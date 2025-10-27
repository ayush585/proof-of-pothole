# ProofOfPothole (MVP Step 1)

Browser-only progressive web app for anonymous pothole reporting. This milestone focuses on photo capture, local classification stub, mapping, and CSV export, laying the groundwork for upcoming privacy-preserving and Web3 integrations.

## Features
- Mobile-first UI with camera capture (`capture="environment"`), in-browser resize to 720px max width, and preview.
- Geolocation lock with Leaflet map, auto fly-to, and severity-colored markers.
- Deterministic brightness-based classification stub with placeholder metrics ready for OpenCV integration.
- Session-scoped report table (in-memory) with CSV export (`potholes.csv`) for quick sharing.
- PWA manifest + service worker delivering cache-first offline shell (tiles require network unless previously cached).

## Getting Started
1. Install any static file server if you don't already have one. Examples:
   - `npx serve` (Node.js)
   - `python -m http.server`
2. Serve the repository root and open the `src/` directory in your browser, e.g.:
   ```bash
   npx serve .
   # Then navigate to http://localhost:3000/src/
   ```
3. Add the PWA to your home screen for offline testing. Capture a photo, lock location, classify, and export.

## Architecture Notes
- All logic lives client-side; no backend dependencies.
- Modules (`app.js`, `classify.js`, `map.js`, `csv.js`, `utils.js`) are ES modules to keep integration points clean.
- OpenCV, Ed25519/WebCrypto, IPFS (web3.storage), and Firebase hooks are deferred but signposted with TODOs and modular boundaries.

## Next Milestones
1. Replace `classify.js` stub with real OpenCV.js pipeline (edge detection, contour analysis, severity heuristics).
2. Introduce local identities: Ed25519 key generation & signature flows (WebCrypto) with daily nullifiers.
3. Wire IPFS uploads via web3.storage and publish discovery metadata (Firestore/Storage).
4. Build verifier/observer view with dedupe logic and additional map UX polish.
