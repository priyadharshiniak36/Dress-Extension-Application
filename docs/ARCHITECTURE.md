# Architecture

Tryanything is a mobile-first Next.js app that recreates the Anywear onboarding try-on
flow (see `REVERSE_ENGINEERING.md`). The MVP is a modular monolith: one Next.js app,
two server routes, no database.

```
Browser (mobile Safari / Chrome)
 ├─ Onboarding UI (React client components, reducer-driven steps)
 ├─ useTryOnSession  ── getUserMedia ──► camera MediaStream
 │        │  POST /api/v1/tokens          (same-origin, rate limited)
 │        ▼
 │   short-lived client token {apiKey, expiresAt, model, maxSessionSeconds}
 │        │  @decartai/sdk realtime.connect(stream, {model})  ── WebRTC ──►  Decart lucy-vton
 │        │  rtClient.setImage(garmentBlob, {prompt})                         (GPU, Decart cloud)
 │        ◄──────────────── remote MediaStream (try-on video) ─────────────────
 └─ analytics  ── sendBeacon POST /api/v1/events ──► structured JSON logs (stdout)

Next.js server (Vercel / Node)
 ├─ /api/v1/tokens  : origin check → rate limit → mint token with DECART_API_KEY (server-only)
 └─ /api/v1/events  : rate limit → zod schema (enum of event names, bounded props) → logger
```

## Components

| Path | Responsibility |
|---|---|
| `src/app/page.tsx` | Renders `<Onboarding/>` |
| `src/components/onboarding/Onboarding.tsx` | Step orchestration (reducer in `lib/onboarding.ts`) |
| `ConsentModal`, `DressingRoom`, `GarmentGrid`, `Survey`, `ShopStep`, `TimeoutModal` | One screen each, presentational + local UI timers |
| `src/hooks/useTryOnSession.ts` | Camera, token, SDK connect, garment apply, rotation timers, teardown |
| `src/lib/garments.ts` | Garment catalog (image + prompt) |
| `src/lib/events.ts` | Shared zod schema for analytics events |
| `src/lib/analytics.ts` | Client `track()` (beacon, never throws) |
| `src/lib/server/*` | env validation, logger (redacting), rate limiter, origin check, Decart token minting |

## Session lifecycle (`useTryOnSession`)

```
idle ─start()─► camera ─granted─► token ─ok─► connecting ─remote stream─► live
  ▲                │fail              │fail          │fail                   │ 4×15 s / 180 s cap / tab hidden / error
  └──── error{stage, message} ◄───────┴──────────────┴───────────────────────┴──► ended{reason}
```

Every exit path runs one idempotent `teardown()`: stops camera tracks, disconnects the
realtime client, clears all timers. `stage` decides the user-facing message
(only `camera` blames the user's permissions).

## Data

No database in the MVP. Nothing personal is persisted server-side except analytics
log lines (survey answers are coarse: gender bucket + age range). The camera stream
goes browser → Decart over WebRTC and never touches our server.

## Path to production

| Phase | Add |
|---|---|
| Beta | Upstash/Redis rate limiter (shared across instances); Postgres `events` table (Supabase) instead of stdout; Sentry |
| Prod | Seat queue (Redis sorted set + heartbeat) to protect Decart concurrency limits; per-user quotas + auth (Supabase Auth) |
| Scale | Billing (Stripe) for paid sessions; moderation (Decart content flags) ; referral share links (object storage) |

## Cost model

Decart bills realtime GPU time per second of session. The cost levers are all
server-controlled: `maxSessionSeconds` on the token (default 180 s), token TTL (60 s),
rate limit on token minting (5/min/IP), and the client's 60 s auto-rotation that
ends the demo session. Check current per-second pricing on platform.decart.ai before launch.
