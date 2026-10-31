# Gap analysis, fixes, and the mobile app path

Audit of `TryAnything-main.zip` against the Anywear extension
(Chrome Web Store listing "Anywear: Live Virtual Try-On": *"Drag, drop, see it on yourself"*).

## Reference behavior (from the store listing)
Install → go to any fashion site → **drag a garment into the pop-up** → see it on you instantly.
The listing describes no other input method; upload / camera / paste are additions for mobile.

## Gaps found

| # | Gap / bug | Severity | Status |
|---|---|---|---|
| 1 | **No way to try on your own garment.** Only 4 hard-coded images; no drag & drop, upload, camera shot or link. This is the extension's core feature. | Critical | Fixed |
| 2 | Not an installable app: no manifest, icons, service worker. | High | Fixed (PWA) |
| 3 | `npm run dev` used `--experimental-https`, which downloads mkcert and installs a local CA on first run. Fails offline / behind proxies / without rights; easy to read as "the build is broken". | High | `dev` is now plain HTTP (camera works on `localhost`); `dev:https` is opt-in for phone-on-LAN |
| 4 | `@decartai/sdk` was `"latest"`: a breaking SDK release breaks the build silently. | High | Pinned to `0.2.14` |
| 5 | `next@15.1.0` has a published security advisory (CVE-2025-66478). | High | Upgraded to `15.5.28` |
| 6 | Stray `pyproject.toml` / `.python-version` in a Next.js project (confuses tooling, e.g. `uv`). | Low | Removed |
| 7 | Zip nests the project twice (`TryAnything-main/TryAnything-main`). Running `npm install` in the outer folder fails (no `package.json`). | Medium | Documented: run from the inner folder |
| 8 | Auto-rotation would overwrite a garment the user just chose. | High (once #1 exists) | Fixed: choosing/adding pins the garment; the ring then shows time left in the try-on |
| 9 | Tab-hidden teardown would kill the session the moment the OS camera/file picker opens on a phone. | High (once #1 exists) | Fixed: `holdForPicker()` grace window; if the OS reclaimed the camera while away the user gets a clear "tap to resume" message |
| 10 | Dragged images from other sites can't be read by the browser (CORS) and CSP blocks cross-origin fetches. | High | New `POST /api/v1/garment-image` proxy (see Security) |

| 11 | **Build depended on fonts.googleapis.com** (`next/font/google`). If that host is blocked/offline/flaky the build dies with the cryptic `TypeError: Cannot read properties of null (reading '1')` in `next/font`. I hit this once myself after clearing `.next`. | High | Fonts are self-hosted in `src/app/fonts` (`next/font/local`); build verified with the network blocked |
| 12 | "← Back" / "Skip →" touch targets were 36 px tall (<44 px). | Low | Fixed (`min-h-11`) |

## Netlify
`netlify.toml` is included (Node 22, `no-cache` for `/sw.js`). Set in Site configuration → Environment variables:
`DECART_API_KEY` (secret) and `APP_ORIGINS=https://<your-site>.netlify.app` (add custom domains comma-separated).
Without `DECART_API_KEY` `/api/v1/tokens` answers 503 `not_configured`; without the origin in `APP_ORIGINS` it answers 403.

Not changed (documented in README "MVP simplifications"): in-memory rate limiter, no seat queue / paywall,
no moderation hook, placeholder legal pages, CSP `unsafe-inline`.

`npm audit` still lists dev-tooling findings (vitest/esbuild/tinypool) and `zod` 3→4 (major bump).
None ship to the browser; upgrade deliberately, not via `audit fix --force`.

## New: bring your own garment
All routes end in the same pipeline: `normalizeImage` (≤1024 px, white-flattened JPEG) → in-memory garment →
`rtClient.setImage(blob, {prompt})`.

| Input | Desktop | Phone |
|---|---|---|
| Drag & drop a file or an image from another tab | yes | n/a |
| Upload photo | yes | gallery picker |
| Take a photo | file dialog | rear camera (`capture="environment"`) |
| Paste image / image link (Ctrl/⌘+V or link field) | yes | link field |

Garments live in memory only (max 8 per visit); object URLs are revoked on removal/unmount.

### Security of the link proxy (`src/lib/server/safe-fetch.ts`)
Same-origin gated, 20 req/min/IP, https only, no credentials or custom ports, DNS result must be public
(private, loopback, link-local, metadata, CGNAT, multicast all blocked, IPv4-mapped IPv6 included), the validated IP is
**pinned** for the connection (no DNS rebinding), redirects re-validated (max 3), 8 MB streaming cap, 8 s deadline,
body must sniff as JPEG/PNG/WebP/GIF (SVG refused; remote `Content-Type` ignored). Covered by `tests/garment-image.test.ts`.

## Free on-device mode (default)
Decart's realtime AI is paid per second (about $0.02/s), and an account with no credits gets
`Insufficient credits` (WebSocket close 1008). So the app now has two modes:

| | Free mode (default) | AI mode |
|---|---|---|
| Cost | none; runs on the visitor's phone | Decart credits |
| How | MediaPipe pose model finds shoulders/hips, the garment photo (background removed) is drawn on the torso | Decart `lucy-vton` realtime |
| Look | 2D overlay, like a sticker that follows you | photorealistic |
| Camera data | never leaves the device | streamed to Decart |
| Time cap | none | 60 s demo / 180 s token cap |

- Switch with the link under "Turn on camera". Set `NEXT_PUBLIC_DEFAULT_MODE=ai` to make AI the default.
- If AI mode can't start (no credits, busy, down) the app **falls back to free mode automatically**.
- Works with every garment input (uploads, drops, camera photos, links). Best for tops, jackets and hoodies; long
  garments (dresses, trousers) are extended down the body direction from the shoulders and do not follow the legs.
- Computer-vision pipeline (no keys, no server): MediaPipe pose → garment **mesh warp** onto the shoulder/hip quad
  (`transform.ts` + `warp.ts`, follows body width, tilt and turning) → **forearm occlusion** (arms crossing the chest are
  redrawn over the garment) → **lighting match** (`lighting.ts`, garment brightness follows the room) → temporal smoothing.
  Still a 2D overlay: no cloth physics, no sleeves wrapping the arms, no side-on realism. A photorealistic result needs a
  generative model (GPU/API), which is what AI mode is for.
- Files: `src/hooks/useOverlaySession.ts`, `src/lib/overlay/{cutout,transform,pose,sprite}.ts`, tests in
  `tests/overlay.test.ts`. The pose model and wasm are self-hosted in `public/mediapipe/` (33 MB; model
  `pose_landmarker_lite.task` from Google's MediaPipe model storage, Apache-2.0), so there is no third-party request.
- CSP gained `'wasm-unsafe-eval'` (needed to run WebAssembly; it does not allow JS `eval`).
- Verified: production build (CSP on), simulated camera showing MediaPipe's sample photo: reaches LIVE in ~3 s with no
  CSP violations and draws the garment on the torso; consent dialog closes correctly; 61/61 tests.
  **Not verified:** real phone cameras, frame rate on low-end phones, iOS Safari (`canvas.captureStream` needs iOS 15+).

## Mobile app

### 1. PWA (done): installable, works today
`manifest.webmanifest`, generated PNG icons (`/icons/*`), `public/sw.js` (offline shell, caches build assets and garment
photos, never `/api/*`), "Install app" button, iOS standalone meta.
- Android/Chrome: open the site over HTTPS → **Install app**.
- iOS/Safari: Share → **Add to Home Screen**.
HTTPS is required for the camera. Deploy (e.g. Vercel) and set `APP_ORIGINS` to the production origin.

### 2. Native apps via Capacitor 8 (`android/` and `ios/` projects are in the repo)
A thin native shell that loads the **deployed** site (the Next API routes need a server, so a static export is not an
option). `capacitor.config.ts` reads the site origin from `CAP_SERVER_URL`; it must be `https://` and also listed in
`APP_ORIGINS` on the server, otherwise `/api/v1/tokens` returns 403.

Already configured: Android `CAMERA` permission (+ optional camera features), iOS `NSCameraUsageDescription` and
`NSPhotoLibraryUsageDescription`.

```bash
# Android (needs JDK 17+ and Android SDK; set ANDROID_HOME)
CAP_SERVER_URL=https://your-domain.com npx cap sync android
cd android && ./gradlew assembleDebug        # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run cap:android                          # or open in Android Studio

# iOS (macOS + Xcode only)
CAP_SERVER_URL=https://your-domain.com npx cap sync ios
npm run cap:ios
```
On Windows PowerShell set the variable first: `$env:CAP_SERVER_URL="https://your-domain.com"`.
Release builds need your own signing key (Android keystore / Apple Developer team); not configured. Apple may reject apps
that are only a website wrapper; plan for at least one native feature (share-sheet target, native photo picker).

## Verified in this environment
- `tsc --noEmit` clean; `next build` succeeds; **49/49 tests** pass (27 new).
- In the browser pane (375×812): file drop (1600×1200 → 1024×768, added and pinned), pasted URL and dropped `<img>` HTML via
  the proxy, junk and non-image drops show an error; proxy blocks `127.0.0.1`, `169.254.169.254`, `http://`, non-images;
  manifest, 4 icons and `sw.js` all served.
- **Not verified**: a real live try-on (needs `DECART_API_KEY` and a camera), the service worker in a production build,
  real iOS/Android devices, native Capacitor builds. How Decart's `lucy-vton` treats the generic prompt for
  user-supplied garments (`CUSTOM_GARMENT_PROMPT`) needs a test with a real key.
