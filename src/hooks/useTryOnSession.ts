"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Garment } from "@/lib/garments";
import { track } from "@/lib/analytics";

/** Where a start attempt failed. Only `camera` is the user's to fix. */
export type FailStage = "camera" | "token" | "connect";
export type Phase = "idle" | "camera" | "connecting" | "live" | "ended";
export type EndReason = "timer" | "session_cap" | "tab_hidden" | "user" | "error";

export const ROTATION_SECONDS = 15;
export const ROTATIONS = 4;
const COUNTDOWN_WORDS = ["3", "2", "1"] as const;

type TokenResponse = { apiKey: string; expiresAt: string | null; model: string; maxSessionSeconds: number };

// Minimal surface of the SDK realtime client we rely on.
type RealtimeClient = {
  setImage: (image: Blob | string, opts?: { prompt?: string; enhance?: boolean }) => Promise<void>;
  disconnect: () => void;
  on: (event: string, cb: (arg: unknown) => void) => void;
};

export type TryOnState = {
  phase: Phase;
  status: string;
  countdownWord: string | null;
  activeIndex: number;
  /** Seconds until the next look, or until the demo ends once the user has pinned their own pick. */
  secondsLeft: number;
  /** Longest value secondsLeft can have right now (for the timer ring). */
  secondsMax: number;
  /** User picked/added a garment, so auto-rotation is off. */
  pinned: boolean;
  endReason: EndReason | null;
};

const initial: TryOnState = {
  phase: "idle",
  status: "",
  countdownWord: null,
  activeIndex: 0,
  secondsLeft: ROTATION_SECONDS,
  secondsMax: ROTATION_SECONDS,
  pinned: false,
  endReason: null,
};

export function userMessageFor(stage: FailStage, err: unknown): string {
  const msg = String((err as Error)?.message ?? err ?? "");
  if (stage === "camera") {
    if (typeof window !== "undefined" && !window.isSecureContext) return "Camera needs a secure connection (https).";
    if (/NotAllowed|Permission/i.test(msg)) return "Camera access was blocked. Allow it in your browser settings and retry.";
    if (/NotFound|Overconstrained/i.test(msg)) return "We couldn't find a camera on this device.";
    return "Could not start the camera. Check permissions and retry.";
  }
  // Our Decart account is out of credits: nothing the visitor can fix, and not theirs to see billing detail about.
  if (/insufficient credits|payment required|402/i.test(msg)) return "Try-on is temporarily unavailable. Please check back soon.";
  if (/capacity|concurrent session limit|rate_limited|429/i.test(msg))
    return "Our servers are busy right now. Please try again in a minute.";
  return "Our try-on servers couldn't start your session. Please try again in a moment.";
}

