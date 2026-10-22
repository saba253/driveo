/**
 * Strict server-side parsing of a booking submission. Pure and deterministic:
 * "now" (Asia/Tbilisi wall clock) and the allowed city list are passed in.
 *
 * Order: shape (exact keys and types) → honeypot → policy version → text
 * safety → the same field rules the form uses → server-only rules (city list,
 * booking horizon). Only then is a normalized BookingRequest produced.
 */
import { HONEYPOT_FIELD } from "./submission-contract.ts";
import { FUEL_POLICY } from "./policies.ts";
import { EMPTY_DRAFT, OTHER_CITY, type BookingDraft, type BookingField, type BookingRequest } from "./types.ts";
import { toBookingRequest, validateDraft, type LocalNow, type ValidationErrors } from "./validation.ts";

export const SUBMISSION_LIMITS = {
  /** Request bodies above this are refused before parsing. */
  maxBodyBytes: 16 * 1024,
  /** Raw string fields above this are refused as malformed (form limits are far lower). */
  maxRawFieldLength: 400,
  /** Bookings are accepted up to this many days ahead (Tbilisi calendar). */
  maxDaysAhead: 183,
} as const;

export type ParsedSubmission =
  | { kind: "ok"; request: BookingRequest }
  | { kind: "invalid"; errors: ValidationErrors }
  | { kind: "policy_changed" }
  /** Not a form a person could have produced: wrong shape, extra fields, honeypot filled. */
  | { kind: "rejected"; reason: "malformed" | "unexpected_field" | "honeypot" };

const DRAFT_KEYS = Object.keys(EMPTY_DRAFT) as BookingField[];
const TOP_KEYS = ["draft", "fuelPolicyVersion", HONEYPOT_FIELD];

/* C0/C1 controls, line/paragraph separators and bidi overrides have no place in a name or address. */
const UNSAFE_TEXT = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): "ok" | "missing" | "extra" {
  const actual = Object.keys(value);
  if (actual.some((k) => !keys.includes(k))) return "extra";
  return keys.every((k) => k in value) ? "ok" : "missing";
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function parseBookingSubmission(raw: unknown, opts: { now: LocalNow; allowedCities: readonly string[] }): ParsedSubmission {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "rejected", reason: "malformed" };
  const top = raw as Record<string, unknown>;
  const topKeys = hasExactKeys(top, TOP_KEYS);
  if (topKeys !== "ok") return { kind: "rejected", reason: topKeys === "extra" ? "unexpected_field" : "malformed" };

  const draftRaw = top.draft;
  if (!draftRaw || typeof draftRaw !== "object" || Array.isArray(draftRaw)) return { kind: "rejected", reason: "malformed" };
  const d = draftRaw as Record<string, unknown>;
  const draftKeys = hasExactKeys(d, DRAFT_KEYS);
  if (draftKeys !== "ok") return { kind: "rejected", reason: draftKeys === "extra" ? "unexpected_field" : "malformed" };
  for (const key of DRAFT_KEYS) {
    const expected = typeof EMPTY_DRAFT[key];
    if (typeof d[key] !== expected) return { kind: "rejected", reason: "malformed" };
    if (expected === "string" && (d[key] as string).length > SUBMISSION_LIMITS.maxRawFieldLength) return { kind: "rejected", reason: "malformed" };
  }

  if (typeof top[HONEYPOT_FIELD] !== "string") return { kind: "rejected", reason: "malformed" };
  if ((top[HONEYPOT_FIELD] as string).trim() !== "") return { kind: "rejected", reason: "honeypot" };
  if (top.fuelPolicyVersion !== FUEL_POLICY.version) return { kind: "policy_changed" };

  const draft = d as BookingDraft;
  const errors: ValidationErrors = {};
  for (const key of DRAFT_KEYS) {
    const value = draft[key];
    if (typeof value === "string" && UNSAFE_TEXT.test(value)) errors[key] = "invalidText";
  }

  for (const [field, code] of Object.entries(validateDraft(draft, opts.now)) as [BookingField, ValidationErrors[BookingField]][]) {
    if (!errors[field]) errors[field] = code;
  }

  // The form offers only listed cities (or "other" with a typed name); anything else did not come from it.
  for (const field of ["pickupCity", "deliveryCity"] as const) {
    if (!errors[field] && draft[field] !== OTHER_CITY && !opts.allowedCities.includes(draft[field])) errors[field] = "invalidOption";
  }
  if (!errors.pickupDate && draft.pickupDate > addDays(opts.now.date, SUBMISSION_LIMITS.maxDaysAhead)) errors.pickupDate = "dateTooFar";

  if (Object.keys(errors).length > 0) return { kind: "invalid", errors };

  const built = toBookingRequest(draft, opts.now);
  return built.ok ? { kind: "ok", request: built.request } : { kind: "invalid", errors: built.errors };
}

/**
 * Database parameters for public.submit_booking_request. Manual assessment
 * only: no quote, no price. Server decides consent time and the test flag
 * (passed separately as p_is_test, never inside the client-shaped data).
 */
export function toStoredSubmission(request: BookingRequest, opts: { consentedAt: Date; test: boolean }) {
  return {
    isTest: opts.test,
    booking: {
      pricing_mode: "manual_assessment",
      eligibility_reasons: [],
      pickup_city: request.route.pickup.city,
      pickup_address: request.route.pickup.address,
      delivery_city: request.route.delivery.city,
      delivery_address: request.route.delivery.address,
      requested_date: request.schedule.preferredDate,
      requested_time: request.schedule.preferredTime,
      vehicle_make: request.vehicle.make,
      vehicle_model: request.vehicle.model,
      powertrain: request.vehicle.powertrain,
      transmission: request.vehicle.transmission,
      drivable_confirmed: true,
      fuel_policy_id: request.acknowledgements.fuelPolicy.policyId,
      fuel_policy_version: request.acknowledgements.fuelPolicy.policyVersion,
      // Terms of Use and Privacy Policy are not approved yet: no version can be claimed.
      terms_version: null,
      privacy_version: null,
      consented_at: opts.consentedAt.toISOString(),
    },
    contact: {
      full_name: request.contact.name,
      phone_e164: request.contact.phone,
      preferred_contact: "phone",
    },
  };
}

/** The customer-provided content that defines "the same submission" (no server timestamps). */
export function canonicalSubmissionContent(request: BookingRequest, test: boolean): string {
  const { route, vehicle, schedule, contact, acknowledgements } = request;
  return JSON.stringify({ v: 1, test, route, vehicle, schedule, contact, fuel: acknowledgements.fuelPolicy });
}
