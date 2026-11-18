// SQLite storage (Node's built-in sqlite module). Photos are never stored, only the facts read from them.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGtin } from "./gtin.ts";
import type { SourceFacts } from "./schema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(here, "..", "data", "scanner.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gtin TEXT,
    type TEXT NOT NULL,
    url TEXT,
    mode TEXT NOT NULL,
    facts_json TEXT NOT NULL,
    read_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sources_gtin ON sources (gtin);
  CREATE TABLE IF NOT EXISTS listings (
    url TEXT PRIMARY KEY,
    gtin TEXT,
    source_id INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    product TEXT NOT NULL,
    what TEXT NOT NULL,
    why TEXT NOT NULL
  );
`);

// Schema version 1: 8-digit codes that are UPC-E are now filed under their UPC-A (see gtin.ts).
// Move rows saved under the old 8-digit key ("000000" + the code) once, so those products still turn up.
if ((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version < 1) {
  db.exec("BEGIN");
  try {
    const keys = db.prepare("SELECT gtin FROM sources WHERE gtin LIKE '000000%' UNION SELECT gtin FROM listings WHERE gtin LIKE '000000%'").all() as { gtin: string }[];
    for (const { gtin } of keys) {
      const now = normalizeGtin(gtin.slice(6));
      if (!now || now === gtin) continue;
      db.prepare("UPDATE sources SET gtin = ? WHERE gtin = ?").run(now, gtin);
      db.prepare("UPDATE listings SET gtin = ? WHERE gtin = ?").run(now, gtin);
    }
    db.exec("PRAGMA user_version = 1");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

type Row = { id: number; gtin: string | null; type: string; url: string | null; mode: string; facts_json: string; read_at: string };
const toSource = (r: Row): SourceFacts => ({ type: r.type as SourceFacts["type"], url: r.url, mode: r.mode as SourceFacts["mode"], readAt: r.read_at, facts: JSON.parse(r.facts_json) });

export function addSource(gtin: string | null, s: SourceFacts): number {
  const res = db
    .prepare("INSERT INTO sources (gtin, type, url, mode, facts_json, read_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(gtin, s.type, s.url, s.mode, JSON.stringify(s.facts), s.readAt);
  return Number(res.lastInsertRowid);
}

// Latest label and latest listing for a product.
export function latestSources(gtin: string): SourceFacts[] {
  const rows = db
    .prepare(
      `SELECT * FROM sources WHERE id IN (
         SELECT MAX(id) FROM sources WHERE gtin = ? GROUP BY type
       ) ORDER BY type`,
    )
    .all(gtin) as Row[];
  return rows.map(toSource);
}

export function cachedListing(url: string, maxAgeMs: number): { gtin: string | null; source: SourceFacts } | null {
  const row = db.prepare("SELECT l.gtin AS lgtin, l.fetched_at, s.* FROM listings l JOIN sources s ON s.id = l.source_id WHERE l.url = ?").get(url) as
    | (Row & { lgtin: string | null; fetched_at: number })
    | undefined;
  if (!row || Date.now() - row.fetched_at > maxAgeMs) return null;
  return { gtin: row.lgtin, source: toSource(row) };
}

export function saveListing(url: string, gtin: string | null, sourceId: number) {
  db.prepare("INSERT OR REPLACE INTO listings (url, gtin, source_id, fetched_at) VALUES (?, ?, ?, ?)").run(url, gtin, sourceId, Date.now());
}

export function listCorrections() {
  return db.prepare("SELECT date, product, what, why FROM corrections ORDER BY date DESC, id DESC").all();
}

export function addCorrection(c: { date: string; product: string; what: string; why: string }) {
  db.prepare("INSERT INTO corrections (date, product, what, why) VALUES (?, ?, ?, ?)").run(c.date, c.product, c.what, c.why);
}

export function productCount(): number {
  return (db.prepare("SELECT COUNT(DISTINCT gtin) AS n FROM sources WHERE gtin IS NOT NULL").get() as { n: number }).n;
}
