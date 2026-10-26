import { isUnwantedAccessory, searchAll, tokenize } from "../aggregator.js";
import { config } from "../config.js";
import { getProfile } from "../profiles.js";
import type { Product } from "../types.js";
import type { Emit, Intent, Pick, PipelineInput, PipelineResult } from "./schemas.js";

/**
 * Rule-based pipeline used when no AI model is configured (or it's unreachable).
 * Same stages and output shape as the AI pipeline.
 */
const FILLER = /\b(i|me|my|want|need|looking|for|a|an|the|some|please|find|show|get|buy|good|best|cheap|cheapest|affordable|budget|under|below|less|than|over|above|more|between|and|to|around|about|with|that|has|is|recommend|suggest|compare|vs|versus|top|rated|premium|high|end|quality|rs|rupees|inr|dollars)\b/g;

// An amount like "$500", "₹20,000", "rs 1,20,000", "50k" or "1.5 lakh".
const MONEY = String.raw`(?:\$|₹|rs\.?|inr)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|thousand|lakhs?|lacs?|l)?\b`;

function amount(digits: string, unit: string | undefined): number {
  const n = Number(digits.replace(/,/g, ""));
  if (!unit) return n;
  return unit.startsWith("l") ? n * 100_000 : n * 1000;
}

export const formatPrice = (n: number) =>
  new Intl.NumberFormat(config.region.locale, {
    style: "currency",
    currency: config.region.currency,
    maximumFractionDigits: 0,
  }).format(n);

export function parseIntent(query: string, history: PipelineInput["history"]): Intent {
  let q = query.toLowerCase();
  let minPrice: number | null = null;
  let maxPrice: number | null = null;
  const between = q.match(new RegExp(`between\\s+${MONEY}\\s+(?:and|to|-)\\s+${MONEY}`));
  const under = q.match(new RegExp(`(?:under|below|less than|max|up to|upto|within|<)\\s*${MONEY}`));
  const over = q.match(new RegExp(`(?:over|above|more than|at least|>)\\s*${MONEY}`));
  if (between) {
    minPrice = amount(between[1], between[2]);
    maxPrice = amount(between[3], between[4]);
  } else {
    if (under) maxPrice = amount(under[1], under[2]);
    if (over) minPrice = amount(over[1], over[2]);
  }
  // Drop only the budget phrase, so model numbers like "iPhone 15" stay in the search.
  for (const m of [between, under, over]) if (m) q = q.replace(m[0], " ");

  const priority: Intent["priority"] = /cheap|budget|affordable|value|deal/.test(q)
    ? "price"
    : /premium|high[- ]end|luxury|flagship/.test(q)
      ? "premium"
      : /best rated|top rated|highest rated|reviews/.test(q)
        ? "rating"
        : "balanced";

  // Refinements like "cheaper ones" reuse the previous subject.
  const isRefinement = /^(show |any |what about )?(cheaper|more expensive|better|similar|other|those|these|them)\b/.test(q);
  const subjectSource = isRefinement && history.length ? `${history.at(-1)!.query} ${q}` : q;
  const keywords = subjectSource
    .replace(FILLER, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(cheaper|ones|those|these|them|options|something|stuff)\b/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const searchQuery = keywords.slice(0, 4).join(" ") || query;
  const vs = q.split(/\s+(?:vs\.?|versus|or)\s+/);

  return {
    summary: `Looking for ${searchQuery}${maxPrice ? ` under ${formatPrice(maxPrice)}` : ""}${minPrice ? ` over ${formatPrice(minPrice)}` : ""}.`,
    searchQueries: vs.length > 1 && /compare|vs|versus/.test(q) ? vs.map((s) => s.replace(FILLER, " ").trim()).slice(0, 3) : [searchQuery],
    category: null,
    minPrice,
    maxPrice,
    mustHave: [],
    niceToHave: [],
    preferBrands: [],
    avoidBrands: [],
    priority,
    isComparison: /compare|\bvs\b|versus/.test(q),
    clarifyingQuestion: null,
  };
}

function prosCons(p: Product, pool: Product[]) {
  const pros: string[] = [];
  const cons: string[] = [];
  const prices = pool.map((x) => x.bestPrice).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)] ?? p.bestPrice;
  if (p.rating && p.rating >= 4.3) pros.push(`Highly rated (${p.rating.toFixed(1)}★)`);
  if (p.rating && p.rating < 3.5) cons.push(`Mixed reviews (${p.rating.toFixed(1)}★)`);
  if (p.bestPrice < median * 0.85) pros.push("Priced below similar options");
  if (p.bestPrice > median * 1.3) cons.push("Pricier than most alternatives");
  const discounted = p.offers.find((o) => o.originalPrice && o.originalPrice > o.price);
  if (discounted) pros.push(`On sale at ${discounted.platform} (was ${formatPrice(discounted.originalPrice!)})`);
  if (p.platforms.length > 1) pros.push(`Available on ${p.platforms.length} platforms`);
  if (p.offers.every((o) => o.availability === "out_of_stock")) cons.push("Currently out of stock");
  else if (p.offers.some((o) => o.availability === "limited")) cons.push("Limited stock");
  return { pros, cons };
}

