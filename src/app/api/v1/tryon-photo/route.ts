import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/server/env";
import { logger } from "@/lib/server/logger";
import { createRateLimiter, clientIp } from "@/lib/server/rate-limit";
import { resolveAllowedOrigin } from "@/lib/server/origin";
import { apiError } from "@/lib/server/http";
import { sniffImageType } from "@/lib/server/safe-fetch";
import { generateTryOn, GeminiError } from "@/lib/server/gemini";
import { CLOTH_TYPES, CatvtonError, generateWithCatvton, type ClothType, type RawImage } from "@/lib/server/catvton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Image generation takes several seconds; the platform default for functions is too short.
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // the client downsizes to ~1024 px JPEG; Vercel bodies are capped near 4.5 MB total
const perIp = createRateLimiter({ limit: 3, windowMs: 60_000 });
const global = createRateLimiter({ limit: Number(process.env.GEMINI_DAILY_LIMIT ?? 100), windowMs: 24 * 60 * 60 * 1000 });

/** Lets the UI know whether (and which) realistic photo backend exists, without revealing anything about keys or URLs. */
export async function GET(req: Request) {
  const env = getServerEnv();
  const allowed = Boolean(resolveAllowedOrigin(req.headers, env.appOrigins)) || process.env.NODE_ENV !== "production";
  const provider = allowed ? env.tryonProvider : null;
  return NextResponse.json({ enabled: provider !== null, provider }, { headers: { "Cache-Control": "no-store" } });
}

async function readImage(form: FormData, field: string): Promise<RawImage | "too_large" | "bad_type" | null> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > MAX_IMAGE_BYTES) return "too_large";
  const bytes = new Uint8Array(await f.arrayBuffer());
  const mime = sniffImageType(bytes);
  if (!mime || mime === "image/gif") return "bad_type"; // trust the bytes, not the declared type
  return { mime, bytes };
}

const b64 = (i: RawImage) => ({ mime: i.mime, base64: Buffer.from(i.bytes).toString("base64") });
const image = (img: RawImage) =>
  new Response(Buffer.from(img.bytes), { headers: { "Content-Type": img.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function POST(req: Request) {
  const env = getServerEnv();
  if (!resolveAllowedOrigin(req.headers, env.appOrigins)) return apiError(403, "forbidden_origin", "Not allowed.");
  const provider = env.tryonProvider;
  if (!provider) return apiError(503, "not_configured", "Realistic photo try-on is not available right now.");

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

  const rawType = form.get("clothType");
  const clothType: ClothType = (CLOTH_TYPES as readonly string[]).includes(String(rawType)) ? (rawType as ClothType) : "upper";

  const started = Date.now();
  try {
    if (provider === "catvton") {
      const out = await generateWithCatvton({ url: env.catvtonUrl!, token: env.catvtonToken!, person, garment, clothType });
      logger.info("tryon_photo.ok", { provider, cloth_type: clothType, ms: Date.now() - started }); // never log image data
      return image(out);
    }
    const img = await generateTryOn({ apiKey: env.geminiApiKey!, model: env.geminiImageModel, person: b64(person), garment: b64(garment) });
    logger.info("tryon_photo.ok", { provider, model: env.geminiImageModel, ms: Date.now() - started });
    return image({ mime: img.mime, bytes: Buffer.from(img.base64, "base64") });
  } catch (err) {
    const g = err instanceof GeminiError ? err : null;
    const c = err instanceof CatvtonError ? err : null;
    logger.error("tryon_photo.failed", {
      provider,
      code: g?.code ?? c?.code ?? "unknown",
      upstream_status: g?.status ?? c?.status ?? null,
      error: g?.message ?? c?.message ?? String(err),
      ms: Date.now() - started,
    });
    if (g?.code === "quota" || c?.code === "busy") return apiError(429, "rate_limited", "Realistic photo try-on is busy or warming up. Please try again in a minute.");
    if (g?.code === "no_image" || c?.code === "rejected") return apiError(422, "not_image", "Couldn't create a picture from that photo. Try a clearer one, facing the camera.");
    return apiError(502, "upstream_failed", "Realistic photo try-on couldn't run right now. Please try again.");
  }
}
