/** Client-side helpers for turning a file, a dropped image, a pasted link or a camera shot into a garment. */

export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1024;

export class GarmentImageError extends Error {}

/** Downscale to ≤1024px and flatten onto white (transparent PNGs otherwise turn black as JPEG). */
export async function normalizeImage(input: Blob): Promise<Blob> {
  if (input.size > MAX_INPUT_BYTES) throw new GarmentImageError("That image is too large (15 MB max).");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input, { imageOrientation: "from-image" });
  } catch {
    throw new GarmentImageError("We couldn't read that image. Try a JPEG, PNG or WebP.");
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new GarmentImageError("Your browser can't process images.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!out) throw new GarmentImageError("We couldn't process that image.");
    return out;
  } finally {
    bitmap.close();
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new GarmentImageError("Unsupported image data.");
  const type = m[1] ?? "application/octet-stream";
  const raw = m[2] ? atob(m[3]!) : decodeURIComponent(m[3]!);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Loads an image URL: data: locally, same-origin directly, everything else through the server proxy. */
export async function loadImageUrl(rawUrl: string): Promise<Blob> {
  const url = rawUrl.trim();
  if (url.startsWith("data:image/")) return dataUrlToBlob(url);
  let parsed: URL;
  try {
    parsed = new URL(url, location.href);
  } catch {
    throw new GarmentImageError("That doesn't look like a link.");
  }
  if (parsed.origin === location.origin) {
    const res = await fetch(parsed.href);
    if (!res.ok) throw new GarmentImageError("Couldn't load that image.");
    return res.blob();
  }
  if (parsed.protocol === "http:") parsed.protocol = "https:"; // many shops still emit http image URLs
  if (parsed.protocol !== "https:") throw new GarmentImageError("Only image links (https) are supported.");
  const res = await fetch("/api/v1/garment-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: parsed.href }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new GarmentImageError(e?.error?.message ?? "Couldn't load that image.");
  }
  return res.blob();
}

export type Dropped = { file: File } | { url: string } | null;

/** Picks the best source from a drag/drop or paste payload: a real file, else the <img> in dragged HTML, else a URL. */
export function extractFromTransfer(dt: DataTransfer | null): Dropped {
  if (!dt) return null;
  const file = Array.from(dt.files).find((f) => f.type.startsWith("image/"));
  if (file) return { file };
  const item = Array.from(dt.items ?? []).find((i) => i.kind === "file" && i.type.startsWith("image/"));
  const itemFile = item?.getAsFile();
  if (itemFile) return { file: itemFile };

  const html = dt.getData("text/html");
  if (html) {
    const src = new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src");
    if (src) return { url: src };
  }
  const uri = dt.getData("text/uri-list").split(/\r?\n/).find((l) => l && !l.startsWith("#"));
  if (uri) return { url: uri };
  const text = dt.getData("text/plain").trim();
  if (/^(https?:|data:image\/)/i.test(text)) return { url: text };
  return null;
}
