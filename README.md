# Product Scanner

Scan a product's barcode or care label, or paste a listing link, and see what it's really made of, where it's really from, and whether its claims hold up. Every flag shows its source.

```
server/   API: reads labels and listings with Claude, runs the checks, stores products by barcode
app/      Expo phone app: scan, snap the label, check a link, personal rules
web/      Website: link and photo checker, methodology page, corrections log (served by the server)
```

## Run it

1. **Server** (from `server/`):
   ```bash
   npm install
   npm run seed:demo   # adds 5 demo products (barcodes 2000000000015 to 2000000000053)
   npm run dev         # http://localhost:4400
   ```
   With no API key it runs in **sample mode**: demo products work fully, label photos return an example label, and links are read with simple text matching. Sample results are never saved.

   For real AI reading, copy `.env.example` to `.env` and add your Anthropic API key.

2. **App** (from `app/`, in a second terminal):
   ```bash
   npm install
   npx expo start
   ```
   Scan the QR code with your iPhone camera to open it in **Expo Go**. Your phone must be on the same Wi-Fi as this Mac; the app finds the server automatically. Press `i` to open the iOS Simulator instead (no camera there: use the demo buttons and "Choose from photos").

3. **Website:** open http://localhost:4400 (pages: `/`, `/methodology`, `/corrections`).

## Useful commands (from `server/`)

| Command | What it does |
|---|---|
| `npm test` | Runs the checks' test suite |
| `npm run seed` | Reads product pages listed in `seed/urls.txt` (needs an API key; obeys robots.txt, waits between pages) |
| `npm run correction -- "<product>" "<what changed>" "<why>"` | Adds an entry to the public corrections log |

## How it decides

The AI only extracts facts (materials, origin wording, stamps, claims). Every verdict comes from fixed rules in `server/src/checks/report.ts` and the US knowledge packs in `server/src/knowledge/`. See `/methodology` for the public explanation.

## Privacy

- Photos are read once and never stored. Only the extracted facts are saved, under the product's barcode.
- Personal rules (allergies, vegan, countries) are stored and checked only on the phone.
