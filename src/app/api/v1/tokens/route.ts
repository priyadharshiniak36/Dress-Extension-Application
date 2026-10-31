import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/server/env";
import { logger, errorMessage, redact } from "@/lib/server/logger";
import { createRateLimiter, clientIp } from "@/lib/server/rate-limit";
import { resolveAllowedOrigin } from "@/lib/server/origin";
import { mintClientToken, UpstreamError } from "@/lib/server/decart-token";
import { apiError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every token is a door to billed GPU time, so this is the tightest limit in the app.
const limit = createRateLimiter({ limit: 5, windowMs: 60_000 });

export async function POST(req: Request) {
  const started = Date.now();
  const env = getServerEnv();

  const origin = resolveAllowedOrigin(req.headers, env.appOrigins);
  if (!origin) {
    logger.warn("tokens.forbidden_origin", { origin: req.headers.get("origin") });
    return apiError(403, "forbidden_origin", "Not allowed.");
  }

  const ip = clientIp(req.headers);
  const rl = limit(ip);
  if (!rl.ok) {
    logger.warn("tokens.rate_limited", { ip });
    return apiError(429, "rate_limited", "Too many attempts. Please wait a moment.", {
      "Retry-After": String(rl.retryAfterSeconds),
    });
  }

  if (!env.decartApiKey) {
    logger.error("tokens.not_configured");
    return apiError(503, "not_configured", "Try-on is not available right now.");
  }

  try {
    // Scope the token to the one origin that asked for it (least privilege; Decart checks the WebSocket Origin).
    const token = await mintClientToken(env, origin);
    logger.info("tokens.minted", { model: token.model, ttl_s: env.tokenTtlSeconds, ms: Date.now() - started });
    return NextResponse.json(token, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : null;
    logger.error("tokens.upstream_failed", { upstream_status: status, error: errorMessage(err), ms: Date.now() - started });
    // In development only, surface the (key-redacted) upstream reason so misconfiguration is obvious.
    const detail = process.env.NODE_ENV !== "production" ? String(redact(errorMessage(err))) : undefined;
    return apiError(502, "upstream_failed", "Our try-on servers couldn't start your session. Please try again.", undefined, {
      upstreamStatus: status,
      ...(detail ? { detail } : {}),
    });
  }
}
