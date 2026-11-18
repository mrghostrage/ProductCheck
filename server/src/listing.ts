// Fetches a product listing page and pulls out the parts worth reading.
import dns from "node:dns/promises";
import net from "node:net";
import { Agent, fetch } from "undici";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_TEXT = 15000;

export class ListingError extends Error {}

export interface Listing {
  url: string;
  title: string | null;
  name: string | null;
  brand: string | null;
  gtin: string | null;
  material: string | null;
  origin: string | null;
  imageUrls: string[];
  text: string; // the text sent for reading
  trimmed: boolean; // true if relevant text was longer than we send
}

// ---------- safety: only fetch public websites ----------

// Private, local and reserved ranges. BlockList also matches IPv4-mapped IPv6 ("::ffff:7f00:1") against the IPv4 rules.
const BLOCKED = new net.BlockList();
for (const [net4, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const)
  BLOCKED.addSubnet(net4, bits, "ipv4");
// Loopback, unspecified, unique local, link-local and old site-local, NAT64 and 6to4 (both can reach IPv4 addresses).
for (const [net6, bits] of [["::1", 128], ["::", 128], ["fc00::", 7], ["fe80::", 9], ["64:ff9b::", 32], ["2002::", 16]] as const)
  BLOCKED.addSubnet(net6, bits, "ipv6");
const isPrivateIp = (ip: string) => BLOCKED.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");

// IP literals are checked here; host names are checked at connect time by publicLookup.
function assertPublic(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new ListingError("Only web links are supported.");
  const host = url.hostname.replace(/^\[|\]$/g, ""); // IPv6 literals come bracketed
  if (net.isIP(host) && isPrivateIp(host)) throw new ListingError("That address isn't a public website.");
}

// DNS lookup used for the actual connection, so the address that's checked is the address that's used
// (a separate check before fetch() could be fooled by a name that resolves differently the second time).
const publicLookup = ((hostname: string, options: { all?: boolean }, callback: (err: Error | null, address: unknown, family?: number) => void) => {
  dns.lookup(hostname, { all: true }).then(
    (addrs) => {
      if (!addrs.length) return callback(new ListingError(`Couldn't find a website at ${hostname}.`), undefined);
      if (addrs.some((a) => isPrivateIp(a.address))) return callback(new ListingError("That address isn't a public website."), undefined);
      if (options.all) callback(null, addrs);
      else callback(null, addrs[0].address, addrs[0].family);
    },
    () => callback(new ListingError(`Couldn't find a website at ${hostname}.`), undefined),
  );
}) as unknown as net.LookupFunction;
const dispatcher = new Agent({ connect: { lookup: publicLookup } });

const MAX_BYTES = 5_000_000;
const HEADERS = { "user-agent": UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" };

// Follows redirects by hand so every hop is checked. The timeout covers the whole page, body included,
// and reading stops at MAX_BYTES so a huge file can't fill memory.
async function safeFetch(start: string): Promise<{ url: string; html: string }> {
  let url = new URL(start);
  const signal = AbortSignal.timeout(12000);
  try {
    for (let hop = 0; hop < 5; hop++) {
      assertPublic(url);
      const res = await fetch(url, { redirect: "manual", signal, dispatcher, headers: HEADERS });
      const location = res.headers.get("location");
      const type = res.headers.get("content-type");
      const isPage = !type || /html|xml|text\/plain/i.test(type);
      if (!res.ok || !isPage) await res.body?.cancel(); // unread bodies hold the connection until garbage collection
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      if (res.status === 403 || res.status === 429) throw new ListingError("This store blocks automated reading. Take a screenshot of the listing and upload it instead.");
      if (!res.ok) throw new ListingError(`The page returned an error (${res.status}).`);
      if (!isPage) throw new ListingError("That link isn't a web page.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body ?? []) {
        chunks.push(chunk);
        if ((size += chunk.length) >= MAX_BYTES) break;
      }
      return { url: url.toString(), html: Buffer.concat(chunks).toString("utf8").slice(0, MAX_BYTES) };
    }
    throw new ListingError("Too many redirects.");
  } catch (e) {
    if (e instanceof ListingError) throw e;
    const cause = (e as { cause?: unknown }).cause;
    if (cause instanceof ListingError) throw cause; // from publicLookup, wrapped by fetch
    throw new ListingError((e as Error).name === "TimeoutError" ? "The page took too long to load." : "Couldn't load that page.");
  }
}

// ---------- parsing ----------

function decode(s: string) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&ndash;|&mdash;/g, "-");
}

