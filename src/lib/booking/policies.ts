/**
 * Business policies the customer must acknowledge. Each is versioned so a
 * stored request records exactly which wording was accepted.
 * Customer-facing wording lives in content (ka.booking.fuelPolicy).
 */
export const FUEL_POLICY = {
  id: "fuel-customer-provided",
  /** Approved by the founder on 2026-10-21. Bump when the wording changes. */
  version: "2026-10-21",
  /** Fuel is never part of the driver service price. */
  includedInServicePrice: false,
} as const;
