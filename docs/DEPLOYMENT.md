# Deployment (Vercel)

1. Push the repo to GitHub and import it in Vercel (framework: Next.js).
2. Set environment variables per environment (Preview and Production separately —
   use a separate Decart key per environment):
   - `DECART_API_KEY` (secret)
   - `APP_ORIGINS` e.g. `https://tryanything.app` (Preview: the preview domain)
   - optional: `DECART_MODEL`, `DECART_SCOPE_TOKEN_TO_MODEL`, `DECART_TOKEN_TTL_SECONDS`,
     `DECART_MAX_SESSION_SECONDS`, `NEXT_PUBLIC_TERMS_URL`, `NEXT_PUBLIC_PRIVACY_URL`, `NEXT_PUBLIC_AUP_URL`
3. HTTPS is required for `getUserMedia` on phones (Vercel provides it).
4. Smoke test on a real phone: consent → countdown → live video → garment switch → timeout modal.

## Pre-launch checklist
- [ ] Upstash rate limiter replaces in-memory limiter
- [ ] Events go to Postgres, not just logs
- [ ] CSP with nonces
- [ ] Real ToS / Privacy / AUP pages
- [ ] Decart spend alert configured on platform.decart.ai
- [ ] Rollback: Vercel "Promote previous deployment"
