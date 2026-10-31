import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@decartai/sdk", () => ({ createDecartClient: () => ({ tokens: { create } }) }));

const ORIGIN = "https://tryanything.app";

async function loadTokens(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["DECART_API_KEY", "APP_ORIGINS"]) delete process.env[k];
  Object.assign(process.env, env);
  return (await import("@/app/api/v1/tokens/route")).POST;
}

const req = (headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": "9.9.9.9" }) =>
  new Request("http://localhost/api/v1/tokens", { method: "POST", headers });

describe("POST /api/v1/tokens", () => {
  beforeEach(() => {
    create.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("mints a scoped, session-capped token", async () => {
    create.mockResolvedValue({ apiKey: "ek_123", expiresAt: "2026-10-29T10:01:00Z" });
    const POST = await loadTokens({ DECART_API_KEY: "dct_secret", APP_ORIGINS: ORIGIN });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ apiKey: "ek_123", expiresAt: "2026-10-29T10:01:00Z", model: "lucy-vton-latest", maxSessionSeconds: 180 });
    expect(create).toHaveBeenCalledWith({
      expiresIn: 60,
      allowedOrigins: [ORIGIN],
      constraints: { realtime: { maxSessionDuration: 180 } },
    });
  });

  it("never leaks the permanent key in logs", async () => {
    create.mockResolvedValue({ apiKey: "ek_123" });
    const POST = await loadTokens({ DECART_API_KEY: "dct_secret", APP_ORIGINS: ORIGIN });
    await POST(req());
    const logged = [console.log, console.warn, console.error].flatMap((f) => (f as unknown as { mock: { calls: unknown[][] } }).mock.calls).join(" ");
    expect(logged).not.toContain("dct_secret");
    expect(logged).not.toContain("ek_123");
  });

  it("rejects foreign origins", async () => {
    const POST = await loadTokens({ DECART_API_KEY: "dct_secret", APP_ORIGINS: ORIGIN });
    const res = await POST(req({ origin: "https://evil.com" }));
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("rate limits per IP", async () => {
    create.mockResolvedValue({ apiKey: "ek" });
    const POST = await loadTokens({ DECART_API_KEY: "dct_secret", APP_ORIGINS: ORIGIN });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await POST(req())).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("503 when not configured, 502 with a safe message when Decart fails", async () => {
    let POST = await loadTokens({ APP_ORIGINS: ORIGIN });
    expect((await POST(req())).status).toBe(503);

    create.mockRejectedValue(new Error("internal: dct_secret invalid"));
    POST = await loadTokens({ DECART_API_KEY: "dct_secret", APP_ORIGINS: ORIGIN });
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("dct_secret");
  });
});

describe("POST /api/v1/events", () => {
  it("accepts valid events and rejects junk", async () => {
    vi.resetModules();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { POST } = await import("@/app/api/v1/events/route");
    const post = (body: string) => POST(new Request("http://localhost/api/v1/events", { method: "POST", body, headers: { "x-forwarded-for": "8.8.8.8" } }));
    expect((await post(JSON.stringify({ event: "onboarding_opened" }))).status).toBe(204);
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ event: "nope" }))).status).toBe(400);
    expect((await post("x".repeat(5000))).status).toBe(413);
  });
});
