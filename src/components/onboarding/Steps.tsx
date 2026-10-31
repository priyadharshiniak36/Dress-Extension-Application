"use client";

import { GARMENTS, STORES } from "@/lib/garments";
import { AGE_RANGES, type AgeRange, type Gender } from "@/lib/onboarding";
import { Arrow, BackLink, Button, Chip, Eyebrow, Title } from "@/components/ui";
import { track } from "@/lib/analytics";

export function GarmentGridStep({ onShop, onBack, onNext }: { onShop: () => void; onBack: () => void; onNext: () => void }) {
  return (
    <div className="rise flex min-h-0 flex-1 flex-col">
      <Eyebrow>You tried 4 looks</Eyebrow>
      <Title className="mb-5">Your picks.</Title>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-3 overflow-y-auto">
        {GARMENTS.map((g, i) => (
          <figure key={g.id} className="relative flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface">
            <span className="absolute left-3 top-3 font-display text-[11px] font-bold tracking-[0.14em] text-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="m-2 mb-0 flex min-h-0 flex-1 items-center justify-center rounded-2xl bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.image} alt={g.name} className="max-h-full max-w-full object-contain" />
            </div>
            <figcaption className="px-3 py-2.5 text-[13px] font-medium">{g.name}</figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-4 flex shrink-0 flex-col gap-2">
        <Button onClick={onShop} icon={<Arrow />}>
          Find clothes like these
        </Button>
        <div className="flex items-center justify-between">
          <BackLink onClick={onBack} />
          <button type="button" onClick={onNext} className="min-h-11 min-w-11 py-2 pl-3 text-right text-sm font-medium text-fg/80 hover:text-fg">
            Skip →
          </button>
        </div>
      </div>
    </div>
  );
}

const GENDERS: { value: Gender; label: string }[] = [
  { value: "woman", label: "Womenswear" },
  { value: "man", label: "Menswear" },
  { value: "other", label: "Both / other" },
];

const AGE_LABEL: Record<AgeRange, string> = {
  "18-20": "18–20",
  "21-24": "21–24",
  "25-34": "25–34",
  "35-44": "35–44",
  "45-54": "45–54",
  "55+": "55+",
};

export function SurveyStep({
  gender,
  age,
  onGender,
  onAge,
  onBack,
}: {
  gender: Gender | null;
  age: AgeRange | null;
  onGender: (g: Gender) => void;
  onAge: (a: AgeRange) => void;
  onBack: () => void;
}) {
  return (
    <div className="rise flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center">
        <Eyebrow>Two quick taps</Eyebrow>
        <Title className="mb-8">Tune it to you.</Title>

        <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.16em] text-muted">I shop</p>
        <div className="mb-8 grid grid-cols-3 gap-2" role="group" aria-label="I shop">
          {GENDERS.map((g) => (
            <Chip key={g.value} selected={gender === g.value} onClick={() => onGender(g.value)}>
              {g.label}
            </Chip>
          ))}
        </div>

        <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.16em] text-muted">My age</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="My age">
          {AGE_RANGES.map((a) => (
            <Chip key={a} selected={age === a} onClick={() => onAge(a)} className="font-display tabular-nums">
              {AGE_LABEL[a]}
            </Chip>
          ))}
        </div>
        <p className="mt-5 text-xs text-muted">Pick both and we&apos;ll take you to the shops.</p>
      </div>
      <div className="shrink-0">
        <BackLink onClick={onBack} />
      </div>
    </div>
  );
}

export function ShopStep({ onBack, onOpenDressingRoom }: { onBack: () => void; onOpenDressingRoom: () => void }) {
  return (
    <div className="rise flex min-h-0 flex-1 flex-col">
      <Eyebrow>You&apos;re all set</Eyebrow>
      <Title className="mb-5">Shop anywhere.</Title>

      <button
        type="button"
        onClick={onOpenDressingRoom}
        className="mb-5 flex shrink-0 items-center gap-4 rounded-[20px] border border-lime/40 bg-lime/[0.07] p-4 text-left transition hover:bg-lime/[0.12]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lime text-bg">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </span>
        <span className="flex-1">
          <span className="block font-display text-[15px] font-bold">Back to the dressing room</span>
          <span className="block text-xs text-muted">Try the looks again any time</span>
        </span>
        <Arrow />
      </button>

      <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.16em] text-muted">Stores</p>
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-[20px] border border-line bg-surface">
        {STORES.map((s) => (
          <li key={s.name}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("store_clicked", { store: s.name })}
              className="flex items-center justify-between px-4 py-3.5 text-[15px] font-medium transition hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 font-display text-xs font-bold text-lime">
                  {s.name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}
                </span>
                {s.name}
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted" aria-hidden>
                <path d="M7 17 17 7M8 7h9v9" />
              </svg>
            </a>
          </li>
        ))}
      </ul>
      <div className="shrink-0 pt-2">
        <BackLink onClick={onBack} />
      </div>
    </div>
  );
}

export function TimeoutModal({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Try-on finished"
        className="sheet-up w-full max-w-[460px] rounded-t-[28px] border border-line bg-surface px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-8 text-center sm:rounded-[28px] sm:pb-8"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-lime text-bg">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </div>
        <Eyebrow>4 looks · 1 minute</Eyebrow>
        <Title className="mb-6">That&apos;s a wrap.</Title>
        <Button onClick={onContinue} icon={<Arrow />} autoFocus>
          See my picks
        </Button>
      </div>
    </div>
  );
}
