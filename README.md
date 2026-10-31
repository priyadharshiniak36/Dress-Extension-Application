# Tryanything

Mobile-first AI dressing room: open the site on your phone, allow the camera, and see
yourself wearing garments in real time. A rebuild of the Anywear onboarding flow
(`anywear.decart.ai/onboarding-extension`), reverse-engineered with the REA approach —
see [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md).

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind v4 · `@decartai/sdk` (realtime
`lucy-vton`) · zod · Vitest.

## Design
"Dark studio" theme, its own look rather than a copy of Anywear: near-black `#0b0b0d`, electric lime `#c6ff3d`
accent, Space Grotesk + Inter, frosted-glass controls over a full-bleed camera stage, viewfinder
framing, 4-segment progress (Try on · Picks · You · Shop). Tokens live in `src/app/globals.css` (`@theme`).

## Flow
Consent (ToS/Privacy/AUP, 18+) → Enable camera → countdown → live try-on with 4 garments
auto-rotating every 15 s (tap to switch) → "Looking good!" → garment picks → style & age
survey → store list.

> Run every command from the inner folder that contains package.json (the zip nests it twice).
> Gap analysis, fixes and the mobile app path: [docs/GAPS_AND_MOBILE.md](docs/GAPS_AND_MOBILE.md).

## Run locally
```bash
cp .env.example .env.local     # add DECART_API_KEY from platform.decart.ai
npm install
npm run dev                    # http://localhost:3000 (camera works on localhost)
npm run dev:https              # only for testing on a phone over the LAN (downloads mkcert on first run)
npm test                       # unit + API tests (Decart SDK mocked)
npm run typecheck && npm run build
```
Phones need HTTPS for the camera. To test on a phone locally, use `npx next dev --experimental-https`
and add that origin to `APP_ORIGINS`, or deploy a Vercel preview.

## Layout
```
src/app/api/v1/tokens   server-only token minting (rate limited, origin-checked, session-capped)
src/app/api/v1/events   validated analytics sink
src/hooks/useTryOnSession.ts   camera → token → WebRTC → garments → teardown
src/components/onboarding/     one component per screen
src/lib/                       garments, step reducer, event schema, server utilities
docs/                          architecture, API, security, deployment, env, RE report
```

## MVP simplifications (change before production)
| Simplified | Why OK now | Before prod |
|---|---|---|
| In-memory rate limiter | single region, low traffic | Upstash Redis |
| Analytics → stdout logs | queryable in Vercel | Postgres `events` table |
| No seat queue / paywall | low concurrency | Redis queue + Stripe |
| No moderation hook | Decart AUP + 3-min caps | handle Decart content flags |
| Placeholder legal pages | dev only | real policies |
| CSP allows inline scripts | Next bootstrap | nonce-based CSP |

Garment images: DecartAI/tryon-examples (MIT) — see `public/garments/LICENSE-decart-tryon-examples.txt`.
No Anywear/Decart branding, fonts, or media are used.
