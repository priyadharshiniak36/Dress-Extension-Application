import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Decart realtime: signaling over wss://api.decart.ai, then the video itself over LiveKit (WebRTC). The LiveKit
// host is returned by Decart at connect time, so it must be allowed or the session dies right after the token
// is minted ("Stale connect attempt"). If your browser console shows
//   "Refused to connect to 'wss://<host>' because it violates the Content Security Policy"
// add that host (space-separated) to the CSP_CONNECT_EXTRA environment variable and redeploy.
const extraConnect = (process.env.CSP_CONNECT_EXTRA ?? "")
  .split(/\s+/)
  .filter((h) => /^(https|wss):\/\/[a-zA-Z0-9.*-]+(:\d+)?$/.test(h));

const csp = [
  "default-src 'self'",
  // TODO(prod): replace 'unsafe-inline' with per-request nonces.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  ["connect-src 'self' https://*.decart.ai wss://*.decart.ai https://*.livekit.cloud wss://*.livekit.cloud", ...extraConnect].join(" "),
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
