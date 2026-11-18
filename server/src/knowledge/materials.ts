// Plain-language facts about materials. US generic names are used as the canonical key
// (e.g. "spandex", not "elastane"), matching the FTC Textile Rules.

export type MaterialKind = "natural plant" | "natural animal" | "synthetic" | "semi-synthetic" | "leather" | "metal" | "other";

export interface MaterialInfo {
  key: string;
  label: string;
  kind: MaterialKind;
  plain: string; // one-line explanation for most people
  animal: boolean;
  plastic: boolean; // made from fossil-fuel plastics (sheds microplastics, not biodegradable)
  natural: boolean;
}

const M = (key: string, label: string, kind: MaterialKind, plain: string, flags: Partial<Pick<MaterialInfo, "animal" | "plastic" | "natural">> = {}): MaterialInfo => ({
  key, label, kind, plain,
  animal: flags.animal ?? false,
  plastic: flags.plastic ?? false,
  natural: flags.natural ?? false,
});

export const MATERIALS: Record<string, MaterialInfo> = {
  cotton: M("cotton", "Cotton", "natural plant", "Plant fiber. Breathable and soft, absorbs moisture, wrinkles and can shrink.", { natural: true }),
  linen: M("linen", "Linen", "natural plant", "Flax fiber. Very breathable and strong, wrinkles easily.", { natural: true }),
  hemp: M("hemp", "Hemp", "natural plant", "Plant fiber. Strong and breathable, softens with washing.", { natural: true }),
  wool: M("wool", "Wool", "natural animal", "Sheep's hair. Warm even when damp, resists odor, can itch.", { natural: true, animal: true }),
  merino: M("merino", "Merino wool", "natural animal", "Fine sheep's wool. Softer and less itchy than regular wool.", { natural: true, animal: true }),
  cashmere: M("cashmere", "Cashmere", "natural animal", "Goat underhair. Very soft and warm, pills with wear. Real cashmere is expensive to produce.", { natural: true, animal: true }),
  alpaca: M("alpaca", "Alpaca", "natural animal", "Alpaca hair. Warm, soft, less itchy than wool.", { natural: true, animal: true }),
  mohair: M("mohair", "Mohair", "natural animal", "Angora goat hair. Fluffy and lustrous.", { natural: true, animal: true }),
  silk: M("silk", "Silk", "natural animal", "Silkworm fiber. Smooth and light, delicate to wash.", { natural: true, animal: true }),
  down: M("down", "Down", "natural animal", "Duck or goose underfeathers. Very warm for its weight.", { natural: true, animal: true }),
  polyester: M("polyester", "Polyester", "synthetic", "Plastic fiber. Durable, quick-drying and cheap, less breathable, sheds microplastics in the wash.", { plastic: true }),
  recycled_polyester: M("recycled_polyester", "Recycled polyester", "synthetic", "Polyester made from recycled plastic, often bottles. Still plastic and still sheds microplastics.", { plastic: true }),
  nylon: M("nylon", "Nylon", "synthetic", "Plastic fiber. Strong and stretchy, common in activewear, sheds microplastics.", { plastic: true }),
  spandex: M("spandex", "Spandex (elastane)", "synthetic", "Stretch fiber, usually a small share of a blend. Makes clothes stretch, breaks down with heat.", { plastic: true }),
  acrylic: M("acrylic", "Acrylic", "synthetic", "Plastic fiber often used as cheap wool imitation. Warm but pills quickly and sheds microplastics.", { plastic: true }),
  polypropylene: M("polypropylene", "Polypropylene", "synthetic", "Light plastic fiber that wicks moisture.", { plastic: true }),
  rayon: M("rayon", "Rayon (viscose)", "semi-synthetic", "Made from wood pulp with chemical processing. Soft and drapey, weak when wet. \"Bamboo\" fabric is usually rayon.", {}),
  lyocell: M("lyocell", "Lyocell (Tencel)", "semi-synthetic", "Wood-pulp fiber made in a closed-loop process. Soft, breathable, stronger than rayon.", {}),
  modal: M("modal", "Modal", "semi-synthetic", "A type of rayon from beech wood. Very soft, resists shrinking.", {}),
  acetate: M("acetate", "Acetate", "semi-synthetic", "Wood-pulp fiber with a silky look, often used for linings.", {}),
  leather: M("leather", "Leather", "leather", "Animal hide. Grade matters: full-grain is best; \"genuine leather\" is real but often lower-grade split leather.", { animal: true, natural: true }),
  suede: M("suede", "Suede", "leather", "The underside of hide, brushed soft. Real leather, less water-resistant.", { animal: true, natural: true }),
  bonded_leather: M("bonded_leather", "Bonded leather", "other", "Leather scraps ground up and glued to a backing. Often mostly glue and filler, peels over time.", { animal: true }),
  polyurethane: M("polyurethane", "Polyurethane (PU)", "synthetic", "Plastic coating. This is what \"vegan leather\" and \"PU leather\" usually are. Can crack and peel.", { plastic: true }),
  pvc: M("pvc", "PVC", "synthetic", "Plastic, used for faux leather and shiny coatings. Stiffer than PU.", { plastic: true }),
  rubber: M("rubber", "Rubber", "other", "Natural or synthetic rubber, common in soles."),
  eva: M("eva", "EVA foam", "synthetic", "Light plastic foam used in soles.", { plastic: true }),
  gold: M("gold", "Gold", "metal", "Solid gold. Karat sets purity: 24K is pure, 14K is 58.3% gold, 10K is 41.7%.", { natural: true }),
  gold_plated: M("gold_plated", "Gold plated", "metal", "A thin gold layer over another metal. Wears off over time.", {}),
  gold_filled: M("gold_filled", "Gold filled", "metal", "A thick gold layer bonded to a base metal, far more than plating. Lasts years.", {}),
  sterling_silver: M("sterling_silver", "Sterling silver", "metal", "92.5% silver (stamped 925). Tarnishes but can be polished.", { natural: true }),
  stainless_steel: M("stainless_steel", "Stainless steel", "metal", "Durable, doesn't tarnish. Some grades contain nickel.", {}),
  titanium: M("titanium", "Titanium", "metal", "Light and strong. Generally a good choice for metal allergies.", {}),
  brass: M("brass", "Brass", "metal", "Copper and zinc alloy, common base metal under plating. Can turn skin green.", {}),
  alloy: M("alloy", "Unspecified alloy", "metal", "A metal mix with no details. Often zinc or brass; may contain nickel.", {}),
  nickel: M("nickel", "Nickel", "metal", "A common cause of skin allergies.", {}),
};

