"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-[15px] font-bold uppercase tracking-[0.18em] ${className}`} aria-label="Tryanything">
      Try<span className="text-lime">/</span>anything
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost"; icon?: ReactNode };

/** Lime primary or outlined ghost button. Squarish 16px radius — deliberately not a pill. */
export function Button({ className = "", variant = "primary", icon, children, ...rest }: BtnProps) {
  const look =
    variant === "primary"
      ? "bg-lime text-bg hover:bg-lime-dim shadow-[0_8px_30px_rgb(198_255_61/0.25)]"
      : "border border-line bg-white/[0.03] text-fg hover:bg-white/[0.07]";
  return (
    <button
      {...rest}
      className={`flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 font-display text-[15px] font-bold tracking-wide transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${look} ${className}`}
    >
      {children}
      {icon}
    </button>
  );
}

export const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export function Chip({ selected, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...rest}
      className={`rounded-xl border px-3 py-3.5 text-[14px] font-medium transition active:scale-[0.97] ${
        selected ? "border-lime bg-lime text-bg" : "border-line bg-surface text-fg/80 hover:border-white/25"
      } ${className}`}
    />
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-3 font-display text-[11px] font-bold uppercase tracking-[0.22em] text-lime">{children}</p>;
}

export function Title({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`font-display text-[34px] font-bold leading-[0.95] tracking-[-0.03em] sm:text-[44px] ${className}`}>{children}</h2>;
}

const SEGMENTS = ["Try on", "Picks", "You", "Shop"] as const;

/** Segmented progress bar with labels. */
export function Progress({ active }: { active: 0 | 1 | 2 | 3 }) {
  return (
    <div className="flex w-full gap-1.5" aria-label={`Step ${active + 1} of ${SEGMENTS.length}: ${SEGMENTS[active]}`}>
      {SEGMENTS.map((s, i) => (
        <div key={s} className="flex-1">
          <div className={`h-[3px] rounded-full transition-colors duration-500 ${i <= active ? "bg-lime" : "bg-white/10"}`} />
          <p className={`mt-1.5 text-[10px] uppercase tracking-[0.14em] ${i === active ? "text-fg" : "text-muted"}`}>{s}</p>
        </div>
      ))}
    </div>
  );
}

export function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 min-w-11 py-2 pr-3 text-left text-sm text-muted transition hover:text-fg">
      ← Back
    </button>
  );
}
