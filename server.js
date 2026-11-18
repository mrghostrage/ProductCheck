// StoreCheck prototype: paste a store URL from an ad, get red-flag signals.
// Zero dependencies. Run: node server.js  (optional: SERPAPI_KEY=... for reverse image search)
const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const PORT = Number(process.env.PORT) || 4319;
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DAY = 86400000;

// ---------- helpers ----------

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('That address is not a public website.');
    return;
  }
  const addrs = await dns.lookup(hostname, { all: true }).catch(() => {
    throw new Error(`Couldn't find a website at ${hostname}.`);
  });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('That address is not a public website.');
}

async function get(url, { timeout = 10000, accept, maxBytes = 4_000_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = (await res.text()).slice(0, maxBytes);
    return { ok: res.ok, status: res.status, url: res.url, text, headers: res.headers };
  } catch (e) {
    return { ok: false, status: 0, url, text: '', error: e.name === 'AbortError' ? 'timed out' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'co.jp',
  'com.mx', 'co.za', 'com.sg', 'com.hk', 'co.in', 'com.tr', 'com.cn', 'com.my', 'com.ph',
]);
function registrableDomain(host) {
  const p = host.replace(/^www\./, '').split('.');
  if (p.length <= 2) return p.join('.');
  const last2 = p.slice(-2).join('.');
  return MULTI_SUFFIX.has(last2) ? p.slice(-3).join('.') : last2;
}

function normalizeInput(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('Paste a store link first.');
  const found = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (found) s = found[0];
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error("That doesn't look like a link.");
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only web links are supported.');
  if (!u.hostname.includes('.')) throw new Error("That doesn't look like a website address.");
  return u;
}

const ago = (ms) => {
  const d = Math.round(ms / DAY);
  if (d < 1) return 'today';
  if (d < 60) return `${d} day${d === 1 ? '' : 's'} ago`;
  if (d < 730) return `${Math.round(d / 30)} months ago`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')} years ago`;
};
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

// signal: { id, title, level: 'bad'|'warn'|'good'|'info'|'error', summary, details?: [] }
const sig = (id, title, level, summary, details) => ({ id, title, level, summary, details: details || [] });

// ---------- cache ----------
// Saved to cache.json so it survives restarts. A production version would use Redis or SQLite.
const HOUR = 3600000;
const CACHE_FILE = path.join(__dirname, 'cache.json');
const CACHE_MAX_ENTRIES = 1000;
const cache = new Map(); // key -> { at, exp, value }
const inflight = new Map(); // key -> Promise, so two people checking the same store share one fetch

try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')))) if (v.exp > Date.now()) cache.set(k, v);
} catch {}

let saveTimer = null;
function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    for (const [k, v] of cache) if (v.exp <= Date.now()) cache.delete(k);
    while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value); // oldest first
    fs.writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)), () => {});
  }, 1000);
}

// ttl: ms, or a function (value) => ms. A ttl of 0 means "don't save this one" (e.g. rate-limited results).
async function cached(key, ttl, fn, { fresh = false } = {}) {
  const hit = cache.get(key);
  if (!fresh && hit && hit.exp > Date.now()) return { value: hit.value, at: hit.at };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const value = await fn();
    const ms = typeof ttl === 'function' ? ttl(value) : ttl;
    if (ms > 0) {
      cache.delete(key); // re-insert so Map order stays oldest-first
      cache.set(key, { at: Date.now(), exp: Date.now() + ms, value });
      saveCacheSoon();
    }
    return { value, at: null };
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
const okTtl = (good) => (sigOrValue) => (sigOrValue?.level === 'error' ? 0 : good);

// ---------- checks ----------

async function checkDomainAge(domain) {
  const r = await get(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
    accept: 'application/rdap+json, application/json',
  });
  if (!r.ok) return sig('domain', 'Domain age', 'error', `Registration lookup unavailable (${r.error || r.status}).`);
  let j;
  try {
    j = JSON.parse(r.text);
  } catch {
    return sig('domain', 'Domain age', 'error', 'Registration lookup returned unreadable data.');
  }
  const reg = (j.events || []).find((e) => e.eventAction === 'registration');
  const registrarEnt = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const registrar = registrarEnt?.vcardArray?.[1]?.find((f) => f[0] === 'fn')?.[3];
  const details = registrar ? [`Registrar: ${registrar}`] : [];
  if (!reg) return sig('domain', 'Domain age', 'info', 'Registration date not published for this domain.', details);
  const age = Date.now() - new Date(reg.eventDate).getTime();
  const when = `Registered ${ago(age)} (${fmtDate(reg.eventDate)}).`;
  if (age < 30 * DAY) return sig('domain', 'Domain age', 'bad', `${when} Brand-new domains are the most common sign of a pop-up store.`, details);
  if (age < 180 * DAY) return sig('domain', 'Domain age', 'warn', `${when} Under six months old.`, details);
  return sig('domain', 'Domain age', 'good', when, details);
}

