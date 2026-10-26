import { z } from "zod";
import { compactProduct, getProduct, searchAll } from "../aggregator.js";
import type { Product, ProviderStatus, UserProfile } from "../types.js";
import type { Emit, Intent } from "./schemas.js";

/** A research tool, described once and adapted to each model provider's tool format. */
export interface ResearchTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string>;
}

const tool = <S extends z.ZodType>(t: ResearchTool<S>): ResearchTool => t as unknown as ResearchTool;

export interface ResearchState {
  intent: Intent;
  profile: UserProfile;
  emit: Emit;
  /** Every product any search returned; the recommend stage may only pick from here. */
  pool: Map<string, Product>;
  providers: ProviderStatus[];
}

export function researchTools(state: ResearchState): ResearchTool[] {
  return [
    tool({
      name: "search_products",
      description:
        "Search every connected store in parallel. Returns products grouped across platforms with their offers, sorted by relevance to the shopper. Use concise keyword queries.",
      schema: z.object({
        query: z.string().describe("Store search keywords, e.g. 'noise cancelling headphones'"),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
      }),
      run: async ({ query, minPrice, maxPrice }) => {
        state.emit({
          type: "tool",
          name: "search_products",
          input: { query, minPrice, maxPrice },
          summary: `Searching all platforms for "${query}"`,
        });
        const res = await searchAll(query, {
          query,
          minPrice,
          maxPrice,
          priority: state.intent.priority,
          profile: state.profile,
          limit: 15,
        });
        state.providers = res.providers;
        for (const p of res.products) state.pool.set(p.id, p);
        return JSON.stringify({
          platforms: res.providers.map((s) => ({ platform: s.platform, ok: s.ok, results: s.count, error: s.error })),
          products: res.products.slice(0, 12).map(compactProduct),
        });
      },
    }),
    tool({
      name: "get_product_details",
      description: "Full details for one product: description, specs, and every platform offer with price, availability and condition.",
      schema: z.object({ productId: z.string() }),
      run: async ({ productId }) => {
        const p = getProduct(productId);
        state.emit({ type: "tool", name: "get_product_details", input: { productId }, summary: `Inspecting ${p?.title ?? productId}` });
        if (!p) return JSON.stringify({ error: "Unknown productId. Use an id returned by search_products." });
        return JSON.stringify({ ...compactProduct(p), description: p.description, specs: p.specs });
      },
    }),
    tool({
      name: "compare_products",
      description:
        "Side-by-side comparison of 2-6 products: cheapest offer and platform, price spread across platforms, rating, availability.",
      schema: z.object({ productIds: z.array(z.string()) }),
      run: async ({ productIds }) => {
        const products = productIds.map((id) => getProduct(id)).filter((p): p is Product => Boolean(p));
        state.emit({ type: "tool", name: "compare_products", input: { productIds }, summary: `Comparing ${products.length} finalists` });
        if (products.length === 0) return JSON.stringify({ error: "None of these ids are known. Use ids returned by search_products." });
        const cheapest = Math.min(...products.map((p) => p.bestPrice));
        return JSON.stringify(
          products.map((p) => ({
            id: p.id,
            title: p.title,
            rating: p.rating,
            reviews: p.reviewCount,
            bestPrice: p.bestPrice,
            bestPlatform: p.offers[0]?.platform,
            priceAboveCheapest: Math.round((p.bestPrice - cheapest) * 100) / 100,
            priceSpreadAcrossPlatforms:
              p.offers.length > 1 ? Math.round((p.offers.at(-1)!.price - p.offers[0].price) * 100) / 100 : 0,
            inStockOn: p.offers.filter((o) => o.availability !== "out_of_stock").map((o) => o.platform),
          })),
        );
      },
    }),
  ];
}
