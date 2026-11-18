// Builds the report shown to people from one or more sources (label photo, listing).
// Everything here is deterministic code: the AI only extracts facts, it never decides verdicts.
import type { ProductFacts, SourceFacts, SourceType } from "../schema.ts";
import { MATERIALS, canonicalMaterial, type MaterialKind } from "../knowledge/materials.ts";
import { findWording, type WordingVerdict } from "../knowledge/wording.ts";
import { decodeOrigin, sameCountry, STAGES, STAGE_LABELS, type OriginWording, type Stage } from "../knowledge/origin.ts";

export type Verdict = "supported" | "contradicted" | "misleading" | "unverifiable";

export interface ClaimResult {
  quote: string;
  kind: string;
  verdict: Verdict;
  reason: string;
  from: SourceType;
  basis: string | null;
}

export interface WordingFlag {
  title: string;
  quote: string;
  meaning: string;
  verdict: WordingVerdict;
  basis: string;
  from: SourceType;
}

export interface MaterialComponentOut {
  name: string;
  percent: number | null;
  key: string | null;
  label: string;
  kind: MaterialKind | "unknown";
  plain: string;
  animal: boolean;
  plastic: boolean;
  natural: boolean;
}

export interface MaterialPartOut {
  part: string;
  components: MaterialComponentOut[];
  from: SourceType;
}

export type OriginGrade = "full" | "partial" | "final_only" | "contradicted" | "none";

export interface OriginOut {
  text: string | null;
  wording: OriginWording;
  explanation: string;
  grade: OriginGrade;
  gradeLabel: string;
  gradeExplanation: string;
  ladder: { stage: Stage; label: string; country: string | null; basis: string | null }[];
  design: string | null;
}

export interface Contradiction {
  title: string;
  detail: string;
}

export interface Report {
  product: { brand: string | null; name: string | null; category: ProductFacts["category"]; gtin: string | null };
  sampleMode: boolean;
  materials: MaterialPartOut[];
  materialSummary: { plasticShare: number | null; naturalShare: number | null; hasAnimal: boolean; hasPlasticLeather: boolean; text: string | null } | null;
  jewelryMarks: string[];
  claims: ClaimResult[];
  wording: WordingFlag[];
  origin: OriginOut;
  contradictions: Contradiction[];
  certifications: { name: string; id: string | null; status: string }[];
  care: string[];
  sources: { type: SourceType; url: string | null; readAt: string; mode: SourceFacts["mode"] }[];
  notes: string[];
  counts: Record<Verdict, number>;
}

// ---------- materials ----------

function describeComponent(name: string, percent: number | null): MaterialComponentOut {
  const key = canonicalMaterial(name);
  const info = key ? MATERIALS[key] : null;
  return {
    name,
    percent,
    key,
    label: info?.label ?? name,
    kind: info?.kind ?? "unknown",
    plain: info?.plain ?? "We don't have information on this material yet.",
    animal: info?.animal ?? false,
    plastic: info?.plastic ?? false,
    natural: info?.natural ?? false,
  };
}

function mainPart(facts: ProductFacts) {
  return (
    facts.materials.find((p) => /^(main|shell|body|outer|fabric|upper|self)$/i.test(p.part.trim())) ?? facts.materials[0] ?? null
  );
}

// ---------- claims ----------

interface ClaimedMaterial {
  key: string;
  percent: number | null;
  exclusive: boolean; // "100%", "pure", "solid", "all-"
}

function materialsInClaim(rawQuote: string): ClaimedMaterial[] {
  const out: ClaimedMaterial[] = [];
  // "Cashmere-feel", "silk touch", "leather look" describe a feel, not a material: ignore those words here.
  const quote = rawQuote.replace(/\b[a-z]+[\s-]*(feel|touch|like|look|tone|toned|inspired|effect|style)\b/gi, " ");
  // "recycled" stays in the captured name: "recycled polyester" is its own material key.
  const pctRe = /(\d{1,3})\s*%\s*(?:organic\s+|pure\s+)?([a-z][a-z\s-]{1,30})/gi;
  for (const m of quote.matchAll(pctRe)) {
    const key = canonicalMaterial(m[2]);
    if (key) out.push({ key, percent: Number(m[1]), exclusive: Number(m[1]) === 100 });
  }
  if (out.length) return out;
  // "all" only counts when a material follows it ("all-cotton"), not "for all seasons".
  const exclusive =
    /\b(pure|solid|genuine|real)\b|\b100\s*%/i.test(quote) || [...quote.matchAll(/\ball[\s-]+([a-z]+)/gi)].some((m) => canonicalMaterial(m[1]) != null);
  // Words that imply a material without a percentage
  const words = quote.split(/[^a-zA-Z0-9-]+/).filter(Boolean);
  const seen = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (const span of [words.slice(i, i + 3).join(" "), words.slice(i, i + 2).join(" "), words[i]]) {
      const key = canonicalMaterial(span);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ key, percent: null, exclusive });
        // Skip the words that made this match, so "faux suede" isn't read again as "suede".
        let used = 1;
        while (canonicalMaterial(words.slice(i, i + used).join(" ")) !== key) used++;
        i += used - 1;
        break;
      }
    }
  }
  // "14K gold necklace" without plating words counts as a solid-gold claim
  if (/\b(9|10|14|18|22|24)\s*k(arat|t)?\b/i.test(quote) && !/plat|fill|vermeil|electro|gp\b|tone/i.test(quote) && !seen.has("gold")) {
    out.push({ key: "gold", percent: null, exclusive: true });
  }
  return out;
}

