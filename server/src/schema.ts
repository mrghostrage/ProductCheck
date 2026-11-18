// What we extract from a label photo or a product listing.
// The AI fills this in (structured output); everything after that is plain code.
import { z } from "zod";

export const MaterialComponent = z.object({
  name: z.string().describe('Material exactly as written, e.g. "cotton", "elastane", "polyurethane", "sterling silver", "brass"'),
  percent: z.number().nullable().describe("Percentage if stated, otherwise null"),
});

export const MaterialPart = z.object({
  part: z.string().describe('Which part this applies to, e.g. "main", "shell", "lining", "trim", "upper", "sole", "chain". Use "main" when not stated.'),
  components: z.array(MaterialComponent),
});

export const Claim = z.object({
  quote: z.string().describe("The claim copied word for word from the source"),
  kind: z.enum(["material", "origin", "quality", "certification", "eco", "safety", "other"]),
});

export const ProductFactsSchema = z.object({
  isProductInfo: z.boolean().describe("False if the source shows no product label, tag, stamp or listing"),
  category: z.enum(["clothing", "footwear", "bag", "jewelry", "accessory", "home_textile", "other"]),
  brand: z.string().nullable(),
  productName: z.string().nullable(),
  gtin: z.string().nullable().describe("Barcode number (UPC/EAN/GTIN) if printed or listed, digits only"),
  materials: z.array(MaterialPart),
  jewelryMarks: z.array(z.string()).describe('Metal stamps or marks exactly as written, e.g. "925", "14K", "GP", "HGE", "18K GF"'),
  originText: z.string().nullable().describe('Country-of-origin wording exactly as written, e.g. "Made in Vietnam", "Designed in Italy", "Imported"'),
  originStages: z
    .array(
      z.object({
        stage: z.enum(["raw_material", "fabric", "components", "assembly", "finishing", "design"]),
        country: z.string(),
        quote: z.string(),
      }),
    )
    .describe('Only stages the source names explicitly, e.g. "fabric made in Japan". Do not infer.'),
  claims: z.array(Claim).describe("Marketing or quality claims about the product, word for word"),
  certifications: z.array(z.object({ name: z.string(), id: z.string().nullable() })),
  care: z.array(z.string()),
  unreadable: z.array(z.string()).describe("Parts of the source that were present but could not be read"),
});

export type ProductFacts = z.infer<typeof ProductFactsSchema>;
export type SourceType = "label" | "listing";

export interface SourceFacts {
  type: SourceType;
  url: string | null;
  readAt: string;
  mode: "claude" | "sample" | "demo";
  facts: ProductFacts;
}
