import "server-only";

/**
 * Same-origin gate for browser-only endpoints. Uses Origin, falling back to Referer.
 * This blocks other websites from minting tokens through a visitor's browser; it is
 * NOT authentication (a script can forge headers), which is why rate limits and
 * token session caps also apply.
 *
 * Returns the verified origin (used to scope the Decart token), or null.
 * - Any origin listed in APP_ORIGINS is accepted.
 * - In development only, an origin equal to the request's own host is also accepted, so the
 *   same dev server works from the laptop (https://localhost:3000), a phone on the LAN
 *   (https://192.168.x.x:3000) or a tunnel URL without editing .env each time.
 */
export function resolveAllowedOrigin(
  headers: Headers,
  allowed: string[],
  isDev: boolean = process.env.NODE_ENV !== "production",
): string | null {
  const origin = (headers.get("origin") ?? refererOrigin(headers.get("referer")))?.replace(/\/$/, "");
  if (!origin) return null;
  if (allowed.includes(origin)) return origin;
  if (isDev) {
    const host = headers.get("x-forwarded-host") ?? headers.get("host");
    try {
      if (host && new URL(origin).host === host) return origin;
    } catch {
      return null;
    }
  }
  return null;
}

export function isAllowedOrigin(headers: Headers, allowed: string[], isDev = false): boolean {
  return resolveAllowedOrigin(headers, allowed, isDev) !== null;
}

function refererOrigin(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
