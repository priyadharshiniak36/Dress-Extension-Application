/**
 * Where to draw a garment on a person, from MediaPipe pose landmarks. Pure maths, unit-tested.
 * The garment is mapped onto a quadrilateral (shoulders → hips) instead of a single rotated rectangle, so it follows
 * body width, tilt and turning. Coordinates are in the (unmirrored) camera frame; the output <video> mirrors it.
 */
export type Landmark = { x: number; y: number; visibility?: number }; // x,y normalised 0..1
export type Pt = { x: number; y: number };
/** Corners in image order: left→right (tl/tr = shoulder line, bl/br = hem). */
export type Quad = { tl: Pt; tr: Pt; br: Pt; bl: Pt };

// MediaPipe pose indices
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;

const MIN_SHOULDER_VIS = 0.5;
const MIN_HIP_VIS = 0.35;
const MIN_ARM_VIS = 0.5;

/** Product shots include sleeves, so the garment extends this far beyond each shoulder (× shoulder width). */
const SLEEVE_OUT = 0.45;
/** Extra width at the hem relative to the hips (× hip width, each side). */
const HEM_OUT = 0.3;
/** The collar sits a little above the shoulder line (× torso length). */
const COLLAR_RISE = 0.07;
/** Hoodies and jackets hang below the hips (× torso length). */
const HEM_DROP = 0.14;
/** Estimated torso length when the hips are out of frame (× shoulder width). */
const TORSO_PER_SHOULDER = 1.5;

const vis = (l: Landmark | undefined) => l?.visibility ?? 1;
const add = (p: Pt, q: Pt): Pt => ({ x: p.x + q.x, y: p.y + q.y });
const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
const mul = (p: Pt, k: number): Pt => ({ x: p.x * k, y: p.y * k });
const len = (p: Pt) => Math.hypot(p.x, p.y);
const unit = (p: Pt): Pt => {
  const l = len(p);
  return l > 1e-9 ? mul(p, 1 / l) : { x: 0, y: 0 };
};
const px = (l: Landmark, W: number, H: number): Pt => ({ x: l.x * W, y: l.y * H });

/**
 * `aspect` = sprite height / width. Returns null when the shoulders are not reliably visible.
 * Long garments (dresses, coats) are extended down the body direction to match their photo's proportions.
 */
export function computeQuad(lm: readonly Landmark[], aspect: number, W: number, H: number): Quad | null {
  const l = lm[L_SHOULDER];
  const r = lm[R_SHOULDER];
  if (!l || !r || vis(l) < MIN_SHOULDER_VIS || vis(r) < MIN_SHOULDER_VIS || !(aspect > 0)) return null;

  // Order left→right in the image so the geometry is independent of which side the person's "left" is.
  const [sa, sb] = l.x <= r.x ? [px(l, W, H), px(r, W, H)] : [px(r, W, H), px(l, W, H)];
  const shoulderVec = sub(sb, sa);
  const sw = len(shoulderVec);
  if (sw < 8) return null;
  const u = unit(shoulderVec);
  // "Down the body", perpendicular to the shoulders (image y grows downward).
  const d: Pt = { x: -u.y, y: u.x };

  const lh = lm[L_HIP];
  const rh = lm[R_HIP];
  const hipsOk = !!lh && !!rh && vis(lh) >= MIN_HIP_VIS && vis(rh) >= MIN_HIP_VIS;

  let sideA: Pt; // shoulder → hem, left side
  let sideB: Pt;
  let hemOutA: Pt;
  let hemOutB: Pt;
  if (hipsOk) {
    const [ha, hb] = lh!.x <= rh!.x ? [px(lh!, W, H), px(rh!, W, H)] : [px(rh!, W, H), px(lh!, W, H)];
    const hipVec = sub(hb, ha);
    const hu = unit(hipVec);
    const hw = len(hipVec);
    sideA = sub(ha, sa);
    sideB = sub(hb, sb);
    // Never let a noisy hip estimate turn the garment inside out: the hem must be below the shoulders.
    if (sideA.x * d.x + sideA.y * d.y < sw * 0.4 || sideB.x * d.x + sideB.y * d.y < sw * 0.4) {
      sideA = mul(d, sw * TORSO_PER_SHOULDER);
      sideB = sideA;
      hemOutA = mul(u, -sw * SLEEVE_OUT * 0.7);
      hemOutB = mul(u, sw * SLEEVE_OUT * 0.7);
    } else {
      hemOutA = mul(hu, -Math.max(hw * HEM_OUT, sw * 0.15));
      hemOutB = mul(hu, Math.max(hw * HEM_OUT, sw * 0.15));
    }
  } else {
    sideA = mul(d, sw * TORSO_PER_SHOULDER);
    sideB = sideA;
    hemOutA = mul(u, -sw * SLEEVE_OUT * 0.7);
    hemOutB = mul(u, sw * SLEEVE_OUT * 0.7);
  }

  const torso = (len(sideA) + len(sideB)) / 2;
  const rise = mul(d, -torso * COLLAR_RISE);
  const topA = add(add(sa, mul(u, -sw * SLEEVE_OUT)), rise);
  const topB = add(add(sb, mul(u, sw * SLEEVE_OUT)), rise);

  // Garment length: at least down to the hem, longer if the photo is a long garment.
  const topW = len(sub(topB, topA));
  const naturalH = torso * (1 + COLLAR_RISE + HEM_DROP);
  const wantH = topW * aspect;
  const k = Math.max(1, wantH / naturalH); // only ever extend; never squash a short garment shorter than the torso
  const grow = (side: Pt) => mul(side, (1 + HEM_DROP) * Math.min(k, 3));

  return {
    tl: topA,
    tr: topB,
    bl: add(add(sa, grow(sideA)), hemOutA),
    br: add(add(sb, grow(sideB)), hemOutB),
  };
}

