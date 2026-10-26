import { config } from "../config.js";

export class ProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** fetch + JSON with a hard timeout so one slow platform can't stall a search. */
export async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = config.providerTimeoutMs): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(`HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

export function toNumber(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value.replace(/[^0-9.]/g, "")) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
