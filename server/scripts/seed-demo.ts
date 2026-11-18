// Adds made-up demo products so the app can be tried without real scans.
// Barcodes start with 200, a range reserved for in-store use, so they never collide with real products.
// Run: npm run seed:demo
import { addSource, latestSources } from "../src/db.ts";
import { withCheckDigit } from "../src/gtin.ts";
import { buildReport } from "../src/checks/report.ts";
import type { ProductFacts, SourceFacts } from "../src/schema.ts";

const base = (over: Partial<ProductFacts>): ProductFacts => ({
  isProductInfo: true, category: "clothing", brand: "Demo Brand", productName: null, gtin: null, materials: [], jewelryMarks: [],
  originText: null, originStages: [], claims: [], certifications: [], care: [], unreadable: [], ...over,
});

const demos: { name: string; label: Partial<ProductFacts>; listing: Partial<ProductFacts> }[] = [
  {
    name: "Demo: Cloud Knit Sweater",
    label: { materials: [{ part: "main", components: [{ name: "Acrylic", percent: 70 }, { name: "Wool", percent: 30 }] }], originText: "Made in China", care: ["Hand wash cold", "Dry flat"] },
    listing: { originText: "Designed in Italy", claims: [{ quote: "Cashmere-feel softness", kind: "material" }, { quote: "Premium knit fabric", kind: "quality" }, { quote: "Designed in Italy", kind: "origin" }] },
  },
  {
    name: "Demo: Everyday Tee",
    label: { materials: [{ part: "main", components: [{ name: "Cotton", percent: 60 }, { name: "Polyester", percent: 40 }] }], originText: "Made in Bangladesh", care: ["Machine wash cold"] },
    listing: { originText: "Imported", claims: [{ quote: "100% cotton tee", kind: "material" }, { quote: "Sustainably made", kind: "eco" }] },
  },
  {
    name: "Demo: Gold Chain Necklace",
    label: { category: "jewelry", jewelryMarks: ["14K GP"], materials: [{ part: "chain", components: [{ name: "Brass", percent: null }, { name: "Gold plating", percent: null }] }], originText: "Made in China" },
    listing: { category: "jewelry", claims: [{ quote: "14K gold chain necklace", kind: "material" }, { quote: "Hypoallergenic", kind: "safety" }] },
  },
  {
    name: "Demo: Leather Tote",
    label: { category: "bag", materials: [{ part: "main", components: [{ name: "Leather", percent: 100 }] }, { part: "lining", components: [{ name: "Polyester", percent: 100 }] }], originText: "Made in China" },
    listing: { category: "bag", originText: "Made in Italy", claims: [{ quote: "Genuine leather tote", kind: "material" }, { quote: "Made in Italy", kind: "origin" }] },
  },
  {
    name: "Demo: Merino Base Layer",
    label: {
      materials: [{ part: "main", components: [{ name: "Merino wool", percent: 100 }] }],
      originText: "Made in Portugal",
      originStages: [{ stage: "fabric", country: "Italy", quote: "Fabric made in Italy" }],
      care: ["Machine wash cold, wool cycle"],
    },
    listing: { claims: [{ quote: "100% merino wool", kind: "material" }, { quote: "Made in Portugal", kind: "origin" }] },
  },
];

const now = new Date().toISOString();
demos.forEach((d, i) => {
  const gtin = withCheckDigit("200000000" + String(i + 1).padStart(3, "0")).padStart(14, "0");
  if (latestSources(gtin).length) {
    console.log(`skip  ${gtin}  ${d.name} (already there)`);
    return;
  }
  const label: SourceFacts = { type: "label", url: null, readAt: now, mode: "demo", facts: base({ productName: d.name, ...d.label }) };
  const listing: SourceFacts = { type: "listing", url: null, readAt: now, mode: "demo", facts: base({ productName: d.name, ...d.listing }) };
  addSource(gtin, label);
  addSource(gtin, listing);
  const r = buildReport(latestSources(gtin));
  console.log(`added ${gtin.slice(1)}  ${d.name.padEnd(28)} contradicted:${r.counts.contradicted} misleading:${r.counts.misleading} origin:${r.origin.gradeLabel}`);
});
console.log("\nScan these as EAN-13 barcodes (the 13 digits shown), or look them up at /api/products/<number>.");
