import { z } from "zod";
import { getServerEnv } from "@/lib/server/env";
import { logger } from "@/lib/server/logger";
import { createRateLimiter, clientIp } from "@/lib/server/rate-limit";
import { resolveAllowedOrigin } from "@/lib/server/origin";
import { apiError } from "@/lib/server/http";
import { fetchPublicImage, SafeFetchError } from "@/lib/server/safe-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limit = createRateLimiter({ limit: 20, windowMs: 60_000 });
const body = z.object({ url: z.string().url().max(2048) });

/**
 * Lets the browser load a garment image dragged/pasted from another website. Browsers can't read
 * cross-origin pixels (CORS), so we fetch it server-side. Same-origin gated, rate limited, https-only,
 * SSRF-guarded and size/type limited; see safe-fetch.ts.
 */
export async function POST(req: Request) {
  const env = getServerEnv();
  if (!resolveAllowedOrigin(req.headers, env.appOrigins)) return apiError(403, "forbidden_origin", "Not allowed.");

  const rl = limit(clientIp(req.headers));
  if (!rl.ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a moment.", { "Retry-After": String(rl.retryAfterSeconds) });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "invalid_body", "Send a JSON body with an image url.");

  try {
    const { bytes, contentType } = await fetchPublicImage(parsed.data.url);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      const status = err.code === "blocked_host" || err.code === "invalid_url" ? 400 : err.code === "too_large" ? 413 : err.code === "not_image" ? 415 : 502;
      logger.warn("garment_image.rejected", { code: err.code });
      return apiError(status, err.code, err.message);
    }
    logger.error("garment_image.failed", { error: err instanceof Error ? err.message : String(err) });
    return apiError(502, "fetch_failed", "Could not load that image.");
  }
}
