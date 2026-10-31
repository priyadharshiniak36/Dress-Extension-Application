import { describe, expect, it } from "vitest";
import { removeBackground, estimateBackground, type Pixels } from "@/lib/overlay/cutout";
import { computeQuad, createQuadSmoother, pointInQuad, forearmPolygons, framingHint, type Landmark, type Quad } from "@/lib/overlay/transform";
import { affineFor, quadPoint } from "@/lib/overlay/warp";
import { meanLuminance, toneForLuminance } from "@/lib/overlay/lighting";

function canvas(w: number, h: number, bg: [number, number, number], paint: (x: number, y: number) => [number, number, number] | null): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = paint(x, y) ?? bg;
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}
const alphaAt = (p: Pixels, x: number, y: number) => p.data[(y * p.width + x) * 4 + 3];

describe("removeBackground", () => {
  it("clears a light background, keeps the garment and returns its box", () => {
    const p = canvas(40, 40, [240, 240, 240], (x, y) => (x >= 10 && x < 30 && y >= 8 && y < 36 ? [20, 40, 120] : null));
    const box = removeBackground(p);
    expect(box).toEqual({ x: 10, y: 8, w: 20, h: 28 });
    expect(alphaAt(p, 0, 0)).toBe(0);
    expect(alphaAt(p, 20, 20)).toBe(255);
  });

  it("follows a soft background gradient", () => {
    const p = canvas(60, 40, [235, 235, 235], (x, y) => {
      if (x >= 20 && x < 40 && y >= 10 && y < 30) return [30, 30, 30];
      const g = 225 + Math.round((x / 60) * 20); // 225..245 left to right
      return [g, g, g];
    });
    const box = removeBackground(p);
    expect(box).toEqual({ x: 20, y: 10, w: 20, h: 20 });
    expect(alphaAt(p, 1, 1)).toBe(0);
    expect(alphaAt(p, 58, 38)).toBe(0);
  });

  it("keeps a light-coloured patch that is enclosed by the garment (not connected to the border)", () => {
    const p = canvas(40, 40, [240, 240, 240], (x, y) => {
      if (x >= 10 && x < 30 && y >= 10 && y < 30) return x >= 18 && x < 22 && y >= 18 && y < 22 ? [245, 245, 245] : [10, 10, 10];
      return null;
    });
    removeBackground(p);
    expect(alphaAt(p, 20, 20)).toBe(255); // logo stays opaque
    expect(alphaAt(p, 2, 2)).toBe(0);
  });

  it("returns null for an image that is all background", () => {
    expect(removeBackground(canvas(10, 10, [250, 250, 250], () => null))).toBeNull();
  });

  it("estimates the background as the corner median", () => {
    const p = canvas(20, 20, [200, 210, 220], () => null);
    expect(estimateBackground(p)).toEqual([200, 210, 220]);
  });
});


const lm = (over: Record<number, Landmark>): Landmark[] => {
  const a: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [k, v] of Object.entries(over)) a[Number(k)] = v;
  return a;
};
const P = (x: number, y: number, visibility = 1): Landmark => ({ x, y, visibility });
const W = 1000,
  H = 600;
// Upright person: shoulders at y=0.3 (x 0.4..0.6), hips at y=0.7 (x 0.43..0.57)
const upright = { 11: P(0.6, 0.3), 12: P(0.4, 0.3), 23: P(0.57, 0.7), 24: P(0.43, 0.7) };

