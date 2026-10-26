import type { z } from "zod";
import { compactProduct, expandStores } from "../aggregator.js";
import { config } from "../config.js";
import { getProfile, profileSummary } from "../profiles.js";
import { RECOMMEND_SYSTEM, RESEARCH_SYSTEM, UNDERSTAND_SYSTEM } from "./prompts.js";
import { Intent, Recommendations, type Emit, type Pick, type PipelineInput, type PipelineResult } from "./schemas.js";
import { researchTools, type ResearchState, type ResearchTool } from "./tools.js";

/** What the pipeline needs from a model provider. Claude and Gemini each implement this. */
export interface LlmBackend {
  name: "claude" | "gemini";
  model: string;
  /** One call that returns JSON matching `schema`. */
  structured<S extends z.ZodType>(opts: {
    system: string;
    user: string;
    schema: S;
    effort: "low" | "medium";
    signal: AbortSignal;
    onNotice: (message: string) => void;
  }): Promise<z.infer<S>>;
  /** Tool-using loop; returns the model's final notes. `onText` gets interim reasoning between tool calls. */
  research(opts: {
    system: string;
    user: string;
    tools: ResearchTool[];
    maxSteps: number;
    signal: AbortSignal;
    onText: (text: string) => void;
    onNotice: (message: string) => void;
  }): Promise<string>;
}

export async function runAgentPipeline(
  llm: LlmBackend,
  input: PipelineInput,
  emit: Emit,
  signal: AbortSignal,
): Promise<PipelineResult> {
  const timings: Record<string, number> = {};
  const profile = getProfile(input.userId);
  const shopper = JSON.stringify(profileSummary(profile));
  const onNotice = (message: string) => emit({ type: "notice", message });

  // ── Stage 1: query understanding ──────────────────────────────────────────
  let t = Date.now();
  emit({ type: "stage", stage: "understand", status: "start" });
  const history = input.history.length
    ? `Earlier in this conversation:\n${input.history.map((h) => `- "${h.query}"${h.summary ? ` (${h.summary})` : ""}`).join("\n")}\n\n`
    : "";
  const intent = await llm.structured({
    system: UNDERSTAND_SYSTEM,
    user: `${history}Saved shopper preferences: ${shopper}\n\nShopper request: ${input.query}`,
    schema: Intent,
    effort: "low",
    signal,
    onNotice,
  });
  emit({ type: "intent", intent });
  emit({ type: "stage", stage: "understand", status: "done", detail: intent.summary });
  timings.understand = Date.now() - t;

  if (intent.clarifyingQuestion && intent.searchQueries.length === 0) {
    return emptyResult(llm.name, intent, intent.clarifyingQuestion, timings);
  }

  // ── Stage 2: multi-step research with tools ───────────────────────────────
  t = Date.now();
  emit({ type: "stage", stage: "research", status: "start" });
  const state: ResearchState = { intent, profile, emit, pool: new Map(), providers: [] };
  let notes = "";
  try {
    notes = await llm.research({
      system: RESEARCH_SYSTEM,
      user: `Search plan: ${JSON.stringify(intent)}\nShopper preferences: ${shopper}\nOriginal request: ${input.query}`,
      tools: researchTools(state),
      maxSteps: 8,
      signal,
      onText: (text) => emit({ type: "thought", text }),
      onNotice,
    });
  } catch (err) {
    // Research that already found products is still worth recommending from.
    if (signal.aborted || state.pool.size === 0) throw err;
    console.warn(`[agent] research stopped early: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    onNotice("Research was cut short, so these picks are based on what was found so far.");
  }
  const { pool, providers } = state;
  emit({
    type: "stage",
    stage: "research",
    status: "done",
    detail: `${pool.size} products from ${providers.filter((p) => p.ok).length} platforms`,
  });
  timings.research = Date.now() - t;

  const products = [...pool.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (products.length === 0) {
    return { ...emptyResult(llm.name, intent, `I couldn't find products matching "${input.query}".`, timings), providers };
  }

  // Search results show one seller per product. Load every store for the
  // leading candidates first, so the picks quote the prices and exact
  // configurations shoppers will see on their cards.
  const top = products.slice(0, config.autoStoreLookups).filter((p) => p.storesToken);
  if (top.length) {
    emit({ type: "tool", name: "check_stores", input: {}, summary: `Checking every store for the top ${top.length} products` });
    const settled = await Promise.allSettled(top.map((p) => expandStores(p.id)));
    // The pool holds its own copies; swap in the expanded products so the
    // recommendations quote the same (live) prices the cards will show.
    settled.forEach((r, i) => {
      if (r.status !== "fulfilled" || !r.value) return;
      pool.set(top[i].id, r.value);
      products[products.indexOf(top[i])] = r.value;
    });
  }

  // ── Stage 3: personalized recommendations ─────────────────────────────────
  t = Date.now();
  emit({ type: "stage", stage: "recommend", status: "start" });
  const rec = await llm.structured({
    system: RECOMMEND_SYSTEM,
    user: [
      `Shopper request: ${input.query}`,
      `Search plan: ${JSON.stringify(intent)}`,
      `Shopper preferences: ${shopper}`,
      `Research notes:\n${notes || "(none)"}`,
      `Candidates:\n${JSON.stringify(products.slice(0, 20).map(compactProduct))}`,
    ].join("\n\n"),
    schema: Recommendations,
    effort: "medium",
    signal,
    onNotice,
  });
  // Only keep picks that point at products we actually fetched.
  const picks: Pick[] = rec.picks.flatMap((pick) => {
    const product = pool.get(pick.productId);
    return product ? [{ product, label: pick.label, reason: pick.reason, pros: pick.pros, cons: pick.cons }] : [];
  });
  emit({ type: "stage", stage: "recommend", status: "done" });
  timings.recommend = Date.now() - t;

  return {
    mode: llm.name,
    intent,
    headline: rec.headline,
    picks,
    comparison: rec.comparison,
    followUps: rec.followUps,
    products,
    providers,
    timings,
  };
}

function emptyResult(
  mode: LlmBackend["name"],
  intent: Intent,
  headline: string,
  timings: Record<string, number>,
): PipelineResult {
  return { mode, intent, headline, picks: [], comparison: "", followUps: [], products: [], providers: [], timings };
}
