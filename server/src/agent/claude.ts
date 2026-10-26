import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "../config.js";
import type { LlmBackend } from "./agent.js";

const client = new Anthropic();

// Server-side refusal fallback: if the primary model declines, the API reroutes
// the same request to a suitable fallback model inside the same call.
const COMMON = {
  model: config.claudeModel,
  betas: ["server-side-fallback-2026-07-01"] satisfies Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
};

function cachedSystem(text: string) {
  return [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];
}

function checkRefusal(message: { stop_reason: string | null }) {
  if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
}

export const claudeBackend: LlmBackend = {
  name: "claude",
  model: config.claudeModel,

  async structured({ system, user, schema, effort, signal }) {
    const res = await client.beta.messages.parse(
      {
        ...COMMON,
        max_tokens: 8000,
        output_config: { effort, format: betaZodOutputFormat(schema) },
        system: cachedSystem(system),
        messages: [{ role: "user", content: user }],
      },
      { signal },
    );
    checkRefusal(res);
    if (res.parsed_output == null) throw new Error("Claude returned output that didn't match the schema.");
    return res.parsed_output;
  },

  async research({ system, user, tools, maxSteps, signal, onText }) {
    const runner = client.beta.messages.toolRunner(
      {
        ...COMMON,
        max_tokens: 16000,
        max_iterations: maxSteps,
        output_config: { effort: "medium" },
        system: cachedSystem(system),
        tools: tools.map((t) => betaZodTool({ name: t.name, description: t.description, inputSchema: t.schema, run: t.run })),
        messages: [{ role: "user", content: user }],
      },
      { signal },
    );
    let notes = "";
    for await (const message of runner) {
      checkRefusal(message);
      for (const block of message.content) {
        if (block.type === "text" && block.text.trim()) {
          notes = block.text;
          if (message.stop_reason === "tool_use") onText(block.text);
        }
      }
    }
    return notes;
  },
};
