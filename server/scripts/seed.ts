// Seeds the database from real product pages listed in seed/urls.txt (one URL per line, # for comments).
// Polite by design: obeys each site's robots.txt, waits between requests, and skips pages already read.
// Check each retailer's terms of use before seeding from it.
// Run: npm run seed            (or: npm run seed -- --delay 8)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import robotsParserModule from "robots-parser";

// robots-parser is CommonJS (module.exports = fn), but its types declare an ES default export.
const robotsParser = robotsParserModule as unknown as typeof robotsParserModule.default;
type Robot = ReturnType<typeof robotsParser>;

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, "..", ".env"));
} catch {}

const { readListing, MODE } = await import("../src/pipeline.ts");
if (MODE === "sample") {
  console.log("Seeding needs an Anthropic API key: sample-mode results are never saved. Add your key to server/.env first.");
  process.exit(1);
}
const { addSource, cachedListing, saveListing } = await import("../src/db.ts");

const delayArg = process.argv.indexOf("--delay");
const DELAY_MS = (delayArg > -1 ? Number(process.argv[delayArg + 1]) : 5) * 1000;
const file = path.join(here, "..", "seed", "urls.txt");
const urls = fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  : [];
if (!urls.length) {
  console.log(`No URLs found. Add product page links to ${path.relative(process.cwd(), file)}, one per line.`);
  process.exit(0);
}
console.log(`Seeding ${urls.length} pages in ${MODE} mode, ${DELAY_MS / 1000}s apart.\n`);

// robots.txt for "User-agent: *". A server error or no answer means "assume nothing is allowed" (RFC 9309);
// a missing file (4xx) means everything is allowed.
const robotsCache = new Map<string, Robot | null>(); // null: robots.txt unavailable, skip the site
async function allowedByRobots(u: URL): Promise<boolean> {
  if (!robotsCache.has(u.origin)) {
    const robotsUrl = `${u.origin}/robots.txt`;
    let robot: Robot | null = null;
    try {
      const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(8000) });
      if (res.status < 500) robot = robotsParser(robotsUrl, res.ok ? await res.text() : "");
    } catch {}
    robotsCache.set(u.origin, robot);
  }
  return robotsCache.get(u.origin)?.isAllowed(u.href, "*") ?? false;
}

let ok = 0, skipped = 0, failed = 0;
for (const [i, url] of urls.entries()) {
  const tag = `[${i + 1}/${urls.length}]`;
  if (cachedListing(url, Infinity)) { console.log(`${tag} skip (already read) ${url}`); skipped++; continue; }
  let u: URL;
  try { u = new URL(url); } catch { console.log(`${tag} bad URL ${url}`); failed++; continue; }
  if (!(await allowedByRobots(u))) { console.log(`${tag} skip (robots.txt disallows) ${url}`); skipped++; continue; }
  try {
    const { source, gtin } = await readListing(url);
    const id = addSource(gtin, source);
    saveListing(url, gtin, id);
    const comp = source.facts.materials[0]?.components.map((c) => `${c.percent ?? "?"}% ${c.name}`).join(", ") || "no materials found";
    console.log(`${tag} ${gtin ? "saved under " + gtin : "read (no barcode on page)"}  ${source.facts.productName ?? ""}  [${comp}]`);
    ok++;
  } catch (e) {
    console.log(`${tag} failed: ${(e as Error).message}  ${url}`);
    failed++;
  }
  if (i < urls.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
}
console.log(`\nDone. ${ok} read, ${skipped} skipped, ${failed} failed.`);
