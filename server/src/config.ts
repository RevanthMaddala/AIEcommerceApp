const env = process.env;

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type AiProvider = "claude" | "gemini";

/** Market settings: which Google Shopping country to search and how to show prices. */
const REGIONS = {
  US: { code: "US", name: "the United States", gl: "us", googleDomain: "google.com", location: undefined, currency: "USD", locale: "en-US" },
  IN: { code: "IN", name: "India", gl: "in", googleDomain: "google.co.in", location: "India", currency: "INR", locale: "en-IN" },
} as const;
export type Region = (typeof REGIONS)[keyof typeof REGIONS];

const regionCode = (env.REGION || "US").toUpperCase();
const region: Region = REGIONS[regionCode as keyof typeof REGIONS] ?? REGIONS.US;

export const config = {
  port: num(env.PORT, 4000),
  region,
  // "auto" picks Claude if its credentials are set, else Gemini, else the rule-based pipeline.
  aiProvider: (env.AI_PROVIDER || "auto").toLowerCase() as "auto" | AiProvider | "heuristic",
  claudeModel: env.CLAUDE_MODEL || "claude-opus-5-5",
  // Comma-separated; later models are used when earlier ones hit their daily free quota.
  geminiModels: (env.GEMINI_MODEL || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  providerTimeoutMs: num(env.PROVIDER_TIMEOUT_MS, 6000),
  // How many top picks get every store's price and link (Flipkart, Amazon, ...)
  // before results are shown. Each costs one SerpApi search; 0 turns it off.
  autoStoreLookups: num(env.AUTO_STORE_LOOKUPS, 3),
  cacheTtlMs: num(env.CACHE_TTL_SECONDS, 300) * 1000,
  keys: {
    gemini: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "",
    bestBuy: env.BESTBUY_API_KEY || "",
    ebayClientId: env.EBAY_CLIENT_ID || "",
    ebayClientSecret: env.EBAY_CLIENT_SECRET || "",
    ebayMarketplace: env.EBAY_MARKETPLACE_ID || "EBAY_US",
    serpApi: env.SERPAPI_KEY || "",
  },
  // The demo catalog needs no key, but its prices are US dollars, so it's only on
  // by default for the US. Turn it off once real providers are configured.
  enableDemoCatalog: env.ENABLE_DEMO_CATALOG ? env.ENABLE_DEMO_CATALOG !== "false" : region.code === "US",
};

const hasClaude = () => Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE);
const hasGemini = () => Boolean(config.keys.gemini);

/** Which LLM runs the agent pipeline, or null for the rule-based fallback. */
export function activeAiProvider(): AiProvider | null {
  switch (config.aiProvider) {
    case "heuristic":
      return null;
    case "claude":
    case "gemini":
      return config.aiProvider;
    default:
      return hasClaude() ? "claude" : hasGemini() ? "gemini" : null;
  }
}
