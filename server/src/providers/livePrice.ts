import { TtlCache } from "../cache.js";
import type { Availability } from "../types.js";
import { toNumber } from "./http.js";

export interface LivePrice {
  price: number;
  availability: Availability;
}

const cache = new TtlCache<LivePrice | null>(20 * 60 * 1000);

/**
 * The store's current price, read from the schema.org Product data on its own
 * product page. Price trackers like Flipshope can lag the store by hours, so
 * this is what makes a tracked Flipkart price match what the shopper sees.
 * Only Flipkart product pages are read; returns undefined when the page can't
 * be read, and the caller keeps the tracked price.
 */
export async function fetchLivePrice(url: string): Promise<LivePrice | undefined> {
  if (!/^https:\/\/www\.flipkart\.com\/.+[?&]pid=[A-Z0-9]{16}/.test(url)) return undefined;
  const { value } = await cache.getOrLoad(url, async () => {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    for (const [, json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        const data: unknown = JSON.parse(json);
        for (const item of Array.isArray(data) ? data : [data]) {
          const offers = (item as { "@type"?: string; offers?: unknown })?.offers;
          if ((item as { "@type"?: string })["@type"] !== "Product" || !offers) continue;
          const offer = (Array.isArray(offers) ? offers[0] : offers) as { price?: unknown; availability?: string };
          const price = toNumber(offer.price);
          if (!price) continue;
          const stock = offer.availability ?? "";
          const availability: Availability = /InStock/i.test(stock)
            ? "in_stock"
            : /LimitedAvailability/i.test(stock)
              ? "limited"
              : /OutOfStock|SoldOut|Discontinued/i.test(stock)
                ? "out_of_stock"
                : "unknown";
          return { price, availability };
        }
      } catch {
        // Not every JSON-LD block parses; try the next one.
      }
    }
    return null;
  });
  return value ?? undefined;
}
