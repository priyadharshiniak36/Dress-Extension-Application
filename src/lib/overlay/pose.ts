import type { PoseLandmarker } from "@mediapipe/tasks-vision";

let cached: Promise<PoseLandmarker> | null = null;

/**
 * Loads MediaPipe's pose model once (self-hosted under /mediapipe, so no third-party request and CSP stays tight).
 * Tries the GPU delegate first and falls back to CPU, which some phones need.
 */
export function loadPose(): Promise<PoseLandmarker> {
  if (!cached) {
    cached = (async () => {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const make = (delegate: "GPU" | "CPU") =>
        vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_lite.task", delegate },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        return await make("GPU");
      } catch {
        return await make("CPU");
      }
    })();
    // A failed load must be retryable (e.g. flaky network on first visit).
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
