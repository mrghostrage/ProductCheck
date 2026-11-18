// Sales wording that sounds like one thing and means another (US rules first).
// Each entry explains what the words legally or practically mean and cites where that comes from.

export type WordingVerdict = "misleading" | "info";

export interface WordingRule {
  id: string;
  pattern: RegExp;
  title: string;
  meaning: string;
  verdict: WordingVerdict;
  source: string;
}

export const WORDING_RULES: WordingRule[] = [
  // Jewelry
  {
    id: "gold-tone",
    pattern: /\bgold[\s-]*(tone|toned|color|colou?red|finish|look)\b/i,
    title: '"Gold tone"',
    meaning: "Gold-colored. Contains no gold at all.",
    verdict: "misleading",
    source: "FTC Guides for the Jewelry, Precious Metals, and Pewter Industries (16 CFR Part 23)",
  },
  {
    id: "gold-plated",
    pattern: /\bgold[\s-]*(plated|plating|plate|electroplated?|dipped|flashed|washed)\b|\b(18|14|10)\s*k\s*(gold\s*)?(plated|gp)\b/i,
    title: '"Gold plated"',
    meaning: "A thin layer of gold over a cheaper metal, usually brass. The karat number describes only the thin layer, and it wears off.",
    verdict: "misleading",
    source: "FTC Jewelry Guides (16 CFR 23.4)",
  },
  {
    id: "vermeil",
    pattern: /\bvermeil\b/i,
    title: '"Vermeil"',
    meaning: "Sterling silver with a gold layer at least 2.5 microns thick of 10K gold or better. Better than plating, but not solid gold.",
    verdict: "info",
    source: "FTC Jewelry Guides (16 CFR 23.5)",
  },
  {
    id: "gold-filled",
    pattern: /\bgold[\s-]*filled\b/i,
    title: '"Gold filled"',
    meaning: "A thick layer of gold bonded to a base metal, at least 1/20 of the item's weight. Lasts much longer than plating, but not solid gold.",
    verdict: "info",
    source: "FTC Jewelry Guides (16 CFR 23.4)",
  },
  {
    id: "hypoallergenic",
    pattern: /\bhypo[\s-]?allergenic\b|\bnickel[\s-]*safe\b/i,
    title: '"Hypoallergenic"',
    meaning: "No legal definition in the US. It doesn't guarantee the piece is nickel-free.",
    verdict: "misleading",
    source: "No US standard for this term",
  },
  {
    id: "simulated-diamond",
    pattern: /\b(simulated|diamond[\s-]*like|faux|diamond[\s-]*look)\s*diamonds?\b|\bcubic\s+zirconia\b|\bcz\b/i,
    title: '"Simulated diamond"',
    meaning: "Not a diamond. Usually cubic zirconia or glass.",
    verdict: "info",
    source: "FTC Jewelry Guides (16 CFR 23.23)",
  },
  // Leather
  {
    id: "genuine-leather",
    pattern: /\bgenuine\s+leather\b|\breal\s+leather\b/i,
    title: '"Genuine leather"',
    meaning: "Real leather, but not a grade. It's often used for lower-quality split leather. Full-grain and top-grain are the higher grades.",
    verdict: "misleading",
    source: "FTC Guides for Select Leather and Imitation Leather Products (16 CFR Part 24)",
  },
  {
    id: "vegan-leather",
    pattern: /\b(vegan|faux|pu|eco|synthetic|plant[\s-]*based)\s+leather\b|\bleatherette\b|\bleather[\s-]*look\b/i,
    title: '"Vegan leather"',
    meaning: "Usually plastic (polyurethane or PVC). \"Plant-based\" versions are often mixed with plastic too.",
    verdict: "misleading",
    source: "FTC Leather Guides (16 CFR 24.2) require disclosing that imitation leather is not leather",
  },
  {
    id: "bonded-leather",
    pattern: /\bbonded\s+leather\b|\breconstituted\s+leather\b/i,
    title: '"Bonded leather"',
    meaning: "Leather scraps ground up and glued to a backing. The leather share must be disclosed and is often low.",
    verdict: "misleading",
    source: "FTC Leather Guides (16 CFR 24.2)",
  },
  // Textiles
  {
    id: "feel-touch",
    pattern: /\b(cashmere|silk|wool|linen|cotton|suede)[\s-]*(feel|touch|like|blend\s+feel|soft|look)\b/i,
    title: '"Cashmere feel" and similar',
    meaning: "Describes how it feels, not what it is. Usually polyester or acrylic. Check the fiber list.",
    verdict: "misleading",
    source: "FTC Textile Rules (16 CFR 303.6) require generic fiber names for fiber content",
  },
  {
    id: "satin",
    pattern: /\bsatin\b/i,
    title: '"Satin"',
    meaning: "A type of weave, not a fiber. Most satin is polyester, not silk.",
    verdict: "info",
    source: "FTC Textile Rules: fiber content must be stated separately",
  },
  {
    id: "bamboo",
    pattern: /\bbamboo\b/i,
    title: '"Bamboo"',
    meaning: "Almost always rayon made from bamboo pulp through chemical processing. US rules require calling it \"rayon made from bamboo.\"",
    verdict: "misleading",
    source: "FTC enforcement on bamboo textile claims (16 CFR 303.7)",
  },
  {
    id: "vague-premium",
    pattern: /\b(premium|luxury|luxurious|high[\s-]*quality|superior)\s+(quality\s+)?(fabric|material|cotton|leather|feel)\b/i,
    title: '"Premium fabric"',
    meaning: "Marketing language with no standard behind it.",
    verdict: "info",
    source: "No US standard for this term",
  },
  // Origin
  {
    id: "designed-in",
    pattern: /\b(designed|engineered|styled|conceived)\s+in\s+(the\s+)?[a-z]{2,}/i,
    title: '"Designed in…"',
    meaning: "Says where it was designed, not where it was made. Look for the separate \"Made in\" country.",
    verdict: "misleading",
    source: "US country-of-origin marking rules (19 CFR Part 134)",
  },
  {
    id: "italian-style",
    pattern: /\b(italian|french|european|swiss|japanese)\s+(design|style|inspired|craftsmanship|heritage)\b/i,
    title: '"Italian design" and similar',
    meaning: "A style claim, not a country of origin.",
    verdict: "misleading",
    source: "US country-of-origin marking rules (19 CFR Part 134)",
  },
];

export interface WordingHit {
  rule: WordingRule;
  quote: string;
}

export function findWording(text: string): WordingHit[] {
  const hits: WordingHit[] = [];
  for (const rule of WORDING_RULES) {
    const m = text.match(rule.pattern);
    if (m) hits.push({ rule, quote: m[0] });
  }
  return hits;
}
