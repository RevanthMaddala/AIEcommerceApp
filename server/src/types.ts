export type Availability = "in_stock" | "limited" | "out_of_stock" | "unknown";

/** One platform's listing, as normalized by a provider adapter. */
export interface Listing {
  platform: string;
  nativeId: string;
  title: string;
  brand?: string;
  category?: string;
  description?: string;
  image?: string;
  rating?: number;
  reviewCount?: number;
  price: number;
  originalPrice?: number;
  currency: string;
  availability: Availability;
  url: string;
  seller?: string;
  shipping?: string;
  condition?: string;
  /** Set when `url` is an aggregator page; lets /api/go look up the merchant's own page. */
  linkToken?: string;
  specs?: Record<string, string>;
}

export interface Offer {
  id: string;
  platform: string;
  price: number;
  originalPrice?: number;
  currency: string;
  availability: Availability;
  /** Merchant URL. Clients go through /api/go/:offerId instead of using this directly. */
  url: string;
  seller?: string;
  /** The store's own title for the item, when it names the configuration. */
  title?: string;
  shipping?: string;
  condition?: string;
  linkToken?: string;
  /** A big, well-known retailer (Amazon, Flipkart, Croma, ...). Preferred for "Buy". */
  trusted?: boolean;
  /** Why this offer shouldn't be the headline price (deal site, unusually cheap). */
  suspect?: string;
  fetchedAt: number;
}

/** A product grouped across platforms; each platform listing becomes an offer. */
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
  /** Typical price of matching products in the same search; flags fake-cheap single listings. */
  typicalPrice?: number;
  /** Token for looking up every store that sells this product (Google Shopping). */
  storesToken?: string;
}

export interface SearchOptions {
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
}

export interface ProviderStatus {
  platform: string;
  ok: boolean;
  count: number;
  ms: number;
  cached: boolean;
  error?: string;
}

export interface UserProfile {
  userId: string;
  preferredBrands: string[];
  avoidBrands: string[];
  maxBudget?: number;
  priority: "price" | "rating" | "balanced" | "premium";
  /** Learned from clicks: brand -> weight. */
  brandAffinity: Record<string, number>;
  categoryAffinity: Record<string, number>;
  recentQueries: string[];
  recentClicks: { productId: string; title: string; brand?: string; price: number; at: number }[];
  updatedAt: number;
}