/**
 * Coaching text for the visitor, or "" when the framing is good. A garment can only be fitted if the shoulders and
 * waist are visible; a person who is too close (or off to the side) gets an oversized, misplaced garment.
 */
export function framingHint(lm: readonly Landmark[] | null): string {
  const l = lm?.[L_SHOULDER];
  const r = lm?.[R_SHOULDER];
  if (!lm || !l || !r || vis(l) < MIN_SHOULDER_VIS || vis(r) < MIN_SHOULDER_VIS) return "Step back so your shoulders and upper body are in view.";
  const lh = lm[L_HIP];
  const rh = lm[R_HIP];
  if (!lh || !rh || vis(lh) < MIN_HIP_VIS || vis(rh) < MIN_HIP_VIS) return "Step back a little so your waist is in view for a proper fit.";
  const shoulderSpan = Math.abs(l.x - r.x);
  if (shoulderSpan > 0.7) return "You're very close. Step back so the garment fits.";
  return "";
}

/** Exponential smoothing of quads, with a short hold then fade-out when tracking is lost. */
export function createQuadSmoother(opts: { alpha?: number; holdMs?: number } = {}) {
  const alpha = opts.alpha ?? 0.5;
  const holdMs = opts.holdMs ?? 500;
  let cur: Quad | null = null;
  let lastSeen = -Infinity;
  const mix = (a: Pt, b: Pt): Pt => ({ x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha });

  return {
    update(raw: Quad | null, now: number): { q: Quad; opacity: number } | null {
      if (raw) {
        lastSeen = now;
        cur = cur
          ? { tl: mix(cur.tl, raw.tl), tr: mix(cur.tr, raw.tr), br: mix(cur.br, raw.br), bl: mix(cur.bl, raw.bl) }
          : { tl: { ...raw.tl }, tr: { ...raw.tr }, br: { ...raw.br }, bl: { ...raw.bl } };
        return { q: cur, opacity: 1 };
      }
      if (!cur) return null;
      const gone = now - lastSeen;
      if (gone > holdMs * 2) {
        cur = null;
        return null;
      }
      return { q: cur, opacity: gone <= holdMs ? 1 : 1 - (gone - holdMs) / holdMs };
    },
    reset() {
      cur = null;
      lastSeen = -Infinity;
    },
  };
}

/** Point-in-convex-quad test (works for either winding). */
export function pointInQuad(p: Pt, q: Quad): boolean {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let pos = false,
    neg = false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % 4]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross > 0) pos = true;
    else if (cross < 0) neg = true;
    if (pos && neg) return false;
  }
  return true;
}

/**
 * Forearms that cross in front of the chest must be drawn over the garment. Returns one polygon (elbow → wrist,
 * widened to roughly arm thickness and extended past the wrist to cover the hand) per such arm.
 */
export function forearmPolygons(lm: readonly Landmark[], quad: Quad, W: number, H: number): Pt[][] {
  const out: Pt[][] = [];
  const shoulderW = len(sub(quad.tr, quad.tl)) / (1 + 2 * SLEEVE_OUT);
  for (const [e, w] of [
    [L_ELBOW, L_WRIST],
    [R_ELBOW, R_WRIST],
  ] as const) {
    const el = lm[e];
    const wr = lm[w];
    if (!el || !wr || vis(el) < MIN_ARM_VIS || vis(wr) < MIN_ARM_VIS) continue;
    const a = px(el, W, H),
      b = px(wr, W, H);
    if (!pointInQuad(b, quad)) continue; // wrist outside the torso: the arm hangs beside the garment, nothing to redraw
    const dir = unit(sub(b, a));
    if (len(sub(b, a)) < 4) continue;
    const n: Pt = { x: -dir.y, y: dir.x };
    const half = shoulderW * 0.2;
    const tip = add(b, mul(dir, shoulderW * 0.22)); // hand
    out.push([add(a, mul(n, half)), add(tip, mul(n, half * 0.9)), sub(tip, mul(n, half * 0.9)), sub(a, mul(n, half))]);
  }
  return out;
}
