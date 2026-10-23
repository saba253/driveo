/**
 * Unfinished booking drafts, kept in the browser tab's sessionStorage.
 *
 * Privacy: sessionStorage belongs to one tab and is cleared when the tab is
 * closed, so the details never outlive the visit on a shared device. Only the
 * fields the customer typed are stored (route, time, vehicle, name, phone and
 * two confirmations), plus the stage and, while a submission's outcome is
 * unknown, its idempotency key. Validation errors, the honeypot and submission
 * results are never stored. A saved draft expires after 24 hours and is removed
 * on restart and once the server has received the request.
 *
 * Pure functions with an injected storage and clock, so they run in Node's test runner.
 */
import { FUEL_POLICY } from "./policies.ts";
import { EMPTY_DRAFT, POWERTRAINS, TRANSMISSIONS, type BookingDraft, type BookingField } from "./types.ts";
import { validateStage, type FormStage, type LocalNow, type ValidationErrors } from "./validation.ts";

export const DRAFT_STORAGE_KEY = "driveo:booking-draft:v1";
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const VERSION = 1;
/** Clock skew tolerated for a savedAt slightly in the future. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Longer than any field limit; anything larger is not a draft this app wrote. */
const MAX_TEXT = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stages a draft may be saved at; the final screens are never saved. */
export type SavedStage = FormStage | "review";
const SAVED_STAGES: readonly SavedStage[] = ["route", "vehicle", "contact", "review"];
const FORM_STAGES: readonly FormStage[] = ["route", "vehicle", "contact"];

export type SavedDraft = {
  draft: BookingDraft;
  stage: SavedStage;
  /** Epoch milliseconds. */
  savedAt: number;
  /** Idempotency key of a submission whose outcome is not known yet; reused on retry. */
  pendingSubmissionId: string | null;
};

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const isSavedStage = (stage: string): stage is SavedStage => (SAVED_STAGES as readonly string[]).includes(stage);

/** True when the customer has entered anything worth keeping. */
export function hasDraftData(draft: BookingDraft): boolean {
  return (Object.keys(EMPTY_DRAFT) as BookingField[]).some((f) => {
    const v = draft[f];
    return typeof v === "string" ? v.trim() !== "" : v !== EMPTY_DRAFT[f];
  });
}

export function serializeDraft(saved: SavedDraft): string {
  return JSON.stringify({ v: VERSION, policyVersion: FUEL_POLICY.version, ...saved });
}

/** Reads a stored draft defensively: anything malformed, expired or from another version gives null. */
export function parseSavedDraft(raw: string | null, nowMs: number): SavedDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  if (o.v !== VERSION) return null;
  if (typeof o.savedAt !== "number" || !Number.isFinite(o.savedAt)) return null;
  if (nowMs - o.savedAt > DRAFT_MAX_AGE_MS || o.savedAt - nowMs > MAX_FUTURE_SKEW_MS) return null;
  if (typeof o.stage !== "string" || !isSavedStage(o.stage)) return null;
  if (typeof o.draft !== "object" || o.draft === null) return null;

  const source = o.draft as Record<string, unknown>;
  const draft: BookingDraft = { ...EMPTY_DRAFT };
  for (const field of Object.keys(EMPTY_DRAFT) as BookingField[]) {
    const value = source[field];
    if (typeof value !== typeof EMPTY_DRAFT[field]) continue;
    if (typeof value === "string" && value.length > MAX_TEXT) continue;
    (draft as Record<BookingField, unknown>)[field] = value;
  }
  if (!(POWERTRAINS as readonly string[]).includes(draft.powertrain)) draft.powertrain = "";
  if (!(TRANSMISSIONS as readonly string[]).includes(draft.transmission)) draft.transmission = "";
  // Terms accepted under an older wording must be read and accepted again.
  if (o.policyVersion !== FUEL_POLICY.version) draft.fuelPolicyAccepted = false;
  if (!hasDraftData(draft)) return null;

  const pending = typeof o.pendingSubmissionId === "string" && UUID.test(o.pendingSubmissionId) ? o.pendingSubmissionId.toLowerCase() : null;
  return { draft, stage: o.stage, savedAt: o.savedAt, pendingSubmissionId: pending };
}

export type RestoredPosition = {
  stage: SavedStage;
  /** Errors to show: set only when a stage the customer had already completed is no longer valid. */
  errors: ValidationErrors;
  attempted: FormStage | null;
};

/**
 * Where a restored draft resumes. Stages before the saved one are re-validated
 * (a pickup date or time may have passed since); the first one that fails is
 * reopened with its errors shown. Otherwise the saved stage is resumed as it was.
 */
export function restorePosition(draft: BookingDraft, saved: SavedStage, now: LocalNow): RestoredPosition {
  const reached = SAVED_STAGES.indexOf(saved);
  for (const stage of FORM_STAGES.slice(0, reached)) {
    const errors = validateStage(draft, stage, now);
    if (Object.keys(errors).length > 0) return { stage, errors, attempted: stage };
  }
  return { stage: saved, errors: {}, attempted: null };
}

/* Storage access never throws: blocked or full storage simply means no draft is kept. */

export function readDraft(storage: DraftStorage | null, nowMs: number): SavedDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DRAFT_STORAGE_KEY);
    const saved = parseSavedDraft(raw, nowMs);
    if (raw !== null && !saved) storage.removeItem(DRAFT_STORAGE_KEY);
    return saved;
  } catch {
    return null;
  }
}

export function writeDraft(storage: DraftStorage | null, saved: SavedDraft): void {
  try {
    storage?.setItem(DRAFT_STORAGE_KEY, serializeDraft(saved));
  } catch {
    // Quota exceeded or storage disabled: the form keeps working without a saved draft.
  }
}

export function clearDraft(storage: DraftStorage | null): void {
  try {
    storage?.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
