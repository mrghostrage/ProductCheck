import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/checks/report.ts";
import { decodeOrigin } from "../src/knowledge/origin.ts";
import { findWording } from "../src/knowledge/wording.ts";
import { canonicalMaterial } from "../src/knowledge/materials.ts";
import { normalizeGtin, withCheckDigit } from "../src/gtin.ts";
import { sampleListingFacts } from "../src/extract/sample.ts";
import { fetchListing, ListingError } from "../src/listing.ts";
import type { ProductFacts, SourceFacts } from "../src/schema.ts";

const facts = (over: Partial<ProductFacts>): ProductFacts => ({
  isProductInfo: true, category: "clothing", brand: null, productName: null, gtin: null, materials: [], jewelryMarks: [],
  originText: null, originStages: [], claims: [], certifications: [], care: [], unreadable: [], ...over,
});
const src = (type: "label" | "listing", f: Partial<ProductFacts>): SourceFacts => ({ type, url: null, readAt: "2026-11-18T00:00:00Z", mode: "claude", facts: facts(f) });
const cottonPoly = [{ part: "main", components: [{ name: "Cotton", percent: 60 }, { name: "Polyester", percent: 40 }] }];

test("barcodes: valid ones normalize, bad check digits are rejected", () => {
  assert.equal(normalizeGtin("4006381333931"), "04006381333931");
  assert.equal(normalizeGtin("036000291452"), "00036000291452");
  assert.equal(normalizeGtin("036000291453"), null);
  assert.equal(normalizeGtin("12345"), null);
  assert.ok(normalizeGtin(withCheckDigit("200000000001")));
});

test("material names map to US generic names", () => {
  assert.equal(canonicalMaterial("Elastane"), "spandex");
  assert.equal(canonicalMaterial("Polyamide"), "nylon");
  assert.equal(canonicalMaterial("Viscose"), "rayon");
  assert.equal(canonicalMaterial("vegan leather"), "polyurethane");
  assert.equal(canonicalMaterial("Genuine leather"), "leather");
  assert.equal(canonicalMaterial("18K gold plated"), "gold_plated");
});

test("origin wording decodes to the stages it covers", () => {
  assert.equal(decodeOrigin("Made in Vietnam").wording, "made_in");
  assert.equal(decodeOrigin("Made in Vietnam").country, "Vietnam");
  assert.equal(decodeOrigin("100% Made in Italy").wording, "all_stages");
  assert.equal(decodeOrigin("Made in USA of imported fabric").wording, "made_in_of_imported");
  assert.equal(decodeOrigin("Assembled in Mexico").country, "Mexico");
  assert.equal(decodeOrigin("Designed in California").wording, "designed_in");
  assert.equal(decodeOrigin("Imported").wording, "imported");
  assert.equal(decodeOrigin(null).wording, "none");
});

test("wording decoder catches the classic tricks", () => {
  const ids = (t: string) => findWording(t).map((h) => h.rule.id);
  assert.ok(ids("18K Gold Plated Necklace").includes("gold-plated"));
  assert.ok(ids("Gold tone hoops").includes("gold-tone"));
  assert.ok(ids("Genuine leather wallet").includes("genuine-leather"));
  assert.ok(ids("Cashmere-feel sweater").includes("feel-touch"));
  assert.ok(ids("Bamboo sheets").includes("bamboo"));
  assert.ok(ids("Designed in Italy").includes("designed-in"));
  assert.deepEqual(ids("Plain cotton tee"), []);
});

test('"100% cotton" claim is contradicted by a 60/40 label', () => {
  const r = buildReport([src("label", { materials: cottonPoly }), src("listing", { claims: [{ quote: "100% cotton tee", kind: "material" }] })]);
  assert.equal(r.claims[0].verdict, "contradicted");
  assert.match(r.claims[0].reason, /60% Cotton, 40% Polyester/);
  assert.equal(r.counts.contradicted, 1);
});

test("a matching material claim is supported", () => {
  const r = buildReport([src("label", { materials: cottonPoly }), src("listing", { claims: [{ quote: "Soft cotton blend", kind: "material" }] })]);
  assert.equal(r.claims[0].verdict, "supported");
});

test("leather claim on a PU product is contradicted", () => {
  const r = buildReport([
    src("label", { category: "bag", materials: [{ part: "main", components: [{ name: "Polyurethane", percent: 100 }] }] }),
    src("listing", { category: "bag", claims: [{ quote: "Premium leather tote", kind: "material" }] }),
  ]);
  assert.equal(r.claims[0].verdict, "contradicted");
  assert.equal(r.materialSummary?.hasPlasticLeather, true);
});

