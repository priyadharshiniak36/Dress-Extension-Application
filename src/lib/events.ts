import { z } from "zod";

/** Every analytics event the client may send. Unknown names are rejected server-side. */
export const EVENT_NAMES = [
  "onboarding_opened",
  "consent_completed",
  "camera_granted",
  "camera_error",
  "session_started",
  "tryon_started",
  "first_frame_rendered",
  "tryon_error",
  "nudge_shown",
  "nudge_dismissed",
  "nudge_accepted",
  "try_timer_ended",
  "session_ended",
  "session_reset",
  "continue_clicked",
  "garments_shop_clicked",
  "profile_answered",
  "store_clicked",
  "garment_added",
  "garment_add_failed",
  "app_installed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

const propValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

export const eventSchema = z.object({
  event: z.enum(EVENT_NAMES),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  occurredAt: z.string().datetime().optional(),
  properties: z
    .record(z.string().regex(/^[a-zA-Z0-9_]{1,40}$/), propValue)
    .refine((o) => Object.keys(o).length <= 20, "too many properties")
    .optional(),
});

export type AnalyticsEvent = z.infer<typeof eventSchema>;
