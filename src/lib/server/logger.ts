import "server-only";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SECRET_KEY = /^(api[-_]?key|token|authorization|secret|password|cookie)$/i;

/** Recursively replaces secret-looking keys. Exported for tests. */
// Decart permanent keys start with dct_; scrub them even inside free-text error messages.
const KEY_PATTERN = /\bdct_[A-Za-z0-9_-]+/g;

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(KEY_PATTERN, "dct_[REDACTED]");
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value as Fields)) {
    out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

function write(level: Level, msg: string, fields: Fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields) as Fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, f?: Fields) => write("debug", msg, f),
  info: (msg: string, f?: Fields) => write("info", msg, f),
  warn: (msg: string, f?: Fields) => write("warn", msg, f),
  error: (msg: string, f?: Fields) => write("error", msg, f),
};

export function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}
