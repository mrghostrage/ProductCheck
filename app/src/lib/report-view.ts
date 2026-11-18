// Turns a report into what the report screen and its detail sheets show.
// Keeps the screens free of data logic, and keeps every sheet built from the same report.
import type { Tone } from '@/constants/theme';

import type { RuleResult } from './rules';
import type { MaterialComponent, Report, Verdict } from './types';

export const SHORT: Record<Verdict, string> = { contradicted: 'False', misleading: 'Vague', unverifiable: 'Unclear', supported: 'Checks Out' };
export const VERDICT_TONE: Record<Verdict, Tone> = { contradicted: 'red', misleading: 'orange', unverifiable: 'gray', supported: 'green' };
export const VERDICT_SYMBOL: Record<Verdict, string> = { contradicted: 'xmark', misleading: 'exclamationmark', unverifiable: 'questionmark', supported: 'checkmark' };
const ORDER: Verdict[] = ['contradicted', 'misleading', 'unverifiable', 'supported'];

// Wording flags sit beside claims on the report, so they get the same tone, symbol and short verdict.
export const WORDING: Record<Report['wording'][number]['verdict'], { tone: Tone; symbol: string; short: string }> = {
  misleading: { tone: 'orange', symbol: 'exclamationmark', short: 'Vague' },
  info: { tone: 'blue', symbol: 'text.quote', short: 'Explained' },
};

export function gradeTone(grade: Report['origin']['grade']): Tone {
  return grade === 'contradicted' ? 'red' : grade === 'full' ? 'green' : grade === 'partial' ? 'orange' : 'gray';
}

export function materialTone(m: MaterialComponent): Tone {
  return m.plastic ? 'orange' : m.natural ? 'green' : 'blue';
}

export function materialKind(m: MaterialComponent) {
  return m.plastic ? 'Plastic' : m.natural ? 'Natural' : 'Man-made';
}

const sourceName = (from: 'label' | 'listing') => (from === 'label' ? 'Care label' : 'Listing');

function site(r: Report): string | null {
  const url = r.sources.find((s) => s.url)?.url;
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

export function productName(r: Report) {
  return (r.product.name ?? r.product.brand)?.replace(/^Demo:\s*/, '') ?? site(r) ?? 'Unnamed Product';
}

// Where the report came from and when, e.g. "Care label and Listing (shop.com) · Nov 18".
export function sourceLine(r: Report) {
  const kinds = [...new Set(r.sources.map((s) => sourceName(s.type)))];
  const host = site(r);
  const latest = r.sources.map((s) => s.readAt).sort().at(-1);
  const date = latest ? new Date(latest).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return `${kinds.join(' and ')}${host ? ` (${host})` : ''}${date ? ` · ${date}` : ''}`;
}

export function categorySymbol(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('bag')) return 'bag';
  if (c.includes('shoe') || c.includes('foot')) return 'shoe';
  if (c.includes('jewel')) return 'sparkles';
  if (c.includes('home') || c.includes('bed') || c.includes('towel')) return 'bed.double';
  return 'tshirt';
}

// ---------- Summary ----------

export interface Summary {
  tone: Tone;
  issues: number;
  word: string; // shown under the big number or symbol
  segments: { value: number; strong: boolean }[];
  keys: { label: string; strong: boolean }[];
}

export function summarize(r: Report): Summary {
  const wordingIssues = r.wording.filter((w) => w.verdict === 'misleading').length;
  const contradicted = Math.max(r.counts.contradicted, r.contradictions.length);
  const vague = r.counts.misleading + wordingIssues;
  const issues = contradicted + vague;
  const tone: Tone = contradicted ? 'red' : vague ? 'orange' : r.counts.supported ? 'green' : 'gray';

  const parts = [
    { n: contradicted, label: 'False' },
    { n: vague, label: 'Vague' },
    { n: r.counts.unverifiable, label: 'Unclear' },
    { n: r.counts.supported, label: 'OK' },
  ].filter((p) => p.n > 0);

  // The worst kind of finding is drawn solid; on a clean report that's the "OK" share.
  const strongLabel = contradicted ? 'False' : vague ? 'Vague' : 'OK';
  const strong = (p: { label: string }) => p.label === strongLabel;
  return {
    tone,
    issues,
    word: issues ? (issues === 1 ? 'Issue' : 'Issues') : tone === 'green' ? 'Checks Out' : 'Not Enough Info',
    segments: parts.map((p) => ({ value: p.n, strong: strong(p) })),
    keys: parts.map((p) => ({ label: `${p.n} ${p.label}`, strong: strong(p) })),
  };
}

// ---------- Origin ----------

