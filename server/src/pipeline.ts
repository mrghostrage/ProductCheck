// Shared reading steps used by the API and the seeding script.
import { extractWithClaude, MODEL } from "./extract/claude.ts";
import { sampleLabelFacts, sampleListingFacts } from "./extract/sample.ts";
import { fetchListing } from "./listing.ts";
import { normalizeGtin } from "./gtin.ts";
import type { SourceFacts } from "./schema.ts";

export const MODE: "claude" | "sample" =
  process.env.SAMPLE_MODE === "1" || !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) ? "sample" : "claude";
export { MODEL };

// A label photo, or a screenshot of a listing (for stores that block link reading).
export async function readImage(kind: "label" | "screenshot", imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<SourceFacts> {
  const facts =
    MODE === "claude"
      ? await extractWithClaude({ kind, imageBase64, mediaType })
      : kind === "label"
        ? sampleLabelFacts()
        : sampleListingFacts({ text: SAMPLE_SCREENSHOT_TEXT, name: "Example listing (sample screenshot)", brand: "Example Shop", gtin: null, material: null, origin: null });
  return { type: kind === "label" ? "label" : "listing", url: null, readAt: new Date().toISOString(), mode: MODE, facts };
}

const SAMPLE_SCREENSHOT_TEXT = "Ultra-soft lounge set\n100% cotton comfort\nCashmere-feel knit\nDesigned in Italy\nComposition: 95% polyester, 5% elastane";

export async function readListing(url: string): Promise<{ source: SourceFacts; gtin: string | null; trimmed: boolean }> {
  const listing = await fetchListing(url);
  const facts =
    MODE === "claude"
      ? await extractWithClaude({ kind: "listing", url: listing.url, text: listing.text, imageUrls: listing.imageUrls })
      : sampleListingFacts(listing);
  return {
    source: { type: "listing", url: listing.url, readAt: new Date().toISOString(), mode: MODE, facts },
    gtin: normalizeGtin(listing.gtin) ?? normalizeGtin(facts.gtin),
    trimmed: listing.trimmed,
  };
}
