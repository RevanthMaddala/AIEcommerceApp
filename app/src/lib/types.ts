// Mirrors the server's response shapes (server/src/types.ts, server/src/agent/schemas.ts).

export type Availability = "in_stock" | "limited" | "out_of_stock" | "unknown";
export type Priority = "price" | "rating" | "balanced" | "premium";

export interface Offer {
  id: string;
  platform: string;
  price: number;
  originalPrice?: number;
  currency: string;
  availability: Availability;
  seller?: string;
  title?: string;
  shipping?: string;
  condition?: string;
  /** Present when more stores (and direct links) can be looked up for this offer. */
  linkToken?: string;
  trusted?: boolean;
  suspect?: string;
  fetchedAt: number;
}

export interface Product {
  id: string;
  title: string;
  brand?: string;
  category?: string;
  description?: string;
  image?: string;
  rating?: number;
  reviewCount?: number;
  specs: Record<string, string>;
  offers: Offer[];
  bestPrice: number;
  currency: string;
  platforms: string[];
  score?: number;
  /** Set when the server can look up more stores for this product. */
  storesToken?: string;
}

export interface Intent {
  summary: string;
  searchQueries: string[];
  category: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  mustHave: string[];
  niceToHave: string[];
  preferBrands: string[];
  avoidBrands: string[];
  priority: Priority;
  isComparison: boolean;
  clarifyingQuestion: string | null;
}

export interface Pick {
  product: Product;
  label: string;
  reason: string;
  pros: string[];
  cons: string[];
}

export interface ProviderStatus {
  platform: string;
  ok: boolean;
  count: number;
  ms: number;
  cached: boolean;
  error?: string;
}

export interface PipelineResult {
  mode: "claude" | "gemini" | "heuristic";
  intent: Intent;
  headline: string;
  picks: Pick[];
  comparison: string;
  followUps: string[];
  products: Product[];
  providers: ProviderStatus[];
  timings: Record<string, number>;
}

export type Stage = "understand" | "research" | "recommend";

export type AgentEvent =
  | { type: "stage"; stage: Stage; status: "start" | "done"; detail?: string }
  | { type: "intent"; intent: Intent }
  | { type: "tool"; name: string; input: unknown; summary: string }
  | { type: "thought"; text: string }
  | { type: "notice"; message: string }
  | { type: "result"; result: PipelineResult }
  | { type: "error"; message: string };

export interface UserProfile {
  userId: string;
  preferredBrands: string[];
  avoidBrands: string[];
  maxBudget?: number;
  priority: Priority;
  brandAffinity: Record<string, number>;
  categoryAffinity: Record<string, number>;
  recentQueries: string[];
  recentClicks: { productId: string; title: string; brand?: string; price: number; at: number }[];
}

export const AI_NAMES = { claude: "Claude", gemini: "Gemini", heuristic: "quick mode" } as const;

export interface Health {
  ok: boolean;
  ai: { mode: "claude" | "gemini" | "heuristic"; model?: string };
  region: { code: string; currency: string; locale: string };
  providers: { platform: string; enabled: boolean }[];
}
