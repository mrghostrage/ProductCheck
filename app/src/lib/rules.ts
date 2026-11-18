// Personal rules. Stored and checked only on this phone: allergies and preferences
// can be health data, so they are never sent to the server.
import Storage from 'expo-sqlite/kv-store';

import { sameCountry } from './report-view';
import type { Report } from './types';

export interface Prefs {
  avoid: string[]; // material keys, e.g. "polyester"
  naturalOnly: boolean;
  vegan: boolean;
  noPlasticLeather: boolean;
  nickelAllergy: boolean;
  countries: string[]; // allowed "Made in" countries; empty = no rule
}

export const DEFAULT_PREFS: Prefs = { avoid: [], naturalOnly: false, vegan: false, noPlasticLeather: false, nickelAllergy: false, countries: [] };

export const AVOIDABLE: { key: string; label: string }[] = [
  { key: 'polyester', label: 'Polyester' },
  { key: 'nylon', label: 'Nylon' },
  { key: 'acrylic', label: 'Acrylic' },
  { key: 'spandex', label: 'Spandex (elastane)' },
  { key: 'rayon', label: 'Rayon (viscose, "bamboo")' },
  { key: 'wool', label: 'Wool' },
];

const KEY = 'prefs.v1';

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await Storage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(p: Prefs) {
  await Storage.setItem(KEY, JSON.stringify(p));
}

function hasAnyRule(p: Prefs) {
  return p.avoid.length > 0 || p.naturalOnly || p.vegan || p.noPlasticLeather || p.nickelAllergy || p.countries.length > 0;
}

// The shopper's rules checked against a report; empty if they haven't set any.
export async function loadRuleResults(report: Report): Promise<RuleResult[]> {
  const p = await loadPrefs();
  return hasAnyRule(p) ? checkRules(report, p) : [];
}

export interface RuleResult {
  rule: string;
  status: 'pass' | 'fail' | 'unknown';
  reason: string;
}

const pct = (n: number | null) => (n != null ? `${n}% ` : '');

// Fibers an avoid rule also covers. US rules count merino, cashmere, alpaca and mohair as wool.
const ALSO_COVERS: Record<string, string[]> = {
  polyester: ['recycled_polyester'],
  wool: ['merino', 'cashmere', 'alpaca', 'mohair'],
};
const MAYBE_NICKEL = new Set(['alloy', 'brass', 'gold_plated', 'gold_filled', 'stainless_steel']);
const LOW_NICKEL = new Set(['titanium', 'gold', 'sterling_silver']);

export function checkRules(report: Report, p: Prefs): RuleResult[] {
  const comps = report.materials.flatMap((m) => m.components);
  const known = comps.length > 0;
  const out: RuleResult[] = [];
  const unknown = (rule: string) => out.push({ rule, status: 'unknown', reason: 'No material list yet. Snap the care label to check.' });

  for (const key of p.avoid) {
    const label = AVOIDABLE.find((a) => a.key === key)?.label ?? key;
    const rule = `No ${label.toLowerCase()}`;
    if (!known) { unknown(rule); continue; }
    const hit = comps.find((c) => c.key === key || (c.key != null && ALSO_COVERS[key]?.includes(c.key)));
    out.push(hit ? { rule, status: 'fail', reason: `Contains ${pct(hit.percent)}${hit.label.toLowerCase()}.` } : { rule, status: 'pass', reason: `No ${label.toLowerCase()} listed.` });
  }
  if (p.naturalOnly) {
    const rule = 'Natural fibers only';
    if (!known) unknown(rule);
    else {
      const bad = comps.filter((c) => !c.natural);
      out.push(bad.length ? { rule, status: 'fail', reason: `Contains ${bad.map((c) => pct(c.percent) + c.label.toLowerCase()).join(', ')}.` } : { rule, status: 'pass', reason: 'All listed materials are natural.' });
    }
  }
  if (p.vegan) {
    const rule = 'Vegan';
    if (!known) unknown(rule);
    else {
      const animal = comps.filter((c) => c.animal);
      out.push(animal.length
        ? { rule, status: 'fail', reason: `Contains ${animal.map((c) => c.label.toLowerCase()).join(', ')}.` }
        : { rule, status: 'pass', reason: 'No animal materials listed. Glues and dyes aren\'t covered.' });
    }
  }
  if (p.noPlasticLeather) {
    const rule = 'No plastic "leather"';
    if (!known) unknown(rule);
    else out.push(report.materialSummary?.hasPlasticLeather
      ? { rule, status: 'fail', reason: 'Contains polyurethane or PVC, the plastics sold as "vegan" or "PU" leather.' }
      : { rule, status: 'pass', reason: 'No plastic leather listed.' });
  }
  if (p.nickelAllergy && ['jewelry', 'accessory'].includes(report.product.category)) {
    const rule = 'Nickel allergy';
    if (!known && !report.jewelryMarks.length) unknown(rule);
    else if (comps.some((c) => c.key === 'nickel')) out.push({ rule, status: 'fail', reason: 'Lists nickel.' });
    else if (comps.some((c) => c.key && MAYBE_NICKEL.has(c.key)) || report.jewelryMarks.some((m) => /gp|hge|plat/i.test(m)))
      out.push({ rule, status: 'unknown', reason: 'Plated or base metal: these often contain nickel, and "hypoallergenic" isn\'t a guarantee.' });
    else if (comps.length && comps.every((c) => c.key && LOW_NICKEL.has(c.key)))
      out.push({ rule, status: 'pass', reason: 'Metals listed are generally low-nickel. Check the clasp too.' });
    else unknown(rule);
  }
  if (p.countries.length) {
    const rule = `Made in ${p.countries.join(', ')}`;
    const made = report.origin.ladder.find((s) => s.stage === 'assembly')?.country;
    if (!made || /imported/i.test(made)) out.push({ rule, status: 'unknown', reason: 'Country of manufacture not disclosed.' });
    else {
      const ok = p.countries.some((c) => sameCountry(c, made));
      out.push({ rule, status: ok ? 'pass' : 'fail', reason: `Made in ${made}${report.origin.grade === 'contradicted' ? ' (sources disagree)' : ''}.` });
    }
  }
  return out;
}
