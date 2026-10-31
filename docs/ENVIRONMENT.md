# Environment variables

| Name | Scope | Required | Default | Purpose |
|---|---|---|---|---|
| `DECART_API_KEY` | server secret | yes | — | Permanent Decart key, used only to mint client tokens |
| `APP_ORIGINS` | server | yes in prod | `http://localhost:3000` | Comma-separated allowed origins for token minting and token `allowedOrigins` |
| `DECART_MODEL` | server | no | `lucy-vton-latest` | Realtime try-on model slug returned to the client |
| `DECART_SCOPE_TOKEN_TO_MODEL` | server | no | `false` | When `true`, token `allowedModels=[DECART_MODEL]`. Turn on once you've confirmed the slug is accepted by your account |
| `DECART_TOKEN_TTL_SECONDS` | server | no | `60` | Client token TTL (1–3600) |
| `DECART_MAX_SESSION_SECONDS` | server | no | `180` | Hard cap per realtime session (≥ 10) |
| `NEXT_PUBLIC_TERMS_URL` | public | no | `/legal/terms` | Consent link |
| `NEXT_PUBLIC_PRIVACY_URL` | public | no | `/legal/privacy` | Consent link |
| `NEXT_PUBLIC_AUP_URL` | public | no | `/legal/aup` | Consent link |

Only `NEXT_PUBLIC_*` values reach the browser.
