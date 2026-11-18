// Decodes country-of-origin wording into which production stages it actually covers.

export type Stage = "raw_material" | "fabric" | "components" | "assembly" | "finishing";
export const STAGES: Stage[] = ["raw_material", "fabric", "components", "assembly", "finishing"];
export const STAGE_LABELS: Record<Stage | "design", string> = {
  raw_material: "Raw material",
  fabric: "Fabric or main material",
  components: "Components (zippers, buttons, soles)",
  assembly: "Cutting, sewing or assembly",
  finishing: "Finishing",
  design: "Design",
};

export type OriginWording =
  | "all_stages" // "100% Made in Italy"
  | "made_in_of_imported" // "Made in USA of imported fabric"
  | "made_in" // "Made in Vietnam"
  | "assembled_in" // "Assembled in Mexico"
  | "designed_in" // "Designed in California" with no "Made in"
  | "imported" // "Imported" with no country
  | "none";

export interface OriginDecoded {
  wording: OriginWording;
  country: string | null;
  explanation: string;
  stages: Partial<Record<Stage, string>>; // stage -> country, only what the wording covers
}

const SHORT_UPPER = new Set(["USA", "UK", "UAE", "US", "PRC"]);
function tidyCountry(raw: string): string {
  const c = raw.replace(/[.,;:]+$/, "").trim();
  return c
    .split(/\s+/)
    .map((w) => (SHORT_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w.toLowerCase() === "of" ? "of" : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

// Finds a keyword phrase case-insensitively, then reads the country name that follows it.
// Country words must be capitalized (or the whole label uppercase), so "Made in China Free shipping"
// doesn't swallow the next sentence. A single lowercase word is accepted as a fallback.
function after(text: string, keyword: RegExp): { country: string; rest: string } | null {
  const m = keyword.exec(text);
  if (!m) return null;
  const tail = text.slice(m.index + m[0].length).replace(/^[\s:]+/, "").replace(/^the\s+/i, "");
  const c =
    tail.match(/^([A-Z][A-Za-z.]*(?:[ \t]+(?:of[ \t]+)?[A-Z][A-Za-z.]*){0,3})/) ??
    tail.match(/^([a-z]{2,})/i);
  if (!c) return null;
  // Drop trailing words that are clearly not part of a country name
  const words = c[1].split(/[ \t]+/);
  while (words.length > 1 && /^(and|with|from|of|for|by|free|shipping|imported|fabric|materials?|components?)$/i.test(words.at(-1)!)) words.pop();
  const country = tidyCountry(words.join(" "));
  return { country, rest: tail.slice(words.join(" ").length) };
}

export function decodeOrigin(text: string | null): OriginDecoded {
  if (!text || !text.trim()) {
    return { wording: "none", country: null, explanation: "No country of origin found.", stages: {} };
  }
  const t = text.trim();
  let hit;

  if ((hit = after(t, /100\s*%\s*made\s+in\b/i))) {
    const c = hit.country;
    return {
      wording: "all_stages",
      country: c,
      explanation: `"100% Made in ${c}" claims every stage happened in ${c}. Italy's law for "100% Made in Italy" requires design, materials and manufacturing all in Italy.`,
      stages: Object.fromEntries(STAGES.map((s) => [s, c])),
    };
  }
  if ((hit = after(t, /\b(?:made|manufactured|produced|crafted|handmade)\s+in\b/i))) {
    const imported = hit.rest.match(/^\s*(?:of|from|with)\s+imported\s+(\w+)/i);
    if (imported) {
      return {
        wording: "made_in_of_imported",
        country: hit.country,
        explanation: `Made in ${hit.country} from imported ${imported[1].toLowerCase()}. This wording is honest about the split: assembly in ${hit.country}, materials from another, unnamed country.`,
        stages: { assembly: hit.country, fabric: "Imported (country not named)" },
      };
    }
    return madeIn(hit.country);
  }
  if ((hit = after(t, /\b(?:assembled|finished|sewn|packed)\s+in\b/i))) {
    return {
      wording: "assembled_in",
      country: hit.country,
      explanation: `Only the final assembly happened in ${hit.country}. The parts were made somewhere else.`,
      stages: { assembly: hit.country },
    };
  }
  if ((hit = after(t, /\b(?:product\s+of|country\s+of\s+origin|origin)\b/i))) {
    return madeIn(hit.country);
  }
  if ((hit = after(t, /\b(?:designed|engineered|styled)\s+in\b/i))) {
    return { wording: "designed_in", country: null, explanation: `Says where it was designed (${hit.country}), not where it was made.`, stages: {} };
  }
  if (/\bimported\b/i.test(t)) {
    return {
      wording: "imported",
      country: null,
      explanation: '"Imported" means made outside the US, without naming the country. US rules allow this wording online and in catalogs; the physical label must name the country.',
      stages: {},
    };
  }
  // Structured data sometimes gives just a country name ("Vietnam")
  if (/^[A-Za-z][A-Za-z .]{1,40}$/.test(t)) return madeIn(tidyCountry(t));
  return { wording: "none", country: null, explanation: `Couldn't interpret the origin wording "${t}".`, stages: {} };
}

function madeIn(c: string): OriginDecoded {
  return {
    wording: "made_in",
    country: c,
    explanation: `"Made in ${c}" names the country where the product was last substantially changed, usually where it was cut and sewn or assembled. It says nothing about where the fabric or materials came from.`,
    stages: { assembly: c },
  };
}

export function sameCountry(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z]/g, "")
      .replace(/^(usa|us|unitedstates|unitedstatesofamerica|america)$/, "usa")
      .replace(/^(uk|unitedkingdom|greatbritain|england)$/, "uk")
      .replace(/^(prc|peoplesrepublicofchina|chinaprc|mainlandchina)$/, "china");
  return norm(a) === norm(b);
}
