import { ApiError, GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { config } from "../config.js";
import type { LlmBackend } from "./agent.js";

let client: GoogleGenAI | undefined;
// Per-request timeout: under load a free-tier request can hang with no response.
const ai = () => (client ??= new GoogleGenAI({ apiKey: config.keys.gemini, httpOptions: { timeout: 60_000 } }));

/** Zod -> plain JSON Schema for Gemini's responseJsonSchema / parametersJsonSchema. */
function jsonSchema(schema: z.ZodType) {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

// Free-tier quotas are counted per model, so when one model's daily quota runs
// out we move on to the next model in GEMINI_MODEL until its quota resets.
const exhaustedUntil = new Map<string, number>();

export function currentGeminiModel(): string {
  const now = Date.now();
  return config.geminiModels.find((m) => (exhaustedUntil.get(m) ?? 0) <= now) ?? config.geminiModels[0];
}

/**
 * Handles the failures that are usually temporary on the free tier, instead of
 * failing the whole search:
 * - 429 daily quota: switch to the next configured model.
 * - 429 per-minute quota: wait as long as Google says, if that's short.
 * - 500/503 "high demand": brief backoff.
 * - A request that timed out: one more try.
 */
async function withRetry<T>(fn: (model: string) => Promise<T>, signal: AbortSignal, onNotice: (m: string) => void): Promise<T> {
  for (let attempt = 0; ; ) {
    const model = currentGeminiModel();
    try {
      return await fn(model);
    } catch (err) {
      if (signal.aborted) throw err;
      if (err instanceof ApiError && err.status === 429 && /PerDay/.test(err.message)) {
        const seconds = Number(/"retryDelay":"(\d+(?:\.\d+)?)s"/.exec(err.message)?.[1] ?? 3600);
        exhaustedUntil.set(model, Date.now() + seconds * 1000);
        const next = currentGeminiModel();
        if (next === model) throw err; // every configured model is out of quota
        onNotice(`Today's free quota for ${model} is used up, switching to ${next}…`);
        continue;
      }
      if (attempt++ >= 3) throw err;
      if (!(err instanceof ApiError)) {
        const timedOut = err instanceof Error && /abort|timeout|timed out/i.test(`${err.name} ${err.message}`);
        if (!timedOut || attempt >= 1) throw err;
        onNotice("Gemini is slow to respond, trying again…");
        continue;
      }
      let seconds: number;
      if (err.status === 429) {
        seconds = Number(/"retryDelay":"(\d+(?:\.\d+)?)s"/.exec(err.message)?.[1] ?? 15);
        // Per-minute windows reset within ~60s, so a wait that long still beats falling back.
        if (seconds > 65) throw err;
        onNotice(`Gemini free-tier limit reached, waiting ${Math.ceil(seconds)}s…`);
      } else if (err.status === 500 || err.status === 503) {
        seconds = 2 * 2 ** attempt;
        onNotice(`Gemini is busy, retrying in ${seconds}s…`);
      } else {
        throw err;
      }
      await sleep(seconds * 1000 + 500, undefined, { signal });
    }
  }
}

// Gemini thinks at HIGH by default, which made one search take minutes. These
// steps are routine, so keep thinking light and save depth for the final picks.
const THINKING = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM } as const;

/** Visible text of a response, skipping thought summaries and function-call parts. */
function textOf(parts: Part[] | undefined): string {
  return (parts ?? [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
}

export const geminiBackend: LlmBackend = {
  name: "gemini",
  get model() {
    return currentGeminiModel();
  },

  async structured({ system, user, schema, effort, signal, onNotice }) {
    const res = await withRetry((model) => ai().models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema(schema),
        thinkingConfig: { thinkingLevel: THINKING[effort] },
        abortSignal: signal,
      },
    }), signal, onNotice);
    const text = textOf(res.candidates?.[0]?.content?.parts);
    if (!text) throw new Error(`Gemini returned no output (${res.candidates?.[0]?.finishReason ?? "unknown reason"}).`);
    return schema.parse(JSON.parse(text));
  },

  async research({ system, user, tools, maxSteps, signal, onText, onNotice }) {
    const byName = new Map(tools.map((t) => [t.name, t]));
    const declarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: jsonSchema(t.schema),
    }));
    const contents: Content[] = [{ role: "user", parts: [{ text: user }] }];

    let notes = "";
    for (let step = 0; step < maxSteps; step++) {
      const res = await withRetry(
        (model) =>
          ai().models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: system,
              tools: [{ functionDeclarations: declarations }],
              thinkingConfig: { thinkingLevel: THINKING.low },
              abortSignal: signal,
            },
          }),
        signal,
        onNotice,
      );
      const content = res.candidates?.[0]?.content;
      if (!content) break;
      // Append the model turn unchanged: it carries thought signatures Gemini needs back.
      contents.push(content);
      notes = textOf(content.parts) || notes;

      const calls = (content.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
      if (calls.length === 0) return notes;
      if (notes) onText(notes);

      // Run this turn's calls in parallel and answer them all in one user turn.
      const responses = await Promise.all(
        calls.map(async (call): Promise<Part> => {
          const t = call.name ? byName.get(call.name) : undefined;
          const parsed = t?.schema.safeParse(call.args ?? {});
          const output = !t
            ? { error: `Unknown tool ${call.name}` }
            : !parsed?.success
              ? { error: `Invalid arguments: ${parsed?.error.message}` }
              : { result: await t.run(parsed.data).catch((e: Error) => JSON.stringify({ error: e.message })) };
          return { functionResponse: { id: call.id, name: call.name, response: output } };
        }),
      );
      contents.push({ role: "user", parts: responses });
    }
    return notes;
  },
};
