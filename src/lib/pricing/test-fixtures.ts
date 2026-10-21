/*
 * ============================================================================
 *  TEST FIXTURES ONLY — NOT DRIVEO TARIFFS, FARES, ZONES OR ROUTE DISTANCES.
 * ============================================================================
 *  Every number below is invented to exercise the arithmetic. Localities are
 *  fictional ("Alpha", "Beta"…). Tariffs are marked `fixture: true`, and the
 *  quote engine refuses them unless a test passes `allowFixtures: true`.
 *  Never import this file from application code.
 */
import type { PricingEngineConfig, ProviderRoute, QuoteRequest, ServiceTariff, TravelRule } from "./engine-types.ts";
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

const rule = (r: Omit<TravelRule, "updatedAt" | "updatedBy">): TravelRule => ({
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
  quoteValidityHours: 24,
  roundingStepMinor: 100,
  base: { zoneId: "alpha", locality: "Alpha" },
  zones: [
    { id: "alpha", name: "Alpha (fixture base)", localities: ["Alpha", "ალფა"] },
    { id: "beta", name: "Beta (fixture)", localities: ["Beta", "ბეტა", "Beta Village"] },
    { id: "gamma", name: "Gamma (fixture)", localities: ["Gamma", "გამა"] },
    { id: "delta", name: "Delta (fixture, no rules)", localities: ["Delta"] },
  ],
  travelRules: FIXTURE_RULES,
  plausibility: { maxRoadKm: 1000, minAvgSpeedKmh: 10, maxAvgSpeedKmh: 110, maxRoadToStraightRatio: 3 },
  overnight: { mode: "disabled" },
};

export const fixtureRoute = (distanceKm: number, durationMinutes: number): ProviderRoute => ({
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
  ...overrides,
});