function compositionKeys(facts: ProductFacts): Map<string, number | null> {
  const keys = new Map<string, number | null>();
  for (const part of facts.materials) {
    for (const c of part.components) {
      const k = canonicalMaterial(c.name);
      if (k && !keys.has(k)) keys.set(k, c.percent);
    }
  }
  for (const mark of facts.jewelryMarks) {
    const k = canonicalMaterial(mark);
    if (k && !keys.has(k)) keys.set(k, null);
  }
  return keys;
}

const LEATHER_KEYS = new Set(["leather", "suede"]);
const FAKE_LEATHER = new Set(["polyurethane", "pvc", "bonded_leather"]);
const NOT_SOLID_GOLD = new Set(["gold_plated", "gold_filled", "brass", "alloy", "stainless_steel", "sterling_silver"]);

function judgeMaterialClaim(quote: string, all: SourceFacts[], from: SourceFacts): Omit<ClaimResult, "quote" | "kind" | "from"> {
  const claimed = materialsInClaim(quote);
  // Prefer the label's composition when we have one; it's the legally required disclosure.
  const hasComposition = (s: SourceFacts) => s.facts.materials.length > 0 || s.facts.jewelryMarks.length > 0;
  const ref = all.find((s) => s.type === "label" && hasComposition(s)) ?? (hasComposition(from) ? from : null);
  if (!claimed.length) return { verdict: "unverifiable", reason: "No specific material named that we can check.", basis: null };
  if (!ref) return { verdict: "unverifiable", reason: "No fiber or material list found to compare against. Snap the care label to check it.", basis: null };

  const comp = compositionKeys(ref.facts);
  const refName = ref.type === "label" ? "the label" : "the listing's own material details";
  const main = mainPart(ref.facts);

  for (const c of claimed) {
    if (c.key === "gold") {
      const notSolid = [...comp.keys()].filter((k) => NOT_SOLID_GOLD.has(k));
      if (notSolid.length) {
        return { verdict: "contradicted", reason: `Claim implies solid gold, but ${refName} shows ${notSolid.map((k) => MATERIALS[k].label.toLowerCase()).join(", ")}.`, basis: "FTC Jewelry Guides (16 CFR Part 23)" };
      }
    }
    if (LEATHER_KEYS.has(c.key)) {
      const fake = [...comp.keys()].filter((k) => FAKE_LEATHER.has(k));
      if (fake.length && !comp.has("leather") && !comp.has("suede")) {
        return { verdict: "contradicted", reason: `Claim says leather, but ${refName} lists ${fake.map((k) => MATERIALS[k].label).join(", ")}.`, basis: "FTC Leather Guides (16 CFR Part 24)" };
      }
    }
    if (!comp.has(c.key)) {
      return { verdict: "contradicted", reason: `Claim mentions ${MATERIALS[c.key].label.toLowerCase()}, but ${refName} doesn't list it.`, basis: ref.type === "label" ? "Care label" : "Listing details" };
    }
    if (c.exclusive && main) {
      const others = main.components.filter((x) => canonicalMaterial(x.name) !== c.key && (x.percent ?? 1) > 0);
      if (others.length) {
        const listed = main.components.map((x) => (x.percent != null ? `${x.percent}% ` : "") + x.name).join(", ");
        return { verdict: "contradicted", reason: `Claim implies it's entirely ${MATERIALS[c.key].label.toLowerCase()}, but ${refName} lists ${listed}.`, basis: "FTC Textile Rules (16 CFR Part 303)" };
      }
    }
    if (c.percent != null) {
      const actual = comp.get(c.key);
      if (actual != null && Math.abs(actual - c.percent) > 3) {
        return { verdict: "contradicted", reason: `Claim says ${c.percent}% ${MATERIALS[c.key].label.toLowerCase()}, ${refName} says ${actual}%.`, basis: "FTC Textile Rules (16 CFR Part 303)" };
      }
    }
  }
  return { verdict: "supported", reason: `Matches ${refName}.`, basis: ref.type === "label" ? "Care label" : "Listing details" };
}