async function checkFirstCert(domain) {
  const r = await get(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, {
    timeout: 28000,
    accept: 'application/json',
  });
  if (!r.ok) return sig('cert', 'First SSL certificate', 'error', `Certificate log unavailable (${r.error || r.status}).`);
  // Regex instead of JSON.parse so a truncated huge response still works.
  const dates = [...r.text.matchAll(/"not_before":"([^"]+)"/g)].map((m) => new Date(m[1] + 'Z').getTime()).filter(Boolean);
  if (!dates.length) return sig('cert', 'First SSL certificate', 'info', 'No certificates on record.');
  const first = Math.min(...dates);
  const age = Date.now() - first;
  const when = `First certificate issued ${ago(age)} (${fmtDate(first)}), a good proxy for when the site went live.`;
  if (age < 30 * DAY) return sig('cert', 'Site went live', 'bad', when);
  if (age < 120 * DAY) return sig('cert', 'Site went live', 'warn', when);
  return sig('cert', 'Site went live', 'good', when);
}

const URGENCY = [
  [/only\s+\d+\s+(?:left|remaining)/i, '"Only X left"'],
  [/limited[-\s]time/i, '"Limited time"'],
  [/sale\s+ends/i, '"Sale ends…"'],
  [/selling\s+fast/i, '"Selling fast"'],
  [/\d+\s+(?:people|others)\s+(?:are\s+)?(?:viewing|looking)/i, '"X people viewing"'],
  [/sold\s+in\s+(?:the\s+)?last\s+\d+/i, '"X sold in the last…"'],
  [/hurry/i, '"Hurry"'],
  [/today\s+only/i, '"Today only"'],
  [/countdown|hurrify|timer[-_]?app|essential[-_]countdown/i, 'Countdown timer widget'],
  [/\b(?:[5-9]\d)%\s*off/i, '50%+ off banner'],
];
const REVIEW_APPS = [
  [/ali[-_\s]?reviews|kudosi/i, 'Ali Reviews / Kudosi', true],
  [/ryviu/i, 'Ryviu', true],
  [/loox/i, 'Loox', false],
  [/judge\.me|judgeme/i, 'Judge.me', false],
  [/rivyo/i, 'Rivyo', true],
];
const DROPSHIP_APPS = [
  [/dsers/i, 'DSers'],
  [/zendrop/i, 'Zendrop'],
  [/cjdropshipping|cj[-_]dropshipping/i, 'CJ Dropshipping'],
  [/autods/i, 'AutoDS'],
  [/spocket/i, 'Spocket'],
  [/oberlo/i, 'Oberlo'],
];

function detectPlatform(html, headers) {
  if (/cdn\.shopify\.com|Shopify\.shop|shopify-section/i.test(html) || headers?.get?.('x-shopid')) return 'Shopify';
  if (/woocommerce/i.test(html)) return 'WooCommerce';
  if (/static\.wixstatic\.com|wix\.com/i.test(html)) return 'Wix';
  if (/bigcommerce/i.test(html)) return 'BigCommerce';
  if (/squarespace/i.test(html)) return 'Squarespace';
  return 'Unknown';
}

