/**
 * The public contract of POST /api/bookings, shared by the browser form and
 * the server. No Node or server imports here: this file is bundled for the
 * browser.
 *
 * The request carries ONLY what the customer typed and the policy version they
 * saw. Prices, statuses, references, pricing modes, driver assignments and
 * consent timestamps are decided on the server; any extra field is rejected.
 */
import { FUEL_POLICY } from "./policies.ts";
import type { BookingDraft, BookingField } from "./types.ts";
import type { ValidationCode } from "./validation.ts";

export const BOOKINGS_ENDPOINT = "/api/bookings";
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
/** Hidden form field that people never fill in (bots often do). */
export const HONEYPOT_FIELD = "website";

export type BookingSubmissionPayload = {
  draft: BookingDraft;
  /** The fuel-policy version shown to the customer when they accepted it. */
  fuelPolicyVersion: number;
  [HONEYPOT_FIELD]: string;
};

export function toSubmissionPayload(draft: BookingDraft, honeypot = ""): BookingSubmissionPayload {
  return { draft, fuelPolicyVersion: FUEL_POLICY.version, [HONEYPOT_FIELD]: honeypot };
}

/** Everything the server ever says back. It never echoes submitted personal data. */
export type BookingSubmissionResponse =
  /** Stored. `submitted` means received for review: NOT a confirmed order. */
  | { status: "received"; reference: string; duplicate: boolean }
  | { status: "invalid"; errors: Partial<Record<BookingField, ValidationCode>> }
  /** The policy wording changed since the customer accepted it. */
  | { status: "policy_changed" }
  /** The same submission key was already used for different details. */
  | { status: "conflict" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  /** Disabled, misconfigured or temporarily failing. Nothing was stored. */
  | { status: "unavailable" }
  /** Malformed, oversized, cross-site or flagged as automated. */
  | { status: "rejected" };

export type BookingSubmissionStatus = BookingSubmissionResponse["status"];

const STATUSES: readonly BookingSubmissionStatus[] = ["received", "invalid", "policy_changed", "conflict", "rate_limited", "unavailable", "rejected"];

/** Defensive parse of a server response in the browser; anything unexpected counts as unavailable. */
export function readSubmissionResponse(value: unknown): BookingSubmissionResponse {
  if (!value || typeof value !== "object") return { status: "unavailable" };
  const v = value as Record<string, unknown>;
  if (!STATUSES.includes(v.status as BookingSubmissionStatus)) return { status: "unavailable" };
  if (v.status === "received") {
    return typeof v.reference === "string" && /^DRV-\d{4}-\d{6}$/.test(v.reference)
      ? { status: "received", reference: v.reference, duplicate: v.duplicate === true }
      : { status: "unavailable" };
  }
  if (v.status === "invalid") {
    const errors = (v.errors && typeof v.errors === "object" ? v.errors : {}) as Partial<Record<BookingField, ValidationCode>>;
    return { status: "invalid", errors };
  }
  if (v.status === "rate_limited") {
    const s = Number(v.retryAfterSeconds);
    return { status: "rate_limited", retryAfterSeconds: Number.isFinite(s) && s > 0 ? Math.ceil(s) : 60 };
  }
  return { status: v.status as "policy_changed" | "conflict" | "unavailable" | "rejected" };
}