test('"14K gold" claim with a GP stamp is contradicted', () => {
  const r = buildReport([
    src("label", { category: "jewelry", jewelryMarks: ["14K GP"] }),
    src("listing", { category: "jewelry", claims: [{ quote: "14K gold chain necklace", kind: "material" }] }),
  ]);
  assert.equal(r.claims[0].verdict, "contradicted");
});

test('"genuine leather" is flagged as misleading wording even when true', () => {
  const r = buildReport([src("listing", { category: "bag", materials: [{ part: "main", components: [{ name: "Leather", percent: 100 }] }], claims: [{ quote: "Genuine leather", kind: "material" }] })]);
  assert.equal(r.claims[0].verdict, "misleading");
  // Explained once, on the claim, not repeated in the wording section
  assert.ok(!r.wording.some((w) => w.title.includes("Genuine leather")));
});

test("origin: label and listing disagree, grade is contradicted", () => {
  const r = buildReport([src("label", { originText: "Made in China" }), src("listing", { originText: "Made in Italy", claims: [{ quote: "Made in Italy", kind: "origin" }] })]);
  assert.equal(r.origin.grade, "contradicted");
  assert.equal(r.claims[0].verdict, "contradicted");
  assert.ok(r.contradictions.some((c) => c.title === "Origin doesn't match"));
});

test("origin: plain Made in X is final step only, with fabric origin it's partial", () => {
  assert.equal(buildReport([src("label", { originText: "Made in Vietnam" })]).origin.grade, "final_only");
  const partial = buildReport([src("label", { originText: "Made in Portugal", originStages: [{ stage: "fabric", country: "Italy", quote: "Italian fabric" }] })]);
  assert.equal(partial.origin.grade, "partial");
  assert.equal(buildReport([src("listing", { originText: "Imported" })]).origin.grade, "none");
});

test("label vs listing material mismatch is reported", () => {
  const r = buildReport([
    src("label", { materials: cottonPoly }),
    src("listing", { materials: [{ part: "main", components: [{ name: "Cotton", percent: 100 }] }] }),
  ]);
  assert.ok(r.contradictions.some((c) => c.title === "Materials don't match"));
});

test("material summary computes plastic share", () => {
  const r = buildReport([src("label", { materials: cottonPoly })]);
  assert.equal(r.materialSummary?.plasticShare, 40);
  assert.equal(r.materialSummary?.naturalShare, 60);
  assert.equal(r.materialSummary?.text, "40% plastic-based fibers, 60% natural.");
});

test("material summary names the main part and flags plastic in other parts", () => {
  const r = buildReport([src("label", { materials: [
    { part: "main", components: [{ name: "Leather", percent: 100 }] },
    { part: "lining", components: [{ name: "Polyester", percent: 100 }] },
  ] })]);
  assert.equal(r.materialSummary?.plasticShare, 0);
  assert.equal(r.materialSummary?.text, "Main: 0% plastic-based fibers, 100% natural. Lining contains plastic fibers (polyester).");
});

test("sample mode reads a listing's text", () => {
  const f = sampleListingFacts({
    text: "Product: Cozy Knit Sweater\nComposition: 70% Acrylic, 30% Wool\nCashmere-feel softness you'll love.\nMade in China\nFree shipping on orders over $50.",
    name: "Cozy Knit Sweater", brand: "Example", gtin: null, material: null, origin: null,
  });
  assert.deepEqual(f.materials[0].components.map((c) => c.percent), [70, 30]);
  assert.equal(f.originText, "Made in China");
  assert.ok(f.claims.some((c) => /Cashmere-feel/.test(c.quote)));
  assert.ok(!f.claims.some((c) => /shipping/i.test(c.quote)));
  const r = buildReport([{ type: "listing", url: null, readAt: "", mode: "sample", facts: f }]);
  assert.ok(r.claims.some((c) => /Cashmere-feel/.test(c.quote) && c.verdict === "misleading"));
  assert.ok(r.sampleMode);
});

test("listing fetcher refuses private addresses", async () => {
  await assert.rejects(fetchListing("http://localhost:4400/"), ListingError);
  await assert.rejects(fetchListing("http://192.168.1.1/"), ListingError);
});

test('"Cashmere-feel" is misleading wording, not a contradicted cashmere claim', () => {
  const r = buildReport([
    src("label", { materials: [{ part: "main", components: [{ name: "Acrylic", percent: 70 }, { name: "Wool", percent: 30 }] }] }),
    src("listing", { claims: [{ quote: "Cashmere-feel softness", kind: "material" }] }),
  ]);
  assert.equal(r.claims[0].verdict, "misleading");
});

