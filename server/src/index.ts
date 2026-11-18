// API server for the app and the website.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, "..", ".env"));
} catch {
  // no .env file: fine, sample mode unless the key is set some other way
}

const { Hono } = await import("hono");
const { bodyLimit } = await import("hono/body-limit");
const { cors } = await import("hono/cors");
const { serve } = await import("@hono/node-server");
const { getConnInfo } = await import("@hono/node-server/conninfo");
const { buildReport } = await import("./checks/report.ts");
const { ExtractionError } = await import("./extract/claude.ts");
const { ListingError } = await import("./listing.ts");
const { MODE, MODEL, readImage, readListing } = await import("./pipeline.ts");
const { normalizeGtin } = await import("./gtin.ts");
const store = await import("./db.ts");
type SourceFacts = import("./schema.ts").SourceFacts;

const PORT = Number(process.env.PORT) || 4400;
const LISTING_CACHE_MS = 24 * 3600 * 1000;
const WEB_DIR = path.join(here, "..", "..", "web");

const app = new Hono();
app.use("/api/*", cors());

// Simple per-device limit on the endpoints that cost money.
const hits = new Map<string, { n: number; reset: number }>();
const LIMIT = Number(process.env.HOURLY_LIMIT) || 60;
function overLimit(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 3600_000 });
    return false;
  }
  h.n++;
  return h.n > LIMIT;
}
// Drop expired entries so the map doesn't grow with every address ever seen.
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (h.reset < now) hits.delete(ip);
}, 600_000).unref();
// Behind a reverse proxy, set TRUST_PROXY=1 to limit by the client address the proxy appends
// (the last X-Forwarded-For entry; earlier entries are client-supplied and can be faked).
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const ipOf = (c: Parameters<typeof getConnInfo>[0]) =>
  (TRUST_PROXY && c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim()) || getConnInfo(c).remote.address || "unknown";

const errorJson = (message: string) => ({ error: message });
const LIMIT_REACHED = errorJson("You've reached the hourly limit. Try again later.");

// Sample-mode results are never saved: they'd put made-up or low-quality data under real barcodes.
// They're still combined with anything already saved for that barcode, so the report shows both.
function combine(gtin: string | null, source: SourceFacts): { saved: boolean; sources: SourceFacts[]; sourceId: number | null } {
  if (!gtin) return { saved: false, sources: [source], sourceId: null };
  if (source.mode === "sample") {
    const others = store.latestSources(gtin).filter((s) => s.type !== source.type);
    return { saved: false, sources: [...others, source], sourceId: null };
  }
  const sourceId = store.addSource(gtin, source);
  return { saved: true, sources: store.latestSources(gtin), sourceId };
}

app.get("/api/health", (c) => c.json({ ok: true, mode: MODE, model: MODE === "claude" ? MODEL : null, products: store.productCount() }));

app.get("/api/products/:gtin", (c) => {
  const gtin = normalizeGtin(c.req.param("gtin"));
  if (!gtin) return c.json(errorJson("That barcode number isn't valid."), 400);
  const sources = store.latestSources(gtin);
  if (!sources.length) return c.json({ found: false, gtin });
  return c.json({ found: true, gtin, report: buildReport(sources, gtin) });
});

app.post("/api/label", bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json(errorJson("That photo is too large."), 413) }), async (c) => {
  if (overLimit(ipOf(c))) return c.json(LIMIT_REACHED, 429);
  const body = await c.req.json<{ gtin?: string; imageBase64?: string; mediaType?: string; kind?: string }>().catch(() => null);
  const kind = body?.kind === "screenshot" ? "screenshot" : "label";
  if (!body?.imageBase64) return c.json(errorJson("No photo received."), 400);
  const mediaType = (["image/jpeg", "image/png", "image/webp"].includes(body.mediaType ?? "") ? body.mediaType : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";

  const source = await readImage(kind, body.imageBase64, mediaType);
  // The photo itself goes no further than this function: it is never written to disk or logged.
  if (!source.facts.isProductInfo) {
    return c.json(errorJson(kind === "label" ? "We couldn't find a label in that photo. Get closer to the tag and make sure the text is sharp." : "That screenshot doesn't show a product listing."), 422);
  }

  const gtin = normalizeGtin(body.gtin) ?? normalizeGtin(source.facts.gtin);
  const { saved, sources } = combine(gtin, source);
  return c.json({ gtin, saved, report: buildReport(sources, gtin) });
});