const ISO3: Record<string, string> = {
  china: 'CHN', prc: 'CHN', 'mainland china': 'CHN', italy: 'ITA', 'united states': 'USA', 'united states of america': 'USA', usa: 'USA', us: 'USA', america: 'USA', vietnam: 'VNM', 'viet nam': 'VNM',
  india: 'IND', bangladesh: 'BGD', turkey: 'TUR', 'türkiye': 'TUR', portugal: 'PRT', spain: 'ESP', france: 'FRA', germany: 'DEU', japan: 'JPN',
  korea: 'KOR', 'south korea': 'KOR', taiwan: 'TWN', indonesia: 'IDN', cambodia: 'KHM', pakistan: 'PAK', mexico: 'MEX', 'sri lanka': 'LKA',
  thailand: 'THA', philippines: 'PHL', myanmar: 'MMR', canada: 'CAN', 'united kingdom': 'GBR', 'great britain': 'GBR', uk: 'GBR', england: 'GBR', scotland: 'GBR',
  peru: 'PER', brazil: 'BRA', morocco: 'MAR', egypt: 'EGY', romania: 'ROU', poland: 'POL', 'hong kong': 'HKG', malaysia: 'MYS',
  ethiopia: 'ETH', jordan: 'JOR', honduras: 'HND', guatemala: 'GTM', 'el salvador': 'SLV', nicaragua: 'NIC', 'dominican republic': 'DOM',
  haiti: 'HTI', australia: 'AUS', 'new zealand': 'NZL', ireland: 'IRL', 'czech republic': 'CZE', bulgaria: 'BGR', tunisia: 'TUN',
};

// "The U.S.A." → "usa": the form ISO3 is keyed by.
const countryKey = (name: string) => name.toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L} ]/gu, '').replace(/\s+/g, ' ').trim();

