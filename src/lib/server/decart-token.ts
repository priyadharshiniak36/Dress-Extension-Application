import "server-only";
import { createDecartClient } from "@decartai/sdk";
import type { ServerEnv } from "./env";

export type MintedToken = {
  apiKey: string;
  expiresAt: string | null;
  model: string;
  maxSessionSeconds: number;
};

export class UpstreamError extends Error {
  /** HTTP status Decart answered with, when known (e.g. 401 bad key, 402/403 plan/credits, 400 bad option). */
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

/** The SDK reports failures as "Failed to create token: <status> - <body>". */
function upstreamStatus(err: unknown): number | null {
  const s = (err as { status?: unknown; data?: { status?: unknown } } | null)?.status ?? (err as { data?: { status?: unknown } })?.data?.status;
  if (typeof s === "number") return s;
  const m = /create token:\s*(\d{3})/i.exec(err instanceof Error ? err.message : String(err));
  return m ? Number(m[1]) : null;
}

const MINT_TIMEOUT_MS = 10_000;

/** Mints one short-lived, session-capped client token. The permanent key never leaves this function. */
export async function mintClientToken(env: ServerEnv, origin: string): Promise<MintedToken> {
  if (!env.decartApiKey) throw new Error("DECART_API_KEY not configured");
  const client = createDecartClient({ apiKey: env.decartApiKey });

  const options = {
    expiresIn: env.tokenTtlSeconds,
    allowedOrigins: [origin],
    constraints: { realtime: { maxSessionDuration: env.maxSessionSeconds } },
    ...(env.scopeTokenToModel ? { allowedModels: [env.model] } : {}),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await Promise.race([
      // The SDK's option type may lag the API; options mirror docs.platform.decart.ai/getting-started/client-tokens.
      client.tokens.create(options as Parameters<typeof client.tokens.create>[0]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new UpstreamError("token mint timed out")), MINT_TIMEOUT_MS);
      }),
    ]);
    const t = token as { apiKey?: unknown; expiresAt?: unknown };
    if (typeof t.apiKey !== "string" || !t.apiKey) throw new UpstreamError("token response missing apiKey");
    return {
      apiKey: t.apiKey,
      expiresAt: typeof t.expiresAt === "string" ? t.expiresAt : null,
      model: env.model,
      maxSessionSeconds: env.maxSessionSeconds,
    };
  } catch (err) {
    throw err instanceof UpstreamError
      ? err
      : new UpstreamError(err instanceof Error ? err.message : String(err), upstreamStatus(err));
  } finally {
    clearTimeout(timer);
  }
}