function judgeOriginClaim(quote: string, all: SourceFacts[]): Omit<ClaimResult, "quote" | "kind" | "from"> {
  const claimed = decodeOrigin(quote);
  if (claimed.wording === "designed_in") {
    return { verdict: "misleading", reason: "Names where it was designed, not where it was made.", basis: "US country-of-origin marking rules (19 CFR Part 134)" };
  }
  const label = all.find((s) => s.type === "label" && s.facts.originText);
  if (!label || !claimed.country) {
    return { verdict: "unverifiable", reason: "No label origin to compare against yet.", basis: null };
  }
  const labelOrigin = decodeOrigin(label.facts.originText);
  if (!labelOrigin.country) {
    // "Imported" means made outside the US, so it rules out a US claim but can't confirm any other country.
    if (labelOrigin.wording === "imported" && sameCountry(claimed.country, "USA")) {
      return { verdict: "contradicted", reason: `Claim says ${claimed.country}; the label says "${label.facts.originText}", which means made outside the US.`, basis: "Care label" };
    }
    return { verdict: "unverifiable", reason: "The label's origin doesn't name a country to compare against.", basis: null };
  }
  if (!sameCountry(labelOrigin.country, claimed.country)) {
    return { verdict: "contradicted", reason: `Claim says ${claimed.country}; the label says ${labelOrigin.country}.`, basis: "Care label" };
  }
  return { verdict: "supported", reason: "Matches the label.", basis: "Care label" };
}

function judgeClaim(claim: ProductFacts["claims"][number], all: SourceFacts[], from: SourceFacts): ClaimResult {
  const base = { quote: claim.quote, kind: claim.kind, from: from.type };
  const wording = findWording(claim.quote).find((h) => h.rule.verdict === "misleading");
  let judged: Omit<ClaimResult, "quote" | "kind" | "from">;
  if (claim.kind === "material") judged = judgeMaterialClaim(claim.quote, all, from);
  else if (claim.kind === "origin") judged = judgeOriginClaim(claim.quote, all);
  else if (claim.kind === "certification")
    judged = { verdict: "unverifiable", reason: "Certificate lookups aren't available yet. Ask the brand for the certificate number.", basis: null };
  else judged = { verdict: "unverifiable", reason: "This kind of claim needs testing or documents we don't have.", basis: null };

  // A contradiction outranks wording; otherwise misleading wording outranks "supported"/"can't verify".
  if (judged.verdict !== "contradicted" && wording) {
    judged = { verdict: "misleading", reason: wording.rule.meaning, basis: wording.rule.source };
  }
  return { ...base, ...judged };
}

// ---------- origin ----------

const GRADE_TEXT: Record<OriginGrade, [string, string]> = {
  full: ["Fully disclosed", "Every production stage is named."],
  partial: ["Partly disclosed", "Assembly and where the main material came from are known."],
  final_only: ["Final step only", "Only the last manufacturing step is disclosed. Where the materials came from is unknown."],
  contradicted: ["Contradicted", "Sources disagree about where this was made."],
  none: ["Not disclosed", "No country of origin is given."],
};