describe("computeQuad", () => {
  it("maps an upright body to a quad that spans shoulders+sleeves on top and the hips at the hem", () => {
    const q = computeQuad(lm(upright), 1.1, W, H)!;
    expect(q.tl.x).toBeLessThan(400); // sleeves extend outward past the left shoulder
    expect(q.tr.x).toBeGreaterThan(600);
    expect(q.tl.y).toBeLessThan(0.3 * H); // collar rises above the shoulder line
    expect(q.bl.y).toBeGreaterThan(0.7 * H); // hem hangs below the hips
    expect(q.tl.x).toBeLessThan(q.tr.x);
    expect(q.bl.x).toBeLessThan(q.br.x);
  });

  it("is independent of which landmark is the person's left", () => {
    const swapped = { 11: upright[12], 12: upright[11], 23: upright[24], 24: upright[23] };
    expect(computeQuad(lm(swapped), 1.1, W, H)).toEqual(computeQuad(lm(upright), 1.1, W, H));
  });

  it("follows a tilted torso: the left side of the hem moves with the left hip", () => {
    const lean = { 11: P(0.6, 0.3), 12: P(0.4, 0.3), 23: P(0.64, 0.7), 24: P(0.5, 0.7) }; // hips shifted right
    const a = computeQuad(lm(upright), 1.1, W, H)!;
    const b = computeQuad(lm(lean), 1.1, W, H)!;
    expect(b.bl.x).toBeGreaterThan(a.bl.x);
    expect(b.br.x).toBeGreaterThan(a.br.x);
  });

  it("estimates the torso from the shoulders when the hips are out of frame", () => {
    const q = computeQuad(lm({ 11: P(0.6, 0.3), 12: P(0.4, 0.3) }), 1.1, W, H)!;
    expect(q.bl.y).toBeGreaterThan(q.tl.y + 200 * 1.4); // ≥ ~1.5× shoulder width (200px) tall
  });

  it("extends long garments (dress) further down than short ones", () => {
    const short = computeQuad(lm(upright), 0.9, W, H)!;
    const long = computeQuad(lm(upright), 2.4, W, H)!;
    expect(long.bl.y).toBeGreaterThan(short.bl.y + 100);
  });

  it("never produces an inside-out garment when hips are detected above the shoulders", () => {
    const bad = { 11: P(0.6, 0.3), 12: P(0.4, 0.3), 23: P(0.57, 0.1), 24: P(0.43, 0.1) };
    const q = computeQuad(lm(bad), 1.1, W, H)!;
    expect(q.bl.y).toBeGreaterThan(q.tl.y);
    expect(q.br.y).toBeGreaterThan(q.tr.y);
  });

  it("returns null without reliable shoulders or a valid aspect", () => {
    expect(computeQuad(lm({ 11: P(0.6, 0.3, 0.2), 12: P(0.4, 0.3) }), 1, W, H)).toBeNull();
    expect(computeQuad(lm(upright), 0, W, H)).toBeNull();
    expect(computeQuad([], 1, W, H)).toBeNull();
  });
});

describe("createQuadSmoother", () => {
  const sq = (dx: number): Quad => ({ tl: { x: dx, y: 0 }, tr: { x: dx + 100, y: 0 }, br: { x: dx + 100, y: 100 }, bl: { x: dx, y: 100 } });
  it("starts at the first reading, then eases toward new ones", () => {
    const s = createQuadSmoother({ alpha: 0.5 });
    expect(s.update(sq(0), 0)!.q.tl.x).toBe(0);
    expect(s.update(sq(100), 33)!.q.tl.x).toBe(50);
  });
  it("holds, fades, then drops the garment when tracking is lost", () => {
    const s = createQuadSmoother({ holdMs: 500 });
    s.update(sq(0), 0);
    expect(s.update(null, 300)).toMatchObject({ opacity: 1 });
    const fading = s.update(null, 750)!;
    expect(fading.opacity).toBeGreaterThan(0);
    expect(fading.opacity).toBeLessThan(1);
    expect(s.update(null, 1200)).toBeNull();
  });
  it("returns null before anything was ever detected", () => {
    expect(createQuadSmoother().update(null, 0)).toBeNull();
  });
});

