/**
 * Road-routing contract. Providers return a normalized RouteResult and never
 * throw for expected failures. Pricing never falls back to straight-line
 * distance: any failure becomes a manual-pricing outcome.
 */

export type RoutePoint = {
  city: string;
  address: string;
  /** Provider place id from address autocomplete; preferred when present. */
  placeId?: string | null;
  coordinates?: { lat: number; lng: number } | null;
};

export type RouteRequest = { origin: RoutePoint; destination: RoutePoint };

export type RoadRoute = {
  /** Driving distance along roads. */
  distanceKm: number;
  durationMinutes: number;
  /** Always "road": pricing rejects anything else. */
  method: "road";
  /** Provider id, recorded with provider-derived data. */
  provider: string;
  computedAt: string;
};

export type RouteErrorKind =
  /** Live requests are switched off (feature flag) or not configured. */
  | "disabled"
  /** Provider found no drivable route between the points. */
  | "notFound"
  /** An address or place could not be resolved by the provider. */
  | "unresolvedAddress"
  /** Our request was rejected as invalid (a bug or bad input). */
  | "invalidRequest"
  /** Credentials missing, invalid or not permitted for this API. */
  | "auth"
  /** Provider quota or rate limit exceeded. */
  | "rateLimited"
  /** Our own usage guard refused the call (daily/monthly cap). */
  | "usageLimit"
  | "timeout"
  /** Network failure or provider 5xx. */
  | "unavailable"
  /** Response could not be interpreted safely. */
  | "malformedResponse";

export type RouteError = {
  kind: RouteErrorKind;
  /** Whether trying again later could succeed. */
  retryable: boolean;
  httpStatus?: number;
  /** Provider status string, e.g. "PERMISSION_DENIED". Never contains credentials. */
  providerStatus?: string;
  attempts?: number;
};

export type RouteResult = { ok: true; route: RoadRoute } | { ok: false; error: RouteError };

export interface RouteProvider {
  readonly id: string;
  computeRoute(request: RouteRequest): Promise<RouteResult>;
}

/** Provider used whenever live routing is off: always reports "disabled". */
export const disabledRouteProvider: RouteProvider = {
  id: "disabled",
  async computeRoute() {
    return { ok: false, error: { kind: "disabled", retryable: false } };
  },
};
