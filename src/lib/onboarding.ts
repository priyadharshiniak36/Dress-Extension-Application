/**
 * Onboarding step machine (pure, unit-tested).
 * Flow mirrors Anywear: consent → dressing room → garments → survey → shop.
 */
export type Step = "consent" | "dressing" | "garments" | "survey" | "shop";

export type Gender = "woman" | "man" | "other";
export const AGE_RANGES = ["18-20", "21-24", "25-34", "35-44", "45-54", "55+"] as const;
export type AgeRange = (typeof AGE_RANGES)[number];

export type OnboardingState = {
  step: Step;
  timeoutModalOpen: boolean;
  gender: Gender | null;
  age: AgeRange | null;
};

export type OnboardingAction =
  | { type: "CONSENT_ACCEPTED" }
  | { type: "TRY_TIMER_ENDED" }
  | { type: "TIMEOUT_CONTINUE" }
  | { type: "CONTINUE" } // "Try more outfits" CTA under the live feed
  | { type: "NUDGE_SHOP" }
  | { type: "GARMENTS_NEXT" }
  | { type: "GARMENTS_BACK" }
  | { type: "SET_GENDER"; gender: Gender }
  | { type: "SET_AGE"; age: AgeRange }
  | { type: "SURVEY_BACK" }
  | { type: "SHOP_BACK" }
  | { type: "OPEN_DRESSING" };

export const initialOnboarding: OnboardingState = { step: "consent", timeoutModalOpen: false, gender: null, age: null };

export function onboardingReducer(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case "CONSENT_ACCEPTED":
      return s.step === "consent" ? { ...s, step: "dressing" } : s;
    case "TRY_TIMER_ENDED":
      return s.step === "dressing" ? { ...s, timeoutModalOpen: true } : s;
    case "TIMEOUT_CONTINUE":
      return { ...s, timeoutModalOpen: false, step: "garments" };
    case "CONTINUE":
      return s.step === "dressing" ? { ...s, step: "garments" } : s;
    case "NUDGE_SHOP":
      return s.step === "dressing" ? { ...s, step: "shop" } : s;
    case "GARMENTS_NEXT":
      return s.step === "garments" ? { ...s, step: "survey" } : s;
    case "GARMENTS_BACK":
      return s.step === "garments" ? { ...s, step: "dressing" } : s;
    case "SET_GENDER":
      return advanceSurvey({ ...s, gender: a.gender });
    case "SET_AGE":
      return advanceSurvey({ ...s, age: a.age });
    case "SURVEY_BACK":
      return s.step === "survey" ? { ...s, step: "garments" } : s;
    case "SHOP_BACK":
      return s.step === "shop" ? { ...s, step: "survey" } : s;
    case "OPEN_DRESSING":
      return s.step === "consent" ? s : { ...s, step: "dressing", timeoutModalOpen: false };
  }
}

function advanceSurvey(s: OnboardingState): OnboardingState {
  return s.step === "survey" && s.gender && s.age ? { ...s, step: "shop" } : s;
}

/** Segment of the 4-part progress bar: Try on · Picks · You · Shop. */
export function progressIndex(step: Step): 0 | 1 | 2 | 3 {
  switch (step) {
    case "garments":
      return 1;
    case "survey":
      return 2;
    case "shop":
      return 3;
    default:
      return 0;
  }
}
