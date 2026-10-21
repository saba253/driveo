/*
 * ============================================================================
 *  TEST FIXTURES ONLY — NOT DRIVEO TARIFFS, FARES, ZONES OR ROUTE DISTANCES.
 * ============================================================================
 *  Every number below is invented to exercise the arithmetic. Localities are
 *  fictional ("Alpha", "Beta"…). Tariffs are marked `fixture: true`, and the
 *  quote engine refuses them unless a test passes `allowFixtures: true`.
 *  Never import this file from application code.
 */
import type { PricingEngineConfig, ProviderRoute, QuoteRequest, ServiceTariff, TravelEvidence, TravelRule, TravelZone } from "./engine-types.ts";
import type { Approval, AutomaticPricingPolicy, OperatingPolicy } from "./eligibility.ts";
import { HOME_BASE_ZONE, INITIAL_HOME_BASE } from "./base.ts";
import { RUSTAVI_ZONE } from "./pilot.ts";
import { DEFAULT_PRICING_CONFIG } from "./config.ts";
import { gel } from "./money.ts";

export const FIXTURE_TARIFF: ServiceTariff = {
  id: "fixture-tariff-not-real",
  version: 1,
  currency: "GEL",
  baseFee: gel(30),
  perKmMinor: 120, // 1.20 per km
  minimumFee: gel(80),
  travelTimePerHourMinor: 600, // 6.00 per hour of driver travel
  effectiveFrom: "2026-01-01T00:00:00Z",
  scope: { driverId: null, region: null },
  status: "active",
  fixture: true,
};

/** FIXTURE evidence: not a real verification of any fare or timetable. */
export const FIXTURE_EVIDENCE: TravelEvidence = { source: "fixture — not a real verification", verifiedAt: "2026-10-15T00:00:00Z", verifiedBy: "fixture" };

const rule = (r: Omit<TravelRule, "updatedAt" | "updatedBy">): TravelRule => ({
  evidence: FIXTURE_EVIDENCE,
  availability: { kind: "frequent", firstDeparture: "05:00", lastDeparture: "23:30", accessMinutes: 10 },
  ...r,
  updatedAt: "2026-10-21T00:00:00Z",
  updatedBy: "fixture",
});

export const FIXTURE_RULES: readonly TravelRule[] = [
  // Inside the base zone (to a pickup in the base town, or back from a delivery there).
  rule({ id: "r-alpha-alpha", fromZoneId: "alpha", toZoneId: "alpha", mode: "taxi", fare: gel(10), travelMinutes: 30 }),
  // Positioning to the Beta zone, and back from it.
  rule({ id: "r-alpha-beta", fromZoneId: "alpha", toZoneId: "beta", mode: "minibus", fare: gel(20), travelMinutes: 180 }),
  rule({ id: "r-beta-alpha", fromZoneId: "beta", toZoneId: "alpha", mode: "minibus", fare: gel(20), travelMinutes: 180 }),
  // A remote village in Beta has its own, more specific return rule.
  rule({ id: "r-betavillage-alpha", fromZoneId: "beta", toZoneId: "alpha", fromLocality: "Beta Village", mode: "other", fare: gel(35), travelMinutes: 240 }),
  // Return from Gamma only: there is deliberately NO positioning rule alpha → gamma.
  rule({ id: "r-gamma-alpha", fromZoneId: "gamma", toZoneId: "alpha", mode: "train", fare: gel(25), travelMinutes: 200 }),
  // Zone "delta" deliberately has no rules at all.
];

export const FIXTURE_CONFIG: PricingEngineConfig = {
  version: "fixture-config-1",
  fixture: true,
  // Follow the approved defaults (12 h validity, round up to whole GEL).
  quoteValidityHours: DEFAULT_PRICING_CONFIG.quoteValidityHours,
  roundingStepMinor: DEFAULT_PRICING_CONFIG.roundingStepMinor,
  base: { zoneId: "alpha", locality: "Alpha" },
  zones: [
    { id: "alpha", name: "Alpha (fixture base)", localities: ["Alpha", "ალფა"] },
    { id: "beta", name: "Beta (fixture)", localities: ["Beta", "ბეტა", "Beta Village"] },
    { id: "gamma", name: "Gamma (fixture)", localities: ["Gamma", "გამა"] },
    { id: "delta", name: "Delta (fixture, no rules)", localities: ["Delta"] },
  ],
  travelRules: FIXTURE_RULES,
  plausibility: { maxRoadKm: 1000, minAvgSpeedKmh: 10, maxAvgSpeedKmh: 110, maxRoadToStraightRatio: 3 },
  // Fixture-only waiver so price tests are not blocked; real config starts as "notConfigured".
  overnight: { mode: "waived", approvedBy: "fixture", reason: "test fixture" },
};

