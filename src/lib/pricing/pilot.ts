import { HOME_BASE_ZONE } from "./base.ts";
import type { AutomaticPricingPolicy, OperatingPolicy } from "./eligibility.ts";
import type { TravelZone } from "./engine-types.ts";

/**
 * Pilot configuration — DATA ONLY, everything disabled.
 *
 * Nothing here is approved for production. Automatic pricing stays off until
 * the founder approves (with name and date) the master switch, each pilot
 * route, the tariff, the configuration, the operating policy and the
 * evidence-age rule, and every travel rule carries fresh verified evidence.
 */

/** Rustavi zone membership (place names only — no fares or times are implied). */
export const RUSTAVI_ZONE: TravelZone = {
  id: "rustavi",
  name: "რუსთავი",
  localities: ["რუსთავი", "Rustavi"],
};

export const PILOT_ZONES: readonly TravelZone[] = [HOME_BASE_ZONE, RUSTAVI_ZONE];

const NOT_APPROVED = { status: "proposed", note: "Pilot candidate — awaiting founder approval" } as const;

/**
 * Default policy: automatic pricing OFF, every pilot route OFF, no approved
 * tariff, configuration or operating policy. Every request → manual assessment.
 */
export const DEFAULT_AUTOMATIC_PRICING_POLICY: AutomaticPricingPolicy = {
  version: "pilot-policy-0-disabled",
  automaticPricingEnabled: false,
  masterApproval: NOT_APPROVED,
  pilotRoutes: [
    { id: "pilot-tbilisi-local", fromZoneId: "tbilisi", toZoneId: "tbilisi", automaticPricingEnabled: false, approval: NOT_APPROVED },
    { id: "pilot-tbilisi-rustavi", fromZoneId: "tbilisi", toZoneId: "rustavi", automaticPricingEnabled: false, approval: NOT_APPROVED },
    { id: "pilot-rustavi-tbilisi", fromZoneId: "rustavi", toZoneId: "tbilisi", automaticPricingEnabled: false, approval: NOT_APPROVED },
  ],
  tariffApproval: null,
  configApproval: null,
  operating: null,
  evidenceMaxAgeDays: { value: 90, approval: { status: "proposed", note: "90-day re-verification proposed, not approved" } },
};

/**
 * RESEARCH ASSUMPTIONS ONLY (Step 1.6C.3 pilot-readiness report). Marked
 * "proposed", so the eligibility gate rejects it. Not a production policy.
 */
export const PROPOSED_OPERATING_POLICY: OperatingPolicy = {
  approval: { status: "proposed", note: "Research proposal: 13 h day, 6 h driving, 45 min break before exceeding 4.5 h" },
  maxTotalMinutes: 13 * 60,
  maxDrivingMinutes: 6 * 60,
  maxContinuousDrivingMinutes: 4.5 * 60,
  breakMinutes: 45,
  pickupHandoverMinutes: 30,
  deliveryHandoverMinutes: 30,
  latestDriveStart: null,
};

/**
 * MODERATE RESEARCH SCENARIO — labelled scenario inputs, NOT a tariff.
 * Deliberately not a ServiceTariff, so it cannot be passed to the pricing engine.
 */
export const MODERATE_RESEARCH_SCENARIO = {
  approval: { status: "proposed", note: "Research scenario only; no commercial tariff approved" },
  baseFeeGel: 60,
  perKmGel: 0.7,
  minimumDrivingFeeGel: 110,
  driverTimeCostGelPerHour: 25,
  overheadGelPerJob: 20,
  riskReserveShareOfPrice: 0.05,
  targetMarginShareOfPrice: 0.2,
} as const;
