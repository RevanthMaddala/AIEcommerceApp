import { createHash } from "node:crypto";
import { TtlCache } from "./cache.js";
import { config } from "./config.js";
import { activeProviders } from "./providers/index.js";
import { fetchLivePrice } from "./providers/livePrice.js";
import { fetchStores } from "./providers/serpapi.js";
import type { Listing, Offer, Product, ProviderStatus, SearchOptions, UserProfile } from "./types.js";

const listingCache = new TtlCache<Listing[]>(config.cacheTtlMs);
// Products and offers stay addressable for an hour so details, compare and the
// purchase redirect keep working after the search that produced them.
const productIndex = new TtlCache<Product>(60 * 60 * 1000, 5000);
const offerIndex = new TtlCache<{ offer: Offer; productId: string }>(60 * 60 * 1000, 20000);

const STOPWORDS = new Set(
  "a an and the for with of in on to by from new best top cheap good under over below above around about my me i want need looking some any is are that this".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/**
 * Model numbers and variants in a title ("WH-1000XM5" -> "wh1000xm5", "128GB").
 * Two listings with different codes are different products even when the rest
 * of the title matches, e.g. WH-1000XM5 headphones vs WF-1000XM5 earbuds.
 */
function modelCodes(title: string): Set<string> {
  const codes = title.toLowerCase().match(/\b[a-z]*-?\d[a-z0-9-]*/g) ?? [];
  // Short codes matter too ("M2" vs "M5" MacBooks); sizes and units ("16gb", "70w", "13inch") are variants, not models.
  const UNIT = /^\d+(\.\d+)?(gb|tb|mb|mah|w|hz|cm|mm|inch|in|mp|k|nm|g|kg|ml|l|x|p|th|nd|rd|st|core|gen)$/;
  return new Set(codes.map((c) => c.replace(/-/g, "")).filter((c) => /[a-z]/.test(c) && /\d/.test(c) && !UNIT.test(c)));
}

const disjoint = (a: Set<string>, b: Set<string>) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));

/**
 * Memory, storage and screen size ("16 GB", "1TB", "13.6 inch"). Listings that
 * spell out different configurations are different products.
 */
