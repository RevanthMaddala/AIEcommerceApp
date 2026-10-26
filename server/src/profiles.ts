import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Product, UserProfile } from "./types.js";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "profiles.json");

const profiles = new Map<string, UserProfile>();
try {
  for (const p of JSON.parse(readFileSync(FILE, "utf8")) as UserProfile[]) profiles.set(p.userId, p);
} catch {
  // First run: no profiles yet.
}

let saveTimer: NodeJS.Timeout | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify([...profiles.values()], null, 2));
  }, 500);
}

export function getProfile(userId: string): UserProfile {
  let p = profiles.get(userId);
  if (!p) {
    p = {
      userId,
      preferredBrands: [],
      avoidBrands: [],
      priority: "balanced",
      brandAffinity: {},
      categoryAffinity: {},
      recentQueries: [],
      recentClicks: [],
      updatedAt: Date.now(),
    };
    profiles.set(userId, p);
  }
  return p;
}

export function updatePreferences(
  userId: string,
  prefs: Partial<Pick<UserProfile, "preferredBrands" | "avoidBrands" | "maxBudget" | "priority">>,
): UserProfile {
  const p = getProfile(userId);
  if (prefs.preferredBrands) p.preferredBrands = prefs.preferredBrands.slice(0, 20);
  if (prefs.avoidBrands) p.avoidBrands = prefs.avoidBrands.slice(0, 20);
  if (prefs.priority) p.priority = prefs.priority;
  if ("maxBudget" in prefs) p.maxBudget = prefs.maxBudget || undefined;
  p.updatedAt = Date.now();
  scheduleSave();
  return p;
}

export function recordQuery(userId: string, query: string) {
  const p = getProfile(userId);
  p.recentQueries = [query, ...p.recentQueries.filter((q) => q !== query)].slice(0, 15);
  p.updatedAt = Date.now();
  scheduleSave();
}

/** A purchase-link click is the strongest preference signal we get. */
export function recordClick(userId: string, product: Product, price: number) {
  const p = getProfile(userId);
  const brand = product.brand?.toLowerCase();
  if (brand) p.brandAffinity[brand] = (p.brandAffinity[brand] ?? 0) + 1;
  const category = product.category?.toLowerCase();
  if (category) p.categoryAffinity[category] = (p.categoryAffinity[category] ?? 0) + 1;
  p.recentClicks = [
    { productId: product.id, title: product.title, brand: product.brand, price, at: Date.now() },
    ...p.recentClicks.filter((c) => c.productId !== product.id),
  ].slice(0, 20);
  p.updatedAt = Date.now();
  scheduleSave();
}

/** Short, model-friendly summary of what we know about the shopper. */
export function profileSummary(p: UserProfile) {
  const top = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);
  return {
    priority: p.priority,
    maxBudget: p.maxBudget,
    preferredBrands: p.preferredBrands,
    avoidBrands: p.avoidBrands,
    brandsClickedMost: top(p.brandAffinity),
    categoriesClickedMost: top(p.categoryAffinity),
    recentQueries: p.recentQueries.slice(0, 5),
    recentlyViewed: p.recentClicks.slice(0, 5).map((c) => `${c.title} ($${c.price})`),
  };
}
