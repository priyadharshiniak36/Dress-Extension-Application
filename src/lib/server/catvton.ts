import "server-only";
import { sniffImageType } from "@/lib/server/safe-fetch";

export const CLOTH_TYPES = ["upper", "lower", "overall"] as const;
export type ClothType = (typeof CLOTH_TYPES)[number];

export type RawImage = { mime: string; bytes: Uint8Array };

export class CatvtonError extends Error {
  constructor(
    readonly code: "busy" | "unavailable" | "rejected" | "failed",
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/**
 * Calls our self-hosted CatVTON server (tryon-server/). The bearer token never leaves the server side, and the
 * response body is only accepted if its bytes are a raster image.
 */
export async function generateWithCatvton(opts: {
  url: string;
  token: string;
  person: RawImage;
  garment: RawImage;
  clothType: ClothType;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<RawImage> {
  const { url, token, person, garment, clothType, timeoutMs = 55_000, fetchImpl = fetch } = opts;
  const form = new FormData();
  form.append("person", new File([person.bytes as BlobPart], "person", { type: person.mime }));
  form.append("garment", new File([garment.bytes as BlobPart], "garment", { type: garment.mime }));
  form.append("cloth_type", clothType);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${url}/tryon`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal: ctrl.signal });
  } catch (err) {
    throw new CatvtonError("unavailable", (err as Error)?.name === "AbortError" ? "Try-on server took too long." : "Could not reach the try-on server.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 160); // server-side logging only
    if (res.status === 503 || res.status === 429) throw new CatvtonError("busy", `Try-on server busy or still loading: ${detail}`, res.status);
    if (res.status === 401 || res.status === 403) throw new CatvtonError("failed", "Try-on server rejected our token (check CATVTON_TOKEN).", res.status);
    if (res.status >= 400 && res.status < 500) throw new CatvtonError("rejected", `Try-on server rejected the request: ${detail}`, res.status);
    throw new CatvtonError("failed", `Try-on server error ${res.status}: ${detail}`, res.status);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = sniffImageType(bytes);
  if (!mime || mime === "image/gif") throw new CatvtonError("failed", "Try-on server returned something that is not an image.", res.status);
  return { mime, bytes };
}
