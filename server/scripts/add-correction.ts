// Records a correction on the public log. Use whenever a published result changes.
// Run: npm run correction -- "Demo: Everyday Tee" "Origin changed from Vietnam to Bangladesh" "Label photo was re-read after a user report"
import { addCorrection } from "../src/db.ts";
const [product, what, why] = process.argv.slice(2);
if (!product || !what || !why) {
  console.log('Usage: npm run correction -- "<product>" "<what changed>" "<why>"');
  process.exit(1);
}
addCorrection({ date: new Date().toISOString().slice(0, 10), product, what, why });
console.log("Added to the corrections log.");
