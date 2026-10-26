import { config } from "../config.js";
import type { Listing } from "../types.js";
import { getJson } from "./http.js";
import type { ProductProvider } from "./types.js";

/** Best Buy Products API: https://bestbuyapis.github.io/api-documentation/ */
interface BestBuyProduct {
  sku: number;
  name: string;
  salePrice: number;
  regularPrice?: number;
  onlineAvailability?: boolean;
  url: string;
  image?: string;
  manufacturer?: string;
  modelNumber?: string;
  customerReviewAverage?: number;
  customerReviewCount?: number;
  shortDescription?: string;
  categoryPath?: { name: string }[];
  freeShipping?: boolean;
  condition?: string;
}

const SHOW = [
  "sku",
  "name",
  "salePrice",
  "regularPrice",
  "onlineAvailability",
  "url",
  "image",
  "manufacturer",
  "modelNumber",
  "customerReviewAverage",
  "customerReviewCount",
  "shortDescription",
  "categoryPath.name",
  "freeShipping",
  "condition",
].join(",");

export const bestBuyProvider: ProductProvider = {
  platform: "Best Buy",
  // Best Buy only sells in the US.
  enabled: () => Boolean(config.keys.bestBuy) && config.region.code === "US",
  async search(query, opts) {
    const terms = query
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `search=${encodeURIComponent(t.replace(/[()&=]/g, ""))}`)
      .join("&");
    const filters = [terms];
    if (opts.minPrice) filters.push(`salePrice>=${opts.minPrice}`);
    if (opts.maxPrice) filters.push(`salePrice<=${opts.maxPrice}`);
    const url =
      `https://api.bestbuy.com/v1/products(${filters.join("&")})` +
      `?apiKey=${config.keys.bestBuy}&format=json&pageSize=${opts.limit ?? 20}&show=${SHOW}`;
    const data = await getJson<{ products: BestBuyProduct[] }>(url);
    return data.products.map(
      (p): Listing => ({
        platform: "Best Buy",
        nativeId: String(p.sku),
        title: p.name,
        brand: p.manufacturer,
        category: p.categoryPath?.at(-1)?.name,
        description: p.shortDescription,
        image: p.image,
        rating: p.customerReviewAverage,
        reviewCount: p.customerReviewCount,
        price: p.salePrice,
        originalPrice: p.regularPrice && p.regularPrice > p.salePrice ? p.regularPrice : undefined,
        currency: "USD",
        availability: p.onlineAvailability === false ? "out_of_stock" : "in_stock",
        url: p.url,
        seller: "Best Buy",
        shipping: p.freeShipping ? "Free shipping" : undefined,
        condition: p.condition,
        specs: p.modelNumber ? { Model: p.modelNumber } : {},
      }),
    );
  },
};
