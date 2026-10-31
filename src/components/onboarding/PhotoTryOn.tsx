"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Garment } from "@/lib/garments";
import { track } from "@/lib/analytics";
import { Button } from "@/components/ui";

type Step = "idle" | "confirm" | "working" | "done" | "error";

async function garmentBlob(g: Garment): Promise<Blob> {
  if (g.custom) return g.custom.blob;
  const res = await fetch(g.image);
  if (!res.ok) throw new Error("garment image");
  return res.blob();
}

/**
 * "Realistic photo" button + flow: takes a clean camera photo, sends it with the selected garment to our server,
 * which asks Google Gemini to dress the person in it. Shown only when the server has a GEMINI_API_KEY.
 * The photo leaves the device only after the visitor confirms.
 */
export function PhotoTryOn({ garment, capture }: { garment: Garment | undefined; capture: () => Promise<Blob | null> }) {
  const [enabled, setEnabled] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const person = useRef<Blob | null>(null);

  useEffect(() => {
    let off = false;
    fetch("/api/v1/tryon-photo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j: { enabled?: boolean }) => !off && setEnabled(Boolean(j.enabled)))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result);
    },
    [result],
  );

  if (!enabled || !garment) return null;

  const begin = async () => {
    setError("");
    person.current = await capture(); // photo taken now, before the dialog covers the camera
    if (!person.current) {
      setError("Couldn't take a photo. Make sure the camera is on.");
      setStep("error");
      return;
    }
    setStep("confirm");
  };

  const send = async () => {
    setStep("working");
    track("tryon_started", { garment_id: garment.id, mode: "photo" });
    try {
      const form = new FormData();
      form.append("person", person.current!, "person.jpg");
      form.append("garment", await garmentBlob(garment), "garment.jpg");
      const res = await fetch("/api/v1/tryon-photo", { method: "POST", body: form });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(e?.error?.message ?? "Realistic photo try-on couldn't run right now.");
      }
      setResult(URL.createObjectURL(await res.blob()));
      setStep("done");
      track("first_frame_rendered", { garment_id: garment.id, mode: "photo" });
    } catch (err) {
      setError((err as Error).message);
      setStep("error");
      track("tryon_error", { garment_id: garment.id, mode: "photo", message: String((err as Error).message).slice(0, 120) });
    } finally {
      person.current = null; // never keep the photo around
    }
  };

  const close = () => {
    setStep("idle");
    setResult(null);
    setError("");
    person.current = null;
  };

  return (
    <>
      <button
        type="button"
        onClick={begin}
        className="glass min-h-11 rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-lime"
      >
        Realistic photo
      </button>

      {step !== "idle" &&
        // Portal to <body>: inside the video overlay the dock's stacking layer would paint over this dialog.
        createPortal(
        <div role="dialog" aria-modal="true" aria-label="Realistic photo try-on" className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-[440px] rounded-[24px] border border-line bg-surface p-5">
            {step === "confirm" && (
              <>
                <h3 className="font-display text-xl font-bold">Make a realistic photo?</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  We&apos;ll send this one photo of you and the garment to Google&apos;s Gemini AI to create a picture of you wearing it. It
                  takes a few seconds. We don&apos;t store the photo. Only continue if you&apos;re OK with that.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button onClick={send}>Send &amp; create</Button>
                </div>
              </>
            )}
            {step === "working" && (
              <div className="py-6 text-center" aria-live="polite">
                <p className="font-display text-lg font-bold text-lime">Creating your photo…</p>
                <p className="mt-2 text-sm text-muted">This takes about 10 seconds.</p>
              </div>
            )}
            {step === "done" && result && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result} alt="You wearing the selected garment" className="max-h-[60dvh] w-full rounded-2xl object-contain" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <a href={result} download="tryanything.png" className="flex items-center justify-center rounded-2xl bg-lime px-4 py-3 font-display text-sm font-bold text-bg">
                    Save
                  </a>
                  <Button variant="ghost" onClick={close}>
                    Close
                  </Button>
                </div>
              </>
            )}
            {step === "error" && (
              <>
                <h3 className="font-display text-xl font-bold">Couldn&apos;t make the photo</h3>
                <p role="alert" className="mt-2 text-sm text-muted">
                  {error}
                </p>
                <Button className="mt-4" variant="ghost" onClick={close}>
                  Close
                </Button>
              </>
            )}
          </div>
        </div>,
        document.body,
        )}
    </>
  );
}
