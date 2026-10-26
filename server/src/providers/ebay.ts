import { config } from "../config.js";
import type { Listing } from "../types.js";
import { getJson, toNumber } from "./http.js";
import type { ProductProvider } from "./types.js";

/** eBay Browse API (application token via client-credentials OAuth). */
interface EbayItem {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  image?: { imageUrl: string };
  itemWebUrl: string;
  condition?: string;
  seller?: { username: string; feedbackPercentage?: string };
  shippingOptions?: { shippingCost?: { value: string } }[];
  categories?: { categoryName: string }[];
}

let token: { value: string; expires: number } | undefined;

async function appToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${config.keys.ebayClientId}:${config.keys.ebayClientSecret}`).toString("base64");
  const data = await getJson<{ access_token: string; expires_in: number }>(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    },
  );
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

export const ebayProvider: ProductProvider = {
  platform: "eBay",
  // Configured for the US marketplace; eBay no longer runs a store in India.
  enabled: () => Boolean(config.keys.ebayClientId && config.keys.ebayClientSecret) && config.region.code === "US",
  async search(query, opts) {
    const params = new URLSearchParams({ q: query, limit: String(opts.limit ?? 20) });
    if (opts.minPrice || opts.maxPrice) {
      params.set("filter", `price:[${opts.minPrice ?? ""}..${opts.maxPrice ?? ""}],priceCurrency:USD`);
    }
    const data = await getJson<{ itemSummaries?: EbayItem[] }>(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${await appToken()}`,
          "X-EBAY-C-MARKETPLACE-ID": config.keys.ebayMarketplace,
        },
      },
    );
    return (data.itemSummaries ?? []).flatMap((item): Listing[] => {
      const price = toNumber(item.price?.value);
      if (!price) return [];
      const shipCost = toNumber(item.shippingOptions?.[0]?.shippingCost?.value);
      return [
        {
          platform: "eBay",
          nativeId: item.itemId,
          title: item.title,
          category: item.categories?.[0]?.categoryName,
          image: item.image?.imageUrl,
          price,
          currency: item.price?.currency ?? "USD",
          availability: "in_stock",
          url: item.itemWebUrl,
          seller: item.seller?.username,
          shipping: shipCost ? `$${shipCost.toFixed(2)} shipping` : "Free shipping",
          condition: item.condition,
        },
      ];
    });
  },
};
