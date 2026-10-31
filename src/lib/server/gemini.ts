import "server-only";

export type InlineImage = { mime: string; base64: string };

/** Fixed instruction: no user-supplied text ever reaches the model. */
export const TRYON_PROMPT =
  "The first image is a photo of a person. The second image is a garment. Edit the first image so the person is wearing the garment " +
  "from the second image instead of their current top. Keep the person's face, hair, skin tone, body pose, the background and the " +
  "lighting exactly the same. The garment must fit their body naturally, with realistic folds and sleeves that follow their arms. " +
  "Return only the edited photo.";

/** Request body for POST https://generativelanguage.googleapis.com/v1beta/interactions (image editing, text + images). */
export function buildTryOnRequest(model: string, person: InlineImage, garment: InlineImage) {
  return {
    model,
    input: [
      { type: "text", text: TRYON_PROMPT },
      { type: "image", mime_type: person.mime, data: person.base64 },
      { type: "image", mime_type: garment.mime, data: garment.base64 },
    ],
  };
}

type Found = { mime: string; base64: string };

/**
 * Finds the generated image in a response. The API has used several shapes (interaction steps, an `output_image`
 * convenience field, classic `inlineData` parts), so search for any image-like node instead of trusting one path.
 */
export function extractImage(json: unknown, depth = 0): Found | null {
  if (!json || typeof json !== "object" || depth > 8) return null;
  const o = json as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

  if (o.type === "image" && str(o.data)) return { mime: str(o.mime_type) ?? str(o.mimeType) ?? "image/png", base64: o.data as string };
  const inline = (o.inlineData ?? o.inline_data) as Record<string, unknown> | undefined;
  if (inline && str(inline.data)) return { mime: str(inline.mimeType) ?? str(inline.mime_type) ?? "image/png", base64: inline.data as string };
  const out = o.output_image as Record<string, unknown> | undefined;
  if (out && str(out.data)) return { mime: str(out.mime_type) ?? str(out.mimeType) ?? "image/png", base64: out.data as string };

  for (const v of Array.isArray(json) ? json : Object.values(o)) {
    const hit = extractImage(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export class GeminiError extends Error {
  constructor(
    readonly code: "not_configured" | "upstream_failed" | "no_image" | "blocked" | "quota",
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/** Calls Gemini. The API key never leaves the server and is never logged. */
export async function generateTryOn(opts: {
  apiKey: string;
  model: string;
  person: InlineImage;
  garment: InlineImage;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<Found> {
  const { apiKey, model, person, garment, timeoutMs = 50_000, fetchImpl = fetch } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(buildTryOnRequest(model, person, garment)),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new GeminiError("upstream_failed", (err as Error)?.name === "AbortError" ? "Gemini took too long." : "Could not reach Gemini.");
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    // Logged server-side only (the route never returns it to visitors). Google's error text doesn't contain the key.
    const msg = String((json as { error?: { message?: unknown } } | null)?.error?.message ?? text).slice(0, 200);
    if (res.status === 429 || /quota|rate/i.test(msg)) throw new GeminiError("quota", "Gemini quota reached.", res.status);
    // Billing not enabled / free tier has no image output → 403/400 with a readable message in `msg`.
    throw new GeminiError("upstream_failed", msg || `Gemini answered ${res.status}.`, res.status);
  }
  const img = extractImage(json);
  if (!img) {
    // A safety block or a text-only answer: report it without echoing model text back to visitors.
    throw new GeminiError("no_image", "Gemini returned no image (the photo may have been blocked by its safety filters).", res.status);
  }
  return img;
}
