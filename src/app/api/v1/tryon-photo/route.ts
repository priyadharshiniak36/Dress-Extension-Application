import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/server/env";
import { logger } from "@/lib/server/logger";
import { createRateLimiter, clientIp } from "@/lib/server/rate-limit";
import { resolveAllowedOrigin } from "@/lib/server/origin";
import { apiError } from "@/lib/server/http";
import { sniffImageType } from "@/lib/server/safe-fetch";
import { generateTryOn, GeminiError } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Image generation takes several seconds; the platform default for functions is too short.
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // the client downsizes to ~1024 px JPEG; Vercel bodies are capped near 4.5 MB total
const perIp = createRateLimiter({ limit: 3, windowMs: 60_000 });
const global = createRateLimiter({ limit: Number(process.env.GEMINI_DAILY_LIMIT ?? 100), windowMs: 24 * 60 * 60 * 1000 });

/** Lets the UI know whether to show the "realistic photo" button, without revealing anything about the key. */
export async function GET(req: Request) {
  const env = getServerEnv();
  if (!resolveAllowedOrigin(req.headers, env.appOrigins) && process.env.NODE_ENV === "production") {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ enabled: Boolean(env.geminiApiKey) }, { headers: { "Cache-Control": "no-store" } });
}

async function readImage(form: FormData, field: string): Promise<{ mime: string; base64: string } | "too_large" | "bad_type" | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_IMAGE_BYTES) return "too_large";
  const bytes = new Uint8Array(await f.arrayBuffer());
  const mime = sniffImageType(bytes);
  if (!mime || mime === "image/gif") return "bad_type"; // trust the bytes, not the declared type
  return { mime, base64: Buffer.from(bytes).toString("base64") };
}

export async function POST(req: Request) {
  const env = getServerEnv();
  if (!resolveAllowedOrigin(req.headers, env.appOrigins)) return apiError(403, "forbidden_origin", "Not allowed.");
  if (!env.geminiApiKey) return apiError(503, "not_configured", "Realistic photo try-on is not available right now.");

  const rl = perIp(clientIp(req.headers));
  if (!rl.ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a minute.", { "Retry-After": String(rl.retryAfterSeconds) });
  // Daily spend guard (best-effort: per server instance).
  if (!global("all").ok) return apiError(429, "rate_limited", "Realistic photo try-on is busy today. Please try again tomorrow.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(400, "invalid_body", "Send a multipart form with `person` and `garment` images.");
  }
  const person = await readImage(form, "person");
  const garment = await readImage(form, "garment");
  if (person === "too_large" || garment === "too_large") return apiError(413, "payload_too_large", "Image is too large.");
  if (person === "bad_type" || garment === "bad_type") return apiError(415, "not_image", "Use JPEG, PNG or WebP images.");
  if (!person || !garment) return apiError(400, "invalid_body", "Send a multipart form with `person` and `garment` images.");

  const started = Date.now();
  try {
    const img = await generateTryOn({ apiKey: env.geminiApiKey, model: env.geminiImageModel, person, garment });
    logger.info("tryon_photo.ok", { model: env.geminiImageModel, ms: Date.now() - started }); // never log image data
    return new Response(Buffer.from(img.base64, "base64"), {
      headers: { "Content-Type": img.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    const e = err instanceof GeminiError ? err : null;
    logger.error("tryon_photo.failed", { code: e?.code ?? "unknown", upstream_status: e?.status ?? null, error: e?.message ?? String(err), ms: Date.now() - started });
    if (e?.code === "quota") return apiError(429, "rate_limited", "Realistic photo try-on is busy. Please try again later.");
    if (e?.code === "no_image") return apiError(422, "not_image", "Couldn't create a picture from that photo. Try a clearer one, facing the camera.");
    return apiError(502, "upstream_failed", "Realistic photo try-on couldn't run right now. Please try again.");
  }
}
