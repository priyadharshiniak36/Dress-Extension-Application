"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Garment } from "@/lib/garments";
import { track } from "@/lib/analytics";
import { loadPose } from "@/lib/overlay/pose";
import { loadSprite, type Sprite } from "@/lib/overlay/sprite";
import { computeQuad, createQuadSmoother, forearmPolygons, framingHint, type Landmark, type Quad } from "@/lib/overlay/transform";
import { drawWarped } from "@/lib/overlay/warp";
import { meanLuminance, tintSprite, toneForLuminance } from "@/lib/overlay/lighting";
import { userMessageFor, type EndReason, type Phase, type TryOnState } from "@/hooks/useTryOnSession";

const initial: TryOnState = {
  phase: "idle",
  status: "",
  countdownWord: null,
  activeIndex: 0,
  secondsLeft: 0,
  secondsMax: 0, // 0 = no timer: free mode has no session cap
  pinned: true,
  hint: "",
  endReason: null,
};

/**
 * Free, on-device try-on. The camera never leaves the phone: MediaPipe finds the shoulders and hips, the garment
 * photo (background removed) is drawn on top, and the result is exposed as a MediaStream so the same <video>
 * UI as the AI session can show it. Same return shape as useTryOnSession.
 */
export function useOverlaySession(opts: { garments: readonly Garment[] }) {
  const garmentsRef = useRef(opts.garments);
  garmentsRef.current = opts.garments;

  const [state, setState] = useState<TryOnState>(initial);
  const outputRef = useRef<HTMLVideoElement | null>(null);

  const epochRef = useRef(0);
  const busyRef = useRef(false);
  const live = useRef<{
    camera: MediaStream;
    video: HTMLVideoElement;
    out: MediaStream;
    raf: number;
  } | null>(null);
  const activeRef = useRef(0);
  const spriteRef = useRef<Sprite | null>(null);
  const pickerHoldUntil = useRef(0);
  const hintRef = useRef("");
  const sessionIdRef = useRef<string | null>(null);

  const teardown = useCallback((reason: EndReason, nextPhase: Phase) => {
    epochRef.current++;
    busyRef.current = false;
    const l = live.current;
    live.current = null;
    if (l) {
      cancelAnimationFrame(l.raf);
      l.camera.getTracks().forEach((t) => t.stop());
      l.out.getTracks().forEach((t) => t.stop());
      l.video.srcObject = null;
      l.video.remove();
      if (sessionIdRef.current) track("session_ended", { reason, mode: "free" }, sessionIdRef.current);
    }
    spriteRef.current = null;
    if (outputRef.current) outputRef.current.srcObject = null;
    setState((s) => ({ ...s, phase: nextPhase, countdownWord: null, endReason: reason }));
  }, []);

  /** Loads the sprite for the active garment; keeps showing the previous one until the new one is ready. */
  const activate = useCallback(async (index: number) => {
    const g = garmentsRef.current[index];
    if (!g) return;
    activeRef.current = index;
    setState((s) => ({ ...s, activeIndex: index }));
    const epoch = epochRef.current;
    try {
      const sprite = await loadSprite(g);
      if (epoch === epochRef.current && activeRef.current === index) spriteRef.current = sprite;
    } catch (err) {
      track("tryon_error", { garment_id: g.id, mode: "free", message: String((err as Error)?.message ?? err).slice(0, 120) }, sessionIdRef.current);
    }
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current || live.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState({ ...initial, status: window.isSecureContext ? "Camera isn't available in this browser." : "Camera needs a secure connection (https)." });
      return;
    }
    if (typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) {
      setState({ ...initial, status: "This browser can't run free mode. Try Chrome or Safari 15+." });
      return;
    }
    busyRef.current = true;
    hintRef.current = "";
    const epoch = ++epochRef.current;
    const sid = (sessionIdRef.current = `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
    setState({ ...initial, phase: "camera" });

    let camera: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let stage: "camera" | "model" = "camera";
    try {
      camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
        audio: false,
      });
      if (epoch !== epochRef.current) return camera.getTracks().forEach((t) => t.stop());
      track("camera_granted", { mode: "free" }, sid);
      setState((s) => ({ ...s, phase: "connecting", status: "Loading on-device tracking… first time takes a few seconds" }));

      stage = "model";
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("aria-hidden", "true");
      Object.assign(video.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", left: "0", top: "0" });
      document.body.appendChild(video);
      video.srcObject = camera;
      await video.play();
      const pose = await loadPose();
      if (epoch !== epochRef.current) {
        video.remove();
        return camera.getTracks().forEach((t) => t.stop());
      }

      const W = video.videoWidth || 960;
      const H = video.videoHeight || 540;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { alpha: false })!;
      const out = canvas.captureStream(30);
      if (outputRef.current) outputRef.current.srcObject = out;

      const smoother = createQuadSmoother();
      let lastVideoTime = -1;
      let lastLms: Landmark[] | null = null;
      let frameNo = 0;
      let tone = 1;
      let tinted: { src: HTMLCanvasElement; tone: number; canvas: HTMLCanvasElement } | null = null;
      // Tiny canvas used to read the scene brightness cheaply (downscaled on the GPU, then read back 16×16 pixels).
      const sampler = document.createElement("canvas");
      sampler.width = sampler.height = 16;
      const sctx = sampler.getContext("2d", { willReadFrequently: true })!;
      const v = video;

      const frame = () => {
        const l = live.current;
        if (!l || epoch !== epochRef.current) return;
        l.raf = requestAnimationFrame(frame);
        if (v.readyState < 2) return;
        ctx.drawImage(v, 0, 0, W, H);
        const sprite = spriteRef.current;
        let raw: Quad | null = null;
        if (sprite && v.currentTime !== lastVideoTime) {
          lastVideoTime = v.currentTime;
          try {
            lastLms = (pose.detectForVideo(v, performance.now()).landmarks[0] as Landmark[] | undefined) ?? null;
            raw = lastLms ? computeQuad(lastLms, sprite.aspect, W, H) : null;
            const next = framingHint(lastLms);
            if (next !== hintRef.current) {
              hintRef.current = next;
              setState((s) => ({ ...s, hint: next }));
            }
          } catch {
            lastLms = null; // one bad frame must not stop the camera feed
          }
        }
        const sm = sprite ? smoother.update(raw, performance.now()) : null;
        if (!sm || !sprite) return;
        const { q, opacity } = sm;

        // Match the garment's brightness to the room (re-measured a few times a second, only re-tinted on real change).
        if (frameNo++ % 8 === 0) {
          const cx = (q.tl.x + q.tr.x + q.bl.x + q.br.x) / 4,
            cy = (q.tl.y + q.tr.y + q.bl.y + q.br.y) / 4;
          const s = Math.max(24, Math.abs(q.tr.x - q.tl.x) * 0.5);
          sctx.drawImage(v, cx - s / 2, cy - s / 2, s, s, 0, 0, 16, 16);
          tone = toneForLuminance(meanLuminance(sctx.getImageData(0, 0, 16, 16).data));
        }
        if (!tinted || tinted.src !== sprite.canvas || Math.abs(tinted.tone - tone) > 0.04) {
          tinted = { src: sprite.canvas, tone, canvas: tintSprite(sprite.canvas, tone, tinted?.src === sprite.canvas ? tinted.canvas : undefined) };
        }

        ctx.globalAlpha = opacity;
        drawWarped(ctx, tinted.canvas, q);
        ctx.globalAlpha = 1;

        // A forearm crossing the chest is in front of the garment: put the camera pixels for it back on top.
        if (lastLms && opacity > 0.5) {
          for (const poly of forearmPolygons(lastLms, q, W, H)) {
            ctx.save();
            ctx.beginPath();
            poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(v, 0, 0, W, H);
            ctx.restore();
          }
        }
      };

      live.current = { camera, video, out, raf: 0 };
      busyRef.current = false;
      activeRef.current = 0;
      void activate(0);
      live.current.raf = requestAnimationFrame(frame);
      setState((s) => ({ ...s, phase: "live", status: "", countdownWord: null }));
      track("session_started", { model: "on-device", mode: "free" }, sid);
    } catch (err) {
      camera?.getTracks().forEach((t) => t.stop());
      video?.remove();
      if (epoch !== epochRef.current) return;
      console.warn(`[free] start failed at ${stage}:`, err);
      track("camera_error", { stage, mode: "free", message: String((err as Error)?.message ?? err).slice(0, 120) }, sid);
      busyRef.current = false;
      epochRef.current++;
      setState({
        ...initial,
        status:
          stage === "camera"
            ? userMessageFor("camera", err)
            : "Couldn't load the on-device tracking. Check your connection and try again.",
      });
    }
  }, [activate]);

  const selectGarment = useCallback(
    (index: number) => {
      if (state.phase !== "live") return;
      void activate(index);
    },
    [activate, state.phase],
  );

  const holdForPicker = useCallback((ms = 120_000) => {
    pickerHoldUntil.current = Date.now() + ms;
  }, []);
  /** A clean camera photo (no garment drawn on it, ≤1024 px JPEG) for the realistic photo try-on. */
  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    const l = live.current;
    if (!l || l.video.readyState < 2) return null;
    const k = Math.min(1, 1024 / Math.max(l.video.videoWidth, l.video.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(l.video.videoWidth * k);
    c.height = Math.round(l.video.videoHeight * k);
    c.getContext("2d")!.drawImage(l.video, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.9));
  }, []);

  const stop = useCallback((reason: EndReason = "user") => teardown(reason, "ended"), [teardown]);
  const reset = useCallback(() => {
    teardown("user", "idle");
    setState(initial);
  }, [teardown]);

  // When free mode takes over from the AI session the <video> ref switches owner after start() began; make sure
  // the stream ends up attached.
  useEffect(() => {
    const l = live.current;
    if (state.phase === "live" && l && outputRef.current && outputRef.current.srcObject !== l.out) outputRef.current.srcObject = l.out;
  }, [state.phase]);

  // Release the camera when the tab is hidden, like the AI session (unless the OS camera/file picker is open).
  useEffect(() => {
    const onHide = () => {
      if (!live.current) return;
      if (document.visibilityState === "hidden") {
        if (Date.now() < pickerHoldUntil.current) return;
        teardown("tab_hidden", "idle");
      } else if (live.current.camera.getTracks().some((t) => t.readyState === "ended")) {
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

  return { state, outputRef, start, stop, reset, selectGarment, holdForPicker, captureFrame, sessionId: sessionIdRef };
}