/**
 * Same engine with the REAL configured home base (Tbilisi, see base.ts) but
 * FIXTURE fares and minutes and fictional destination zones. These are not
 * real travel costs to or from Tbilisi.
 */
export const FIXTURE_TBILISI_CONFIG: PricingEngineConfig = {
  ...FIXTURE_CONFIG,
  version: "fixture-tbilisi-config-1",
  base: INITIAL_HOME_BASE,
  zones: [
    HOME_BASE_ZONE,
    { id: "beta", name: "Beta (fixture)", localities: ["Beta", "ბეტა"] },
    { id: "gamma", name: "Gamma (fixture)", localities: ["Gamma", "გამა"] },
    { id: "delta", name: "Delta (fixture, no rules)", localities: ["Delta"] },
  ],
  travelRules: [
    rule({ id: "t-tbilisi-tbilisi", fromZoneId: "tbilisi", toZoneId: "tbilisi", mode: "taxi", fare: gel(10), travelMinutes: 30 }),
    rule({ id: "t-tbilisi-beta", fromZoneId: "tbilisi", toZoneId: "beta", mode: "minibus", fare: gel(20), travelMinutes: 180 }),
    rule({ id: "t-beta-tbilisi", fromZoneId: "beta", toZoneId: "tbilisi", mode: "minibus", fare: gel(20), travelMinutes: 180 }),
    rule({ id: "t-tbilisi-gamma", fromZoneId: "tbilisi", toZoneId: "gamma", mode: "train", fare: gel(25), travelMinutes: 200 }),
    rule({ id: "t-gamma-tbilisi", fromZoneId: "gamma", toZoneId: "tbilisi", mode: "train", fare: gel(25), travelMinutes: 200 }),
    // A second driver based in Beta (fixture): their own positioning/return rules.
    rule({ id: "t-beta-beta", fromZoneId: "beta", toZoneId: "beta", mode: "taxi", fare: gel(8), travelMinutes: 20 }),
    rule({ id: "t-beta-gamma", fromZoneId: "beta", toZoneId: "gamma", mode: "minibus", fare: gel(15), travelMinutes: 120 }),
    rule({ id: "t-gamma-beta", fromZoneId: "gamma", toZoneId: "beta", mode: "minibus", fare: gel(15), travelMinutes: 120 }),
    // Delta: no rules at all.
  ],
};

/* --------------------------------------------- eligibility (FIXTURES ONLY) */

/** A fake approval record, used only to exercise the eligibility gate in tests. */
export const FIXTURE_APPROVAL: Approval = { status: "approved", approvedBy: "fixture", approvedAt: "2026-10-01T00:00:00Z", reference: "test only" };

/** FIXTURE operating limits — generous so price tests are not schedule-bound. Not a real policy. */
export const FIXTURE_OPERATING_POLICY: OperatingPolicy = {
  approval: FIXTURE_APPROVAL,
  maxTotalMinutes: 16 * 60,
  maxDrivingMinutes: 8 * 60,
  maxContinuousDrivingMinutes: 270,
  breakMinutes: 45,
  pickupHandoverMinutes: 30,
  deliveryHandoverMinutes: 30,
  latestDriveStart: null,
};

const allPairs = (zones: readonly TravelZone[]) =>
  zones.flatMap((a) => zones.map((b) => ({ id: `pilot-${a.id}-${b.id}`, fromZoneId: a.id, toZoneId: b.id, automaticPricingEnabled: true, approval: FIXTURE_APPROVAL })));

/** Everything approved and enabled for the fixture Tbilisi config, so orchestration tests can reach "quoted". */
export const FIXTURE_ELIGIBLE_POLICY: AutomaticPricingPolicy = {
  version: "fixture-policy-1",
  automaticPricingEnabled: true,
  masterApproval: FIXTURE_APPROVAL,
  pilotRoutes: allPairs(FIXTURE_TBILISI_CONFIG.zones),
  tariffApproval: { tariffId: FIXTURE_TARIFF.id, tariffVersion: FIXTURE_TARIFF.version, approval: FIXTURE_APPROVAL },
  configApproval: { configVersion: FIXTURE_TBILISI_CONFIG.version, approval: FIXTURE_APPROVAL },
  operating: FIXTURE_OPERATING_POLICY,
  evidenceMaxAgeDays: { value: 90, approval: FIXTURE_APPROVAL },
};

/**
 * FIXTURE pilot geography: the real Tbilisi base and Rustavi zone names, with
 * INVENTED fares, minutes and timetables. "Gamma" is a fictional zone outside
 * the pilot with a fixed timetable (two departures) to exercise deadlines.
 */