function buildOrigin(sources: SourceFacts[], contradictions: Contradiction[]): OriginOut {
  const label = sources.find((s) => s.type === "label" && s.facts.originText);
  const primary = label ?? sources.find((s) => s.facts.originText) ?? null;
  const decoded = decodeOrigin(primary?.facts.originText ?? null);
  const ladder = STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage], country: null as string | null, basis: null as string | null }));
  let design: string | null = null;

  for (const s of sources) {
    const d = decodeOrigin(s.facts.originText);
    for (const [stage, country] of Object.entries(d.stages) as [Stage, string][]) {
      const row = ladder.find((r) => r.stage === stage)!;
      if (!row.country) { row.country = country; row.basis = `"${s.facts.originText}" (${s.type})`; }
    }
    for (const st of s.facts.originStages) {
      if (st.stage === "design") { design = design ?? st.country; continue; }
      const row = ladder.find((r) => r.stage === st.stage)!;
      if (!row.country) { row.country = st.country; row.basis = `"${st.quote}" (${s.type})`; }
    }
  }

  // Label vs listing origin conflict
  const countries = sources
    .map((s) => ({ s, d: decodeOrigin(s.facts.originText) }))
    .filter((x) => x.d.country);
  let grade: OriginGrade;
  const conflict = countries.find((a) => countries.some((b) => b !== a && !sameCountry(a.d.country!, b.d.country!)));
  if (conflict) {
    const other = countries.find((b) => !sameCountry(conflict.d.country!, b.d.country!))!;
    contradictions.push({
      title: "Origin doesn't match",
      detail: `The ${conflict.s.type} says "${conflict.s.facts.originText}", the ${other.s.type} says "${other.s.facts.originText}".`,
    });
    grade = "contradicted";
  } else {
    const known = new Set(ladder.filter((r) => r.country).map((r) => r.stage));
    if (STAGES.every((s) => known.has(s))) grade = "full";
    else if (known.has("assembly") && (known.has("fabric") || known.has("raw_material"))) grade = "partial";
    else if (known.has("assembly")) grade = "final_only";
    else grade = "none";
  }
  return {
    text: primary?.facts.originText ?? null,
    wording: decoded.wording,
    explanation: decoded.explanation,
    grade,
    gradeLabel: GRADE_TEXT[grade][0],
    gradeExplanation: GRADE_TEXT[grade][1],
    ladder,
    design,
  };
}

// ---------- cross-source materials ----------

function compareCompositions(sources: SourceFacts[], contradictions: Contradiction[]) {
  const label = sources.find((s) => s.type === "label" && s.facts.materials.length);
  const listing = sources.find((s) => s.type === "listing" && s.facts.materials.length);
  if (!label || !listing) return;
  const a = mainPart(label.facts)!;
  const b = mainPart(listing.facts)!;
  const toMap = (p: typeof a) => new Map(p.components.map((c) => [canonicalMaterial(c.name) ?? c.name.toLowerCase(), c.percent]));
  const ma = toMap(a);
  const mb = toMap(b);
  const diffs: string[] = [];
  for (const [k, pa] of ma) {
    const pb = mb.get(k);
    if (!mb.has(k)) diffs.push(`the label lists ${pa != null ? pa + "% " : ""}${MATERIALS[k]?.label.toLowerCase() ?? k} but the listing doesn't`);
    else if (pa != null && pb != null && Math.abs(pa - pb) > 3) diffs.push(`${MATERIALS[k]?.label.toLowerCase() ?? k}: label ${pa}%, listing ${pb}%`);
  }
  for (const [k, pb] of mb) {
    if (!ma.has(k)) diffs.push(`the listing lists ${pb != null ? pb + "% " : ""}${MATERIALS[k]?.label.toLowerCase() ?? k} but the label doesn't`);
  }
  if (diffs.length) contradictions.push({ title: "Materials don't match", detail: `Label and listing disagree: ${diffs.join("; ")}.` });
}

// ---------- main ----------

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// The shares cover the main fabric only, so say so whenever there are other parts,
// and point out plastic in those parts: "100% natural" next to a polyester lining misleads.
function summaryText(main: MaterialPartOut, all: MaterialPartOut[], plastic: number, natural: number): string {
  const shares = `${plastic}% plastic-based fibers, ${natural}% natural.`;
  if (all.length === 1) return cap(shares);
  let text = `${cap(main.part)}: ${shares}`;
  const others = all.filter((p) => p !== main && p.components.some((c) => c.plastic));
  if (others.length) {
    const fibers = [...new Set(others.flatMap((p) => p.components.filter((c) => c.plastic).map((c) => c.label.toLowerCase())))];
    const names = others.map((p) => p.part.toLowerCase());
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    text += ` ${cap(list)} ${names.length > 1 ? "contain" : "contains"} plastic fibers (${fibers.join(", ")}).`;
  }
  return text;
}

