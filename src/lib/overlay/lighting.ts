/** Mean Rec.709 luminance (0..1) of RGBA pixels. */
export function meanLuminance(data: Uint8ClampedArray): number {
  const n = data.length / 4;
  if (!n) return 0.5;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  return sum / n / 255;
}

/**
 * Garment brightness multiplier for a given scene luminance: a dim room darkens the (studio-lit) product photo and a
 * bright one lifts it slightly, so it doesn't look pasted on. 1 = unchanged.
 */
export function toneForLuminance(lum: number): number {
  return Math.min(1.12, Math.max(0.7, 0.62 + 0.7 * lum));
}

/** Returns a copy of `sprite` with brightness `tone` baked in (no `ctx.filter`, which older iOS Safari lacks). */
export function tintSprite(sprite: HTMLCanvasElement, tone: number, into?: HTMLCanvasElement): HTMLCanvasElement {
  const out = into ?? document.createElement("canvas");
  out.width = sprite.width;
  out.height = sprite.height;
  const ctx = out.getContext("2d")!;
  ctx.clearRect(0, 0, out.width, out.height);
  ctx.drawImage(sprite, 0, 0);
  if (Math.abs(tone - 1) > 0.01) {
    ctx.globalCompositeOperation = "source-atop"; // only touches opaque garment pixels
    ctx.fillStyle = tone < 1 ? "#000" : "#fff";
    ctx.globalAlpha = tone < 1 ? 1 - tone : (tone - 1) * 0.8;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  return out;
}