export const FIXTURE_PILOT_CONFIG: PricingEngineConfig = {
  ...FIXTURE_CONFIG,
  version: "fixture-pilot-config-1",
  base: INITIAL_HOME_BASE,
  zones: [HOME_BASE_ZONE, RUSTAVI_ZONE, { id: "gamma", name: "Gamma (fixture)", localities: ["Gamma"] }],
  plausibility: { maxRoadKm: 1000, minAvgSpeedKmh: 10, maxAvgSpeedKmh: 110, maxRoadToStraightRatio: 3 },
  overnight: { mode: "manualReviewAbove", maxSameDayMinutes: 16 * 60, handoverMinutes: 60 },
  travelRules: [
    rule({ id: "p-tbilisi-tbilisi", fromZoneId: "tbilisi", toZoneId: "tbilisi", mode: "bus", fare: gel(10), travelMinutes: 45, availability: { kind: "frequent", firstDeparture: "06:00", lastDeparture: "23:00", accessMinutes: 10 } }),
    rule({ id: "p-tbilisi-rustavi", fromZoneId: "tbilisi", toZoneId: "rustavi", mode: "minibus", fare: gel(4), travelMinutes: 70, availability: { kind: "frequent", firstDeparture: "07:00", lastDeparture: "23:00", accessMinutes: 20 } }),
    rule({ id: "p-rustavi-tbilisi", fromZoneId: "rustavi", toZoneId: "tbilisi", mode: "minibus", fare: gel(4), travelMinutes: 80, availability: { kind: "frequent", firstDeparture: "07:00", lastDeparture: "23:00", accessMinutes: 15 } }),
    rule({ id: "p-tbilisi-gamma", fromZoneId: "tbilisi", toZoneId: "gamma", mode: "train", fare: gel(30), travelMinutes: 300, availability: { kind: "timetable", departures: ["08:05", "17:10"], accessMinutes: 40, validFrom: "2026-10-01", validTo: "2026-12-31" } }),
    rule({ id: "p-gamma-tbilisi", fromZoneId: "gamma", toZoneId: "tbilisi", mode: "train", fare: gel(30), travelMinutes: 300, availability: { kind: "timetable", departures: ["08:00", "16:50"], accessMinutes: 30, validFrom: "2026-10-01", validTo: "2026-12-31" } }),
  ],
};

/** Pilot policy for the fixture pilot config: the three pilot routes approved and enabled (TEST ONLY). */
export const FIXTURE_PILOT_POLICY: AutomaticPricingPolicy = {
  version: "fixture-pilot-policy-1",
  automaticPricingEnabled: true,
  masterApproval: FIXTURE_APPROVAL,
  pilotRoutes: [
    { id: "pilot-tbilisi-local", fromZoneId: "tbilisi", toZoneId: "tbilisi", automaticPricingEnabled: true, approval: FIXTURE_APPROVAL },
    { id: "pilot-tbilisi-rustavi", fromZoneId: "tbilisi", toZoneId: "rustavi", automaticPricingEnabled: true, approval: FIXTURE_APPROVAL },
    { id: "pilot-rustavi-tbilisi", fromZoneId: "rustavi", toZoneId: "tbilisi", automaticPricingEnabled: true, approval: FIXTURE_APPROVAL },
  ],
  tariffApproval: { tariffId: FIXTURE_TARIFF.id, tariffVersion: FIXTURE_TARIFF.version, approval: FIXTURE_APPROVAL },
  configApproval: { configVersion: FIXTURE_PILOT_CONFIG.version, approval: FIXTURE_APPROVAL },
  operating: { ...FIXTURE_OPERATING_POLICY, maxTotalMinutes: 13 * 60, maxDrivingMinutes: 6 * 60 },
  evidenceMaxAgeDays: { value: 90, approval: FIXTURE_APPROVAL },
};

export const fixtureRoute =(distanceKm: number, durationMinutes: number): ProviderRoute => ({
  provider: "fixture-provider",
  method: "road",
  distanceKm,
  durationMinutes,
  computedAt: "2026-10-21T08:00:00.000Z",
});

export const fixtureRequest = (pickup: string, delivery: string, overrides: Partial<QuoteRequest> = {}): QuoteRequest => ({
  requestId: "req-1",
  pickup: { locality: pickup, address: "Fixture street 1", placeId: null },
  delivery: { locality: delivery, address: "Fixture avenue 2", placeId: null },
  schedule: { date: "2026-10-25", time: "09:00" },
  vehicle: { powertrain: "petrol", transmission: "automatic", drivableConfirmed: true },
  ...overrides,
});
