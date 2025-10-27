# ProofOfPothole (MVP Step 1)

Browser-only progressive web app for anonymous pothole reporting. This milestone focuses on photo capture, local classification stub, mapping, and CSV export, laying the groundwork for upcoming privacy-preserving and Web3 integrations.

## Features
- Mobile-first UI with camera capture (`capture="environment"`), in-browser resize to 720px max width, and preview.
- Geolocation lock with Leaflet map, auto fly-to, and severity-colored markers.
- OpenCV.js-powered classification pipeline (edge detection, contour analysis) with automatic fallback if the WASM bundle fails.
- Client-side Ed25519 identity: anon ID, daily nullifier, image hashing, report signing, and inline signature verification badges.
- Session-scoped report table (in-memory) with CSV export (`potholes.csv`) plus one-tap pack publishing to IPFS and Firestore feed indexing.
- Standalone verifier (`verify.html`) for judges to paste a CID or drop a ZIP and view totals, signature checks, image hashes, and map pins.
- PWA manifest + service worker delivering cache-first offline shell (tiles require network unless previously cached).

## Getting Started
1. Install any static file server if you don't already have one. Examples:
   - `npx serve` (Node.js)
   - `python -m http.server`
2. Copy the config template and add your own credentials/tokens:
   ```bash
   cp src/config.example.js src/config.js
   ```
   - `FIREBASE_CONFIG`: create a Firebase project, enable Firestore, and paste the web SDK config.
   - `WEB3_STORAGE_TOKEN`: generate an API token from https://web3.storage.
   - `IPFS_GATEWAY`: optional override for downloads (default `https://w3s.link`).
   - `DEFAULT_CHANNEL`: initial community channel for packs.
   > `src/config.js` is git-ignored by default - keep your credentials local.
3. Serve the repository root and open the `src/` directory in your browser, e.g.:
   ```bash
   npx serve .
   # Then navigate to http://localhost:3000/src/
   ```
4. Add the PWA to your home screen for offline testing. Capture a photo, lock location, classify, and export.
5. Use the Identity section to export your local keys (keep `identity.json` safe) or import an existing identity to resume signing on another browser.

## Architecture Notes
- All logic lives client-side; no backend dependencies.
- Modules (`app.js`, `classify.js`, `map.js`, `csv.js`, `utils.js`) are ES modules to keep integration points clean.
- OpenCV, Ed25519/WebCrypto, Web3.Storage, and Firebase Firestore live entirely in-browser through ES modules, keeping integration points modular.

## Publish & Discover Flow
1. Capture and classify potholes on the main page (`index.html`). Signed reports accumulate in your session.
2. Hit **Publish Pack** to bundle the signed reports and resized images into a ZIP pack.
   - The ZIP is uploaded to Web3.Storage and registered in Firestore (`packs/{packId}`) with its CID and hash.
3. Open **Community Feed** (`feed.html`) to browse packs per channel, import them, and verify signatures + image hashes client-side.
4. Judges can jump straight to **Verify Pack** (`verify.html`) to audit any CID or ZIP without touching Firestore.
5. Verified reports are plotted on the Leaflet map. Duplicates (nullifier + timestamp) are skipped automatically.

## Next Milestones
1. Train thresholds on labeled pothole samples and expose severity calibration controls.
2. Expand verifier/observer UX with channel filters, bulk downloads, and richer map overlays.
3. Layer in Ed25519-based pack aggregation, nullifier rotation safeguards, and Firebase channel discovery.