export async function runHeuristicPipeline(input: PipelineInput, emit: Emit): Promise<PipelineResult> {
  const timings: Record<string, number> = {};
  const profile = getProfile(input.userId);

  let t = Date.now();
  emit({ type: "stage", stage: "understand", status: "start" });
  const intent = parseIntent(input.query, input.history);
  emit({ type: "intent", intent });
  emit({ type: "stage", stage: "understand", status: "done", detail: intent.summary });
  timings.understand = Date.now() - t;

  t = Date.now();
  emit({ type: "stage", stage: "research", status: "start" });
  const results = await Promise.all(
    intent.searchQueries.map((sq) => {
      emit({ type: "tool", name: "search_products", input: { query: sq }, summary: `Searching all platforms for "${sq}"` });
      return searchAll(sq, {
        query: sq,
        minPrice: intent.minPrice ?? undefined,
        maxPrice: intent.maxPrice ?? profile.maxBudget,
        priority: intent.priority === "balanced" ? profile.priority : intent.priority,
        profile,
      });
    }),
  );
  const seen = new Set<string>();
  const products = results
    .flatMap((r) => r.products)
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const providers = results[0]?.providers ?? [];
  emit({ type: "stage", stage: "research", status: "done", detail: `${products.length} products from ${providers.filter((p) => p.ok).length} platforms` });
  timings.research = Date.now() - t;

  t = Date.now();
  emit({ type: "stage", stage: "recommend", status: "start" });
  const picks: Pick[] = [];
  const add = (p: Product | undefined, label: string, reason: string) => {
    if (p && !picks.some((x) => x.product.id === p.id)) picks.push({ product: p, label, reason, ...prosCons(p, products) });
  };
  const relevantTo = (list: Product[], query: string) => {
    const queryTokens = tokenize(query);
    const needed = Math.max(1, Math.ceil(queryTokens.length * 0.6));
    return list.filter((p) => {
      const hay = `${p.brand ?? ""} ${p.title} ${p.category ?? ""}`.toLowerCase();
      return !isUnwantedAccessory(p, query) && queryTokens.filter((tok) => hay.includes(tok)).length >= needed;
    });
  };
  if (intent.isComparison && results.length > 1) {
    // One finalist per compared item, so "iphone vs samsung" shows one of each.
    results.forEach((r, i) => {
      const q = intent.searchQueries[i];
      add(relevantTo(r.products, q)[0], `Top ${q}`, `Best-scoring "${q}" across all platforms.`);
    });
  }
  const top = products.slice(0, 12);
  const relevant = relevantTo(top, intent.searchQueries[0]);
  const pool = relevant.length ? relevant : top;
  if (!intent.isComparison) {
    const best = pool[0];
    add(best, "Best match", "Closest match to your search with a strong balance of price and reviews.");
    const value = [...pool].filter((p) => (p.rating ?? 0) >= 3.5).sort((a, b) => a.bestPrice - b.bestPrice)[0];
    if (value && best && value.bestPrice < best.bestPrice) {
      add(value, "Best value", `Lowest price among well-reviewed options at ${formatPrice(value.bestPrice)}.`);
    }
    const rated = [...pool].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    add(rated, "Top rated", `Highest customer rating in this set${rated?.rating ? ` (${rated.rating.toFixed(1)}★)` : ""}.`);
  }
  emit({ type: "stage", stage: "recommend", status: "done" });
  timings.recommend = Date.now() - t;

  const prices = pool.map((p) => p.bestPrice);
  return {
    mode: "heuristic",
    intent,
    headline: products.length
      ? `Found ${products.length} options for "${intent.searchQueries[0]}" — here are my top picks.`
      : `No products found for "${input.query}". Try different keywords.`,
    picks,
    comparison: products.length
      ? `Prices range from ${formatPrice(Math.min(...prices))} to ${formatPrice(Math.max(...prices))} across ${providers.filter((p) => p.ok).length} platform(s). Connect an AI model on the server (GEMINI_API_KEY or ANTHROPIC_API_KEY) for AI-written comparisons.`
      : "",
    followUps: intent.searchQueries[0] ? [`cheaper ${intent.searchQueries[0]}`, `best rated ${intent.searchQueries[0]}`] : [],
    products,
    providers,
    timings,
  };
}