function variantSpecs(title: string): Set<string> {
  const t = title.toLowerCase().replace(/[″”"]|′′/g, " inch ");
  const sizes = [...t.matchAll(/\b(\d+(?:\.\d+)?)\s?(gb|tb)\b/g)].map((m) => `${m[1]}${m[2]}`);
  const screens = [...t.matchAll(/\b(\d{2}(?:\.\d)?)\s?-?\s?(?:inch|in\b)/g)].map((m) => `${Math.floor(Number(m[1]))}in`);
  return new Set([...sizes, ...screens]);
}

const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
/** A listing that names no configuration could be any of them, so it only joins others that don't either. */
const compatible = (a: Set<string>, b: Set<string>) =>
  a.size === 0 || b.size === 0 ? a.size === b.size : subset(a, b) || subset(b, a);

const USED = /\b(refurbished|renewed|pre-?owned|used|open[- ]box|second[- ]hand|restored)\b/i;

/** "Refurbished", "Used", ... from the listing's condition field or its title; undefined for new. */
export function usedCondition(title: string, condition?: string): string | undefined {
  const m = (condition ?? "").match(USED) ?? title.match(USED);
  if (!m) return condition && !/^new$/i.test(condition) ? condition : undefined;
  const word = m[1].toLowerCase();
  return /refurb|renewed|restored/.test(word) ? "Refurbished" : /open/.test(word) ? "Open box" : "Used";
}

/** Merge listings that look like the same item on different platforms into one product. */
function groupListings(listings: Listing[]): Product[] {
  const groups: { tokens: Set<string>; codes: Set<string>; specs: Set<string>; used: boolean; product: Product }[] = [];
  const now = Date.now();
  for (const l of listings) {
    const tokens = new Set(tokenize(`${l.brand ?? ""} ${l.title}`));
    const codes = modelCodes(l.title);
    const specs = variantSpecs(l.title);
    const condition = usedCondition(l.title, l.condition);
    const offer: Offer = {
      id: hash(`${l.platform}:${l.nativeId}:${l.url}`),
      platform: l.platform,
      price: l.price,
      originalPrice: l.originalPrice,
      currency: l.currency,
      availability: l.availability,
      url: l.url,
      seller: l.seller,
      title: l.title,
      shipping: l.shipping,
      condition,
      linkToken: l.linkToken,
      fetchedAt: now,
    };
    const match = groups.find(({ tokens: t, codes: c, specs: s, used, product: p }) => {
      if (p.platforms.includes(l.platform)) return false;
      if (used !== Boolean(condition)) return false;
      if (p.brand && l.brand && p.brand.toLowerCase() !== l.brand.toLowerCase()) return false;
      if (disjoint(c, codes) || !compatible(s, specs)) return false;
      const ratio = Math.max(p.bestPrice, l.price) / Math.min(p.bestPrice, l.price);
      return ratio < 2.5 && jaccard(t, tokens) >= 0.6;
    });
    if (match) {
      // Once a group knows its configuration, later listings must agree with it.
      for (const x of specs) match.specs.add(x);
      const p = match.product;
      p.offers.push(offer);
      p.platforms.push(l.platform);
      p.brand ??= l.brand;
      p.category ??= l.category;
      p.description ??= l.description;
      p.image ??= l.image;
      if (l.rating && (!p.rating || (l.reviewCount ?? 0) > (p.reviewCount ?? 0))) {
        p.rating = l.rating;
        p.reviewCount = l.reviewCount;
      }
      Object.assign(p.specs, { ...l.specs, ...p.specs });
      continue;
    }
    groups.push({
      tokens,
      codes,
      specs,
      used: Boolean(condition),
      product: {
        id: hash(`${l.platform}:${l.nativeId}`),
        title: l.title,
        brand: l.brand,
        category: l.category,
        description: l.description,
        image: l.image,
        rating: l.rating,
        reviewCount: l.reviewCount,
        specs: { ...l.specs },
        offers: [offer],
        bestPrice: l.price,
        currency: l.currency,
        platforms: [l.platform],
        // The listing that started this group defines the product, so its token
        // is the right one for looking up other stores.
        storesToken: l.linkToken,
      },
    });
  }
  return groups.map(({ product }) => rankOffers(product));
}

const storeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Big retailers and official brand stores, matched by name prefix ("Amazon.in", "Tata CLiQ - Fashion"). */
const TRUSTED_STORES = [
  "amazon", "flipkart", "croma", "reliancedigital", "vijaysales", "tatacliq", "jiomart", "myntra", "ajio", "nykaa",
  "poorvika", "sangeetha", "zepto", "blinkit", "bigbasket", "swiggy", "apple", "samsung", "oneplus", "walmart", "bestbuy", "target", "costco", "newegg", "bhphoto",
];
/** Price trackers and deal aggregators: they show up as sellers but aren't stores. */
const DEAL_SITES = [
  "flipshope", "smartprix", "mysmartprice", "pricehistory", "pricebefore", "buyhatke", "desidime", "91mobiles", "pricee", "compareraja",
  "gadgetsnow", "gadgets360",
];
/** Real stores whose prices most shoppers can't get (student-only pricing). */
const RESTRICTED_STORES = ["appleeducation"];
function isTrusted(store: string): boolean {
  const key = storeKey(store);
  return TRUSTED_STORES.some((s) => key.startsWith(s)) && !RESTRICTED_STORES.some((s) => key.startsWith(s));
}

/** An offer this far below the trusted (or typical) price is likely used, fake or a listing error. */
const SUSPICIOUS_RATIO = 0.6;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Orders offers so the one we'd send a shopper to comes first: in-stock big
 * stores, then other sellers, then deal sites and suspiciously cheap listings.
 * `bestPrice` is that first offer's price, so the headline price is one the
 * shopper can actually trust.
 */
export function rankOffers(p: Product): Product {
  for (const o of p.offers) {
    const key = storeKey(o.platform);
    o.trusted = isTrusted(o.platform);
    o.suspect = DEAL_SITES.some((s) => key.startsWith(s)) ? "Price-tracking site, not a store" : undefined;
  }
  // Judge prices against new items only: a refurbished unit being cheaper is expected.
  const fresh = p.offers.filter((o) => !o.suspect && !o.condition);
  const trustedPrices = fresh.filter((o) => o.trusted).map((o) => o.price);
  const reference = trustedPrices.length
    ? Math.min(...trustedPrices)
    : fresh.length >= 3
      ? median(fresh.map((o) => o.price))
      : p.typicalPrice;
  for (const o of p.offers) {
    if (!o.suspect && !o.trusted && !o.condition && reference && o.price < reference * SUSPICIOUS_RATIO) {
      o.suspect = "Unusually cheap — check the seller";
    }
  }
  const tier = (o: Offer) =>
    o.suspect ? 4 : o.availability === "out_of_stock" ? 3 : o.condition ? 2 : o.trusted ? 0 : 1;
  p.offers.sort((a, b) => tier(a) - tier(b) || a.price - b.price);
  p.bestPrice = p.offers[0].price;
  return p;
}

const ACCESSORY = ["case", "charger", "cable", "cover", "screen protector", "adapter", "strap", "stand", "sleeve", "mount"];

export function isUnwantedAccessory(p: Product, query: string): boolean {
  const hay = `${p.title} ${p.category ?? ""}`.toLowerCase();
  const accessory = ACCESSORY.find((a) => new RegExp(`\\b${a}`).test(hay));
  return Boolean(accessory && !query.toLowerCase().includes(accessory));
}

export interface RankContext {
  query: string;
  minPrice?: number;
  maxPrice?: number;
  priority?: UserProfile["priority"];
  profile?: UserProfile;
  /** Median price of the result set; used to judge "cheap" when there's no budget. */
  referencePrice?: number;
}

/** Share of query words found in the product (substring match so "phone" hits "iPhone"). */
function relevanceOf(p: Product, query: string): number {
  const q = tokenize(query);
  const hay = haystack(p);
  return q.length ? q.filter((t) => hay.includes(t)).length / q.length : 0.5;
}

const haystack = (p: Product) =>
  `${p.brand ?? ""} ${p.title} ${p.category ?? ""}`.toLowerCase().replace(/(\d)\s+(gb|tb)\b/g, "$1$2");

/**
 * Query words with a digit name a model or variant ("m5", "16", "s25", "256gb").
 * A product missing one is a different model (an M3 MacBook for "MacBook Air M5").
 */
function missesModel(p: Product, query: string): boolean {
  const hay = haystack(p);
  return tokenize(query).some((t) => /\d/.test(t) && !new RegExp(`(^|[^a-z0-9])${t.replace(/[.]/g, "\\.")}`).test(hay));
}

const wantsUsed = (query: string) => USED.test(query);

export function scoreProduct(p: Product, ctx: RankContext): number {
  const relevance = relevanceOf(p, ctx.query);
  // Keyword searches surface accessories ("iPhone case" for "iphone") and
  // refurbished units; demote them unless the shopper asked for one.
  const accessoryPenalty = isUnwantedAccessory(p, ctx.query) ? 1.5 : 0;
  const best = p.offers[0];
  const usedPenalty = best?.condition && !wantsUsed(ctx.query) ? 1.5 : 0;
  const trustPenalty = best?.suspect ? 2 : best?.trusted ? -0.4 : 0;
  const modelPenalty = missesModel(p, ctx.query) ? 2 : 0;
  const rating = (p.rating ?? 3) / 5;
  const ceiling = ctx.maxPrice ?? ctx.profile?.maxBudget;
  const priceFit = ceiling
    ? p.bestPrice > ceiling
      ? -1
      : 1 - p.bestPrice / ceiling
    : ctx.referencePrice
      ? Math.max(-1, 1 - p.bestPrice / (2 * ctx.referencePrice))
      : 0;

  const priority = ctx.priority ?? ctx.profile?.priority ?? "balanced";
  const w = {
    price: { rating: 0.6, price: 2 },
    rating: { rating: 2, price: 0.5 },
    premium: { rating: 1.6, price: -0.4 },
    balanced: { rating: 1.2, price: 1 },
  }[priority];

  let score = relevance * 4 + rating * w.rating + priceFit * w.price - accessoryPenalty - usedPenalty - trustPenalty - modelPenalty;
  const brand = p.brand?.toLowerCase();
  if (brand && ctx.profile) {
    if (ctx.profile.preferredBrands.some((b) => b.toLowerCase() === brand)) score += 1;
    if (ctx.profile.avoidBrands.some((b) => b.toLowerCase() === brand)) score -= 3;
    score += Math.min(1, (ctx.profile.brandAffinity[brand] ?? 0) * 0.2);
  }
  if (p.offers.every((o) => o.availability === "out_of_stock")) score -= 1;
  score += (p.platforms.length - 1) * 0.2;
  return Math.round(score * 1000) / 1000;
}

export interface SearchResult {
  products: Product[];
  providers: ProviderStatus[];
}

/** Fan out to every configured platform in parallel; one failing platform never fails the search. */
export async function searchAll(query: string, opts: SearchOptions & RankContext): Promise<SearchResult> {
  const providers = activeProviders();
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const started = Date.now();
      const key = `${provider.platform}|${query.toLowerCase().trim()}|${opts.minPrice ?? ""}|${opts.maxPrice ?? ""}`;
      const { value, cached } = await listingCache.getOrLoad(key, () =>
        provider.search(query, { minPrice: opts.minPrice, maxPrice: opts.maxPrice, limit: 20 }),
      );
      return { value, cached, ms: Date.now() - started };
    }),
  );

  const statuses: ProviderStatus[] = [];
  const listings: Listing[] = [];
  settled.forEach((r, i) => {
    const platform = providers[i].platform;
    if (r.status === "fulfilled") {
      listings.push(...r.value.value);
      statuses.push({ platform, ok: true, count: r.value.value.length, ms: r.value.ms, cached: r.value.cached });
    } else {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      statuses.push({ platform, ok: false, count: 0, ms: 0, cached: false, error });
    }
  });

  let products = groupListings(listings);
  markTypicalPrices(products, query);
  const inRange = products.filter(
    (p) => (!opts.minPrice || p.bestPrice >= opts.minPrice) && (!opts.maxPrice || p.bestPrice <= opts.maxPrice),
  );
  if (inRange.length > 0) products = inRange;

  const prices = products.map((p) => p.bestPrice).sort((a, b) => a - b);
  const referencePrice = prices[Math.floor(prices.length / 2)];
  for (const p of products) {
    p.score = scoreProduct(p, { ...opts, query, referencePrice });
    remember(p);
  }
  products.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { products: products.slice(0, opts.limit ?? 30), providers: statuses };
}

