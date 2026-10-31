import { ImageResponse } from "next/og";

export const dynamic = "force-static";

const SIZES: Record<string, { px: number; maskable: boolean }> = {
  "192": { px: 192, maskable: false },
  "512": { px: 512, maskable: false },
  "maskable-512": { px: 512, maskable: true },
  "apple-180": { px: 180, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

/** App icons rendered at build time: lime slash on near-black (matches the "Try/anything" wordmark). */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await params).size];
  if (!spec) return new Response("Not found", { status: 404 });
  const { px, maskable } = spec;
  // Maskable icons keep the glyph inside the central 80% safe zone.
  const glyph = Math.round(px * (maskable ? 0.5 : 0.62));
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0b0d", borderRadius: maskable ? 0 : px * 0.22 }}>
        <div style={{ color: "#c6ff3d", fontSize: glyph, fontWeight: 800, lineHeight: 1, display: "flex" }}>/</div>
      </div>
    ),
    { width: px, height: px },
  );
}
