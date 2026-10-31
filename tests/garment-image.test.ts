import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicIp, sniffImageType, fetchPublicImage, SafeFetchError } from "@/lib/server/safe-fetch";

describe("isPublicIp (SSRF guard)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPublicIp(ip)).toBe(false));

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isPublicIp(ip)).toBe(true),
  );
});

describe("sniffImageType", () => {
  it("identifies raster formats by magic bytes", () => {
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffImageType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
  });
  it("rejects SVG, HTML and junk regardless of what the server claims", () => {
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("fetchPublicImage rejects before any network I/O", () => {
  const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e as SafeFetchError).code);
  it("non-https, credentials, odd ports, literal private IPs", async () => {
    expect(await code(fetchPublicImage("http://example.com/a.jpg"))).toBe("invalid_url");
    expect(await code(fetchPublicImage("https://user:pw@example.com/a.jpg"))).toBe("invalid_url");
    expect(await code(fetchPublicImage("https://example.com:8443/a.jpg"))).toBe("invalid_url");
    expect(await code(fetchPublicImage("https://127.0.0.1/a.jpg"))).toBe("blocked_host");
    expect(await code(fetchPublicImage("https://169.254.169.254/latest/meta-data"))).toBe("blocked_host");
    expect(await code(fetchPublicImage("https://[::1]/a.jpg"))).toBe("blocked_host");
    expect(await code(fetchPublicImage("not a url"))).toBe("invalid_url");
  });
});

describe("POST /api/v1/garment-image", () => {
  const fetchMock = vi.fn();
  const ORIGIN = "https://tryanything.app";

  async function load() {
    vi.resetModules();
    vi.doMock("@/lib/server/safe-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/server/safe-fetch")>()), fetchPublicImage: fetchMock }));
    process.env.APP_ORIGINS = ORIGIN;
    return (await import("@/app/api/v1/garment-image/route")).POST;
  }
  const post = (body: unknown, origin = ORIGIN, ip = "7.7.7.7") =>
    new Request("http://localhost/api/v1/garment-image", {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the image bytes with a sniffed content type", async () => {
    fetchMock.mockResolvedValue({ bytes: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" });
    const POST = await load();
    const res = await POST(post({ url: "https://cdn.shop.com/dress.jpg" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.shop.com/dress.jpg");
  });

  it("rejects foreign origins and bad bodies without fetching", async () => {
    const POST = await load();
    expect((await POST(post({ url: "https://a.com/x.jpg" }, "https://evil.com"))).status).toBe(403);
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ url: "nope" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps SafeFetchError codes to HTTP statuses", async () => {
    const POST = await load();
    const { SafeFetchError: E } = await import("@/lib/server/safe-fetch");
    fetchMock.mockRejectedValueOnce(new E("blocked_host", "x"));
    expect((await POST(post({ url: "https://a.com/x.jpg" }))).status).toBe(400);
    fetchMock.mockRejectedValueOnce(new E("too_large", "x"));
    expect((await POST(post({ url: "https://a.com/x.jpg" }))).status).toBe(413);
    fetchMock.mockRejectedValueOnce(new E("not_image", "x"));
    expect((await POST(post({ url: "https://a.com/x.jpg" }))).status).toBe(415);
  });
});
