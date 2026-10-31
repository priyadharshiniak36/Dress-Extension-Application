import type { Garment } from "@/lib/garments";
import { removeBackground } from "./cutout";

export type Sprite = { canvas: HTMLCanvasElement; aspect: number };

const MAX_EDGE = 640;
const cache = new Map<string, Promise<Sprite>>();

async function blobFor(g: Garment): Promise<Blob> {
  if (g.custom) return g.custom.blob;
  const res = await fetch(g.image);
  if (!res.ok) throw new Error(`garment image ${res.status}`);
  return res.blob();
}

/** Garment photo → background-free, cropped sprite. Cached per garment id. */
export function loadSprite(g: Garment): Promise<Sprite> {
  let hit = cache.get(g.id);
  if (!hit) {
    hit = (async () => {
      const bmp = await createImageBitmap(await blobFor(g));
      try {
        const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k)),
          h = Math.max(1, Math.round(bmp.height * k));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const box = removeBackground(img);
        ctx.putImageData(img, 0, 0);
        const b = box ?? { x: 0, y: 0, w, h };
        const out = document.createElement("canvas");
        out.width = b.w;
        out.height = b.h;
        out.getContext("2d")!.drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        return { canvas: out, aspect: b.h / b.w };
      } finally {
        bmp.close();
      }
    })();
    cache.set(g.id, hit);
    hit.catch(() => cache.delete(g.id));
  }
  return hit;
}
