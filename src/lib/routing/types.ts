/**
 * Contract for a future road-routing service (e.g. a maps/directions API
 * called from the server). Nothing implements it yet: the site never invents
 * distances, and pricing never falls back to straight-line distance.
 */

export type RoutePoint = {
  city: string;
  address: string;
  /** Filled by geocoding once a provider exists. */
  coordinates?: { lat: number; lng: number };
};

export type RouteRequest = { origin: RoutePoint; destination: RoutePoint };

export type RoadRoute = {
  /** Driving distance along roads. */
  distanceKm: number;
  durationMinutes: number;
  /** Always "road": pricing rejects anything else. */
  method: "road";
  /** Provider id, recorded in quote snapshots. */
  provider: string;
  computedAt: string;
};

export type RouteFailureReason = "notFound" | "ambiguousAddress" | "unreachable" | "providerError";

export class RouteUnavailableError extends Error {
  readonly reason: RouteFailureReason;
  constructor(reason: RouteFailureReason, message?: string) {
    super(message ?? reason);
    this.reason = reason;
  }
}

export interface RouteProvider {
  readonly id: string;
  /** Resolves the road route or throws RouteUnavailableError. */
  getRoadRoute(request: RouteRequest): Promise<RoadRoute>;
}