test("listing parser reads structured data and relevant lines, skips scripts and nav", async () => {
  const { parseListing } = await import("../src/listing.ts");
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("./fixtures/listing.html", import.meta.url), "utf8");
  const l = parseListing("https://shop.example.com/p/1", html);
  assert.equal(l.name, "Cloud Knit Sweater");
  assert.equal(l.brand, "Example Shop");
  assert.equal(l.gtin, "2000000000015");
  assert.equal(l.material, "70% Acrylic, 30% Wool");
  assert.equal(l.origin, "China");
  assert.deepEqual(l.imageUrls, ["https://cdn.example.com/sweater-1.jpg", "https://cdn.example.com/sweater.jpg"]);
  assert.match(l.text, /Designed in Italy/);
  assert.match(l.text, /Premium knit fabric/);
  assert.doesNotMatch(l.text, /tracking|Careers|Shop Women/);
  const f = sampleListingFacts(l);
  assert.equal(f.materials[0].components.length, 2);
});

const claimVerdict = (labelFacts: Partial<ProductFacts>, quote: string, kind: "material" | "origin" = "material") =>
  buildReport([src("label", labelFacts), src("listing", { claims: [{ quote, kind }] })]).claims[0].verdict;
const cottonSpandex = [{ part: "main", components: [{ name: "Cotton", percent: 95 }, { name: "Elastane", percent: 5 }] }];
const allPoly = [{ part: "main", components: [{ name: "Polyester", percent: 100 }] }];

test("claim wording doesn't create false contradictions", () => {
  assert.equal(claimVerdict({ materials: [{ part: "main", components: [{ name: "Recycled polyester", percent: 100 }] }] }, "100% recycled polyester"), "supported");
  assert.equal(claimVerdict({ materials: cottonSpandex }, "Really soft cotton tee"), "supported");
  assert.equal(claimVerdict({ materials: cottonSpandex }, "Cotton jersey for all seasons"), "supported");
  assert.equal(claimVerdict({ materials: cottonSpandex }, "All-cotton tee"), "contradicted");
  assert.equal(claimVerdict({ materials: allPoly }, "Faux suede finish"), "supported");
  assert.equal(canonicalMaterial("Silky smooth drape"), null);
  assert.equal(canonicalMaterial("Mulberry silk"), "silk");
  assert.equal(canonicalMaterial("Button-down collar"), null);
  assert.equal(canonicalMaterial("Goose down"), "down");
});

test('an "Imported" label rules out a US origin claim', () => {
  assert.equal(claimVerdict({ originText: "Imported" }, "Made in USA", "origin"), "contradicted");
  assert.equal(claimVerdict({ originText: "Imported" }, "Made in Italy", "origin"), "unverifiable");
});

test("numeric JSON-LD gtin is read", async () => {
  const { parseListing } = await import("../src/listing.ts");
  const html = `<script type="application/ld+json">{"@type":"Product","name":"Tee","gtin13":4006381333931}</script><p>100% cotton</p>`;
  assert.equal(parseListing("https://shop.example.com/p/2", html).gtin, "4006381333931");
});

test("UPC-E files under its UPC-A, EAN-8 still works", () => {
  assert.equal(normalizeGtin("04252614"), normalizeGtin("042100005264"));
  assert.equal(normalizeGtin("96385074"), "00000096385074"); // EAN-8
});

test("imitation names don't map to animal fibers", () => {
  assert.equal(canonicalMaterial("Down alternative fill"), "polyester");
  assert.equal(canonicalMaterial("Pleather"), "polyurethane");
  assert.equal(canonicalMaterial("Art silk"), "rayon");
  assert.equal(canonicalMaterial("Faux silk"), "polyester");
  assert.equal(canonicalMaterial("Duck down"), "down");
  assert.equal(claimVerdict({ materials: cottonSpandex }, "All day comfort in all-cotton jersey"), "contradicted");
});

test("IPv4-mapped IPv6 links to private addresses are refused", async () => {
  await assert.rejects(fetchListing("http://[::ffff:127.0.0.1]:4400/"), ListingError);
  await assert.rejects(fetchListing("http://[::ffff:a9fe:a9fe]/"), ListingError);
});

test("sample mode picks up 100% claims", () => {
  const f = sampleListingFacts({ text: "100% cotton tee", name: null, brand: null, gtin: null, material: null, origin: null });
  assert.deepEqual(f.claims.map((c) => c.quote), ["100% cotton tee"]);
});

test("report carries the barcode it's saved under", () => {
  const r = buildReport([src("listing", { gtin: null })], "04006381333931");
  assert.equal(r.product.gtin, "04006381333931");
  assert.equal(buildReport([src("listing", { gtin: "4006381333931" })]).product.gtin, "4006381333931");
});

test('"gold plating" is gold plated', () => {
  assert.equal(canonicalMaterial("Gold plating"), "gold_plated");
  assert.ok(findWording("Gold plating").some((h) => h.rule.id === "gold-plated"));
});
