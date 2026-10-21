/**
 * Business policies the customer must acknowledge. Each is versioned so a
 * stored request records exactly which wording was accepted.
 * Customer-facing wording lives in content (ka.booking.fuelPolicy).
 */
export const FUEL_POLICY = {
  id: "fuel-customer-provided",
  /**
   * Increment on every material change to the customer-facing wording.
   *  v1 (2026-10-21): customer provides fuel; extra refuelling reimbursed with receipts.
   *  v2 (2026-10-21): extended to LPG, CNG and EV charging; extra refuelling or
   *                   charging reimbursed at documented actual cost.
   */
  version: 2,
  effectiveFrom: "2026-10-21",
  /** Fuel and charging are never part of the service price. */
  includedInServicePrice: false,
  covers: ["petrol", "diesel", "lpg", "cng", "electricity"],
} as const;
