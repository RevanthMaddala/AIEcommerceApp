import { bestBuyProvider } from "./bestbuy.js";
import { dummyJsonProvider } from "./dummyjson.js";
import { ebayProvider } from "./ebay.js";
import { serpApiProvider } from "./serpapi.js";
import type { ProductProvider } from "./types.js";

/** Add a new platform by implementing ProductProvider and registering it here. */
export const allProviders: ProductProvider[] = [bestBuyProvider, ebayProvider, serpApiProvider, dummyJsonProvider];

export function activeProviders(): ProductProvider[] {
  return allProviders.filter((p) => p.enabled());
}
