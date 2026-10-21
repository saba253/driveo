"use client";

import { useCallback, useRef, useState } from "react";
import {
  BOOKINGS_ENDPOINT,
  IDEMPOTENCY_HEADER,
  readSubmissionResponse,
  toSubmissionPayload,
  type BookingSubmissionStatus,
} from "@/lib/booking/submission-contract";
import { EMPTY_DRAFT, type BookingDraft, type BookingField } from "@/lib/booking/types";
import { STAGE_FIELDS, localNow, toBookingRequest, validateStage, type FormStage, type ValidationErrors } from "@/lib/booking/validation";

/**
 * route → vehicle → contact → review → done (prototype) | received (stored by the server).
 * "vehicle" and "contact" are two progressive sections of the same visual step.
 */
export type Stage = FormStage | "review" | "done" | "received";

/** Where a real submission stands. Only "received" means the server stored it. */
export type SubmissionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: Exclude<BookingSubmissionStatus, "received" | "invalid"> }
  | { kind: "received"; reference: string };

const SUBMIT_TIMEOUT_MS = 20_000;

const NEXT: Record<FormStage, Stage> = { route: "vehicle", vehicle: "contact", contact: "review" };
const PREVIOUS: Partial<Record<FormStage, FormStage>> = { vehicle: "route", contact: "vehicle" };

type State = {
  draft: BookingDraft;
  stage: Stage;
  /** Errors currently shown. */
  errors: ValidationErrors;
  /** Stages the customer has tried to submit — those re-validate live as they type. */
  attempted: Partial<Record<FormStage, boolean>>;
  /** True while editing a stage opened from the review screen. */
  editingFromReview: boolean;
  submission: SubmissionState;
};

const INITIAL: State = { draft: EMPTY_DRAFT, stage: "route", errors: {}, attempted: {}, editingFromReview: false, submission: { kind: "idle" } };

const isFormStage = (s: Stage): s is FormStage => s === "route" || s === "vehicle" || s === "contact";

/**
 * Booking flow. In prototype mode nothing is sent or stored: the final step
 * builds a BookingRequest in memory to prove the data is complete. In test
 * mode `send()` posts to /api/bookings and shows "received" ONLY after the
 * server reports the booking stored. The draft is kept in full when moving
 * backwards, editing or retrying.
 */
export function useBookingForm() {
  const [state, setState] = useState<State>(INITIAL);
  /** One key per submission attempt; reused on retries so the server never stores it twice. */
  const idempotencyKey = useRef<string | null>(null);

  const setField = useCallback(<K extends BookingField>(field: K, value: BookingDraft[K]) => {
    setState((s) => {
      const draft = { ...s.draft, [field]: value };
      // Live re-validation only after a submit attempt, so errors never appear while typing for the first time.
      const errors = isFormStage(s.stage) && s.attempted[s.stage] ? validateStage(draft, s.stage, localNow()) : s.errors;
      // An earlier failure message no longer applies once the details change.
      const submission = s.submission.kind === "submitting" ? s.submission : ({ kind: "idle" } as const);
      return { ...s, draft, errors, submission };
    });
  }, []);

  /** Validates the current stage; on success advances and returns null, otherwise returns the errors. */
  const submitStage = useCallback(
    (stage: FormStage): ValidationErrors | null => {
      const errors = validateStage(state.draft, stage, localNow());
      const failed = Object.keys(errors).length > 0;
      setState((s) => {
        if (failed) return { ...s, errors, attempted: { ...s.attempted, [stage]: true } };
        const next = s.editingFromReview ? "review" : NEXT[stage];
        return { ...s, errors: {}, stage: next, editingFromReview: next === "review" ? false : s.editingFromReview };
      });
      return failed ? errors : null;
    },
    [state.draft],
  );

  const goBack = useCallback((from: FormStage) => {
    const previous = PREVIOUS[from];
    if (previous) setState((s) => ({ ...s, stage: previous, errors: {} }));
  }, []);

  const editStage = useCallback((stage: FormStage) => {
    setState((s) => ({ ...s, stage, errors: {}, editingFromReview: true }));
  }, []);

  const returnToReview = useCallback(() => {
    setState((s) => ({ ...s, stage: "review", errors: {}, editingFromReview: false }));
  }, []);

  /** Sends the customer back to the first stage with errors, showing every error. */
  const showErrors = useCallback((errors: ValidationErrors) => {
    const firstStage = (["route", "vehicle", "contact"] as const).find((st) => STAGE_FIELDS[st].some((f) => errors[f])) ?? "route";
    setState((s) => ({
      ...s,
      stage: firstStage,
      errors,
      attempted: { route: true, vehicle: true, contact: true },
      editingFromReview: true,
      submission: { kind: "idle" },
    }));
  }, []);

  /** Final prototype confirmation: re-validates everything; nothing leaves the browser. */
  const confirm = useCallback((): ValidationErrors | null => {
    const result = toBookingRequest(state.draft, localNow());
    if (!result.ok) {
      showErrors(result.errors);
      return result.errors;
    }
    setState((s) => ({ ...s, stage: "done" }));
    return null;
  }, [state.draft, showErrors]);

  /** Real (test-mode) submission. Resolves with validation errors to announce, or null. */
  const send = useCallback(
    async (honeypot: string): Promise<ValidationErrors | null> => {
      if (state.submission.kind === "submitting") return null;
      const local = toBookingRequest(state.draft, localNow());
      if (!local.ok) {
        showErrors(local.errors);
        return local.errors;
      }

      idempotencyKey.current ??= crypto.randomUUID();
      setState((s) => ({ ...s, submission: { kind: "submitting" } }));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
      let response;
      try {
        const res = await fetch(BOOKINGS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", [IDEMPOTENCY_HEADER]: idempotencyKey.current },
          body: JSON.stringify(toSubmissionPayload(state.draft, honeypot)),
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        response = readSubmissionResponse(await res.json().catch(() => null));
      } catch {
        // Network failure or timeout: the outcome is unknown, so the same key is kept for the retry.
        response = { status: "unavailable" } as const;
      } finally {
        clearTimeout(timer);
      }

      switch (response.status) {
        case "received":
          idempotencyKey.current = null;
          setState((s) => ({ ...s, stage: "received", errors: {}, submission: { kind: "received", reference: response.reference } }));
          return null;
        case "invalid":
          // Nothing was stored, so the corrected request may use a fresh key.
          idempotencyKey.current = null;
          showErrors(response.errors);
          return response.errors;
        default:
          setState((s) => ({ ...s, submission: { kind: response.status } }));
          return null;
      }
    },
    [state.draft, state.submission.kind, showErrors],
  );

  const restart = useCallback(() => {
    idempotencyKey.current = null;
    setState(INITIAL);
  }, []);

  return { ...state, setField, submitStage, goBack, editStage, returnToReview, confirm, send, restart };
}

export type BookingForm = ReturnType<typeof useBookingForm>;

export const fieldId = (field: BookingField) => `booking-${field}`;
