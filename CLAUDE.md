# Product Scanner — code map

Scan a barcode / care label / listing link → report on materials, origin, and whether claims hold up.
Read this map first; open only the files a task needs. Line counts are approximate.

## Never read (huge or generated)

- `app/ios/Pods/`, `app/ios/**/*.pbxproj`, `app/ios/Podfile.lock` — native build output (CNG: don't edit `ios/` by hand)
- `app/.expo/` — includes `xcodebuild.log` (~42k lines)
- `**/package-lock.json`, `**/node_modules/`
- `cache.json` (85 KB), `server/data/scanner.db*` — runtime data
- `app/assets/` — images

## Legacy / not part of the product

- `server.js`, `index.html`, `cache.json` (root) — old "StoreCheck" prototype (store red-flag checker, port 4319). Unrelated to the current app.
- `roadmap.html`, `mockups/*.html`, `web/mockup.html` — design docs / static mockups (`mockups` served on :4410 via `.claude/launch.json`).

## Architecture in one line

AI (Claude) **only extracts facts** into `ProductFactsSchema`; every verdict comes from deterministic code in `server/src/checks/report.ts` + `server/src/knowledge/`. The app and website both call the same API.

```
photo/URL ─► POST /api/label | /api/listing ─► pipeline.ts ─► extract/claude.ts (or extract/sample.ts if no API key)
                                                    │                     └► ProductFacts (schema.ts)
                                                    ▼
                                         db.ts (sources by GTIN) ─► checks/report.ts buildReport(sources[]) ─► Report JSON
```

## server/ (Hono + Node built-in sqlite, TS via tsx, port 4400)

| File | Lines | What's there |
|---|---|---|
| `src/index.ts` | 162 | Entry. Routes: `GET /api/health`, `GET /api/products/:gtin`, `POST /api/label` (8MB limit), `POST /api/listing` (24h cache), `GET /api/corrections`, `GET /api/wording-rules`, `GET *` serves `web/`. Per-IP hourly rate limit (`HOURLY_LIMIT`). `combine()` merges a new source with stored ones. |
| `src/pipeline.ts` | 36 | `MODE` ("claude"/"sample"), `readImage(kind, b64, mediaType)`, `readListing(url)` — shared by API + seed script |
| `src/extract/claude.ts` | 82 | `extractWithClaude()`, `MODEL` (env `CLAUDE_MODEL`, default `claude-haiku-5-5`), `ExtractionError` |
| `src/extract/sample.ts` | 94 | Sample mode: `sampleLabelFacts()`, `sampleListingFacts()` (regex matching) |
| `src/schema.ts` | 53 | Zod `ProductFactsSchema` (materials parts/components, origin text, claims), `SourceFacts` |
| `src/checks/report.ts` | 432 | **Core logic.** `buildReport(sources)` → `Report`. Types `Verdict`, `ClaimResult`, `WordingFlag`, `OriginOut`, `OriginGrade`, `Contradiction`. Claim judging (`judgeMaterialClaim`, `judgeOriginClaim`), `buildOrigin`, `compareCompositions`, `summaryText` |
| `src/knowledge/materials.ts` | 110 | `MATERIALS` table (US/FTC generic names), `canonicalMaterial()`, `materialInfo()` |
| `src/knowledge/origin.ts` | 128 | `decodeOrigin(text)` → production stages covered; `STAGES`, `STAGE_LABELS`, `sameCountry()` |
| `src/knowledge/wording.ts` | 154 | `WORDING_RULES` (misleading sales terms + sources), `findWording(text)` |
| `src/listing.ts` | 182 | `fetchListing(url)` with SSRF guard (`assertPublic`, `isPrivateIp`), `parseListing()` (JSON-LD product + text lines), `ListingError` |
| `src/db.ts` | 84 | Tables `sources`, `listings`, `corrections`. `addSource`, `latestSources`, `cachedListing`, `saveListing`, `listCorrections`, `addCorrection`, `productCount` |
| `src/gtin.ts` | 26 | `normalizeGtin`, `validCheckDigit`, `withCheckDigit` |
| `scripts/seed-demo.ts` | 61 | 5 demo products, GTINs `2000000000015`–`…053` |
| `scripts/seed.ts` | 75 | Seeds from `seed/urls.txt`, obeys robots.txt |
| `scripts/add-correction.ts` | 10 | Adds to public corrections log |
| `test/checks.test.ts` | 175 | node:test suite for checks; fixture `test/fixtures/listing.html` |

Commands (in `server/`): `npm run dev`, `npm test`, `npm run typecheck`, `npm run seed:demo`. Env: `server/.env` (`ANTHROPIC_API_KEY`, optional `CLAUDE_MODEL`, `PORT`, `HOURLY_LIMIT`, `TRUST_PROXY=1` to rate-limit by the last `X-Forwarded-For` entry behind a proxy).

## app/ (Expo SDK 58, Expo Router, iOS-first) — see `app/AGENTS.md` for Expo rules

Routes (`src/app/`):

| File | Lines | Screen |
|---|---|---|
| `_layout.tsx` | 29 | Root Stack: `(tabs)`, `label` (fullScreenModal), `report`, `detail` (formSheet) |
| `(tabs)/_layout.tsx` | 19 | `NativeTabs`: Scan (`index`), My Rules (`rules`) |
| `(tabs)/index.tsx` | 483 | **Scan screen**: camera barcode/label, paste link, photo picker, demo buttons, recent history, health/mode banner. Calls `lookupBarcode` → found ? report : label; `readImage`; `readListing`. Subcomponents `Glass`, `RecentCard`, `Viewfinder`; all checks go through `attempt()` |
| `(tabs)/rules.tsx` | 179 | Personal rules editor (allergies, vegan, countries…) |
| `label.tsx` | 80 | Add a care label to an existing report → `readPhoto` → `/report` |
| `report.tsx` | 379 | Report screen: `Hero`, `OriginCard`, `ClaimTile`, `RulesBanner`, `ChainCard`; taps open `/detail?item=<key>` |
| `detail.tsx` | 103 | Detail sheet, content from `detailFor(key, report, rules)` |

Libs / components:

| File | What's there |
|---|---|
| `src/lib/api.ts` | `API_URL` (auto-detects dev host; `EXPO_PUBLIC_API_URL` override), `getHealth`, `lookupBarcode`, `readImage`, `readListing`, `ApiError` |
| `src/lib/types.ts` | Client copy of `Report` — **must mirror `server/src/checks/report.ts`** |
| `src/lib/report-view.ts` | Report → view models: `summarize`, `originView`, `detailFor`, `sortedClaims`, `productName`, `sourceLine`, `materialKind`, tone/symbol maps (`SHORT`, `VERDICT_TONE`, `VERDICT_SYMBOL`, `WORDING`) |
| `src/lib/rules.ts` | On-device personal rules: `Prefs`, `loadPrefs`/`savePrefs`, `checkRules(report, prefs)`, `loadRuleResults(report)` (never sent to server) |
| `src/lib/history.ts` | On-device recent checks: `loadHistory`, `addToHistory`, `timeAgo` |
| `src/lib/current-report.ts` | In-memory handoff of the viewed report: `openReport(report, saved, {fresh, replace})` (also records history), `getCurrentReport` |
| `src/lib/photo.ts` | `pickImage()`, `readPhoto(kind, uri, gtin?)` (resize/compress, then `readImage`) |
| `src/components/ui.tsx` | Shared iOS kit, each reads colors itself: `Sym`, `IconTile`, `TapCard`, `Chevron`, `Dashes`, `SectionTitle`, `Button`, `ErrorNote`, `BusyOverlay`, `Group`/`Row` (inset grouped list), `alpha`, `tintBackground`, `meshBackground` |
| `src/components/ring.tsx` | `Ring` segmented ring (plain views, no SVG) |
| `src/constants/theme.ts` | iOS system palette `System`, `useSystemColors()`, `Tone` |

Commands (in `app/`): `npx expo start`, `npx expo lint`, `npx tsc --noEmit`, `npx expo install <pkg>`.

## web/ (plain HTML + ES modules, served by the server)

- `index.html` — link / barcode / photo checker (calls `/api/listing`, `/api/products/:gtin`, `/api/label`)
- `report.js` — `renderReport(r)` → HTML, shared by pages
- `methodology.html` (uses `/api/wording-rules`), `corrections.html` (uses `/api/corrections`), `style.css`

## Common change recipes

- **New verdict rule / claim logic** → `server/src/checks/report.ts` (+ knowledge pack), add test in `server/test/checks.test.ts`.
- **New field in the report** → `server/src/checks/report.ts` `Report` + `app/src/lib/types.ts` + `app/src/lib/report-view.ts` + `web/report.js`.
- **New extracted fact** → `server/src/schema.ts` + `extract/claude.ts` prompt + `extract/sample.ts`.
- **New API endpoint** → `server/src/index.ts` + `app/src/lib/api.ts`.