/**
 * For a specific model ("MacBook Air M5", "iPhone 16"), every full match should
 * cost about the same, so a one-store listing at half the typical price is
 * probably fake or a listing error. Broad searches ("laptop") span too wide a
 * price range to judge this way.
 */
function markTypicalPrices(products: Product[], query: string) {
  if (!tokenize(query).some((t) => /\d/.test(t))) return;
  const matches = products.filter((p) => relevanceOf(p, query) === 1 && !isUnwantedAccessory(p, query));
  const peers = matches.filter((p) => !p.offers[0].condition && !p.offers[0].suspect);
  if (peers.length < 3) return;
  const typical = median(peers.map((p) => p.bestPrice));
  for (const p of matches) {
    p.typicalPrice = typical;
    rankOffers(p);
  }
}

function remember(p: Product) {
  productIndex.set(p.id, p);
  for (const offer of p.offers) offerIndex.set(offer.id, { offer, productId: p.id });
}

export const getProduct = (id: string) => productIndex.get(id);

/**
 * Adds every other store Google lists for this product (Flipkart, Croma, ...)
 * as offers with direct links, and swaps existing offers' Google links for
 * direct ones. One SerpApi search per product, cached for an hour.
 */
export async function expandStores(id: string): Promise<Product | undefined> {
  const p = productIndex.get(id);
  const token = p?.storesToken;
  if (!p || !token) return p;
  const stores = await fetchStores(token);
  // Search titles like "Apple MacBook Air M5 chip" hide the configuration, but
  // each store names it ("16 GB/512 GB SSD ... 15.3 inch"). Adopt the most
  // specific store title so shoppers can see exactly what they're buying.
  let want = variantSpecs(p.title);
  let adopted = false;
  if (want.size === 0) {
    const named = stores
      .filter((s) => s.title)
      .map((s) => ({ s, specs: variantSpecs(s.title!) }))
      .sort((a, b) => b.specs.size - a.specs.size || Number(isTrusted(b.s.name)) - Number(isTrusted(a.s.name)))[0];
    if (named?.specs.size) {
      p.title = named.s.title!;
      want = named.specs;
      adopted = true;
    }
  }
  const confirmed = new Set<Offer>();
  for (const s of stores) {
    // A store listing a different configuration is a different product.
    const specs = s.title ? variantSpecs(s.title) : new Set<string>();
    if (want.size && specs.size && !subset(want, specs) && !subset(specs, want)) continue;
    if (s.title && disjoint(modelCodes(p.title), modelCodes(s.title))) continue;
    const existing = p.offers.find((o) => storeKey(o.platform) === storeKey(s.name));
    if (existing) {
      existing.url = s.link;
      existing.linkToken = undefined;
      existing.title ??= s.title;
      confirmed.add(existing);
      continue;
    }
    if (!s.price) continue;
    const offer: Offer = {
      id: hash(`${s.name}:${s.link}`),
      platform: s.name,
      price: s.price,
      originalPrice: s.originalPrice && s.originalPrice > s.price ? s.originalPrice : undefined,
      currency: p.currency,
      availability: "unknown",
      url: s.link,
      seller: s.name,
      title: s.title,
      shipping: s.shipping,
      // Google lists stores per listing, so a refurbished listing's stores sell it refurbished too.
      condition: p.offers.every((o) => o.condition) ? p.offers[0].condition : undefined,
      fetchedAt: Date.now(),
    };
    p.offers.push(offer);
    p.platforms.push(s.name);
    offerIndex.set(offer.id, { offer, productId: p.id });
    confirmed.add(offer);
  }
  if (adopted && confirmed.size) {
    // Listings merged in by a vague title may be another configuration; keep
    // only the ones this product's store list vouches for.
    p.offers = p.offers.filter((o) => confirmed.has(o) || (o.title && subset(want, variantSpecs(o.title))));
    p.platforms = [...new Set(p.offers.map((o) => o.platform))];
  }
  await refreshTrackedPrices(p);
  return rankOffers(p);
}

