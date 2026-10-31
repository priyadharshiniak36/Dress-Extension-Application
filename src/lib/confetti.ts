"use client";

/** Three-burst celebration used at each stage completion (same choreography as the original). */
export async function celebrate() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const { default: confetti } = await import("canvas-confetti");
    const zIndex = 2_147_483_000;
    const colors = ["#c6ff3d", "#ffffff", "#8a7bff"];
    void confetti({ particleCount: 90, spread: 75, origin: { y: 0.7 }, zIndex, colors });
    setTimeout(() => void confetti({ particleCount: 55, angle: 60, spread: 55, origin: { x: 0, y: 0.8 }, zIndex, colors }), 150);
    setTimeout(() => void confetti({ particleCount: 55, angle: 120, spread: 55, origin: { x: 1, y: 0.8 }, zIndex, colors }), 300);
  } catch {
    /* decorative only */
  }
}
