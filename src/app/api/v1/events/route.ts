import { eventSchema } from "@/lib/events";
import { logger } from "@/lib/server/logger";
import { createRateLimiter, clientIp } from "@/lib/server/rate-limit";
import { apiError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4096;
const limit = createRateLimiter({ limit: 60, windowMs: 60_000 });

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (!limit(ip).ok) return apiError(429, "rate_limited", "Too many events.");

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return apiError(413, "payload_too_large", "Event too large.");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return apiError(400, "invalid_body", "Invalid JSON.");
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return apiError(400, "invalid_body", "Invalid event.");

  // MVP sink: structured log line (queryable in Vercel logs). Phase 2: insert into Postgres.
  logger.info("analytics.event", {
    event: parsed.data.event,
    session_id: parsed.data.sessionId ?? null,
    occurred_at: parsed.data.occurredAt ?? null,
    props: parsed.data.properties ?? {},
  });
  return new Response(null, { status: 204 });
}