export function useTryOnSession(opts: { garments: readonly Garment[]; onTimerEnded?: () => void; onUnavailable?: () => void }) {
  const { garments } = opts;
  const garmentsRef = useRef(garments);
  garmentsRef.current = garments;
  // While the OS camera/file picker is open the page is hidden; don't treat that as "user left".
  const pickerHoldUntil = useRef(0);
  const [state, setState] = useState<TryOnState>(initial);
  const outputRef = useRef<HTMLVideoElement | null>(null);

  const onUnavailableRef = useRef(opts.onUnavailable);
  onUnavailableRef.current = opts.onUnavailable;
  const onTimerEndedRef = useRef(opts.onTimerEnded);
  onTimerEndedRef.current = opts.onTimerEnded;

  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<RealtimeClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Bumped on every teardown so late promises from an old session become no-ops.
  const epochRef = useRef(0);
  const busyRef = useRef(false);
  const timersRef = useRef<{ countdown?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval>; cap?: ReturnType<typeof setTimeout> }>({});
  const rotationRef = useRef({ index: 0, left: ROTATION_SECONDS, total: ROTATION_SECONDS * ROTATIONS, pinned: false });
  const blobCache = useRef(new Map<string, Blob>());

  const clearTimers = () => {
    const t = timersRef.current;
    clearTimeout(t.countdown);
    clearInterval(t.tick);
    clearTimeout(t.cap);
    timersRef.current = {};
  };

  /** Idempotent: safe from every exit path. */
  const teardown = useCallback((reason: EndReason, nextPhase: Phase) => {
    const hadSession = Boolean(streamRef.current || clientRef.current);
    epochRef.current++;
    busyRef.current = false;
    clearTimers();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (clientRef.current) {
      try {
        clientRef.current.disconnect();
      } catch {
        /* already closed */
      }
      clientRef.current = null;
    }
    if (outputRef.current) outputRef.current.srcObject = null;
    if (hadSession && sessionIdRef.current) track("session_ended", { reason }, sessionIdRef.current);
    setState((s) => ({ ...s, phase: nextPhase, countdownWord: null, endReason: reason }));
  }, []);

  const garmentBlob = useCallback(async (g: Garment) => {
    if (g.custom) return g.custom.blob;
    const hit = blobCache.current.get(g.id);
    if (hit) return hit;
    const res = await fetch(g.image);
    if (!res.ok) throw new Error(`garment image ${res.status}`);
    const blob = await res.blob();
    blobCache.current.set(g.id, blob);
    return blob;
  }, []);

  const applyGarment = useCallback(
    async (index: number) => {
      const client = clientRef.current;
      const g = garmentsRef.current[index];
      if (!client || !g) return;
      const epoch = epochRef.current;
      rotationRef.current.index = index;
      setState((s) => ({ ...s, activeIndex: index }));
      track("tryon_started", { garment_id: g.id }, sessionIdRef.current);
      try {
        const blob = await garmentBlob(g);
        if (epoch !== epochRef.current) return;
        await client.setImage(blob, { prompt: g.prompt, enhance: false });
        if (epoch === epochRef.current) track("first_frame_rendered", { garment_id: g.id }, sessionIdRef.current);
      } catch (err) {
        track("tryon_error", { garment_id: g.id, message: String((err as Error)?.message ?? err) }, sessionIdRef.current);
      }
    },
    [garmentBlob],
  );

  const startRotation = useCallback(() => {
    rotationRef.current = { index: 0, left: ROTATION_SECONDS, total: ROTATION_SECONDS * ROTATIONS, pinned: false };
    void applyGarment(0);
    timersRef.current.tick = setInterval(() => {
      const r = rotationRef.current;
      r.total--;
      if (r.total <= 0) {
        track("try_timer_ended", {}, sessionIdRef.current);
        teardown("timer", "ended");
        onTimerEndedRef.current?.();
        return;
      }
      if (!r.pinned) {
        r.left--;
        if (r.left <= 0) {
          r.left = ROTATION_SECONDS;
          void applyGarment((r.index + 1) % garmentsRef.current.length);
        }
      }
      setState((s) => ({
        ...s,
        pinned: r.pinned,
        secondsLeft: r.pinned ? r.total : r.left,
        secondsMax: r.pinned ? ROTATION_SECONDS * ROTATIONS : ROTATION_SECONDS,
      }));
    }, 1000);
  }, [applyGarment, teardown]);

  const start = useCallback(async () => {
    if (busyRef.current || clientRef.current) return;
    // Browsers only expose the camera on HTTPS or localhost. Fail fast with a clear,
    // actionable message instead of throwing (e.g. http://192.168.x.x during dev).
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      track("camera_error", { stage: "camera", message: window.isSecureContext ? "getUserMedia unavailable" : "insecure_context" });
      setState({
        ...initial,
        status: window.isSecureContext
          ? "Camera isn't available in this browser."
          : `Camera needs a secure connection. Open ${location.href.replace(/^http:/, "https:")}`,
      });
      return;
    }
    busyRef.current = true;
    const epoch = ++epochRef.current;
    sessionIdRef.current = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const sid = sessionIdRef.current;
    let stage: FailStage = "camera";
    setState({ ...initial, phase: "camera", status: "" });
    void garmentBlob(garmentsRef.current[0]!).catch(() => {}); // warm the first garment

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (epoch !== epochRef.current) return stream.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      track("camera_granted", {}, sid);

      // Countdown runs while we mint + connect (≈5 s).
      setState((s) => ({ ...s, phase: "connecting", status: "Connecting… takes about 5 seconds" }));
      let w = 0;
      const tickWord = () => {
        setState((s) => ({ ...s, countdownWord: COUNTDOWN_WORDS[w] ?? "1" }));
        if (++w < COUNTDOWN_WORDS.length) timersRef.current.countdown = setTimeout(tickWord, 1000);
      };
      tickWord();

      stage = "token";
      const res = await fetch("/api/v1/tokens", { method: "POST", cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string; upstreamStatus?: number | null; detail?: string };
        } | null;
        const e = body?.error;
        // `detail` is only sent by the server in development.
        throw new Error(
          [e?.code ?? `token HTTP ${res.status}`, e?.upstreamStatus ? `decart ${e.upstreamStatus}` : "", e?.detail ?? ""]
            .filter(Boolean)
            .join(" · "),
        );
      }
      const token = (await res.json()) as TokenResponse;
      if (!token?.apiKey || !token.model) throw new Error("token response incomplete");
      if (epoch !== epochRef.current) return;

      stage = "connect";
      const sdk = await import("@decartai/sdk");
      let model: unknown;
      try {
        model = sdk.models.realtime(token.model as Parameters<typeof sdk.models.realtime>[0]);
      } catch {
        // Slug not in this SDK version's registry: same definition shape the SDK uses for lucy-vton.
        model = { name: token.model, urlPath: "/v1/stream", fps: 30, width: 1088, height: 624, inputSchema: {} };
      }
      // When Decart refuses a session (no credits, policy, capacity) the SDK's connect() only rejects with a
      // generic "Stale connect attempt"; the real reason arrives as a logged server error. Capture it.
      let serverError = "";
      const base = sdk.createConsoleLogger("info");
      const logger = {
        ...base,
        error: (msg: string, data?: Record<string, unknown>) => {
          if (data && typeof data.error === "string" && /server error/i.test(msg)) serverError = data.error;
          base.error(msg, data);
        },
      };
      let client: RealtimeClient;
      try {
        client = (await sdk.createDecartClient({ apiKey: token.apiKey, logger }).realtime.connect(stream, {
          model: model as never,
          onRemoteStream: (remote: MediaStream) => {
            if (epoch !== epochRef.current) return;
            clearTimeout(timersRef.current.countdown);
            if (outputRef.current) outputRef.current.srcObject = remote;
            setState((s) => ({ ...s, phase: "live", status: "", countdownWord: null }));
            track("session_started", { model: token.model }, sid);
          },
        })) as unknown as RealtimeClient;
      } catch (connectErr) {
        throw serverError ? new Error(serverError) : connectErr;
      }

      if (epoch !== epochRef.current) {
        client.disconnect();
        return;
      }
      clientRef.current = client;
      busyRef.current = false;

      client.on("connectionChange", (s) => {
        if (s === "disconnected" && epoch === epochRef.current) teardown("error", "idle");
      });
      client.on("error", (err) => {
        track("tryon_error", { message: String((err as Error)?.message ?? err) }, sid);
        setState((s) => ({ ...s, status: "Connection issue. Please try again." }));
      });

      // Hard cap mirrors the token's maxSessionDuration so the UI ends cleanly before Decart cuts it.
      timersRef.current.cap = setTimeout(() => teardown("session_cap", "ended"), token.maxSessionSeconds * 1000);
      startRotation();
    } catch (err) {
      if (epoch !== epochRef.current) return;
      // A refused/missing camera is an expected user outcome, not an app error.
      (stage === "camera" ? console.warn : console.error)(`[tryon] start failed at ${stage}:`, err);
      track("camera_error", { stage, message: String((err as Error)?.message ?? err) }, sid);
      const status =
        process.env.NODE_ENV !== "production" && stage !== "camera"
          ? `${userMessageFor(stage, err)} [dev: ${String((err as Error)?.message ?? err).slice(0, 240)}]`
          : userMessageFor(stage, err);
      // Anything other than a camera problem means the AI service can't serve this visitor (no credits, busy, down):
      // hand over to the free on-device mode instead of leaving them at a dead end. Called before the state
      // updates below so React applies the mode switch and the idle state in one render.
      const fallback = stage !== "camera" ? onUnavailableRef.current : undefined;
      fallback?.();
      teardown("error", "idle");
      if (!fallback) setState((s) => ({ ...s, status }));
    }
  }, [garmentBlob, startRotation, teardown]);

  const selectGarment = useCallback(
    (index: number) => {
      if (state.phase !== "live") return;
      // Choosing a garment yourself stops the auto-rotation so your pick stays on.
      rotationRef.current.pinned = true;
      setState((s) => ({ ...s, pinned: true, secondsLeft: rotationRef.current.total, secondsMax: ROTATION_SECONDS * ROTATIONS }));
      void applyGarment(index);
    },
    [applyGarment, state.phase],
  );

  /** Call right before opening the native camera / file picker so backgrounding the page doesn't end the session. */
  const holdForPicker = useCallback((ms = 120_000) => {
    pickerHoldUntil.current = Date.now() + ms;
  }, []);

  const stop = useCallback((reason: EndReason = "user") => teardown(reason, "ended"), [teardown]);
  const reset = useCallback(() => {
    teardown("user", "idle");
    setState(initial);
  }, [teardown]);

  // Release the camera the moment the tab is hidden (privacy + no billed idle GPU time).
  useEffect(() => {
    const onHide = () => {
      if (!(streamRef.current || clientRef.current)) return;
      if (document.visibilityState === "hidden") {
        if (Date.now() < pickerHoldUntil.current) return; // picking a garment, not leaving
        track("session_reset", { reason: "tab_hidden" }, sessionIdRef.current);
        teardown("tab_hidden", "idle");
      } else if (streamRef.current?.getTracks().some((t) => t.readyState === "ended")) {
        // The OS reclaimed the camera while we were in the background: end cleanly with a clear message.
        teardown("tab_hidden", "idle");
        setState((s) => ({ ...s, status: "Camera paused while you were away. Tap to resume." }));
      }
      pickerHoldUntil.current = 0;
    };
    const onPageHide = () => teardown("tab_hidden", "idle");
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      teardown("user", "idle");
    };
  }, [teardown]);

  return { state, outputRef, start, stop, reset, selectGarment, holdForPicker, sessionId: sessionIdRef };
}
