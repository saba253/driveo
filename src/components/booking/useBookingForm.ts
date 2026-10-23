"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BOOKINGS_ENDPOINT,
  IDEMPOTENCY_HEADER,
  readSubmissionResponse,
  toSubmissionPayload,
  type BookingSubmissionStatus,
} from "@/lib/booking/submission-contract";
import { clearDraft, hasDraftData, readDraft, restorePosition, writeDraft, type DraftStorage } from "@/lib/booking/draft-storage";
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
  /** True from restoring a saved draft until the customer moves to another stage. */
  restored: boolean;
};

const INITIAL: State = {
  draft: EMPTY_DRAFT,
  stage: "route",
  errors: {},
  attempted: {},
  editingFromReview: false,
  submission: { kind: "idle" },
  restored: false,
};

/** This tab's sessionStorage, or null where storage is blocked. */
function tabStorage(): DraftStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const isFormStage = (s: Stage): s is FormStage => s === "route" || s === "vehicle" || s === "contact";

/**
 * Booking flow. In prototype mode nothing is sent or stored: the final step
 * builds a BookingRequest in memory to prove the data is complete. In test
 * mode `send()` posts to /api/bookings and shows "received" ONLY after the
 * server reports the booking stored. The draft is kept in full when moving
 * backwards, editing or retrying, and survives a refresh of the tab
 * (src/lib/booking/draft-storage.ts); a restored draft is never sent automatically.
 */
export function useBookingForm() {
  const [state, setState] = useState<State>(INITIAL);
  /** One key per submission attempt; reused on retries so the server never stores it twice. */
  const idempotencyKey = useRef<string | null>(null);
  /** Set while a request is in flight, so a second click cannot start another one. */
  const inFlight = useRef(false);
  /** False until the saved draft has been read; nothing is written before that. */
  const storageReady = useRef(false);

  // Save on every change of the draft, stage or submission. Declared before the restore
  // effect so that, on mount, it runs first and cannot overwrite the saved draft.
  const { draft, stage, submission } = state;
  useEffect(() => {
    if (!storageReady.current) return;
    const storage = tabStorage();
    // Final screens and empty forms leave nothing behind; "received" is set only once the server stored the request.
    if (stage === "done" || stage === "received" || !hasDraftData(draft)) {
      clearDraft(storage);
      return;
    }
    writeDraft(storage, { draft, stage, savedAt: Date.now(), pendingSubmissionId: idempotencyKey.current });
  }, [draft, stage, submission.kind]);

  // Restore after hydration (the server always renders an empty form, so markup matches).
  useEffect(() => {
    storageReady.current = true;
    const saved = readDraft(tabStorage(), Date.now());
    if (!saved) return;
    // An unknown earlier outcome keeps its key, so a manual resend cannot store the request twice.
    idempotencyKey.current = saved.pendingSubmissionId;
    const position = restorePosition(saved.draft, saved.stage, localNow());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser storage after hydration
    setState({
      ...INITIAL,
      draft: saved.draft,
      stage: position.stage,
      errors: position.errors,
      attempted: position.attempted ? { [position.attempted]: true } : {},
      restored: true,
    });
  }, []);

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
        return { ...s, errors: {}, stage: next, editingFromReview: next === "review" ? false : s.editingFromReview, restored: false };
      });
      return failed ? errors : null;
    },
    [state.draft],
  );

  const goBack = useCallback((from: FormStage) => {
    const previous = PREVIOUS[from];
    if (previous) setState((s) => ({ ...s, stage: previous, errors: {}, restored: false }));
  }, []);

  const editStage = useCallback((stage: FormStage) => {
    setState((s) => ({ ...s, stage, errors: {}, editingFromReview: true, restored: false }));
  }, []);

  const returnToReview = useCallback(() => {
    setState((s) => ({ ...s, stage: "review", errors: {}, editingFromReview: false, restored: false }));
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
      restored: false,
    }));
  }, []);

  /** Final prototype confirmation: re-validates everything; nothing leaves the browser. */
  const confirm = useCallback((): ValidationErrors | null => {
    const result = toBookingRequest(state.draft, localNow());
    if (!result.ok) {
      showErrors(result.errors);
      return result.errors;
    }
    setState((s) => ({ ...s, stage: "done", restored: false }));
    return null;
  }, [state.draft, showErrors]);

  /** Real (test-mode) submission. Resolves with validation errors to announce, or null. */
  const send = useCallback(
    async (honeypot: string): Promise<ValidationErrors | null> => {
      if (inFlight.current || state.submission.kind === "submitting") return null;
      const local = toBookingRequest(state.draft, localNow());
      if (!local.ok) {
        showErrors(local.errors);
        return local.errors;
      }

      idempotencyKey.current ??= crypto.randomUUID();
      inFlight.current = true;
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
        inFlight.current = false;
      }

      switch (response.status) {
        case "received":
          idempotencyKey.current = null;
          setState((s) => ({ ...s, stage: "received", errors: {}, submission: { kind: "received", reference: response.reference }, restored: false }));
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

  /** Clears the form, the saved draft and any pending submission key. */
  const restart = useCallback(() => {
    idempotencyKey.current = null;
    clearDraft(tabStorage());
    setState(INITIAL);
  }, []);

  return { ...state, setField, submitStage, goBack, editStage, returnToReview, confirm, send, restart };
}

export type BookingForm = ReturnType<typeof useBookingForm>;

export const fieldId = (field: BookingField) => `booking-${field}`;
