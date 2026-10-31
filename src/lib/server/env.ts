import "server-only";
import { z } from "zod";

const boolish = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  DECART_API_KEY: z.string().min(1).optional(),
  APP_ORIGINS: z.string().default("http://localhost:3000"),
  DECART_MODEL: z.string().min(1).default("lucy-vton-latest"),
  DECART_SCOPE_TOKEN_TO_MODEL: boolish,
  DECART_TOKEN_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  DECART_MAX_SESSION_SECONDS: z.coerce.number().int().min(10).max(3600).default(180),
});

export type ServerEnv = {
  decartApiKey: string | undefined;
  appOrigins: string[];
  model: string;
  scopeTokenToModel: boolean;
  tokenTtlSeconds: number;
  maxSessionSeconds: number;
};

let cached: ServerEnv | null = null;

/** Parses env once. Throws on malformed values so misconfiguration fails loudly at first use. */
export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached && source === process.env) return cached;
  const parsed = schema.parse(source);
  const env: ServerEnv = {
    decartApiKey: parsed.DECART_API_KEY,
    appOrigins: parsed.APP_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean),
    model: parsed.DECART_MODEL,
    scopeTokenToModel: parsed.DECART_SCOPE_TOKEN_TO_MODEL,
    tokenTtlSeconds: parsed.DECART_TOKEN_TTL_SECONDS,
    maxSessionSeconds: parsed.DECART_MAX_SESSION_SECONDS,
  };
  if (source === process.env) cached = env;
  return env;
}