// `gtin` is the normalized barcode the sources are saved under, when the caller knows it. The app sends
// report.product.gtin back when adding a label, so it must be that key, not whatever a source printed.
export function buildReport(sources: SourceFacts[], gtin: string | null = null): Report {
  if (!sources.length) throw new Error("No sources to build a report from.");
  // Labels are the legally required disclosure, so they lead.
  const ordered = [...sources].sort((a, b) => (a.type === b.type ? 0 : a.type === "label" ? -1 : 1));
  const first = ordered[0].facts;
  const pick = <K extends keyof ProductFacts>(k: K) => ordered.map((s) => s.facts[k]).find((v) => v != null && v !== "") ?? null;

  const contradictions: Contradiction[] = [];
  const materials: MaterialPartOut[] = [];
  const materialSource = ordered.find((s) => s.facts.materials.length);
  if (materialSource) {
    for (const p of materialSource.facts.materials) {
      materials.push({ part: p.part, from: materialSource.type, components: p.components.map((c) => describeComponent(c.name, c.percent)) });
    }
  }

  let materialSummary: Report["materialSummary"] = null;
  const main = materials.find((p) => /^(main|shell|body|outer|fabric|upper|self)$/i.test(p.part)) ?? materials[0];
  if (main) {
    const withPct = main.components.filter((c) => c.percent != null);
    const total = withPct.reduce((a, c) => a + (c.percent ?? 0), 0);
    const plasticShare = withPct.length === main.components.length && total > 0 ? Math.round((withPct.filter((c) => c.plastic).reduce((a, c) => a + c.percent!, 0) / total) * 100) : null;
    const naturalShare = withPct.length === main.components.length && total > 0 ? Math.round((withPct.filter((c) => c.natural).reduce((a, c) => a + c.percent!, 0) / total) * 100) : null;
    materialSummary = {
      plasticShare,
      naturalShare,
      hasAnimal: materials.some((p) => p.components.some((c) => c.animal)),
      hasPlasticLeather: materials.some((p) => p.components.some((c) => c.key === "polyurethane" || c.key === "pvc")),
      text: plasticShare != null ? summaryText(main, materials, plasticShare, naturalShare ?? 0) : null,
    };
  }

  const claims: ClaimResult[] = [];
  const wording: WordingFlag[] = [];
  const seenWording = new Set<string>();
  for (const s of ordered) {
    for (const c of s.facts.claims) claims.push(judgeClaim(c, ordered, s));
    const texts = [s.facts.productName ?? "", s.facts.originText ?? "", ...s.facts.claims.map((c) => c.quote), ...s.facts.materials.flatMap((p) => p.components.map((c) => c.name)), ...s.facts.jewelryMarks];
    for (const t of texts) {
      for (const h of findWording(t)) {
        if (seenWording.has(h.rule.id)) continue;
        seenWording.add(h.rule.id);
        wording.push({ title: h.rule.title, quote: h.quote, meaning: h.rule.meaning, verdict: h.rule.verdict, basis: h.rule.source, from: s.type });
      }
    }
  }

  compareCompositions(ordered, contradictions);
  const origin = buildOrigin(ordered, contradictions);
  // Contradicted claims join the "doesn't add up" list, except origin claims already covered by the origin mismatch.
  const originConflict = contradictions.some((c) => c.title === "Origin doesn't match");
  for (const c of claims) {
    if (c.verdict !== "contradicted" || (c.kind === "origin" && originConflict)) continue;
    contradictions.push({ title: `"${c.quote}"`, detail: c.reason });
  }
  // Wording already explained on a claim isn't repeated in the wording section.
  const explained = new Set(claims.filter((c) => c.verdict === "misleading").map((c) => c.reason));
  for (let i = wording.length - 1; i >= 0; i--) if (explained.has(wording[i].meaning)) wording.splice(i, 1);

  const notes: string[] = [];
  const sampleMode = sources.some((s) => s.mode === "sample");
  if (sources.some((s) => s.mode === "demo")) notes.push("Demo product: made-up example data for testing the app.");
  if (sampleMode) notes.push("Sample mode: these results come from simple text matching, not AI reading. Add an Anthropic API key for real results.");
  for (const s of ordered) for (const u of s.facts.unreadable) notes.push(`Couldn't read on the ${s.type}: ${u}`);
  if (main && main.components.some((c) => c.percent == null)) notes.push("Some material percentages aren't stated.");
  if (!materials.length) notes.push(sources.some((s) => s.type === "label") ? "No material list found on the label." : "No material list in the listing. Snap the care label to see the real composition.");

  const counts: Record<Verdict, number> = { supported: 0, contradicted: 0, misleading: 0, unverifiable: 0 };
  for (const c of claims) counts[c.verdict]++;

  return {
    product: { brand: pick("brand") as string | null, name: pick("productName") as string | null, category: first.category, gtin: gtin ?? (pick("gtin") as string | null) },
    sampleMode,
    materials,
    materialSummary,
    jewelryMarks: [...new Set(ordered.flatMap((s) => s.facts.jewelryMarks))],
    claims,
    wording,
    origin,
    contradictions,
    certifications: ordered.flatMap((s) => s.facts.certifications).map((c) => ({ ...c, status: "Not checked yet. Certificate lookups come in a later version." })),
    care: [...new Set(ordered.flatMap((s) => s.facts.care))],
    sources: ordered.map((s) => ({ type: s.type, url: s.url, readAt: s.readAt, mode: s.mode })),
    notes,
    counts,
  };
}
