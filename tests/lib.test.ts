import { describe, expect, it } from "vitest";
import { createRateLimiter, clientIp } from "@/lib/server/rate-limit";
import { isAllowedOrigin, resolveAllowedOrigin } from "@/lib/server/origin";
import { redact } from "@/lib/server/logger";
import { getServerEnv } from "@/lib/server/env";
import { eventSchema } from "@/lib/events";
import { LEGAL_DOCS } from "@/lib/legal";
import { progressIndex, initialOnboarding, onboardingReducer, type OnboardingAction, type OnboardingState } from "@/lib/onboarding";

describe("rate limiter", () => {
  it("allows up to the limit then blocks until the window resets", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(check("a", 0).ok).toBe(true);
    expect(check("a", 10).ok).toBe(true);
    const blocked = check("a", 20);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect(check("b", 20).ok).toBe(true); // per key
    expect(check("a", 1001).ok).toBe(true); // new window
  });
  it("keeps memory bounded", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 });
    for (let i = 0; i < 50; i++) check(`k${i}`, 0);
    expect(check("k49", 0).ok).toBe(false); // newest bucket survived
  });
  it("reads the first forwarded IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("origin gate", () => {
  const allowed = ["https://tryanything.app"];
  it("accepts a matching Origin or Referer", () => {
    expect(isAllowedOrigin(new Headers({ origin: "https://tryanything.app" }), allowed)).toBe(true);
    expect(isAllowedOrigin(new Headers({ referer: "https://tryanything.app/x?y" }), allowed)).toBe(true);
  });
  it("in development only, accepts the request's own host (laptop, LAN phone, tunnel)", () => {
    const h = new Headers({ origin: "https://172.20.10.3:3000", host: "172.20.10.3:3000" });
    expect(resolveAllowedOrigin(h, allowed, true)).toBe("https://172.20.10.3:3000");
    expect(resolveAllowedOrigin(h, allowed, false)).toBeNull();
    expect(resolveAllowedOrigin(new Headers({ origin: "https://evil.com", host: "172.20.10.3:3000" }), allowed, true)).toBeNull();
  });
  it("rejects missing, foreign, or look-alike origins", () => {
    expect(isAllowedOrigin(new Headers(), allowed)).toBe(false);
    expect(isAllowedOrigin(new Headers({ origin: "https://evil.com" }), allowed)).toBe(false);
    expect(isAllowedOrigin(new Headers({ origin: "https://tryanything.app.evil.com" }), allowed)).toBe(false);
    expect(isAllowedOrigin(new Headers({ referer: "not a url" }), allowed)).toBe(false);
  });
});

describe("logger redaction", () => {
  it("redacts secret keys at any depth", () => {
    expect(redact({ apiKey: "dct_x", nested: { token: "t", ok: 1 }, list: [{ password: "p" }] })).toEqual({
      apiKey: "[REDACTED]",
      nested: { token: "[REDACTED]", ok: 1 },
      list: [{ password: "[REDACTED]" }],
    });
  });
});

describe("server env", () => {
  it("applies safe defaults", () => {
    const env = getServerEnv({} as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ model: "lucy-vton-latest", tokenTtlSeconds: 60, maxSessionSeconds: 180, scopeTokenToModel: false });
    expect(env.decartApiKey).toBeUndefined();
  });
  it("parses origins and rejects invalid caps", () => {
    expect(getServerEnv({ APP_ORIGINS: "https://a.com/, https://b.com" } as unknown as NodeJS.ProcessEnv).appOrigins).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
    expect(() => getServerEnv({ DECART_MAX_SESSION_SECONDS: "5" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("event schema", () => {
  it("accepts a known event", () => {
    expect(eventSchema.safeParse({ event: "tryon_started", sessionId: "s_abc", properties: { garment_id: "hoodie" } }).success).toBe(true);
  });
  it("rejects unknown events, nested values, bad keys and oversize strings", () => {
    expect(eventSchema.safeParse({ event: "drop_table" }).success).toBe(false);
    expect(eventSchema.safeParse({ event: "tryon_started", properties: { a: { b: 1 } } }).success).toBe(false);
    expect(eventSchema.safeParse({ event: "tryon_started", properties: { "bad key": 1 } }).success).toBe(false);
    expect(eventSchema.safeParse({ event: "tryon_started", properties: { a: "x".repeat(201) } }).success).toBe(false);
    expect(eventSchema.safeParse({ event: "tryon_started", sessionId: "../../etc" }).success).toBe(false);
  });
});

describe("legal docs", () => {
  it("serves exactly the three docs the consent screen links to, each with content", () => {
    expect(Object.keys(LEGAL_DOCS).sort()).toEqual(["aup", "privacy", "terms"]);
    for (const d of Object.values(LEGAL_DOCS)) {
      expect(d.sections.length).toBeGreaterThan(3);
      expect(d.summary.length).toBeGreaterThan(20);
    }
  });
});

describe("onboarding reducer", () => {
  const run = (actions: OnboardingAction[], from: OnboardingState = initialOnboarding) => actions.reduce(onboardingReducer, from);

  it("walks the happy path", () => {
    let s = run([{ type: "CONSENT_ACCEPTED" }, { type: "TRY_TIMER_ENDED" }]);
    expect(s).toMatchObject({ step: "dressing", timeoutModalOpen: true });
    s = run([{ type: "TIMEOUT_CONTINUE" }, { type: "GARMENTS_NEXT" }], s);
    expect(s.step).toBe("survey");
    s = run([{ type: "SET_GENDER", gender: "woman" }], s);
    expect(s.step).toBe("survey"); // needs both answers
    s = run([{ type: "SET_AGE", age: "25-34" }], s);
    expect(s.step).toBe("shop");
  });
  it("ignores actions that don't belong to the current step", () => {
    expect(run([{ type: "GARMENTS_NEXT" }]).step).toBe("consent");
    expect(run([{ type: "OPEN_DRESSING" }]).step).toBe("consent"); // never bypass consent
    expect(run([{ type: "CONSENT_ACCEPTED" }, { type: "SHOP_BACK" }]).step).toBe("dressing");
  });
  it("nudge goes straight to the shop", () => {
    expect(run([{ type: "CONSENT_ACCEPTED" }, { type: "NUDGE_SHOP" }]).step).toBe("shop");
  });
  it("maps progress segments", () => {
    expect(progressIndex("consent")).toBe(0);
    expect(progressIndex("dressing")).toBe(0);
    expect(progressIndex("garments")).toBe(1);
    expect(progressIndex("survey")).toBe(2);
    expect(progressIndex("shop")).toBe(3);
  });
});
