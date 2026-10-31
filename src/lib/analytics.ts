"use client";

import type { EventName } from "./events";

type Props = Record<string, string | number | boolean | null | undefined>;

/** Fire-and-forget analytics. Never throws, never blocks the UI. */
export function track(event: EventName, properties: Props = {}, sessionId?: string | null) {
  try {
    const clean: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(properties)) {
      if (v === undefined) continue;
      clean[k] = typeof v === "string" ? v.slice(0, 200) : v;
    }
    const body = JSON.stringify({
      event,
      occurredAt: new Date().toISOString(),
      ...(sessionId ? { sessionId } : {}),
      properties: clean,
    });
    const url = "/api/v1/events";
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
        () => {},
      );
    }
  } catch {
    /* analytics must never break the app */
  }
}