app.post("/api/listing", async (c) => {
  const body = await c.req.json<{ url?: string; gtin?: string }>().catch(() => null);
  if (!body?.url?.trim()) return c.json(errorJson("Paste a product link first."), 400);
  const raw = body.url.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? body.url.trim();

  // The listing's own barcode wins. The client's (e.g. scanned in the store) only files a listing that has none,
  // so nobody can re-file a product's listing under another product's barcode.
  const clientGtin = normalizeGtin(body.gtin);
  const cached = store.cachedListing(raw, LISTING_CACHE_MS);
  // A fresh cached read is reused as is, unless it has no barcode and the client brings one to file it under.
  if (cached && (cached.gtin || !clientGtin)) {
    const gtin = cached.gtin;
    // This page's own read plus the product's label: the newest listing under the barcode may be another store's.
    const sources = gtin ? [...store.latestSources(gtin).filter((s) => s.type !== "listing"), cached.source] : [cached.source];
    return c.json({ gtin, saved: Boolean(gtin), cached: true, report: buildReport(sources, gtin) });
  }
  // Reading costs money and filing writes to the database, so both count toward the limit.
  if (overLimit(ipOf(c))) return c.json(LIMIT_REACHED, 429);

  const read = cached ? { source: cached.source, gtin: null, trimmed: false } : await readListing(raw);
  if (!read.source.facts.isProductInfo) return c.json(errorJson("That page doesn't look like a single product listing."), 422);

  const gtin = read.gtin ?? clientGtin;
  const { saved, sources, sourceId } = combine(gtin, read.source);
  // A page with no barcode isn't filed under a product, but its read is still stored so the link cache can reuse it.
  const cacheId = sourceId ?? (!cached && read.source.mode !== "sample" ? store.addSource(null, read.source) : null);
  if (cacheId != null) store.saveListing(raw, gtin, cacheId);
  const report = buildReport(sources, gtin);
  if (read.trimmed) report.notes.push("This page was long, so only the parts about materials, origin and claims were read.");
  return c.json({ gtin, saved, cached: Boolean(cached), report });
});

app.get("/api/corrections", (c) => c.json({ corrections: store.listCorrections() }));
app.get("/api/wording-rules", async (c) => {
  const { WORDING_RULES } = await import("./knowledge/wording.ts");
  return c.json({ rules: WORDING_RULES.map((r) => ({ title: r.title, meaning: r.meaning, verdict: r.verdict, source: r.source })) });
});

// ---------- website ----------
const PAGES: Record<string, string> = { "/": "index.html", "/methodology": "methodology.html", "/corrections": "corrections.html" };
app.get("*", (c) => {
  const p = c.req.path;
  const file = PAGES[p] ?? (/^\/[\w-]+\.(css|js|svg|png)$/.test(p) ? p.slice(1) : null);
  if (!file) return c.notFound();
  const full = path.join(WEB_DIR, file);
  if (!fs.existsSync(full)) return c.notFound();
  const type = { html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", svg: "image/svg+xml", png: "image/png" }[path.extname(file).slice(1)]!;
  return c.body(fs.readFileSync(full), 200, { "content-type": type });
});

// Reading errors carry a message meant for the user.
app.onError((err, c) => {
  if (err instanceof ListingError) return c.json(errorJson(err.message), 422);
  if (err instanceof ExtractionError) {
    console.error("extraction failed:", err.message);
    return c.json(errorJson(err.userMessage), 502);
  }
  console.error(err);
  return c.json(errorJson("Something went wrong on our side."), 500);
});

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  console.log(`Server running: http://localhost:${PORT}${lan ? `  (phone on same Wi-Fi: http://${lan}:${PORT})` : ""}`);
  console.log(MODE === "claude" ? `Reading with ${MODEL}` : "SAMPLE MODE: no Anthropic API key found. Add one to server/.env for real results.");
});
