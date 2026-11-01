import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTryOnRequest, extractImage, generateTryOn, GeminiError, TRYON_PROMPT } from "@/lib/server/gemini";

const img = { mime: "image/jpeg", base64: "QUJD" };

describe("buildTryOnRequest", () => {
  it("sends a fixed prompt plus the person and garment images, in that order", () => {
    const body = buildTryOnRequest("gemini-nano-banana-2.1", img, { mime: "image/png", base64: "REVG" });
    expect(body.model).toBe("gemini-nano-banana-2.1");
    expect(body.input).toEqual([
      { type: "text", text: TRYON_PROMPT },
      { type: "image", mime_type: "image/jpeg", data: "QUJD" },
      { type: "image", mime_type: "image/png", data: "REVG" },
    ]);
  });
  it("never includes user text (prompt injection through the form is impossible)", () => {
    expect(JSON.stringify(buildTryOnRequest("m", img, img))).not.toMatch(/ignore previous/i);
    expect(TRYON_PROMPT).toMatch(/first image/);
  });
});

describe("extractImage", () => {
  it("reads an interaction step with an image content block", () => {
    const r = { steps: [{ type: "model_output", content: [{ type: "text", text: "ok" }, { type: "image", mime_type: "image/png", data: "AAAA" }] }] };
    expect(extractImage(r)).toEqual({ mime: "image/png", base64: "AAAA" });
  });
  it("reads an output_image convenience field", () => {
    expect(extractImage({ output_image: { data: "BBBB", mime_type: "image/jpeg" } })).toEqual({ mime: "image/jpeg", base64: "BBBB" });
  });
  it("reads classic inlineData parts", () => {
    const r = { candidates: [{ content: { parts: [{ text: "hi" }, { inlineData: { mimeType: "image/webp", data: "CCCC" } }] } }] };
    expect(extractImage(r)).toEqual({ mime: "image/webp", base64: "CCCC" });
  });
  it("returns null for text-only or empty answers and is depth-limited", () => {
    expect(extractImage({ steps: [{ content: [{ type: "text", text: "I can't do that" }] }] })).toBeNull();
    expect(extractImage(null)).toBeNull();
    let deep: unknown = { type: "image", data: "ZZ" };
    for (let i = 0; i < 20; i++) deep = { x: deep };
    expect(extractImage(deep)).toBeNull();
  });
});

describe("generateTryOn", () => {
  const ok = (json: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(json), { status }));
  const run = (fetchImpl: typeof fetch) => generateTryOn({ apiKey: "KEY", model: "m", person: img, garment: img, fetchImpl });
  const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e as GeminiError).code);

  it("calls the interactions endpoint with the key in a header (never in the URL) and returns the image", async () => {
    const f = ok({ output_image: { data: "QQ==", mime_type: "image/png" } });
    expect(await run(f as unknown as typeof fetch)).toEqual({ mime: "image/png", base64: "QQ==" });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(String(url)).not.toContain("KEY");
    expect((init as RequestInit).headers).toMatchObject({ "x-goog-api-key": "KEY" });
  });
  it("maps 429 to quota, other errors to upstream_failed, and a text-only answer to no_image", async () => {
    expect(await code(run(ok({ error: { message: "Quota exceeded" } }, 429) as unknown as typeof fetch))).toBe("quota");
    expect(await code(run(ok({ error: { message: "billing not enabled" } }, 403) as unknown as typeof fetch))).toBe("upstream_failed");
    expect(await code(run(ok({ steps: [{ content: [{ type: "text", text: "no" }] }] }) as unknown as typeof fetch))).toBe("no_image");
  });
  it("reports a network failure without leaking the key", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom KEY"));
    const e = await run(f as unknown as typeof fetch).catch((x: GeminiError) => x);
    expect((e as GeminiError).code).toBe("upstream_failed");
    expect((e as GeminiError).message).not.toContain("KEY");
  });
});

