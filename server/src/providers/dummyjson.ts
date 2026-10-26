import { config } from "../config.js";
import type { Availability, Listing } from "../types.js";
import { getJson } from "./http.js";
import type { ProductProvider } from "./types.js";

/**
 * DummyJSON's public product catalog. Needs no key, so the app works out of the
 * box; its prices are sample data, which the UI labels as "Demo Store".
 */
interface DummyProduct {
  id: number;
  title: string;
  description: string;
  category: string;
  price: number;
  discountPercentage?: number;
  rating?: number;
  stock?: number;
  brand?: string;
  sku?: string;
  thumbnail?: string;
  availabilityStatus?: string;
  warrantyInformation?: string;
  shippingInformation?: string;
  weight?: number;
  dimensions?: { width: number; height: number; depth: number };
  reviews?: unknown[];
}

const FIELDS =
  "title,description,category,price,discountPercentage,rating,stock,brand,sku,thumbnail,availabilityStatus,warrantyInformation,shippingInformation,weight,dimensions,reviews";

function availability(p: DummyProduct): Availability {
  if (p.stock === 0 || p.availabilityStatus === "Out of Stock") return "out_of_stock";
  if (p.availabilityStatus === "Low Stock") return "limited";
  return "in_stock";
}

function toListing(p: DummyProduct): Listing {
  const discount = p.discountPercentage ?? 0;
  const price = Math.round(p.price * (1 - discount / 100) * 100) / 100;
  const specs: Record<string, string> = {};
  if (p.warrantyInformation) specs.Warranty = p.warrantyInformation;
  if (p.weight) specs.Weight = `${p.weight} oz`;
  if (p.dimensions) specs.Dimensions = `${p.dimensions.width} × ${p.dimensions.height} × ${p.dimensions.depth} cm`;
  if (p.sku) specs.SKU = p.sku;
  return {
    platform: "Demo Store",
    nativeId: String(p.id),
    title: p.title,
    brand: p.brand,
    category: p.category.replace(/-/g, " "),
    description: p.description,
    image: p.thumbnail,
    rating: p.rating,
    reviewCount: p.reviews?.length,
    price,
    originalPrice: discount > 0 ? p.price : undefined,
    currency: "USD",
    availability: availability(p),
    url: `https://dummyjson.com/products/${p.id}`,
    shipping: p.shippingInformation,
    specs,
  };
}

async function searchOnce(q: string): Promise<DummyProduct[]> {
  const url = `https://dummyjson.com/products/search?q=${encodeURIComponent(q)}&limit=40&select=${FIELDS}`;
  const data = await getJson<{ products: DummyProduct[] }>(url);
  return data.products;
}

export const dummyJsonProvider: ProductProvider = {
  platform: "Demo Store",
  enabled: () => config.enableDemoCatalog,
  async search(query) {
    let products = await searchOnce(query);
    // DummyJSON only does substring matching, so fall back to the query's main words.
    if (products.length === 0) {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 3);
      if (words.length > 1) {
        const batches = await Promise.all(words.map(searchOnce));
        const seen = new Set<number>();
        products = batches.flat().filter((p) => !seen.has(p.id) && seen.add(p.id));
      }
    }
    return products.map(toListing);
  },
};
