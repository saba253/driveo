/**
 * Booking lifecycle — the TypeScript mirror of the database rules in
 * supabase/migrations/20261022000200_booking_functions.sql
 * (driveo_private.booking_transition_rules). The database is authoritative;
 * a test compares both tables so they cannot drift apart.
 *
 * Only the admin moves a booking forward. "submitted" means the request was
 * received — it is NOT a confirmed order.
 */

export const BOOKING_STATUSES = [
  "submitted",
  "under_review",
  "info_requested",
  "price_proposed",
  "customer_accepted",
  "confirmed",
  "declined",
  "cancelled",
  "completed",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Which operation may perform a transition:
 * - manual: the admin's explicit status change;
 * - proposal_sent: recording that a written price was sent;
 * - proposal_superseded: replacing a sent price with a new one;
 * - acceptance_recorded: recording the customer's written acceptance (with evidence).
 */
export type TransitionVia = "manual" | "proposal_sent" | "proposal_superseded" | "acceptance_recorded";

export type TransitionRule = { from: BookingStatus; to: BookingStatus; via: TransitionVia };

export const TRANSITION_RULES: readonly TransitionRule[] = [
  { from: "submitted", to: "under_review", via: "manual" },
  { from: "submitted", to: "declined", via: "manual" },
  { from: "submitted", to: "cancelled", via: "manual" },
  { from: "under_review", to: "info_requested", via: "manual" },
  { from: "under_review", to: "declined", via: "manual" },
  { from: "under_review", to: "cancelled", via: "manual" },
  { from: "under_review", to: "price_proposed", via: "proposal_sent" },
  { from: "info_requested", to: "under_review", via: "manual" },
  { from: "info_requested", to: "declined", via: "manual" },
  { from: "info_requested", to: "cancelled", via: "manual" },
  { from: "price_proposed", to: "under_review", via: "manual" },
  { from: "price_proposed", to: "under_review", via: "proposal_superseded" },
  { from: "price_proposed", to: "declined", via: "manual" },
  { from: "price_proposed", to: "cancelled", via: "manual" },
  { from: "price_proposed", to: "customer_accepted", via: "acceptance_recorded" },
  { from: "customer_accepted", to: "confirmed", via: "manual" },
  { from: "customer_accepted", to: "declined", via: "manual" },
  { from: "customer_accepted", to: "cancelled", via: "manual" },
  { from: "confirmed", to: "completed", via: "manual" },
  { from: "confirmed", to: "cancelled", via: "manual" },
];

export const TERMINAL_STATUSES: readonly BookingStatus[] = ["declined", "cancelled", "completed"];

export function canTransition(from: BookingStatus, to: BookingStatus, via: TransitionVia = "manual"): boolean {
  return TRANSITION_RULES.some((r) => r.from === from && r.to === to && r.via === via);
}

/** Statuses the admin can choose directly from `from` (managed transitions excluded). */
export function manualTargets(from: BookingStatus): BookingStatus[] {
  return TRANSITION_RULES.filter((r) => r.from === from && r.via === "manual").map((r) => r.to);
}