describe("/api/v1/tryon-photo", () => {
  const ORIGIN = "https://tryanything.app";
  const gen = vi.fn();
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

  async function load(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const k of ["DECART_API_KEY", "APP_ORIGINS", "GEMINI_API_KEY", "GEMINI_DAILY_LIMIT", "CATVTON_URL", "CATVTON_TOKEN", "TRYON_PROVIDER"]) delete process.env[k];
    Object.assign(process.env, { APP_ORIGINS: ORIGIN }, env);
    vi.doMock("@/lib/server/gemini", async (orig) => ({ ...(await orig<typeof import("@/lib/server/gemini")>()), generateTryOn: gen }));
    return import("@/app/api/v1/tryon-photo/route");
  }
  const form = (person: Uint8Array | null = JPEG, garment: Uint8Array | null = JPEG) => {
    const f = new FormData();
    if (person) f.append("person", new File([person as BlobPart], "p.jpg", { type: "image/jpeg" }));
    if (garment) f.append("garment", new File([garment as BlobPart], "g.jpg", { type: "image/jpeg" }));
    return f;
  };
  const post = (body: FormData, origin = ORIGIN, ip = "5.5.5.5") =>
    new Request("http://localhost/api/v1/tryon-photo", { method: "POST", body, headers: { origin, "x-forwarded-for": ip } });

  beforeEach(() => {
    gen.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("GET reports whether the feature is configured, and never the key", async () => {
    const off = await load({});
    expect(await (await off.GET(new Request("http://localhost/api/v1/tryon-photo", { headers: { origin: ORIGIN } }))).json()).toEqual({ enabled: false, provider: null });
    const on = await load({ GEMINI_API_KEY: "SECRET" });
    const res = await on.GET(new Request("http://localhost/api/v1/tryon-photo", { headers: { origin: ORIGIN } }));
    expect(await res.text()).toBe(`{"enabled":true,"provider":"gemini"}`);
  });

  it("returns the generated image", async () => {
    gen.mockResolvedValue({ mime: "image/png", base64: Buffer.from("PNGDATA").toString("base64") });
    const { POST } = await load({ GEMINI_API_KEY: "SECRET" });
    const res = await POST(post(form()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("PNGDATA");
    expect(gen.mock.calls[0]![0]).toMatchObject({ apiKey: "SECRET", model: "gemini-nano-banana-2.1" });
  });

  it("is off without a key and rejects foreign origins before doing any work", async () => {
    const { POST } = await load({});
    expect((await POST(post(form()))).status).toBe(503);
    const on = await load({ GEMINI_API_KEY: "SECRET" });
    expect((await on.POST(post(form(), "https://evil.com"))).status).toBe(403);
    expect(gen).not.toHaveBeenCalled();
  });

  it("validates the uploads by their bytes, not their declared type", async () => {
    const { POST } = await load({ GEMINI_API_KEY: "SECRET" });
    expect((await POST(post(form(new TextEncoder().encode("<svg/>"))))).status).toBe(415);
    expect((await POST(post(form(null)))).status).toBe(400);
    expect((await POST(post(form(new Uint8Array(2 * 1024 * 1024 + 1).fill(0xff))))).status).toBe(413);
    expect(gen).not.toHaveBeenCalled();
  });

  it("rate limits per IP and caps the daily total", async () => {
    gen.mockResolvedValue({ mime: "image/png", base64: "QQ==" });
    const a = await load({ GEMINI_API_KEY: "SECRET" });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await a.POST(post(form()))).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    const b = await load({ GEMINI_API_KEY: "SECRET", GEMINI_DAILY_LIMIT: "2" });
    const s2 = [];
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) s2.push((await b.POST(post(form(), ORIGIN, ip))).status);
    expect(s2).toEqual([200, 200, 429]);
  });

  it("maps Gemini failures to friendly statuses without leaking details", async () => {
    const { POST } = await load({ GEMINI_API_KEY: "SECRET" });
    const { GeminiError: E } = await import("@/lib/server/gemini");
    gen.mockRejectedValueOnce(new E("no_image", "blocked by filters", 200));
    expect((await POST(post(form(), ORIGIN, "9.9.9.1"))).status).toBe(422);
    gen.mockRejectedValueOnce(new E("upstream_failed", "billing not enabled for project 12345", 403));
    const res = await POST(post(form(), ORIGIN, "9.9.9.2"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("12345");
  });
});
