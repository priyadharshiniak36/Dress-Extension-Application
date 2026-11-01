"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { GARMENTS } from "@/lib/garments";
import { progressIndex, initialOnboarding, onboardingReducer, type Step } from "@/lib/onboarding";
import { useTryOnSession } from "@/hooks/useTryOnSession";
import { useOverlaySession } from "@/hooks/useOverlaySession";
import { useCloset } from "@/hooks/useCloset";
import { track } from "@/lib/analytics";
import { celebrate } from "@/lib/confetti";
import { Logo, Progress } from "@/components/ui";
import { ConsentModal } from "./ConsentModal";
import { DressingRoom } from "./DressingRoom";
import { GarmentGridStep, ShopStep, SurveyStep, TimeoutModal } from "./Steps";

export function Onboarding() {
  const [ui, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const [consentPending, setConsentPending] = useState(false);

  const closet = useCloset();
  const garments = useMemo(() => [...GARMENTS, ...closet.custom], [closet.custom]);

  // Decart live AI is the default. If it can't start (no credits, busy, down) the app falls back to free on-device mode
  // automatically. NEXT_PUBLIC_DEFAULT_MODE=free makes the free mode the default instead.
  const [mode, setMode] = useState<"ai" | "free">(process.env.NEXT_PUBLIC_DEFAULT_MODE === "free" ? "free" : "ai");
  const [fellBack, setFellBack] = useState(false);

  const free = useOverlaySession({ garments });
  const ai = useTryOnSession({
    garments,
    onTimerEnded: () => {
      dispatch({ type: "TRY_TIMER_ENDED" });
      void celebrate();
    },
    // AI service can't start a session (no credits, busy, down): continue in free mode instead of a dead end.
    onUnavailable: () => {
      track("session_reset", { reason: "ai_unavailable_fallback_free" });
      setFellBack(true);
      setMode("free");
      void free.start();
    },
  });
  const session = mode === "free" ? free : ai;
  const { phase, status } = session.state;

  // A garment the user just added goes on immediately (once live).
  const { lastAdded } = closet;
  useEffect(() => {
    if (!lastAdded) return;
    const i = garments.findIndex((g) => g.id === lastAdded);
    if (i >= 0) session.selectGarment(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAdded]);

  useEffect(() => track("onboarding_opened"), []);

  // Consent modal closes once the camera is ours (as in the original), or reopens its button on failure.
  const sawCameraPrompt = useRef(false);
  useEffect(() => {
    if (!consentPending) return;
    if (phase === "camera") sawCameraPrompt.current = true;
    if (phase === "connecting" || phase === "live") {
      setConsentPending(false);
      dispatch({ type: "CONSENT_ACCEPTED" });
      void celebrate();
    } else if (phase === "idle" && (sawCameraPrompt.current || status)) {
      sawCameraPrompt.current = false;
      setConsentPending(false); // camera refused: keep the modal, show the reason
    }
  }, [consentPending, phase, status]);

  // Leaving the dressing room always releases the camera and GPU session.
  const prevStep = useRef<Step>(ui.step);
  useEffect(() => {
    const from = prevStep.current;
    prevStep.current = ui.step;
    if (from === ui.step) return;
    if (from === "dressing") {
      ai.reset();
      free.reset();
    }
    if (from === "survey" && ui.step === "shop") {
      track("profile_answered", { gender: ui.gender, age_range: ui.age });
      void celebrate();
    }
    if (from === "garments" && ui.step === "survey") void celebrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.step]);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-[520px] flex-col px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))] sm:pb-8 sm:pt-8">
      <header className="mb-4 shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <Logo />
          <span className="font-display text-[11px] font-bold tracking-[0.14em] text-muted">
            {String(progressIndex(ui.step) + 1).padStart(2, "0")}/04
          </span>
        </div>
        <Progress active={progressIndex(ui.step)} />
      </header>

      {ui.step === "dressing" || ui.step === "consent" ? (
        <DressingRoom
          garments={garments}
          closet={closet}
          onHoldPicker={() => session.holdForPicker()}
          freeMode={mode === "free"}
          onCaptureFrame={mode === "free" ? free.captureFrame : undefined}
          fellBack={fellBack}
          onToggleMode={() => {
            if (session.state.phase !== "idle") return;
            setFellBack(false);
            setMode((m) => (m === "free" ? "ai" : "free"));
          }}
          state={session.state}
          outputRef={session.outputRef}
          onStart={() => void session.start()}
          onSelect={session.selectGarment}
          onContinue={() => {
            track("continue_clicked");
            dispatch({ type: "CONTINUE" });
          }}
          onNudgeShop={() => dispatch({ type: "NUDGE_SHOP" })}
        />
      ) : null}

      {ui.step === "garments" && (
        <GarmentGridStep
          onShop={() => {
            track("garments_shop_clicked");
            void celebrate();
            dispatch({ type: "GARMENTS_NEXT" });
          }}
          onBack={() => dispatch({ type: "GARMENTS_BACK" })}
          onNext={() => dispatch({ type: "GARMENTS_NEXT" })}
        />
      )}

      {ui.step === "survey" && (
        <SurveyStep
          gender={ui.gender}
          age={ui.age}
          onGender={(gender) => dispatch({ type: "SET_GENDER", gender })}
          onAge={(age) => dispatch({ type: "SET_AGE", age })}
          onBack={() => dispatch({ type: "SURVEY_BACK" })}
        />
      )}

      {ui.step === "shop" && (
        <ShopStep onBack={() => dispatch({ type: "SHOP_BACK" })} onOpenDressingRoom={() => dispatch({ type: "OPEN_DRESSING" })} />
      )}

      {ui.step === "consent" && (
        <ConsentModal
          pending={consentPending}
          status={phase === "idle" ? status : ""}
          onAccept={() => {
            track("consent_completed");
            setConsentPending(true);
            void session.start();
          }}
        />
      )}

      {ui.timeoutModalOpen && <TimeoutModal onContinue={() => dispatch({ type: "TIMEOUT_CONTINUE" })} />}
    </main>
  );
}
