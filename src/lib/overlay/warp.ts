import type { Pt, Quad } from "./transform";

export type Affine = [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * The 2D affine transform (canvas `transform(a,b,c,d,e,f)` order) that maps source triangle s0,s1,s2 onto d0,d1,d2.
 * Returns null for a degenerate (zero-area) source triangle.
 */
export function affineFor(s0: Pt, s1: Pt, s2: Pt, d0: Pt, d1: Pt, d2: Pt): Affine | null {
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(det) < 1e-9) return null;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
  return [a, b, c, d, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - d * s0.y];
}

/** Bilinear point inside the quad for u,v in 0..1 (u across, v down). */
export function quadPoint(q: Quad, u: number, v: number): Pt {
  const top = { x: q.tl.x + (q.tr.x - q.tl.x) * u, y: q.tl.y + (q.tr.y - q.tl.y) * u };
  const bot = { x: q.bl.x + (q.br.x - q.bl.x) * u, y: q.bl.y + (q.br.y - q.bl.y) * u };
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
}

/** Pushes a triangle's corners slightly away from its centre so neighbouring triangles overlap (no hairline seams). */
function grow(a: Pt, b: Pt, c: Pt, by: number): [Pt, Pt, Pt] {
  const cx = (a.x + b.x + c.x) / 3,
    cy = (a.y + b.y + c.y) / 3;
  const g = (p: Pt): Pt => {
    const dx = p.x - cx,
      dy = p.y - cy,
      l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * by, y: p.y + (dy / l) * by };
  };
  return [g(a), g(b), g(c)];
}

/** Draws `img` stretched onto the quad as a grid of affine-mapped triangles (a cheap mesh warp). */
export function drawWarped(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, q: Quad, nx = 4, ny = 6) {
  const W = img.width,
    H = img.height;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const u0 = i / nx,
        u1 = (i + 1) / nx,
        v0 = j / ny,
        v1 = (j + 1) / ny;
      const s = [
        { x: u0 * W, y: v0 * H },
        { x: u1 * W, y: v0 * H },
        { x: u1 * W, y: v1 * H },
        { x: u0 * W, y: v1 * H },
      ];
      const d = [quadPoint(q, u0, v0), quadPoint(q, u1, v0), quadPoint(q, u1, v1), quadPoint(q, u0, v1)];
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3],
      ] as const) {
        const [i0, i1, i2] = tri;
        const m = affineFor(s[i0]!, s[i1]!, s[i2]!, d[i0]!, d[i1]!, d[i2]!);
        if (!m) continue;
        const [c0, c1, c2] = grow(d[i0]!, d[i1]!, d[i2]!, 0.6);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(c0.x, c0.y);
        ctx.lineTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.closePath();
        ctx.clip();
        ctx.transform(...m);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      }
    }
  }
}
