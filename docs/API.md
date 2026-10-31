# API

## `POST /api/v1/tokens`
Mints a short-lived Decart client token for one realtime session.

Request: no body. Must be same-origin (Origin or Referer in `APP_ORIGINS`).

`200`
```json
{ "apiKey": "ek_…", "expiresAt": "2026-10-29T10:00:00.000Z", "model": "lucy-vton-latest", "maxSessionSeconds": 180 }
```

Errors (body `{ "error": { "code": string, "message": string } }`):

| Status | code | When |
|---|---|---|
| 403 | `forbidden_origin` | Origin not allowed |
| 429 | `rate_limited` | > 5/min/IP (`Retry-After` header set) |
| 503 | `not_configured` | `DECART_API_KEY` missing |
| 502 | `upstream_failed` | Decart mint failed or timed out |

## `POST /api/v1/events`
Analytics sink. Always answers `204` on accepted input so beacons never retry-storm.

```json
{ "event": "tryon_started", "sessionId": "s_…", "properties": { "garmentId": "hoodie" } }
```
`event` must be one of `EVENT_NAMES` in `src/lib/events.ts`; `properties` values are
string/number/boolean/null, ≤ 20 keys, strings ≤ 200 chars.

| Status | When |
|---|---|
| 204 | accepted |
| 400 | invalid body |
| 413 | body > 4 KB |
| 429 | > 60/min/IP |