function checkHomepage(html) {
  const text = htmlToText(html);
  const out = [];

  const hits = URGENCY.filter(([re]) => re.test(re.source.includes('countdown') ? html : text)).map(([, label]) => label);
  if (hits.length >= 3)
    out.push(sig('urgency', 'Pressure tactics', 'warn', `${hits.length} urgency tactics on the homepage.`, hits));
  else if (hits.length)
    out.push(sig('urgency', 'Pressure tactics', 'info', `A little urgency marketing (${hits.length}).`, hits));
  else out.push(sig('urgency', 'Pressure tactics', 'good', 'No fake-urgency tactics detected on the homepage.'));

  const reviews = REVIEW_APPS.filter(([re]) => re.test(html));
  const aliImport = reviews.filter(([, , ali]) => ali).map(([, n]) => n);
  if (aliImport.length)
    out.push(sig('reviews', 'Review source', 'warn', `Uses ${aliImport.join(', ')}, apps built mainly to import reviews from AliExpress.`));
  else if (reviews.length)
    out.push(sig('reviews', 'Review source', 'info', `Uses ${reviews.map(([, n]) => n).join(', ')}. These can import AliExpress reviews, so check reviews for copied photos.`));

  const ds = DROPSHIP_APPS.filter(([re]) => re.test(html)).map(([, n]) => n);
  if (ds.length)
    out.push(sig('dropship', 'Dropshipping tools', 'warn', `Site code references ${ds.join(', ')}. Products likely ship straight from an overseas supplier.`));

  return out;
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const decodeXml = (t) => (t || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const fixImg = (src) => (src || '').replace(/^\/\//, 'https://');

// Keep only the fields we use, so the cache stays small.
const trimProduct = (p) => {
  const v = (p.variants || [])[0] || {};
  return {
    handle: p.handle,
    title: p.title,
    type: (p.product_type || '').trim().toLowerCase(),
    date: p.published_at || p.created_at,
    price: v.price ? parseFloat(v.price) : null,
    compareAt: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
    image: fixImg(p.images?.[0]?.src),
  };
};

// Shopify's product sitemap: a separate file from products.json, with each product's URL, last-edit date and photo.
async function fetchSitemapProducts(origin) {
  const idx = await get(`${origin}/sitemap.xml`);
  if (idx.status === 429) return { rateLimited: true };
  const base = registrableDomain(new URL(origin).hostname);
  let locs = [...idx.text.matchAll(/<loc>\s*([^<]*sitemap_products[^<]*?)\s*<\/loc>/gi)]
    .map((m) => decodeXml(m[1]))
    .filter((l) => {
      try {
        return registrableDomain(new URL(l).hostname) === base; // never follow a sitemap to another site
      } catch {
        return false;
      }
    });
  if (!locs.length) locs = [`${origin}/sitemap_products_1.xml`];
  const sm = await get(locs[0], { timeout: 15000, maxBytes: 20_000_000 });
  if (sm.status === 429) return { rateLimited: true };
  if (!sm.ok) return { items: [] };
  const items = [];
  for (const block of sm.text.split(/<url>/i).slice(1)) {
    const loc = decodeXml(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]);
    const handle = loc.split('/products/')[1]?.split(/[?#/]/)[0];
    if (!handle) continue;
    items.push({
      handle,
      title: decodeXml(block.match(/<image:title>([\s\S]*?)<\/image:title>/i)?.[1]) || handle.replace(/-/g, ' '),
      date: block.match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1] || null,
      image: decodeXml(block.match(/<image:loc>([\s\S]*?)<\/image:loc>/i)?.[1]),
      price: null,
      compareAt: null,
    });
  }
  return { items };
}

// Returns { source: 'products' | 'sitemap' | 'none', items, rateLimited? }
async function fetchCatalog(origin) {
  const url = `${origin}/products.json?limit=250`;
  let r = await get(url, { timeout: 15000, maxBytes: 40_000_000 });
  if (r.status === 429) {
    await sleep(2500);
    r = await get(url, { timeout: 15000, maxBytes: 40_000_000 });
  }
  if (r.ok) {
    try {
      const products = JSON.parse(r.text).products;
      if (Array.isArray(products) && products.length) return { source: 'products', items: products.map(trimProduct) };
    } catch {}
  }
  const sm = await fetchSitemapProducts(origin);
  if (sm.items?.length) return { source: 'sitemap', items: sm.items, productsBlocked: r.status === 429 };
  if (r.status === 429 || sm.rateLimited) return { source: 'none', items: [], rateLimited: true };
  return { source: 'none', items: [] };
}

// Full catalog: 12h. Sitemap-only (weaker data): 1h, so a later check can upgrade it. Rate-limited: never saved.
const catalogTtl = (c) => (c.rateLimited ? 0 : c.source === 'sitemap' ? 1 * HOUR : 12 * HOUR);

async function checkProducts(origin, productHandle, opts) {
  const { value: catalog } = await cached(`catalog:${origin}`, catalogTtl, () => fetchCatalog(origin), opts);
  const items = catalog.items;

  if (catalog.rateLimited)
    return { signals: [sig('catalog', 'Product catalog', 'error', 'Shopify is rate-limiting catalog checks right now. Try again in a minute.')], samples: [] };
  if (!items.length)
    return { signals: [sig('catalog', 'Product catalog', 'info', 'Catalog is not publicly listed, so store age by product dates is unknown.')], samples: [] };

  const signals = [];
  const n = items.length;
  const dates = items.map((p) => new Date(p.date).getTime()).filter(Boolean);
  const oldest = dates.length ? Math.min(...dates) : null;
  const oldestAge = oldest ? Date.now() - oldest : null;

  if (catalog.source === 'products' && oldest) {
    const recent30 = dates.filter((d) => Date.now() - d < 30 * DAY).length;
    const ageMsg = `Oldest listed product was added ${ago(oldestAge)} (${fmtDate(oldest)}).`;
    const countMsg = `${n === 250 ? '250+' : n} products, ${recent30} added in the last 30 days.`;
    if (oldestAge < 45 * DAY) signals.push(sig('catalog', 'Store age (by products)', 'bad', `${ageMsg} The whole store appeared within the last ~6 weeks.`, [countMsg]));
    else if (oldestAge < 150 * DAY) signals.push(sig('catalog', 'Store age (by products)', 'warn', ageMsg, [countMsg]));
    else signals.push(sig('catalog', 'Store age (by products)', 'good', ageMsg, [countMsg]));
  } else if (catalog.source === 'sitemap' && oldest) {
    // lastmod is the last *edit*, not the creation date, so it only proves a minimum age.
    const note = [`${n} products in the store's sitemap.`, 'Based on last-edit dates, because the full catalog was unavailable.'];
    if (oldestAge >= 150 * DAY)
      signals.push(sig('catalog', 'Store age (by sitemap)', 'good', `Oldest product page was last edited ${ago(oldestAge)} (${fmtDate(oldest)}), so the store is at least that old.`, note));
    else
      // Shopify bumps lastmod on any edit (even stock changes), so a recent date proves nothing either way.
      signals.push(sig('catalog', 'Store age (by sitemap)', 'info', `Product pages were edited recently (oldest edit ${ago(oldestAge)}), so their dates can't show how old the store is. Rely on the domain and site-age checks.`, note));
  }

  if (catalog.source === 'products') {
    // Permanent "sale" pricing
    const disc = items.filter((p) => p.price > 0 && p.compareAt > p.price);
    if (disc.length) {
      const share = disc.length / n;
      const avg = disc.reduce((a, p) => a + (1 - p.price / p.compareAt), 0) / disc.length;
      const msg = `${Math.round(share * 100)}% of products show a crossed-out "was" price, averaging ${Math.round(avg * 100)}% off.`;
      if (share >= 0.7 && avg >= 0.4)
        signals.push(sig('pricing', 'Fake "was" prices', 'warn', `${msg} When nearly everything is on deep sale all the time, the original price is usually made up.`));
      else signals.push(sig('pricing', 'Discounts', 'info', msg));
    }
    // Random mix of unrelated products ("general store")
    const types = new Set(items.map((p) => p.type).filter(Boolean));
    if (n >= 15 && types.size >= 8 && types.size / n > 0.3)
      signals.push(sig('mix', 'Product mix', 'warn', `${types.size} unrelated product categories. Random catalogs are typical of dropshipping "general stores".`, [...types].slice(0, 10)));
  }

  // Samples for reverse image search; the product from the ad link goes first
  let ordered = items;
  if (productHandle) {
    let target = items.find((p) => p.handle === productHandle);
    if (!target && catalog.source === 'products') {
      const pr = await get(`${origin}/products/${encodeURIComponent(productHandle)}.json`);
      try {
        target = trimProduct(JSON.parse(pr.text).product);
      } catch {}
    }
    if (target) ordered = [target, ...items.filter((p) => p.handle !== target.handle)];
  }
  const samples = ordered
    .filter((p) => p.image)
    .slice(0, 6)
    .map((p) => ({ title: p.title, price: p.price, compareAt: p.compareAt, image: p.image, url: `${origin}/products/${p.handle}` }));
  return { signals, samples };
}

const FREE_MAIL = /@(gmail|googlemail|outlook|hotmail|live|yahoo|ymail|aol|icloud|proton(?:mail)?|qq|163|126|yandex|gmx)\.[a-z.]+$/i;

async function checkPolicies(origin, homeHtml, host) {
  const base = host.replace(/^www\./, '');
  const candidates = new Set([
    '/policies/shipping-policy',
    '/policies/refund-policy',
    '/policies/terms-of-service',
    '/pages/contact',
  ]);
  for (const m of homeHtml.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (!/(shipping|refund|return|contact|terms|about)/i.test(href)) continue;
    try {
      const u = new URL(href, origin);
      if (u.hostname.replace(/^www\./, '') === base) candidates.add(u.pathname);
    } catch {}
  }
  const paths = [...candidates].slice(0, 8);
  const pages = await Promise.all(paths.map((p) => get(origin + p, { timeout: 8000 })));
  const found = pages
    .map((r, i) => ({ path: paths[i], ok: r.ok && !/\/password$/.test(r.url), text: r.ok ? htmlToText(r.text) : '' }))
    .filter((p) => p.ok && p.text.length > 200);

  const signals = [];
  const all = found.map((p) => p.text).join(' \n ');
  const shippingPage = found.find((p) => /shipping/i.test(p.path));
  const refundPage = found.find((p) => /refund|return/i.test(p.path));

  if (!shippingPage && !refundPage)
    signals.push(sig('policies', 'Store policies', 'warn', "Couldn't find a shipping or refund policy page."));

  // Shipping times
  const ranges = [...all.matchAll(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:business\s+|working\s+)?days/gi)]
    .map((m) => Number(m[2]))
    .filter((d) => d > 0 && d <= 60);
  const maxDays = ranges.length ? Math.max(...ranges) : 0;
  const overseas = [/(?:ships?|shipped|dispatched)\s+(?:directly\s+)?from\s+(?:china|asia|our\s+(?:international|overseas)\s+(?:warehouse|supplier)s?)/i, /overseas\s+warehouse/i, /(?:multiple|international|global)\s+warehouses/i, /ships?\s+from\s+(?:our\s+)?(?:international|overseas)/i]
    .filter((re) => re.test(all))
    .map((re) => all.match(re)[0]);
  if (maxDays >= 20 || (maxDays >= 14 && overseas.length))
    signals.push(sig('shipping', 'Shipping times', 'bad', `Policy quotes delivery of up to ${maxDays} days. That's typical of products shipped from overseas suppliers after you order.`, overseas.map((o) => `Mentions "${o}"`)));
  else if (maxDays >= 12 || overseas.length)
    signals.push(sig('shipping', 'Shipping times', 'warn', maxDays ? `Policy quotes delivery of up to ${maxDays} days.` : 'Policy mentions overseas fulfilment.', overseas.map((o) => `Mentions "${o}"`)));
  else if (shippingPage)
    signals.push(sig('shipping', 'Shipping times', 'good', maxDays ? `Policy quotes up to ${maxDays} days.` : 'No unusually long delivery times found.'));

  // Returns
  const returnFlags = [
    [/(?:do not|don't|cannot)\s+(?:accept|offer)\s+returns|all\s+sales\s+(?:are\s+)?final|no\s+returns/i, 'No returns / all sales final'],
    [/contact\s+us\s+(?:first\s+)?(?:for|to\s+get)\s+(?:the|a|our)?\s*return\s+address|return\s+address\s+will\s+be\s+provided/i, 'Return address only "provided on request"'],
    [/(?:customer|buyer|you)\s+(?:is|are|will\s+be)\s+responsible\s+for\s+(?:all\s+)?return\s+shipping/i, 'You pay return shipping'],
    [/restocking\s+fee/i, 'Restocking fee'],
  ]
    .filter(([re]) => re.test(all))
    .map(([, l]) => l);
  if (returnFlags.length >= 2) signals.push(sig('returns', 'Return policy', 'warn', 'Return policy makes getting your money back hard.', returnFlags));
  else if (returnFlags.length) signals.push(sig('returns', 'Return policy', 'info', returnFlags[0] + '.', returnFlags));
  else if (refundPage) signals.push(sig('returns', 'Return policy', 'good', 'No obvious return-policy traps found.'));

  // Copy-pasted templates
  const leftovers = [
    ...all.matchAll(/\[(?:store|company|business|your)[^\]]{0,30}\]|\{\{[^}]{1,30}\}\}|your\s+store\s+name|insert\s+(?:company|store|email)/gi),
  ].map((m) => m[0]);
  const ownShop = (homeHtml.match(/Shopify\.shop\s*=\s*["']([^"']+)["']/) || [])[1] || '';
  const otherDomains = [...new Set([...all.matchAll(/\b([a-z0-9-]+\.myshopify\.com)\b/gi)].map((m) => m[1].toLowerCase()))]
    .filter((d) => d !== ownShop.toLowerCase())
    .slice(0, 3);
  if (leftovers.length || otherDomains.length)
    signals.push(
      sig('template', 'Copied policies', 'warn', 'Policy pages look copy-pasted from a template or another store.', [
        ...[...new Set(leftovers)].slice(0, 3).map((l) => `Leftover placeholder: "${l}"`),
        ...otherDomains.map((d) => `Mentions another Shopify store: ${d}`),
      ])
    );

  // Contact email
  const emails = [...new Set([...(all + ' ' + homeHtml).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => m[0].toLowerCase()))]
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/sentry|example|wixpress|shopify/.test(e));
  const free = emails.filter((e) => FREE_MAIL.test(e));
  if (free.length) signals.push(sig('contact', 'Contact email', 'warn', `Support email is a free address (${free[0]}), not one on the store's own domain.`));
  else if (emails.length) signals.push(sig('contact', 'Contact email', 'good', `Uses a business email (${emails[0]}).`));
  else signals.push(sig('contact', 'Contact email', 'info', 'No contact email found on the pages checked.'));

  return signals;
}

const MARKETPLACES = /aliexpress|alibaba|temu|dhgate|shein|1688|wish\.com|banggood/i;
async function reverseImage(samples) {
  if (!SERPAPI_KEY || !samples.length) return [];
  const out = [];
  for (const s of samples.slice(0, 2)) {
    const r = await get(
      `https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(s.image)}&api_key=${SERPAPI_KEY}`,
      { timeout: 25000, accept: 'application/json' }
    );
    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      continue;
    }
    const matches = (j.visual_matches || [])
      .filter((m) => MARKETPLACES.test(m.source || '') || MARKETPLACES.test(m.link || ''))
      .map((m) => ({ source: m.source, link: m.link, title: m.title, price: m.price?.extracted_value ?? null, currency: m.price?.currency || '' }));
    s.matches = matches.slice(0, 4);
    const priced = matches.filter((m) => m.price);
    if (priced.length && s.price) {
      const cheapest = priced.sort((a, b) => a.price - b.price)[0];
      const markup = s.price / cheapest.price;
      out.push(
        sig('markup', `Markup: ${s.title.slice(0, 40)}`, markup >= 4 ? 'bad' : markup >= 2 ? 'warn' : 'info',
          `Same image found on ${cheapest.source} for ${cheapest.currency}${cheapest.price}. This store charges $${s.price} (${markup.toFixed(1)}× markup).`)
      );
    } else if (matches.length) {
      out.push(sig('markup', `Found elsewhere: ${s.title.slice(0, 40)}`, 'warn', `Same product image appears on ${matches[0].source}.`));
    }
  }
  return out;
}

