import "server-only";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

export class SafeFetchError extends Error {
  constructor(
    readonly code: "invalid_url" | "blocked_host" | "fetch_failed" | "too_large" | "not_image",
    message: string,
  ) {
    super(message);
  }
}

/** True only for globally routable addresses. Anything private, loopback, link-local or reserved is refused. */
export function isPublicIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number) as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false; // multicast + reserved + broadcast
    return true;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicIp(mapped[1]!);
    if (lower === "::" || lower === "::1") return false;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    return true;
  }
  return false;
}

/** Identify by magic bytes. Never trust the remote Content-Type; SVG is deliberately unsupported. */
export function sniffImageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return "image/webp";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  return null;
}

async function resolvePublic(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new SafeFetchError("blocked_host", "Address not allowed.");
    return { address: host, family: net.isIP(host) as 4 | 6 };
  }
  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new SafeFetchError("fetch_failed", "Could not resolve host.");
  }
  if (records.length === 0 || records.some((r) => !isPublicIp(r.address))) {
    throw new SafeFetchError("blocked_host", "Address not allowed.");
  }
  // Prefer IPv4: many hosts publish AAAA records that aren't reachable from every network.
  const pick = records.find((r) => r.family === 4) ?? records[0]!;
  return { address: pick.address, family: pick.family as 4 | 6 };
}

type Options = { maxBytes?: number; timeoutMs?: number; maxRedirects?: number };

/**
 * Fetches a public https image with SSRF protection:
 * https only, no credentials, every hop's DNS result must be public and is pinned for the
 * connection (no DNS-rebinding window), redirects are followed manually and re-validated,
 * size is capped while streaming, and the body must sniff as a raster image.
 */
export async function fetchPublicImage(
  rawUrl: string,
  { maxBytes = 8 * 1024 * 1024, timeoutMs = 8_000, maxRedirects = 3 }: Options = {},
): Promise<{ bytes: Buffer; contentType: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("invalid_url", "That link isn't a valid URL.");
  }
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
      throw new SafeFetchError("invalid_url", "Only https image links are supported.");
    }
    const { address, family } = await resolvePublic(url.hostname);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeFetchError("fetch_failed", "Image took too long to load.");

    const result = await new Promise<{ status: number; location?: string; body?: Buffer }>((resolve, reject) => {
      const req = https.request(
        {
          protocol: "https:",
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: "GET",
          timeout: remaining,
          headers: { "User-Agent": "TryanythingGarmentFetch/1.0", Accept: "image/jpeg,image/png,image/webp,image/gif;q=0.9,*/*;q=0.1" },
          // Pin the connection to the address we validated.
          lookup: (_h, _o, cb) => (_o && (_o as { all?: boolean }).all ? (cb as unknown as (e: null, a: unknown[]) => void)(null, [{ address, family }]) : cb(null, address, family)),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            return resolve({ status, location: String(res.headers.location) });
          }
          if (status !== 200) {
            res.resume();
            return resolve({ status });
          }
          const declared = Number(res.headers["content-length"] ?? 0);
          if (declared > maxBytes) {
            res.destroy();
            return reject(new SafeFetchError("too_large", "Image is too large."));
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              res.destroy();
              reject(new SafeFetchError("too_large", "Image is too large."));
            } else chunks.push(c);
          });
          res.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new SafeFetchError("fetch_failed", "Image took too long to load.")));
      req.on("error", (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError("fetch_failed", "Could not load that image.")));
      req.end();
    });

    if (result.location) {
      try {
        url = new URL(result.location, url);
      } catch {
        throw new SafeFetchError("invalid_url", "Bad redirect.");
      }
      continue;
    }
    if (!result.body) throw new SafeFetchError("fetch_failed", `Image host answered ${result.status}.`);
    const type = sniffImageType(result.body);
    if (!type) throw new SafeFetchError("not_image", "That link isn't a JPEG, PNG, WebP or GIF image.");
    return { bytes: result.body, contentType: type };
  }
  throw new SafeFetchError("fetch_failed", "Too many redirects.");
}
