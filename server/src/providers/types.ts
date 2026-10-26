import type { Listing, SearchOptions } from "../types.js";

export interface ProductProvider {
  /** Display name, also used as the offer's platform. */
  platform: string;
  enabled(): boolean;
  search(query: string, opts: SearchOptions): Promise<Listing[]>;
}
