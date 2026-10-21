"use client";

import { useCallback, useState } from "react";
import { EMPTY_DRAFT, type BookingDraft, type BookingField } from "@/lib/booking/types";
import { STAGE_FIELDS, localNow, toBookingRequest, validateStage, type FormStage, type ValidationErrors } from "@/lib/booking/validation";

export type Stage = FormStage | "review" | "done";

type State = {
  draft: BookingDraft;
  stage: Stage;
  /** Errors currently shown. */
  errors: ValidationErrors;
  /** Stages the customer has tried to submit — those re-validate live as they type. */
  attempted: Partial<Record<FormStage, boolean>>;
  /** True while editing a stage opened from the review screen. */
  editingFromReview: boolean;
};

const INITIAL: State = { draft: EMPTY_DRAFT, stage: "route", errors: {}, attempted: {}, editingFromReview: false };

/**
 * Client-only booking flow. Nothing here is sent or stored: the final
 * step builds a BookingRequest in memory to prove the data is complete.
 */
export function useBookingForm() {
  const [state, setState] = useState<State>(INITIAL);

  const setField = useCallback(<K extends BookingField>(field: K, value: BookingDraft[K]) => {
    setState((s) => {
      const draft = { ...s.draft, [field]: value };
      const stage = s.stage === "route" || s.stage === "details" ? s.stage : null;
      // Live re-validation only after a submit attempt, so errors never appear while typing for the first time.
      const errors = stage && s.attempted[stage] ? validateStage(draft, stage, localNow()) : s.errors;
      return { ...s, draft, errors };
    });
  }, []);

  /** Validates the current stage; on success advances and returns null, otherwise returns the errors. */
  const submitStage = useCallback(
    (stage: FormStage): ValidationErrors | null => {
      const errors = validateStage(state.draft, stage, localNow());
      const failed = Object.keys(errors).length > 0;
      setState((s) => {
        if (failed) return { ...s, errors, attempted: { ...s.attempted, [stage]: true } };
        const next: Stage = s.editingFromReview || stage === "details" ? "review" : "details";
        return { ...s, errors: {}, stage: next, editingFromReview: next === "review" ? false : s.editingFromReview };
      });
      return failed ? errors : null;
    },
    [state.draft],
  );

  const goBack = useCallback(() => {
    setState((s) => ({ ...s, stage: "route", errors: {}, editingFromReview: false }));
  }, []);

  const editStage = useCallback((stage: FormStage) => {
    setState((s) => ({ ...s, stage, errors: {}, editingFromReview: true }));
  }, []);

  const returnToReview = useCallback(() => {
    setState((s) => ({ ...s, stage: "review", errors: {}, editingFromReview: false }));
  }, []);

  /** Final prototype confirmation: re-validates everything; nothing leaves the browser. */
  const confirm = useCallback((): ValidationErrors | null => {
    const result = toBookingRequest(state.draft, localNow());
    if (!result.ok) {
      const firstStage: FormStage = STAGE_FIELDS.route.some((f) => result.errors[f]) ? "route" : "details";
      setState((s) => ({
        ...s,
        stage: firstStage,
        errors: result.errors,
        attempted: { route: true, details: true },
        editingFromReview: true,
      }));
      return result.errors;
    }
    setState((s) => ({ ...s, stage: "done" }));
    return null;
  }, [state.draft]);

  const restart = useCallback(() => setState(INITIAL), []);

  return { ...state, setField, submitStage, goBack, editStage, returnToReview, confirm, restart };
}

export type BookingForm = ReturnType<typeof useBookingForm>;

export const fieldId = (field: BookingField) => `booking-${field}`;
