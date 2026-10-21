import type { ManualReason, PlausibilityLimits, ProviderRoute, QuoteEndpoint } from "./engine-types.ts";

/**
 * Safety checks on provider route data. Straight-line distance appears here
 * ONLY to detect impossible routes; it is never used to price anything.
 */

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in km. For sanity checks only — never a pricing input. */
export function straightLineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Small tolerance for geocoder/route endpoint offsets before calling a road "shorter than straight". */
const STRAIGHT_LINE_TOLERANCE = 0.98;

export function checkRoutePlausibility(
  route: ProviderRoute,
  pickup: QuoteEndpoint,
  delivery: QuoteEndpoint,
  limits: PlausibilityLimits,
): ManualReason[] {
  const reasons: ManualReason[] = [];

  if (route.method !== "road") return [{ code: "nonRoadDistance", detail: String(route.method) }];

  const km = route.distanceKm;
  if (!Number.isFinite(km) || km <= 0 || km > limits.maxRoadKm) {
    reasons.push({ code: "implausibleDistance", detail: `${km} km` });
    return reasons;
  }

  const minutes = route.durationMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    reasons.push({ code: "implausibleDuration", detail: `${minutes} min` });
  } else {
    const kmh = km / (minutes / 60);
    if (kmh < limits.minAvgSpeedKmh || kmh > limits.maxAvgSpeedKmh) {
      reasons.push({ code: "implausibleDuration", detail: `average ${kmh.toFixed(1)} km/h` });
    }
  }

  if (pickup.coordinates && delivery.coordinates) {
    const straight = straightLineKm(pickup.coordinates, delivery.coordinates);
    if (straight > 0) {
      if (km < straight * STRAIGHT_LINE_TOLERANCE) {
        reasons.push({ code: "roadShorterThanStraightLine", detail: `road ${km} km < straight ${straight.toFixed(1)} km` });
      } else if (limits.maxRoadToStraightRatio !== null && km / straight > limits.maxRoadToStraightRatio) {
        reasons.push({ code: "routeTooIndirect", detail: `ratio ${(km / straight).toFixed(2)}` });
      }
    }
  }

  return reasons;
}
