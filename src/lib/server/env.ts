import "server-only";
import { z } from "zod";

const boolish = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

/** Blank values (`FOO=` in a copied .env.example) mean "not set", not "invalid". */
const blankIsUnset = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), s);

/** https only (a GPU server carries photos of people); plain http is allowed for localhost development. */
const serverUrl = z
  .string()
  .url()
  .refine((u) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u), "must be https:// (or http://localhost)")
  .transform((u) => u.replace(/\/+$/, ""));

const schema = z.object({
  DECART_API_KEY: blankIsUnset(z.string().min(1).optional()),
  APP_ORIGINS: blankIsUnset(z.string().default("http://localhost:3000")),
  DECART_MODEL: blankIsUnset(z.string().min(1).default("lucy-vton-latest")),
  DECART_SCOPE_TOKEN_TO_MODEL: blankIsUnset(boolish),
  DECART_TOKEN_TTL_SECONDS: blankIsUnset(z.coerce.number().int().min(1).max(3600).default(60)),
  DECART_MAX_SESSION_SECONDS: blankIsUnset(z.coerce.number().int().min(10).max(3600).default(180)),
  GEMINI_API_KEY: blankIsUnset(z.string().min(1).optional()),
  GEMINI_IMAGE_MODEL: blankIsUnset(z.string().min(1).default("gemini-nano-banana-2.1")),
  CATVTON_URL: blankIsUnset(serverUrl.optional()),
  CATVTON_TOKEN: blankIsUnset(z.string().min(1).optional()),
  TRYON_PROVIDER: blankIsUnset(z.enum(["catvton", "gemini"]).optional()),
});

export type TryOnProvider = "catvton" | "gemini";

export type ServerEnv = {
  decartApiKey: string | undefined;
  appOrigins: string[];
  model: string;
  scopeTokenToModel: boolean;
  tokenTtlSeconds: number;
  maxSessionSeconds: number;
  geminiApiKey: string | undefined;
  geminiImageModel: string;
  catvtonUrl: string | undefined;
  catvtonToken: string | undefined;
  /** Which realistic photo backend is usable, or null. An explicit TRYON_PROVIDER wins only if that provider is configured. */
  tryonProvider: TryOnProvider | null;
};

let cached: ServerEnv | null = null;

/** Parses env once. Throws on malformed values so misconfiguration fails loudly at first use. */
export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached && source === process.env) return cached;
  const parsed = schema.parse(source);
  const catvtonReady = Boolean(parsed.CATVTON_URL && parsed.CATVTON_TOKEN);
  const geminiReady = Boolean(parsed.GEMINI_API_KEY);
  const ready = { catvton: catvtonReady, gemini: geminiReady };
  const tryonProvider: TryOnProvider | null =
    parsed.TRYON_PROVIDER && ready[parsed.TRYON_PROVIDER] ? parsed.TRYON_PROVIDER : catvtonReady ? "catvton" : geminiReady ? "gemini" : null;
  const env: ServerEnv = {
    decartApiKey: parsed.DECART_API_KEY,
    appOrigins: parsed.APP_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean),
    model: parsed.DECART_MODEL,
    scopeTokenToModel: parsed.DECART_SCOPE_TOKEN_TO_MODEL,
    tokenTtlSeconds: parsed.DECART_TOKEN_TTL_SECONDS,
    maxSessionSeconds: parsed.DECART_MAX_SESSION_SECONDS,
    geminiApiKey: parsed.GEMINI_API_KEY,
    geminiImageModel: parsed.GEMINI_IMAGE_MODEL,
    catvtonUrl: parsed.CATVTON_URL,
    catvtonToken: parsed.CATVTON_TOKEN,
    tryonProvider,
  };
  if (source === process.env) cached = env;
  return env;
}