// ---------- orchestration ----------

async function runCheck(raw, { fresh = false } = {}) {
  const u = normalizeInput(raw);
  await assertPublicHost(u.hostname);
  const handle = u.pathname.match(/\/products\/([^/?#]+)/)?.[1] || null;
  const { value, at } = await cached(`result:${u.origin}|${handle || ''}`, resultTtl, () => computeCheck(u, handle, { fresh }), { fresh });
  return { ...value, input: String(raw), cachedAt: at };
}

// Clean result: 12h. Some checks failed (e.g. crt.sh down): 1h. Catalog rate-limited: don't save.
const resultTtl = (r) =>
  r.signals.some((s) => s.id === 'catalog' && s.level === 'error') ? 0 : r.signals.some((s) => s.level === 'error') ? 1 * HOUR : 12 * HOUR;

async function computeCheck(u, handle, opts) {
  const started = Date.now();
  const origin = u.origin;
  const domain = registrableDomain(u.hostname);

  const [home, { value: domainSig }, { value: certSig }] = await Promise.all([
    get(origin),
    cached(`domain:${domain}`, okTtl(24 * HOUR), () => checkDomainAge(domain), opts),
    cached(`cert:${domain}`, okTtl(24 * HOUR), () => checkFirstCert(domain), opts),
  ]);
  if (!home.ok && !home.text)
    throw new Error(`Couldn't load ${u.hostname} (${home.error || 'HTTP ' + home.status}).`);

  const html = home.text;
  const platform = detectPlatform(html, home.headers);
  const title = htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || u.hostname;

  const [prod, policySigs] = await Promise.all([
    platform === 'Shopify' ? checkProducts(origin, handle, opts) : Promise.resolve({ signals: [], samples: [] }),
    checkPolicies(origin, html, u.hostname),
  ]);
  const imageSigs = await reverseImage(prod.samples);

  const signals = [domainSig, certSig, ...prod.signals, ...imageSigs, ...checkHomepage(html), ...policySigs];
  const score = signals.reduce((s, x) => s + (x.level === 'bad' ? 3 : x.level === 'warn' ? 1 : 0), 0);
  const verdict = score >= 7 ? 'many' : score >= 3 ? 'some' : 'few';

  return {
    origin,
    host: u.hostname,
    domain,
    title: title.slice(0, 120),
    platform,
    score,
    verdict,
    signals,
    products: prod.samples,
    reverseImageEnabled: Boolean(SERPAPI_KEY),
    elapsedMs: Date.now() - started,
  };
}

// ---------- server ----------

const INDEX = path.join(__dirname, 'index.html');
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/check') {
      res.setHeader('content-type', 'application/json');
      try {
        const result = await runCheck(url.searchParams.get('url'), { fresh: url.searchParams.get('fresh') === '1' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      fs.createReadStream(INDEX).pipe(res);
      return;
    }
    res.statusCode = 404;
    res.end('Not found');
  })
  .listen(PORT, () => console.log(`StoreCheck running at http://localhost:${PORT}${SERPAPI_KEY ? ' (reverse image search on)' : ''}`));