describe("pointInQuad / forearmPolygons", () => {
  const box: Quad = { tl: { x: 100, y: 100 }, tr: { x: 300, y: 100 }, br: { x: 300, y: 400 }, bl: { x: 100, y: 400 } };
  it("tests containment", () => {
    expect(pointInQuad({ x: 200, y: 200 }, box)).toBe(true);
    expect(pointInQuad({ x: 50, y: 200 }, box)).toBe(false);
    expect(pointInQuad({ x: 200, y: 450 }, box)).toBe(false);
  });
  it("redraws only forearms whose wrist is over the garment", () => {
    // 1000x600 frame; garment box above spans x 100..300, y 100..400 → normalised 0.1..0.3 / 0.167..0.667
    const crossing = lm({ 13: P(0.35, 0.5), 15: P(0.2, 0.45) }); // left elbow outside, wrist inside the box
    const hanging = lm({ 14: P(0.4, 0.5), 16: P(0.45, 0.65) }); // wrist outside
    expect(forearmPolygons(crossing, box, W, H)).toHaveLength(1);
    expect(forearmPolygons(crossing, box, W, H)[0]).toHaveLength(4);
    expect(forearmPolygons(hanging, box, W, H)).toHaveLength(0);
  });
  it("ignores low-visibility arms", () => {
    expect(forearmPolygons(lm({ 13: P(0.35, 0.5, 0.1), 15: P(0.2, 0.45, 0.1) }), box, W, H)).toHaveLength(0);
  });
});

describe("mesh warp maths", () => {
  it("affineFor maps the source triangle exactly onto the destination triangle", () => {
    const s = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 }];
    const d = [{ x: 5, y: 5 }, { x: 25, y: 10 }, { x: 0, y: 45 }];
    const m = affineFor(s[0]!, s[1]!, s[2]!, d[0]!, d[1]!, d[2]!)!;
    s.forEach((p, i) => {
      expect(m[0] * p.x + m[2] * p.y + m[4]).toBeCloseTo(d[i]!.x, 6);
      expect(m[1] * p.x + m[3] * p.y + m[5]).toBeCloseTo(d[i]!.y, 6);
    });
  });
  it("affineFor rejects a degenerate source triangle", () => {
    expect(affineFor({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeNull();
  });
  it("quadPoint interpolates corners and centre", () => {
    const q: Quad = { tl: { x: 0, y: 0 }, tr: { x: 100, y: 0 }, br: { x: 120, y: 200 }, bl: { x: -20, y: 200 } };
    expect(quadPoint(q, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(quadPoint(q, 1, 1)).toEqual({ x: 120, y: 200 });
    expect(quadPoint(q, 0.5, 0.5)).toEqual({ x: 50, y: 100 });
  });
});

describe("lighting", () => {
  it("measures luminance", () => {
    expect(meanLuminance(Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(0.5, 2);
    expect(meanLuminance(new Uint8ClampedArray())).toBe(0.5);
  });
  it("darkens in dim rooms, lifts slightly in bright ones, and is clamped", () => {
    expect(toneForLuminance(0.1)).toBeLessThan(0.75);
    expect(toneForLuminance(0.9)).toBe(1.12);
    expect(toneForLuminance(0)).toBe(0.7);
    expect(toneForLuminance(0.5)).toBeGreaterThan(0.9);
    expect(toneForLuminance(0.5)).toBeLessThan(1.05);
  });
});

describe("framingHint", () => {
  const body = (hipVis: number, shoulderX: [number, number] = [0.4, 0.6]) =>
    lm({ 11: P(shoulderX[1], 0.3), 12: P(shoulderX[0], 0.3), 23: P(0.57, 0.7, hipVis), 24: P(0.43, 0.7, hipVis) });
  it("is empty when shoulders and waist are visible", () => {
    expect(framingHint(body(1))).toBe("");
  });
  it("asks the visitor to step back when no body, no shoulders or no waist is visible", () => {
    expect(framingHint(null)).toMatch(/step back/i);
    expect(framingHint([])).toMatch(/step back/i);
    expect(framingHint(body(0.1))).toMatch(/waist/i);
  });
  it("warns when the shoulders fill most of the frame width", () => {
    expect(framingHint(body(1, [0.1, 0.9]))).toMatch(/close/i);
  });
});
