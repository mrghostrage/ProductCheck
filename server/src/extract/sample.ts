// Sample mode: used when no Anthropic API key is set, so the whole app can be tried end to end.
// Listings are read with simple text matching. Label photos can't be read without AI,
// so they return a fixed example label, clearly marked as sample data in the report.
import type { ProductFacts } from "../schema.ts";
import { canonicalMaterial } from "../knowledge/materials.ts";

export function sampleLabelFacts(): ProductFacts {
  return {
    isProductInfo: true,
    category: "clothing",
    brand: "Example Brand",
    productName: "Example T-shirt (sample label)",
    gtin: null,
    materials: [{ part: "main", components: [{ name: "Cotton", percent: 60 }, { name: "Polyester", percent: 40 }] }],
    jewelryMarks: [],
    originText: "Made in Bangladesh",
    originStages: [],
    claims: [],
    certifications: [],
    care: ["Machine wash cold", "Tumble dry low"],
    unreadable: [],
  };
}

const CLAIM_WORDS =
  /\b100\s*%|\b(pure|genuine|real|solid|organic|sustainable|eco|conscious|premium|luxury|hypoallergenic|vegan|recycled|made in|designed in|crafted|handmade|cashmere|silk|leather|gold|sterling|bamboo|satin|certified)\b/i;

export function sampleListingFacts(input: { text: string; name: string | null; brand: string | null; gtin: string | null; material: string | null; origin: string | null }): ProductFacts {
  const text = input.text;
  const components: { name: string; percent: number | null }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(\d{1,3})\s*%\s*([A-Za-z][A-Za-z -]{1,25})/g)) {
    const word = m[2].trim().split(/\s+/).slice(0, 2).join(" ");
    const key = canonicalMaterial(word);
    if (key && !seen.has(key) && Number(m[1]) <= 100) {
      seen.add(key);
      components.push({ name: word, percent: Number(m[1]) });
    }
  }
  if (!components.length && input.material) {
    for (const part of input.material.split(/[,/&]| and /)) {
      if (canonicalMaterial(part)) components.push({ name: part.trim(), percent: null });
    }
  }

  // Take the origin phrase up to the end of its line or sentence; decodeOrigin parses it later.
  const originMatch =
    input.origin ??
    text.match(/(?:\b100\s*%\s*)?\b(?:made|assembled|manufactured|crafted|designed)\s+in\s+[^\n.;,|]{2,50}|\bimported\b/i)?.[0]?.trim() ??
    null;

  const claims: ProductFacts["claims"] = [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 3 && s.length < 160);
  for (const s of sentences) {
    if (claims.length >= 8) break;
    if (!CLAIM_WORDS.test(s) || /shipping|return|delivery|cookie|privacy/i.test(s)) continue;
    const kind: ProductFacts["claims"][number]["kind"] = /made in|designed in|crafted in/i.test(s)
      ? "origin"
      : /certified/i.test(s)
        ? "certification"
        : /sustainab|eco|conscious|recycled|organic/i.test(s)
          ? "eco"
          : /premium|luxury|quality/i.test(s)
            ? "quality"
            : "material";
    if (!claims.some((c) => c.quote === s)) claims.push({ quote: s, kind });
  }

  const marks = [...new Set([...text.matchAll(/\b(925|10K|14K|18K|24K|GP|HGE|GF)\b/g)].map((m) => m[1]))];
  const lower = text.toLowerCase();
  const category: ProductFacts["category"] = /necklace|ring|bracelet|earring|pendant|jewel/.test(lower)
    ? "jewelry"
    : /shoe|sneaker|boot|sandal/.test(lower)
      ? "footwear"
      : /\bbag\b|handbag|wallet|backpack|tote/.test(lower)
        ? "bag"
        : "clothing";

  return {
    isProductInfo: true,
    category,
    brand: input.brand,
    productName: input.name,
    gtin: input.gtin,
    materials: components.length ? [{ part: "main", components }] : [],
    jewelryMarks: category === "jewelry" ? marks : [],
    originText: originMatch,
    originStages: [],
    claims,
    certifications: [],
    care: [],
    unreadable: [],
  };
}
