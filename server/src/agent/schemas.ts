import { z } from "zod";
import type { Product, ProviderStatus } from "../types.js";

export const Intent = z.object({
  summary: z.string().describe("One sentence restating what the shopper wants."),
  searchQueries: z
    .array(z.string())
    .describe("1-3 short keyword queries (2-4 words each) to send to store search engines. No prices or filler words."),
  category: z.string().nullable(),
  minPrice: z.number().nullable(),
  maxPrice: z.number().nullable(),
  mustHave: z.array(z.string()).describe("Hard requirements stated by the shopper."),
  niceToHave: z.array(z.string()),
  preferBrands: z.array(z.string()),
  avoidBrands: z.array(z.string()),
  priority: z.enum(["price", "rating", "balanced", "premium"]),
  isComparison: z.boolean().describe("True when the shopper names specific products to compare."),
  clarifyingQuestion: z
    .string()
    .nullable()
    .describe("Only when the request is too vague to search at all; otherwise null."),
});
export type Intent = z.infer<typeof Intent>;

export const Recommendations = z.object({
  headline: z.string().describe("One-line answer to the shopper."),
  picks: z
    .array(
      z.object({
        productId: z.string().describe("Must be an id from the candidate list."),
        label: z.string().describe('Short badge such as "Best overall", "Best value", "Premium pick".'),
        reason: z.string().describe("1-2 sentences tying this product to the shopper's needs."),
        pros: z.array(z.string()),
        cons: z.array(z.string()),
      }),
    )
    .describe("Up to 4 picks, best first."),
  comparison: z.string().describe("A short paragraph comparing the picks: price spread, trade-offs, where to buy."),
  followUps: z.array(z.string()).describe("2-3 follow-up searches the shopper might want next."),
});
export type Recommendations = z.infer<typeof Recommendations>;

export interface Pick {
  product: Product;
  label: string;
  reason: string;
  pros: string[];
  cons: string[];
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

export type AgentEvent =
  | { type: "stage"; stage: "understand" | "research" | "recommend"; status: "start" | "done"; detail?: string }
  | { type: "intent"; intent: Intent }
  | { type: "tool"; name: string; input: unknown; summary: string }
  | { type: "thought"; text: string }
  | { type: "notice"; message: string }
  | { type: "result"; result: PipelineResult }
  | { type: "error"; message: string };

export type Emit = (event: AgentEvent) => void;

export interface PipelineInput {
  query: string;
  userId: string;
  /** Earlier turns in this conversation, so "show cheaper ones" has context. */
  history: { query: string; summary?: string }[];
}