function toLines(html: string): string[] {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/dt|\/dd|\/td|\/th|\/section)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);
}

type Json = Record<string, unknown>;
function findProduct(node: unknown): Json | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const p = findProduct(n);
      if (p) return p;
    }
    return null;
  }
  const obj = node as Json;
  const type = obj["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return obj;
  if (obj["@graph"]) return findProduct(obj["@graph"]);
  return null;
}

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v); // e.g. "gtin13": 4006381333931
  if (v && typeof v === "object" && "name" in (v as Json)) return str((v as Json).name);
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ") || null;
  return null;
};

const RELEVANT = /\d{1,3}\s*%|material|composition|fabric|fibre|fiber|made in|designed in|origin|imported|leather|gold|silver|sterling|plated|925|\b1[048]k\b|cotton|polyester|nylon|elastane|spandex|wool|cashmere|silk|linen|viscose|rayon|bamboo|organic|recycled|sustainab|certified|premium|genuine|vegan|care|wash|lining|shell|upper|sole/i;

export async function fetchListing(rawUrl: string): Promise<Listing> {
  let start: URL;
  try {
    start = new URL(/^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : "https://" + rawUrl.trim());
  } catch {
    throw new ListingError("That doesn't look like a link.");
  }
  const { url, html } = await safeFetch(start.toString());
  return parseListing(url, html);
}

// Pure parsing step, separate from fetching so it can be tested with saved pages.
export function parseListing(url: string, html: string): Listing {
  let product: Json | null = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      product = findProduct(JSON.parse(m[1].trim()));
    } catch {}
    if (product) break;
  }
  const meta = (name: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, "i"))?.[1] ??
    null;

  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "") || null;
  const name = str(product?.name) ?? (meta("og:title") ? decode(meta("og:title")!) : title);
  const brand = str(product?.brand);
  const gtin = str(product?.gtin13) ?? str(product?.gtin12) ?? str(product?.gtin14) ?? str(product?.gtin8) ?? str(product?.gtin) ?? str((product?.offers as Json | undefined)?.gtin13);
  const material = str(product?.material);
  const origin = str(product?.countryOfOrigin);
  const description = str(product?.description) ?? (meta("og:description") ? decode(meta("og:description")!) : null);

  const imgs = [product?.image, meta("og:image")].flat().map(str).filter((u): u is string => !!u && /^https?:\/\//.test(u));
  const imageUrls = [...new Set(imgs)].slice(0, 2);

  const head = [
    name && `Product: ${name}`,
    brand && `Brand: ${brand}`,
    material && `Material (structured data): ${material}`,
    origin && `Country of origin (structured data): ${origin}`,
    gtin && `GTIN: ${gtin}`,
    description && `Description: ${decode(description)}`,
  ].filter(Boolean) as string[];

  const relevant = toLines(html).filter((l) => l.length < 400 && RELEVANT.test(l));
  const uniq = [...new Set(relevant)];
  let text = head.join("\n");
  let trimmed = false;
  for (const l of uniq) {
    if (text.length + l.length + 1 > MAX_TEXT) {
      trimmed = true;
      break;
    }
    text += "\n" + l;
  }
  if (text.trim().length < 40 && !product) {
    throw new ListingError("Couldn't find product details on that page. Many stores load details with scripts we can't read. Take a screenshot of the listing and upload it instead.");
  }
  return { url, title, name, brand, gtin, material, origin, imageUrls, text, trimmed };
}
