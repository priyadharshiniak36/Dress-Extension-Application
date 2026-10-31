# Reverse-engineering report: Anywear `/onboarding-extension`

Target: `https://anywear.decart.ai/onboarding-extension` (title "Anywear — Installed!")
Captured: 2026-10-29, Chromium, 375×812 mobile emulation, via the Claude browser pane
(REA-style passive capture: DOM, inline/external scripts, stylesheet, resource timing).
Method follows REA's web workflow (`inspect_web_page` → `export_web_scripts` →
`analyze_javascript_application`). REA's CLI could not run in the cloud workspace
because `registry.npmjs.org` and `anywear.decart.ai` were not on the egress
allowlist, so the capture was done in-browser. Re-run with REA once allowed:

```bash
npx -y rea-agents@latest inspect-web-page --endpoint http://127.0.0.1:9222 \
  --origin https://anywear.decart.ai --include-script-sources --json > capture.json
npx -y rea-agents@latest export-web-scripts ./capture.json ./exported --json
npx -y rea-agents@latest analyze-javascript-application ./exported/files --json
```

## 1. Page inventory (evidence)

| Kind | Item | Notes |
|---|---|---|
| HTML | single static document, ~105 KB | no framework; server injects `window.__onbctx = {i, ask_referral, v}` |
| CSS | one inline `<style>`, ~27 KB | desktop-first, **no media queries** (mobile just shrinks the modal) |
| Font | `Roobert` variable (`/fonts/RoobertVF.woff2`) | commercial font — not reused |
| JS | `moderation-reset-attempt.js` | patches `window.WebSocket` **before** SDK loads; NSFW lane config `NSFW_THRESHOLD: 0.8` |
| JS | `tryon-queue.js` (18 KB) | seat queue: `/api/queue/join · status · heartbeat · leave · requeue`, falls back to `/api/tokens` |
| JS | `decart-sdk.min.js` | `@decartai/sdk` browser bundle (`window.DecartSDK`) |
| JS | `confetti.min.js` | canvas-confetti |
| JS | inline app script (~55 KB) | the whole onboarding state machine (below) |
| Media | `hero-tryon.mp4` + poster, `garment1..4.png` | Decart's own assets — **not reused** |
| API | `POST /api/log` | analytics sink (keepalive fetch) |

## 2. Flow / state machine

```
[consent-overlay]  "Ready to try on?"  checkbox (ToS/Privacy/AUP + 18+) → ENABLE CAMERA
      │ getUserMedia(1280×720) ok
      ▼
step1  "Your AI dressing room"  countdown  Ready? → Standing? → Go!  ("Connecting your camera…")
      │ queue.acquire() → token{apiKey, modelName, constraints.realtime.maxSessionDuration}
      │ DecartSDK.createDecartClient({apiKey}).realtime.connect(camStream, {model, onRemoteStream})
      ▼
step1 live: mirrored remote video, 4 garment thumbs float in, timer chip 0:15 per garment,
      auto-rotate garment every 15 s × 4 (= 1:00), hint "First, let's try a few examples!" (15 s),
      nudge card after 20 s "Ready to try on more clothes?  Not yet | Start Shopping →",
      click/drag a thumb → setImage(url). Hard cap 3 min. Tab hidden → full reset.
      │ 4th rotation ends → disconnect → timeout modal + confetti
      ▼
timeout-overlay  [Try more outfits]
      ▼
step-garments  2×2 grid (static) + "Start shopping online", ← Back / Next →
      (loads the Anywear extension widget + 3-stage spotlight tour — extension-specific)
      ▼
step-survey  "What's your style?" Woman | Men | Other   "Age?" 18–20 … 55+
      │ both answered → track(profile) → confetti
      ▼
step2  "Start shopping now."  Tip callout + 20 brand pills (external store links)  ← Back
```

Progress dots `d0..d2`: 0 = camera CTA, 1 = live try-on, 2 = shop.
Confetti fires at: camera enabled, 1-minute try-on done, garment step done, survey done.

## 3. Key constants

| Constant | Value |
|---|---|
| Camera constraints | `{width:{ideal:1280}, height:{ideal:720}}`, audio off |
| Per-garment rotation | 15 s, 4 rotations |
| Hard session cap | 180 s client + `maxSessionDuration` on token |
| Nudge delay | 20 s |
| Hint duration | 15 s |
| Queue heartbeat | 30 s; seat released at `maxSessionDuration + 10 s` |
| Queue max wait | 60 s default |
| Model | taken from token response (`modelName`), never hard-coded (they broke prod on 2026-09-15 by hard-coding `lucy-vton-3.5`) |

## 4. Design tokens

| Token | Value |
|---|---|
| Ink | `#170404` (headings, primary buttons) / `#111` |
| Paper | `#fffffc` |
| Background glow | `radial-gradient(95% 95% at 100% 100%, #fecbff 0%, rgba(254,203,255,.45) 38%, transparent 72%)` |
| Overlay scrim | `rgba(14,13,11,.52)` + `backdrop-filter: blur(6px)` |
| Primary CTA | pill, `#111`, white text; animated **gold conic "beam" border** (`@property --ob-beam-angle`, 2.5 s spin) |
| Heading | 28–32 px, weight 500, letter-spacing ≈ −1.1 px, line-height ≈ 1 |
| Choice buttons | 1.5 px `#bbb` border, radius 24 px; selected = solid `#111` |
| Modal | white, radius 20–28 px, shadow `0 24px 80px rgba(0,0,0,.22)` |
| Motion | step enter `opacity/translateY(14px)` 450 ms `cubic-bezier(.4,0,.2,1)`; garment float 3.2 s |

## 5. Lessons baked into their comments (worth copying)

1. Report the **failing stage** (camera / token / queue / connect); only blame the camera when getUserMedia failed.
2. Release the camera + seat on every failure path, on `visibilitychange: hidden`, and on `pagehide`.
3. Don't pass a DOM event as a callback argument (`enableBtn.addEventListener('click', () => start())`).
4. Model slug comes from the server; the server scopes the token to that model.
5. Cap session length on the **token** — token expiry does not end a live session.
6. Show "servers busy" only when it's provably true (queue timeout or capacity error).

## 6. What Tryanything keeps vs drops

| Anywear feature | Tryanything MVP | Reason |
|---|---|---|
| Consent gate, 18+ | ✅ | legal requirement for camera + AI |
| Countdown, live try-on, rotation, timer, nudge, hint | ✅ | core UX |
| Drag/drop + tap garments | ✅ (tap primary on mobile) | |
| Timeout modal, garment grid, survey, shop step, confetti | ✅ | |
| Server-minted short-lived token | ✅ `/api/v1/tokens` | key never in browser |
| Analytics | ✅ `/api/v1/events` (validated, structured logs) | |
| Seat queue + paywall + requeue | ⏭ phase 2 | needs Redis/Postgres + billing |
| Moderation WebSocket patch | ⏭ phase 2 | private Decart pod protocol; rely on Decart AUP + token caps for MVP |
| Referral share links | ⏭ phase 2 | needs recording storage |
| Extension widget + spotlight tour | ❌ | extension-only |
| Anywear logo, Roobert font, hero video, garment PNGs | ❌ replaced | Decart's brand/IP. Garments come from Decart's MIT-licensed `tryon-examples` repo |
| Layout | 🔁 rebuilt mobile-first | original has no responsive CSS |
