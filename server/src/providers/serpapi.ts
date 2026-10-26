import { TtlCache } from "../cache.js";
import { config } from "../config.js";
import type { Listing } from "../types.js";
import { getJson, toNumber } from "./http.js";
import type { ProductProvider } from "./types.js";

/**
 * Google Shopping via SerpApi. One call returns offers from many merchants
 * (Amazon, Walmart, Flipkart, ... depending on REGION), so each result keeps its
 * merchant as the platform.
 */
interface ShoppingResult {
  product_id?: string;
  title: string;
  source?: string;
  link?: string;
  product_link?: string;
  immersive_product_page_token?: string;
  extracted_price?: number;
  extracted_old_price?: number;
  price?: string;
  thumbnail?: string;
  rating?: number;
  reviews?: number;
  delivery?: string;
  second_hand_condition?: string;
}

/** Google lists the same store as "Amazon.in" and "amazon.in"; show one name. */
export function storeName(source: string): string {
  const s = source.trim();
  return s === s.toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Flipshope's URLs end with Flipkart's product id ("...-silver--1--COMHZQX4GXGGJHDY"),
 * which opens that exact item on Flipkart. Without one, search Flipkart for the
 * model number (e.g. "MDHA4H"), which matches far better than the whole title.
 */
function flipkartUrl(flipshopeLink: string | undefined, title: string): string {
  const pid = flipshopeLink?.match(/--([A-Z0-9]{16})(?:[?#]|$)/)?.[1];
  if (pid) return `https://www.flipkart.com/product/p/itme?pid=${pid}`;
  // Model numbers are capitals and digits with at least two letters: MDHA4H, MDH84HN/A.
  const model = title.match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z][A-Z0-9]*[A-Z])[A-Z0-9]{5,}(?:\/[A-Z])?/g)?.pop();
  const q = model ? `${title.split(/[(-]/)[0].trim()} ${model}` : title;
  return `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`;
}

function regionParams(): Record<string, string> {
  const { gl, googleDomain, location } = config.region;
  return { gl, hl: "en", google_domain: googleDomain, ...(location ? { location } : {}) };
}

export const serpApiProvider: ProductProvider = {
  platform: "Google Shopping",
  enabled: () => Boolean(config.keys.serpApi),
  async search(query, opts) {
    const params = new URLSearchParams({
      engine: "google_shopping",
      q: query,
      api_key: config.keys.serpApi,
      num: String(opts.limit ?? 20),
      ...regionParams(),
    });
    if (opts.minPrice) params.set("min_price", String(opts.minPrice));
    if (opts.maxPrice) params.set("max_price", String(opts.maxPrice));
    const data = await getJson<{ shopping_results?: ShoppingResult[] }>(`https://serpapi.com/search.json?${params}`);
    return (data.shopping_results ?? []).flatMap((r, i): Listing[] => {
      const price = r.extracted_price ?? toNumber(r.price);
      const url = r.link ?? r.product_link;
      if (!price || !url) return [];
      const platform = storeName(r.source ?? "Google Shopping");
      // Flipshope tracks Flipkart's prices under Flipkart's own titles, and is
      // often the only way Flipkart items reach Google's results. Show it as
      // the Flipkart price and send shoppers to Flipkart for that exact item.
      if (/^flipshope/i.test(platform)) {
        const title = r.title.replace(/\.\.\.more$/, "").trim();
        return [
          {
            platform: "Flipkart",
            nativeId: r.product_id ?? `${i}-${r.title}`,
            title,
            image: r.thumbnail,
            rating: r.rating,
            reviewCount: r.reviews,
            price,
            originalPrice: r.extracted_old_price,
            currency: config.region.currency,
            availability: "unknown",
            url: flipkartUrl(r.link, title),
            seller: "Price tracked by Flipshope, may have changed",
            // Search results only link to Google; the store list has Flipshope's
            // link, which carries Flipkart's product id.
            linkToken: r.link ? undefined : r.immersive_product_page_token,
          },
        ];
      }
      return [
        {
          platform,
          nativeId: r.product_id ?? `${i}-${r.title}`,
          title: r.title,
          image: r.thumbnail,
          rating: r.rating,
          reviewCount: r.reviews,
          price,
          originalPrice: r.extracted_old_price,
          currency: config.region.currency,
          availability: "unknown",
          url,
          seller: platform,
          shipping: r.delivery,
          condition: r.second_hand_condition,
          // Google Shopping only links to Google's own product page; the token
          // lets us fetch the stores' direct links on demand.
          linkToken: r.link ? undefined : r.immersive_product_page_token,
        },
      ];
    });
  },
};

export interface StoreOffer {
  name: string;
  link: string;
  /** The store's own product title, which names the exact configuration. */
  title?: string;
  price?: number;
  originalPrice?: number;
  shipping?: string;
}

interface ImmersiveProduct {
  product_results?: {
    stores?: {
      name?: string;
      link?: string;
      title?: string;
      extracted_price?: number;
      extracted_original_price?: number;
      shipping?: string;
    }[];
  };
}

const storeCache = new TtlCache<StoreOffer[]>(60 * 60 * 1000);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every store Google lists for one product, with direct links and prices. This
 * is where sellers like Flipkart show up even when they aren't a top search
 * result. Costs one SerpApi search, so it only runs on demand and is cached.
 */
export async function fetchStores(token: string): Promise<StoreOffer[]> {
  const { value } = await storeCache.getOrLoad(token, async () => {
    const params = new URLSearchParams({ engine: "google_immersive_product", page_token: token, api_key: config.keys.serpApi });
    // Popular products list many sellers and take longer than a search, and the
    // shopper is waiting on this one request, so allow more time.
    const data = await getJson<ImmersiveProduct>(`https://serpapi.com/search.json?${params}`, {}, 20_000);
    const stores = (data.product_results?.stores ?? []).flatMap((s): StoreOffer[] =>
      s.name && s.link && /^https?:\/\//.test(s.link)
        ? [
            {
              name: storeName(s.name),
              link: s.link,
              title: s.title,
              price: s.extracted_price,
              originalPrice: s.extracted_original_price,
              shipping: s.shipping,
            },
          ]
        : [],
    );
    // Show Flipshope as the Flipkart item it tracks, unless Flipkart is listed itself.
    const hasFlipkart = stores.some((s) => /^flipkart/i.test(s.name));
    return stores.flatMap((s) => {
      if (!/^flipshope/i.test(s.name)) return [s];
      if (hasFlipkart) return [];
      const title = s.title?.replace(/\.\.\.more$/, "").trim();
      return [{ ...s, name: "Flipkart", title, link: flipkartUrl(s.link, title ?? "") }];
    });
  });
  return value;
}

/**
 * The merchant's own product page for a Google Shopping offer, or undefined when
 * that merchant isn't listed (the caller then falls back to Google's page).
 */
export async function resolveMerchantLink(token: string, merchant: string): Promise<string | undefined> {
  const stores = await fetchStores(token);
  // Search results name sellers like "Walmart - Secondipity"; the store list may say "Walmart".
  const want = norm(merchant);
  const match =
    stores.find((s) => norm(s.name) === want) ??
    stores.find((s) => want.startsWith(norm(s.name)) || norm(s.name).startsWith(want));
  return match?.link;
}
