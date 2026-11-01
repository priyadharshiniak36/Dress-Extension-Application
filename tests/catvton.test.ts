import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateWithCatvton, CatvtonError } from "@/lib/server/catvton";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
const img = { mime: "image/jpeg", bytes: JPEG };

describe("generateWithCatvton", () => {
  const respond = (body: BodyInit | null, status = 200) => vi.fn().mockResolvedValue(new Response(body, { status }));
  const run = (f: ReturnType<typeof vi.fn>, clothType: "upper" | "lower" | "overall" = "upper") =>
    generateWithCatvton({ url: "https://gpu.example.com", token: "TOK", person: img, garment: img, clothType, fetchImpl: f as unknown as typeof fetch });
  const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e as CatvtonError).code);

  it("posts both images and the cloth type with the bearer token, and returns the picture", async () => {
    const f = respond(PNG);
    const out = await run(f, "overall");
    expect(out.mime).toBe("image/png");
    expect(Array.from(out.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://gpu.example.com/tryon");
    expect((init as RequestInit).headers).toEqual({ Authorization: "Bearer TOK" });
    const form = (init as RequestInit).body as FormData;
    expect(form.get("cloth_type")).toBe("overall");
    expect(form.get("person")).toBeInstanceOf(File);
    expect(form.get("garment")).toBeInstanceOf(File);
  });

  it("maps server states to codes: busy/loading, bad token, rejected input, server error", async () => {
    expect(await code(run(respond("Model is still loading", 503)))).toBe("busy");
    expect(await code(run(respond("Busy", 429)))).toBe("busy");
    expect(await code(run(respond("Unauthorized", 401)))).toBe("failed");
    expect(await code(run(respond("not an image", 415)))).toBe("rejected");
    expect(await code(run(respond("boom", 500)))).toBe("failed");
  });

  it("refuses a response that is not a raster image (e.g. HTML or SVG from a misconfigured proxy)", async () => {
    expect(await code(run(respond("<html>login</html>")))).toBe("failed");
    expect(await code(run(respond("<svg/>")))).toBe("failed");
  });

  it("reports unreachable servers and timeouts without leaking the token or URL", async () => {
    const down = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED https://gpu.example.com TOK"));
    const e = await run(down).catch((x: CatvtonError) => x);
    expect((e as CatvtonError).code).toBe("unavailable");
    expect((e as CatvtonError).message).not.toMatch(/TOK|gpu\.example/);
  });
});

describe("provider selection and /api/v1/tryon-photo with CatVTON", () => {
  const ORIGIN = "https://tryanything.app";
  const gen = vi.fn();

  async function load(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const k of ["DECART_API_KEY", "APP_ORIGINS", "GEMINI_API_KEY", "GEMINI_DAILY_LIMIT", "CATVTON_URL", "CATVTON_TOKEN", "TRYON_PROVIDER"]) delete process.env[k];
    Object.assign(process.env, { APP_ORIGINS: ORIGIN }, env);
    vi.doMock("@/lib/server/catvton", async (orig) => ({ ...(await orig<typeof import("@/lib/server/catvton")>()), generateWithCatvton: gen }));
    const [{ getServerEnv }, route] = await Promise.all([import("@/lib/server/env"), import("@/app/api/v1/tryon-photo/route")]);
    return { getServerEnv, ...route };
  }
  const form = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.append("person", new File([JPEG as BlobPart], "p.jpg", { type: "image/jpeg" }));
    f.append("garment", new File([JPEG as BlobPart], "g.jpg", { type: "image/jpeg" }));
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    return f;
  };
  const post = (body: FormData, ip = "6.6.6.6") =>
    new Request("http://localhost/api/v1/tryon-photo", { method: "POST", body, headers: { origin: ORIGIN, "x-forwarded-for": ip } });
  const CAT = { CATVTON_URL: "https://gpu.example.com/", CATVTON_TOKEN: "TOK" };

  beforeEach(() => {
    gen.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("picks the provider: CatVTON when configured, Gemini otherwise, explicit choice only if usable, else none", async () => {
    expect((await load({})).getServerEnv().tryonProvider).toBeNull();
    expect((await load({ GEMINI_API_KEY: "G" })).getServerEnv().tryonProvider).toBe("gemini");
    expect((await load({ ...CAT, GEMINI_API_KEY: "G" })).getServerEnv().tryonProvider).toBe("catvton");
    expect((await load({ ...CAT, GEMINI_API_KEY: "G", TRYON_PROVIDER: "gemini" })).getServerEnv().tryonProvider).toBe("gemini");
    expect((await load({ ...CAT, TRYON_PROVIDER: "gemini" })).getServerEnv().tryonProvider).toBe("catvton"); // gemini not configured
    expect((await load({ CATVTON_URL: "https://gpu.example.com" })).getServerEnv().tryonProvider).toBeNull(); // token missing
  });

  it("treats blank env values as unset and strips a trailing slash from the URL", async () => {
    const { getServerEnv } = await load({ GEMINI_API_KEY: "", CATVTON_URL: "", DECART_API_KEY: "", ...{ CATVTON_TOKEN: "" } });
    expect(getServerEnv().geminiApiKey).toBeUndefined();
    expect(getServerEnv().decartApiKey).toBeUndefined();
    expect(getServerEnv().tryonProvider).toBeNull();
    expect((await load(CAT)).getServerEnv().catvtonUrl).toBe("https://gpu.example.com");
  });

  it("rejects an insecure CatVTON URL (photos of people must not travel over http)", async () => {
    const { getServerEnv } = await load({ CATVTON_URL: "http://gpu.example.com", CATVTON_TOKEN: "TOK" });
    expect(() => getServerEnv()).toThrow();
    expect((await load({ CATVTON_URL: "http://localhost:8000", CATVTON_TOKEN: "TOK" })).getServerEnv().catvtonUrl).toBe("http://localhost:8000");
  });

  it("GET reports the provider name but never the URL or token", async () => {
    const { GET } = await load(CAT);
    const body = await (await GET(new Request("http://localhost/api/v1/tryon-photo", { headers: { origin: ORIGIN } }))).text();
    expect(body).toBe('{"enabled":true,"provider":"catvton"}');
  });

  it("forwards the images and the validated cloth type to CatVTON and returns its picture", async () => {
    gen.mockResolvedValue({ mime: "image/png", bytes: PNG });
    const { POST } = await load(CAT);
    const res = await POST(post(form({ clothType: "overall" })));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(gen.mock.calls[0]![0]).toMatchObject({ url: "https://gpu.example.com", token: "TOK", clothType: "overall" });
  });

  it("falls back to 'upper' for an unknown cloth type instead of passing it through", async () => {
    gen.mockResolvedValue({ mime: "image/png", bytes: PNG });
    const { POST } = await load(CAT);
    await POST(post(form({ clothType: "rm -rf /" })));
    expect(gen.mock.calls[0]![0]).toMatchObject({ clothType: "upper" });
  });

  it("turns a warming-up/busy GPU into a friendly 429 and a dead one into a generic 502", async () => {
    const { POST } = await load(CAT);
    const { CatvtonError: E } = await import("@/lib/server/catvton");
    gen.mockRejectedValueOnce(new E("busy", "Model is still loading", 503));
    expect((await POST(post(form(), "7.7.7.1"))).status).toBe(429);
    gen.mockRejectedValueOnce(new E("failed", "Try-on server rejected our token TOK", 401));
    const res = await POST(post(form(), "7.7.7.2"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("TOK");
  });
});
