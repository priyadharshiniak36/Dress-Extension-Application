"use client";

import { useState, type ReactNode } from "react";
import { Arrow, Button, Eyebrow, Logo, Title } from "@/components/ui";

const LINKS = {
  terms: process.env.NEXT_PUBLIC_TERMS_URL || "/legal/terms",
  privacy: process.env.NEXT_PUBLIC_PRIVACY_URL || "/legal/privacy",
  aup: process.env.NEXT_PUBLIC_AUP_URL || "/legal/aup",
};

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-lime">{icon}</span>
      <span className="text-[14px] leading-snug text-fg/80">{children}</span>
    </li>
  );
}

const ic = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** Bottom sheet on phones, centered card on larger screens. */
export function ConsentModal({ pending, status, onAccept }: { pending: boolean; status: string; onAccept: () => void }) {
  // Affirmative consent: the switch starts off.
  const [agreed, setAgreed] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        className="sheet-up w-full max-w-[460px] rounded-t-[28px] border border-line bg-surface px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 sm:rounded-[28px] sm:pb-8 sm:pt-8"
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden />
        <Logo className="mb-6 block text-muted" />
        <Eyebrow>Before we start</Eyebrow>
        <Title className="mb-6">
          <span id="consent-title">
            Your mirror,
            <br />
            <span className="text-lime">but smarter.</span>
          </span>
        </Title>

        <ul className="mb-6 space-y-3">
          <Point icon={<svg {...ic}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>}>
            Your camera streams live to our AI only while you&apos;re trying on.
          </Point>
          <Point icon={<svg {...ic}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>}>
            Sessions end automatically after 3 minutes or when you leave the tab.
          </Point>
          <Point icon={<svg {...ic}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}>
            Tryanything doesn&apos;t record or store your video.
          </Point>
        </ul>

        <label
          className={`mb-5 flex cursor-pointer select-none items-center gap-4 rounded-2xl border p-4 transition ${
            needsConsent ? "border-lime bg-lime/10" : "border-line bg-raised"
          }`}
        >
          <span className="flex-1 text-[13px] leading-relaxed text-fg/75">
            I agree to the{" "}
            <a href={LINKS.terms} target="_blank" rel="noopener noreferrer" className="text-fg underline decoration-white/30 underline-offset-2">
              Terms
            </a>
            ,{" "}
            <a href={LINKS.privacy} target="_blank" rel="noopener noreferrer" className="text-fg underline decoration-white/30 underline-offset-2">
              Privacy
            </a>{" "}
            &amp;{" "}
            <a href={LINKS.aup} target="_blank" rel="noopener noreferrer" className="text-fg underline decoration-white/30 underline-offset-2">
              Acceptable Use
            </a>{" "}
            and I&apos;m 18 or older.
          </span>
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (e.target.checked) setNeedsConsent(false);
            }}
          />
          <span
            aria-hidden
            className="relative h-7 w-12 shrink-0 rounded-full bg-white/15 transition peer-checked:bg-lime peer-focus-visible:ring-2 peer-focus-visible:ring-lime peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5 peer-checked:after:bg-bg"
          />
        </label>

        <Button
          disabled={pending}
          aria-disabled={!agreed}
          className={agreed ? "" : "opacity-60"}
          icon={<Arrow />}
          onClick={() => {
            if (!agreed) return setNeedsConsent(true);
            onAccept();
          }}
        >
          {pending ? "Waiting for camera…" : "Turn on camera"}
        </Button>
        <p role="status" aria-live="polite" className="mt-3 min-h-4 text-center text-xs text-muted">
          {needsConsent ? "Flip the switch above to continue." : status}
        </p>
      </div>
    </div>
  );
}