export function countryCode(name: string): string {
  return ISO3[countryKey(name)] ?? name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

// Same country under different names ("USA" / "United States", "Viet Nam" / "Vietnam").
export function sameCountry(a: string, b: string): boolean {
  const id = (n: string) => ISO3[countryKey(n)] ?? countryKey(n);
  return id(a) === id(b);
}

function countryIn(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b(?:made|manufactured|produced|assembled|crafted|sewn|knitted|woven|printed)\s+in\s+(?:the\s+)?([A-Za-zÀ-ÿ .'-]+)/i);
  return m ? m[1].replace(/[.\s]+$/, '').trim() : null;
}

export interface OriginView {
  listing: string | null; // country the listing claims
  label: string | null; // country on the label (or the only known one)
  mismatch: boolean;
  known: number;
  total: number;
}

export function originView(r: Report): OriginView {
  const claim = r.claims.find((c) => c.kind === 'origin' && c.from === 'listing');
  const listing = countryIn(claim?.quote);
  const label = countryIn(r.origin.text) ?? r.origin.ladder.find((s) => s.stage === 'assembly')?.country ?? r.origin.ladder.find((s) => s.country)?.country ?? null;
  const mismatch = !!listing && !!label && !sameCountry(listing, label);
  return { listing, label, mismatch, known: r.origin.ladder.filter((s) => s.country).length, total: r.origin.ladder.length };
}

export const STAGE_SYMBOL: Record<string, string> = {
  raw_material: 'leaf.fill',
  fabric: 'square.grid.3x3.fill',
  components: 'gearshape.fill',
  assembly: 'scissors',
  finishing: 'sparkles',
};

// ---------- Rules ----------

export function rulesSummary(rules: RuleResult[]): { tone: Tone; title: string; sub: string; symbol: string } {
  const fail = rules.filter((x) => x.status === 'fail');
  if (fail.length) return { tone: 'red', title: "Doesn't Fit", sub: fail.length > 1 ? `${fail.length} of your rules` : fail[0].reason, symbol: 'nosign' };
  if (rules.some((x) => x.status === 'unknown')) return { tone: 'gray', title: "Can't Tell Yet", sub: 'Add the care label to check', symbol: 'questionmark' };
  return { tone: 'green', title: 'Fits Your Rules', sub: rules.length > 1 ? `All ${rules.length} rules pass` : rules[0].rule, symbol: 'checkmark' };
}

// ---------- Detail sheets ----------

export interface DetailRow { k: string; sub?: string; v?: string; vTone?: Tone; bold?: boolean }
export interface Detail {
  symbol: string;
  tone: Tone;
  title: string;
  lead: { t: string; tone?: Tone; bold?: boolean }[];
  groups: { label?: string; rows: DetailRow[] }[];
  notes: string[];
  source?: string;
  action?: 'rules';
}

export function detailFor(key: string, r: Report, rules: RuleResult[] | null): Detail | null {
  const [kind, a, b] = key.split(':');

  if (kind === 'origin') {
    const o = originView(r);
    const lead: Detail['lead'] = o.mismatch
      ? [{ t: `The listing says ${o.listing}. The care label says ` }, { t: o.label!, bold: true }, { t: '.' }]
      : [{ t: r.origin.gradeExplanation }];
    const rows: DetailRow[] = [];
    if (o.listing) rows.push({ k: 'Listing', sub: 'Store product page', v: o.listing, vTone: o.mismatch ? 'red' : undefined });
    if (r.origin.text) rows.push({ k: 'Care label', sub: `“${r.origin.text}”`, v: o.label ?? '—', bold: true });
    if (r.origin.design) rows.push({ k: 'Designed in', v: r.origin.design });
    return {
      symbol: 'mappin.and.ellipse',
      tone: gradeTone(r.origin.grade),
      title: 'Origin',
      lead,
      groups: rows.length ? [{ label: 'Compared', rows }] : [],
      notes: [r.origin.explanation].filter(Boolean),
      source: r.origin.text ? 'Care label' : undefined,
    };
  }

  if (kind === 'claim') {
    const c = sortedClaims(r)[Number(a)];
    if (!c) return null;
    return {
      symbol: VERDICT_SYMBOL[c.verdict],
      tone: VERDICT_TONE[c.verdict],
      title: `“${c.quote}”`,
      lead: [{ t: c.reason }],
      groups: [{ label: 'Details', rows: [{ k: 'Verdict', v: SHORT[c.verdict], vTone: VERDICT_TONE[c.verdict] }, { k: 'Claimed in', v: sourceName(c.from) }] }],
      notes: [],
      source: c.basis ?? undefined,
    };
  }

  if (kind === 'wording') {
    const w = r.wording[Number(a)];
    if (!w) return null;
    const { tone, symbol, short } = WORDING[w.verdict];
    return {
      symbol,
      tone,
      title: w.title,
      lead: [{ t: w.meaning }],
      groups: [{ label: 'Details', rows: [{ k: 'Wording', sub: `“${w.quote}”`, v: short, vTone: tone }, { k: 'Found in', v: sourceName(w.from) }] }],
      notes: [],
      source: w.basis,
    };
  }

  if (kind === 'rules') {
    if (!rules?.length) return null;
    const s = rulesSummary(rules);
    const statusTone: Record<RuleResult['status'], Tone> = { pass: 'green', fail: 'red', unknown: 'gray' };
    const statusText: Record<RuleResult['status'], string> = { pass: 'Fits', fail: "Doesn't fit", unknown: 'Unknown' };
    return {
      symbol: s.symbol,
      tone: s.tone,
      title: 'Your Rules',
      lead: [{ t: 'This product ' }, { t: s.tone === 'red' ? "doesn't fit" : s.tone === 'green' ? 'fits' : "can't be checked yet", tone: s.tone, bold: true }, { t: '.' }],
      groups: [{ rows: rules.map((x) => ({ k: x.rule, sub: x.reason, v: statusText[x.status], vTone: statusTone[x.status] })) }],
      notes: ['Your rules are stored and checked only on this phone.'],
      action: 'rules',
    };
  }

  if (kind === 'mat') {
    const part = r.materials[Number(a)];
    const m = part?.components[Number(b)];
    if (!m) return null;
    const type = [materialKind(m), m.animal ? 'Animal' : null].filter(Boolean).join(' · ');
    return {
      symbol: m.plastic ? 'drop.fill' : 'leaf.fill',
      tone: materialTone(m),
      title: m.label,
      lead: [{ t: m.plain }],
      groups: [{ label: 'Details', rows: [{ k: 'Part', v: cap(part.part) }, { k: 'Share', v: m.percent != null ? `${m.percent}%` : 'Not listed' }, { k: 'Type', v: type }] }],
      notes: [],
      source: sourceName(part.from),
    };
  }

  if (kind === 'chain') {
    const o = originView(r);
    return {
      symbol: 'point.3.connected.trianglepath.dotted',
      tone: 'blue',
      title: 'Supply Chain',
      lead: [{ t: 'Only ' }, { t: `${o.known} of ${o.total}`, bold: true }, { t: o.known === 1 ? ' step is disclosed.' : ' steps are disclosed.' }],
      groups: [{ rows: r.origin.ladder.map((s) => ({ k: s.label, sub: s.basis ?? undefined, v: s.country ?? 'Unknown', vTone: s.country ? 'blue' : undefined, bold: !!s.country })) }],
      notes: ['Labels only have to name the last country that substantially changed the product.'],
    };
  }

  return null;
}

export function sortedClaims(r: Report) {
  return [...r.claims].sort((x, y) => ORDER.indexOf(x.verdict) - ORDER.indexOf(y.verdict));
}

export function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
