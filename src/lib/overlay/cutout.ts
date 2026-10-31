/**
 * Turns a product photo (garment on a plain light background) into a sprite: the background connected to
 * the image border is made transparent and the result is cropped to the garment. Pure (no DOM) so it is
 * unit-testable; the caller supplies RGBA pixels.
 */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };
export type Box = { x: number; y: number; w: number; h: number };

const TOLERANCE = 46; // max RGB distance from the estimated background colour
const SMOOTH_STEP = 28; // max difference between neighbouring pixels while flooding (follows soft gradients)

function corner(p: Pixels, cx: number, cy: number, size: number): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = cy; y < Math.min(p.height, cy + size); y++)
    for (let x = cx; x < Math.min(p.width, cx + size); x++) {
      const i = (y * p.width + x) * 4;
      r += p.data[i]!;
      g += p.data[i + 1]!;
      b += p.data[i + 2]!;
      n++;
    }
  return n ? [r / n, g / n, b / n] : [255, 255, 255];
}

/** Background colour = the median of the four corner patches (robust to one corner being covered by the garment). */
export function estimateBackground(p: Pixels): [number, number, number] {
  const s = Math.max(2, Math.floor(Math.min(p.width, p.height) * 0.04));
  const cs = [corner(p, 0, 0, s), corner(p, p.width - s, 0, s), corner(p, 0, p.height - s, s), corner(p, p.width - s, p.height - s, s)];
  const med = (k: 0 | 1 | 2) => cs.map((c) => c[k]).sort((a, b) => a - b)[1]!;
  return [med(0), med(1), med(2)];
}

/** Clears background pixels in place (alpha=0) and returns the bounding box of what remains, or null if nothing does. */
export function removeBackground(p: Pixels): Box | null {
  const { data, width: W, height: H } = p;
  const [br, bg, bb] = estimateBackground(p);
  const seen = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0,
    tail = 0;

  const dist = (i: number) => Math.hypot(data[i]! - br, data[i + 1]! - bg, data[i + 2]! - bb);
  const push = (x: number, y: number, from: number) => {
    const k = y * W + x;
    if (seen[k]) return;
    const i = k * 4;
    if (data[i + 3]! < 16) {
      seen[k] = 1;
      queue[tail++] = k;
      return;
    }
    if (dist(i) > TOLERANCE) return;
    if (from >= 0 && Math.hypot(data[i]! - data[from]!, data[i + 1]! - data[from + 1]!, data[i + 2]! - data[from + 2]!) > SMOOTH_STEP) return;
    seen[k] = 1;
    queue[tail++] = k;
  };

  for (let x = 0; x < W; x++) {
    push(x, 0, -1);
    push(x, H - 1, -1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y, -1);
    push(W - 1, y, -1);
  }
  while (head < tail) {
    const k = queue[head++]!;
    const x = k % W;
    const y = (k - x) / W;
    const from = k * 4;
    if (x > 0) push(x - 1, y, from);
    if (x < W - 1) push(x + 1, y, from);
    if (y > 0) push(x, y - 1, from);
    if (y < H - 1) push(x, y + 1, from);
  }

  let minX = W,
    minY = H,
    maxX = -1,
    maxY = -1;
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    if (seen[k]) {
      data[i + 3] = 0;
      continue;
    }
    if (data[i + 3]! < 16) continue;
    const x = k % W;
    const y = (k - x) / W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
