import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { AgentEvent, Health, Product, UserProfile } from "./types";

/**
 * Where the API lives. Set EXPO_PUBLIC_API_URL for deployed builds; in development
 * we reuse the host the bundle came from, so phones on the same Wi-Fi just work.
 */
function resolveApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host) return `http://${host}:4000`;
  return Platform.OS === "android" ? "http://10.0.2.2:4000" : "http://localhost:4000";
}

export const API_URL = resolveApiUrl();

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => json<Health>("/api/health"),
  product: (id: string) => json<Product>(`/api/products/${id}`),
  moreStores: (id: string) => json<Product>(`/api/products/${id}/stores`, { method: "POST" }),
  profile: (userId: string) => json<UserProfile>(`/api/profile/${userId}`),
  savePreferences: (userId: string, prefs: Partial<Omit<UserProfile, "maxBudget">> & { maxBudget?: number | null }) =>
    json<UserProfile>(`/api/profile/${userId}`, { method: "PUT", body: JSON.stringify(prefs) }),
};

/**
 * Runs the agent pipeline and calls onEvent for each Server-Sent Event as it arrives.
 * Uses expo/fetch, which supports streamed response bodies on iOS, Android and web.
 */
export async function streamAssistant(
  body: { query: string; userId: string; history: { query: string; summary?: string }[] },
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await expoFetch(`${API_URL}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text.includes("error") ? JSON.parse(text).error : `Assistant request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)) as AgentEvent);
      }
    }
  }
}

/** Opens the merchant page via the server's tracked redirect. */
export async function openOffer(offerId: string, userId: string) {
  const url = `${API_URL}/api/go/${offerId}?uid=${encodeURIComponent(userId)}`;
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener");
  } else {
    await WebBrowser.openBrowserAsync(url);
  }
}
