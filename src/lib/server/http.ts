import "server-only";
import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "forbidden_origin"
  | "rate_limited"
  | "not_configured"
  | "upstream_failed"
  | "invalid_body"
  | "payload_too_large"
  | "invalid_url"
  | "blocked_host"
  | "fetch_failed"
  | "too_large"
  | "not_image";

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  headers?: HeadersInit,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error: { code, message, ...extra } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}
