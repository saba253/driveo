import type { DriverBase, TravelZone } from "./engine-types.ts";

/**
 * Operational home base — configuration, not pricing logic. The engine reads
 * the base from its config (or a driver passed to priceQuote) and never refers
 * to a specific city.
 *
 * Founder decision (2026-10-21): the initial driver's home base is Tbilisi.
 * Positioning is priced from the base to the pickup and the return from the
 * delivery back to the base; routes themselves may start and end anywhere.
 *
 * Only the zone membership is defined here. Travel fares and times to/from
 * Tbilisi are business data still to be provided — none are invented.
 */
export const HOME_BASE_ZONE: TravelZone = {
  id: "tbilisi",
  name: "თბილისი",
  localities: ["თბილისი", "Tbilisi"],
};

export const INITIAL_HOME_BASE: DriverBase = {
  zoneId: HOME_BASE_ZONE.id,
  locality: "თბილისი",
};
