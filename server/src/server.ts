import cors from "cors";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { activeModel, runPipeline } from "./agent/pipeline.js";
import type { AgentEvent } from "./agent/schemas.js";
import { expandStores, getOffer, getProduct, searchAll } from "./aggregator.js";
import { activeAiProvider, config } from "./config.js";
import { getProfile, recordClick, updatePreferences } from "./profiles.js";
import { activeProviders, allProviders } from "./providers/index.js";
import { resolveMerchantLink } from "./providers/serpapi.js";
import type { Product } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const UserId = z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ai: { mode: activeAiProvider() ?? "heuristic", model: activeModel() },
    region: { code: config.region.code, currency: config.region.currency, locale: config.region.locale },
    providers: allProviders.map((p) => ({ platform: p.platform, enabled: p.enabled() })),
  });
});

/** Streams the agent pipeline as Server-Sent Events. */
const AssistantBody = z.object({
  query: z.string().trim().min(1).max(500),
  userId: UserId,
  history: z
    .array(z.object({ query: z.string().max(500), summary: z.string().max(500).optional() }))
    .max(10)
    .default([]),
});

app.post("/api/assistant", async (req: Request, res: Response) => {
  const parsed = AssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const send = (event: AgentEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  try {
    const result = await runPipeline(parsed.data, send, abort.signal);
    send({ type: "result", result });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error("[assistant]", err);
      send({ type: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

/** Plain keyword search across platforms, without the agent. */
app.get("/api/search", async (req, res) => {
  const q = z
    .object({
      q: z.string().trim().min(1).max(200),
      minPrice: z.coerce.number().positive().optional(),
      maxPrice: z.coerce.number().positive().optional(),
      userId: UserId.optional(),
    })
    .safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: z.prettifyError(q.error) });
    return;
  }
  const { q: query, minPrice, maxPrice, userId } = q.data;
  const profile = userId ? getProfile(userId) : undefined;
  res.json(await searchAll(query, { query, minPrice, maxPrice, profile }));
});

app.get("/api/products/:id", (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: "Product not found or expired; search again." });
    return;
  }
  res.json(product);
});

/** Pulls in every store that sells this product, e.g. Flipkart alongside Amazon.in. */
app.post("/api/products/:id/stores", async (req, res) => {
  try {
    const product = await expandStores(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found or expired; search again." });
      return;
    }
    res.json(product);
  } catch (err) {
    console.warn("[stores]", err);
    res.status(502).json({ error: "Couldn't load more stores right now." });
  }
});

app.post("/api/compare", (req, res) => {
  const body = z.object({ ids: z.array(z.string()).min(2).max(6) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: z.prettifyError(body.error) });
    return;
  }
  const products = body.data.ids.map(getProduct).filter((p): p is Product => Boolean(p));
  res.json({ products });
});

app.get("/api/profile/:userId", (req, res) => {
  const id = UserId.safeParse(req.params.userId);
  if (!id.success) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  res.json(getProfile(id.data));
});

const Preferences = z.object({
  preferredBrands: z.array(z.string().max(40)).optional(),
  avoidBrands: z.array(z.string().max(40)).optional(),
  maxBudget: z.number().positive().nullable().optional(),
  priority: z.enum(["price", "rating", "balanced", "premium"]).optional(),
});

app.put("/api/profile/:userId", (req, res) => {
  const id = UserId.safeParse(req.params.userId);
  const prefs = Preferences.safeParse(req.body);
  if (!id.success || !prefs.success) {
    res.status(400).json({ error: "Invalid profile update" });
    return;
  }
  res.json(updatePreferences(id.data, { ...prefs.data, maxBudget: prefs.data.maxBudget ?? undefined }));
});

/**
 * Purchase redirect. Only offers the server itself fetched can be targets, so
 * this can't be used as an open redirect. The click also feeds personalization.
 */
app.get("/api/go/:offerId", async (req, res) => {
  const entry = getOffer(req.params.offerId);
  if (!entry || !/^https?:\/\//.test(entry.offer.url)) {
    res.status(404).send("This offer has expired. Go back and search again.");
    return;
  }
  const uid = UserId.safeParse(req.query.uid);
  const product = getProduct(entry.productId);
  if (uid.success && product) recordClick(uid.data, product, entry.offer.price);

  let target = entry.offer.url;
  if (entry.offer.linkToken) {
    // Swap the aggregator page for the store's own page; keep the original if that fails.
    const direct = await resolveMerchantLink(entry.offer.linkToken, entry.offer.platform).catch((err: Error) => {
      console.warn(`[go] couldn't resolve merchant link: ${err.message}`);
      return undefined;
    });
    if (direct) target = direct;
  }
  res.redirect(302, target);
});

app.listen(config.port, (err) => {
  if (err) {
    console.error(`Could not start on port ${config.port}: ${err.message}`);
    process.exit(1);
  }
  const provider = activeAiProvider();
  const ai = provider ? `${provider} (${activeModel()})` : "rule-based (set ANTHROPIC_API_KEY or GEMINI_API_KEY)";
  console.log(`SmartShop API on http://localhost:${config.port}`);
  console.log(`  AI pipeline: ${ai}`);
  console.log(`  Platforms:   ${activeProviders().map((p) => p.platform).join(", ") || "none"}`);
});