/**
 * Prices copied from a price tracker can be hours old. Once the store lookup
 * has found the store's own product page, read the current price from it.
 */
async function refreshTrackedPrices(p: Product): Promise<void> {
  const tracked = p.offers.filter((o) => o.seller?.startsWith("Price tracked"));
  await Promise.all(
    tracked.map(async (o) => {
      const live = await fetchLivePrice(o.url).catch((err: Error) => {
        console.warn(`[live-price] ${o.platform}: ${err.message}`);
        return undefined;
      });
      if (!live) return;
      if (o.originalPrice && o.originalPrice <= live.price) o.originalPrice = undefined;
      o.price = live.price;
      o.availability = live.availability;
      o.seller = o.platform;
      o.fetchedAt = Date.now();
    }),
  );
}
export const getOffer = (id: string) => offerIndex.get(id);

/** Trimmed view handed to the LLM: keeps the tokens on what matters for choosing. */
export function compactProduct(p: Product) {
  return {
    id: p.id,
    title: p.title,
    brand: p.brand,
    category: p.category,
    rating: p.rating,
    reviews: p.reviewCount,
    bestPrice: p.bestPrice,
    offers: p.offers.slice(0, 4).map((o) => ({
      platform: o.platform,
      price: o.price,
      wasPrice: o.originalPrice,
      availability: o.availability,
      condition: o.condition,
      shipping: o.shipping,
      trustedStore: o.trusted || undefined,
      warning: o.suspect,
      trackedPrice: o.seller?.startsWith("Price tracked") || undefined,
    })),
    summary: p.description?.slice(0, 220),
  };
}
