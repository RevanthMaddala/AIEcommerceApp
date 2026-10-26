import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";
import { expandStores } from "../aggregator.js";
import { activeAiProvider, config } from "../config.js";
import { recordQuery } from "../profiles.js";
import { runAgentPipeline } from "./agent.js";
import { claudeBackend } from "./claude.js";
import { geminiBackend } from "./gemini.js";
import { runHeuristicPipeline } from "./heuristic.js";
import type { Emit, PipelineInput, PipelineResult } from "./schemas.js";

function describe(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude credentials were rejected";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limited right now";
  if (err instanceof Anthropic.APIConnectionError) return "Claude could not be reached";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}`;
  if (err instanceof GeminiApiError) {
    if (err.status === 429 && /PerDay/.test(err.message)) {
      return "Gemini's free daily quota is used up for every configured model (it resets at midnight Pacific time)";
    }
    if (err.status === 429) return "Gemini's free-tier limit was reached (it resets within a minute)";
    if (err.status === 400 || err.status === 401 || err.status === 403) return `Gemini rejected the request (${err.status}) — check GEMINI_API_KEY and GEMINI_MODEL`;
    if (err.status === 404) return "Gemini model not found — check GEMINI_MODEL";
    if (err.status === 500 || err.status === 503) return "Gemini is overloaded right now";
    return `Gemini API error ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

const backends = { claude: claudeBackend, gemini: geminiBackend };

/** The model the agent would use right now, for /api/health. */
export function activeModel(): string | undefined {
  const provider = activeAiProvider();
  return provider ? backends[provider].model : undefined;
}

/**
 * Search results name one seller per product, so big stores like Flipkart rarely
 * show up. Load every store for the top picks so their cards can link to them.
 */
async function addStoresToPicks(result: PipelineResult): Promise<PipelineResult> {
  const picks = result.picks.slice(0, config.autoStoreLookups).filter((p) => p.product.storesToken);
  const settled = await Promise.allSettled(picks.map((p) => expandStores(p.product.id)));
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) picks[i].product = r.value;
    else if (r.status === "rejected") console.warn(`[stores] lookup failed for ${picks[i].product.id}:`, r.reason);
  });
  return result;
}

/** Runs the LLM agent when one is configured and degrades to the rule-based pipeline on failure. */
export async function runPipeline(input: PipelineInput, emit: Emit, signal: AbortSignal): Promise<PipelineResult> {
  recordQuery(input.userId, input.query);
  const provider = activeAiProvider();
  if (provider) {
    try {
      return await addStoresToPicks(await runAgentPipeline(backends[provider], input, emit, signal));
    } catch (err) {
      if (signal.aborted) throw err;
      console.error(`[agent] ${provider} pipeline failed:`, err);
      emit({ type: "notice", message: `${describe(err)} — switched to quick search mode.` });
    }
  }
  return addStoresToPicks(await runHeuristicPipeline(input, emit));
}