// Maps written names (English plus common EU/brand names) to canonical keys.
const ALIASES: [RegExp, string][] = [
  [/recycled\s+polyester|rpet/i, "recycled_polyester"],
  // Imitations named after the fiber they copy: "down alternative" fill, "faux silk"
  [/polyester|\bpes\b|down[\s-]*(alternative|free)|faux[\s-]+(down|silk)/i, "polyester"],
  [/polyamide|nylon|\bpa\b/i, "nylon"],
  [/elastane|spandex|lycra|\bea\b/i, "spandex"],
  [/acrylic|polyacryl/i, "acrylic"],
  [/polypropylene/i, "polypropylene"],
  [/lyocell|tencel/i, "lyocell"],
  [/modal/i, "modal"],
  [/viscose|rayon|bamboo|art(ificial)?[\s-]+silk/i, "rayon"], // "art silk" is rayon
  [/acetate/i, "acetate"],
  [/cashmere/i, "cashmere"],
  [/merino/i, "merino"],
  [/alpaca/i, "alpaca"],
  [/mohair/i, "mohair"],
  [/\bwool\b|lambswool/i, "wool"],
  [/\bsilk\b/i, "silk"], // not "silky"
  [/(?<!button[\s-]?)\bdown\b|feather/i, "down"], // not "button-down"
  [/cotton/i, "cotton"],
  [/linen|flax/i, "linen"],
  [/hemp/i, "hemp"],
  [/bonded\s+leather/i, "bonded_leather"],
  [/polyurethane|\bpu\b|vegan\s+leather|faux\s+leather|pu\s+leather|leatherette|pleather/i, "polyurethane"],
  [/\bpvc\b|vinyl/i, "pvc"],
  [/(faux|vegan|micro)[\s-]*suede|ultrasuede|alcantara/i, "polyester"], // imitation suede is a polyester microfiber, not hide
  [/suede/i, "suede"],
  [/leather/i, "leather"],
  [/\beva\b/i, "eva"],
  [/rubber/i, "rubber"],
  [/gold[\s-]*filled|\bgf\b/i, "gold_filled"],
  [/gold[\s-]*plat(ed|ing)|\bgp\b|electroplate|\bhge\b|vermeil/i, "gold_plated"],
  [/\b(9|10|14|18|22|24)\s*k(arat|t)?\b.*gold|solid\s+gold|^gold$/i, "gold"],
  [/sterling|\b925\b/i, "sterling_silver"],
  [/stainless/i, "stainless_steel"],
  [/titanium/i, "titanium"],
  [/brass/i, "brass"],
  [/nickel/i, "nickel"],
  [/alloy|zinc|base\s+metal/i, "alloy"],
];

export function canonicalMaterial(name: string): string | null {
  for (const [re, key] of ALIASES) if (re.test(name)) return key;
  return null;
}

export function materialInfo(name: string): MaterialInfo | null {
  const key = canonicalMaterial(name);
  return key ? MATERIALS[key] : null;
}
