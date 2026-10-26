# SmartShop: AI product search & comparison

SmartShop is a cross-platform app for iOS, Android and web. You describe what you want in plain English, and an AI agent turns that into a search plan. It queries several e-commerce platforms in parallel, reasons over live prices and availability, and returns personalized picks. Each pick has a one-tap purchase link.

```
app/      Expo (React Native + web) client, Expo Router
server/   Node + TypeScript API: agent pipeline, store adapters, caching, profiles
```

## Quick start

```bash
cd server && npm install && npm run dev      # API on http://localhost:4000
```

```bash
cd app && npm install && npx expo start      # press w for web, or scan the QR code with Expo Go
```

The app works with no keys at all. In that case it uses **quick mode**, a rule-based pipeline, against a keyless demo catalog. To use the AI agent and real stores, copy `server/.env.example` to `server/.env` and add keys. The agent runs on either Claude or Gemini:

| Variable | What it enables |
|---|---|
| `ANTHROPIC_API_KEY` | Claude agent pipeline (default model `claude-opus-5-5`) |
| `GEMINI_API_KEY` | Gemini agent pipeline, free tier available (default model `gemini-3.5-flash`, change with `GEMINI_MODEL`) |
| `AI_PROVIDER` | `auto` (default: Claude if its key is set, else Gemini), `claude`, `gemini` or `heuristic` |
| `BESTBUY_API_KEY` | Best Buy Products API |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | eBay Browse API |
| `SERPAPI_KEY` | Google Shopping, which covers offers from Amazon, Walmart, Target and other merchants |
| `REGION` | `US` (default) or `IN`: searches Google India (Amazon.in, Flipkart, Croma, Tata CLiQ, …) with prices in ₹. Best Buy and eBay only run for `US` |
| `ENABLE_DEMO_CATALOG=false` | Hides the demo catalog once real stores are connected. It's off by default outside the US, since its prices are in dollars |

On a phone, the app reaches the API through the same host that served the bundle, on port 4000. For deployed builds, set `EXPO_PUBLIC_API_URL`.

## How it works

### Agent pipeline (`server/src/agent/`)
The three stages live in `agent.ts`. They use the same prompts (`prompts.ts`) and store tools (`tools.ts`) whichever model runs them. `claude.ts` and `gemini.ts` are thin adapters that each provide structured JSON output and a tool-calling loop.

Results stream to the app over Server-Sent Events, so the UI shows each stage while it runs.

1. **Understand.** The model turns the request, the conversation history and the saved preferences into a structured `Intent`: search queries, a budget, must-haves, brands, a priority, and whether the request is a comparison. This step uses structured outputs at low effort. Follow-ups like "cheaper ones" carry the earlier subject forward.
2. **Research.** This is a tool-using agent loop with three tools: `search_products`, `get_product_details` and `compare_products`. On Claude it uses the SDK tool runner; on Gemini, a function-calling loop. The model searches, refines its queries, inspects candidates and compares finalists across platforms over several steps.
3. **Recommend.** A structured output ranks up to four picks, each with a label, reasoning, pros and cons, plus a comparison summary and follow-up suggestions. Product IDs are checked against the fetched pool, so the model can't invent a product.

Claude requests use server-side refusal fallbacks (`fallbacks: "default"`) and cached system prompts. If the model is unavailable (no key, auth error, or a rate limit such as Gemini's free-tier quota), the server falls back to the rule-based pipeline (`heuristic.ts`) and tells the user.

### Live data & performance (`server/src/aggregator.ts`, `providers/`)
- Each platform is a `ProductProvider` adapter that normalizes results into a shared `Listing` shape. To add a store, write an adapter and register it in `providers/index.ts`.
- All platforms are queried in parallel with `Promise.allSettled` and a per-platform timeout. A slow or failing store only drops its own results.
- A TTL + LRU cache sits in front of the providers. It de-duplicates in-flight requests, so identical concurrent searches make one upstream call.
- Listings for the same item on different stores are merged into one product with several offers, sorted by price.
- The LLM receives a compact view of each product, which keeps token usage low.

### Personalization (`server/src/profiles.ts`)
- **Explicit preferences** are set on the Preferences tab: priority, budget, favorite brands and brands to avoid.
- **Implicit signals** come from purchase-link clicks, which build brand and category affinity, plus recent queries. Both feed the ranking score and the agent's prompts.
- Profiles are keyed by an anonymous per-device ID and stored in `server/data/profiles.json`.

### More stores per product
Google Shopping search returns one seller per result, so a big seller like Flipkart can be missing from the list. **Find more stores** on the product page (`POST /api/products/:id/stores`) loads every store Google lists for that item, with prices and direct links. It costs one SerpApi search per product and is cached for an hour.

### Purchase redirection
"Buy" buttons go through `GET /api/go/:offerId`. That endpoint records the click for personalization, then sends a 302 redirect to the merchant. Google Shopping results only link to Google's own product page, so for those offers the server first looks up the store's direct link (one SerpApi search per product, cached). It only redirects to offers the server itself fetched, so it can't be used as an open redirect.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | AI mode and connected platforms |
| POST | `/api/assistant` | `{query, userId, history}`, returns an SSE stream of agent events and the final result |
| GET | `/api/search?q=&minPrice=&maxPrice=` | Plain multi-platform search, no agent |
| GET | `/api/products/:id` | Product with all offers |
| POST | `/api/compare` | `{ids: [...]}` |
| GET/PUT | `/api/profile/:userId` | Read or update preferences |
| GET | `/api/go/:offerId?uid=` | Tracked purchase redirect |

## Notes
- Demo catalog prices come from DummyJSON sample data and are labelled "Demo Store".
- Store API terms usually require attribution or affiliate tagging before you go to production. Check each provider's terms.
- Profiles are stored in a JSON file. Move them to a database before running more than one server instance.
