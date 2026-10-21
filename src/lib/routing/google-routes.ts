import type { RoadRoute, RouteError, RouteErrorKind, RoutePoint, RouteProvider, RouteRequest, RouteResult } from "./types.ts";

/**
 * Google Maps Platform Routes API adapter (computeRoutes), server-side only.
 *
 * - Requests the cheapest tier: DRIVE + TRAFFIC_UNAWARE, no departure time,
 *   no alternatives, no intermediate waypoints (see docs/google-cloud-setup.md).
 * - Asks only for distance and duration via the field mask.
 * - Accepts only resolved locations (place id or coordinates). Free-text
 *   addresses are refused rather than letting the provider guess.
 * - Normalizes every outcome into RouteResult; never throws for provider failures.
 * - Bounded retries with timeout per attempt; the API key never appears in results.
 *
 * Pure: fetch, sleep and clock are injectable so tests use mocked responses.
 */

export const GOOGLE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const GOOGLE_ROUTES_FIELD_MASK = "routes.distanceMeters,routes.duration";
export const GOOGLE_PROVIDER_ID = "google-routes";

export type GoogleRoutesOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt, for retryable failures only. Capped at 3. */
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /** Upper bound for a provider-requested Retry-After wait. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  languageCode?: string;
  regionCode?: string;
  endpoint?: string;
};

const MAX_RETRIES_CAP = 3;

type GoogleWaypoint = { placeId: string } | { location: { latLng: { latitude: number; longitude: number } } };

function toWaypoint(point: RoutePoint): GoogleWaypoint | null {
  if (point.placeId && point.placeId.trim()) return { placeId: point.placeId.trim() };
  const c = point.coordinates;
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180) {
    return { location: { latLng: { latitude: c.lat, longitude: c.lng } } };
  }
  return null;
}

export function buildComputeRoutesBody(request: RouteRequest, opts: { languageCode?: string; regionCode?: string } = {}) {
  const origin = toWaypoint(request.origin);
  const destination = toWaypoint(request.destination);
  if (!origin || !destination) return null;
  return {
    origin,
    destination,
    travelMode: "DRIVE",
    // Essentials tier: no live traffic, no departure time.
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
    units: "METRIC",
    languageCode: opts.languageCode ?? "ka",
    regionCode: opts.regionCode ?? "ge",
  };
}

const err = (kind: RouteErrorKind, retryable: boolean, extra: Partial<RouteError> = {}): RouteError => ({ kind, retryable, ...extra });

/** Only well-formed enum-like statuses are passed through, so no message text (or key) can leak. */
function providerStatus(body: unknown): string | undefined {
  const status = (body as { error?: { status?: unknown } } | null)?.error?.status;
  return typeof status === "string" && /^[A-Z_]{2,64}$/.test(status) ? status : undefined;
}

export function classifyHttpError(httpStatus: number, body: unknown): RouteError {
  const status = providerStatus(body);
  const extra = { httpStatus, ...(status ? { providerStatus: status } : {}) };
  if (httpStatus === 400) return err("invalidRequest", false, extra);
  if (httpStatus === 401 || httpStatus === 403) return err("auth", false, extra);
  if (httpStatus === 404) return err("unresolvedAddress", false, extra);
  if (httpStatus === 408) return err("timeout", true, extra);
  if (httpStatus === 429) return err("rateLimited", true, extra);
  if (httpStatus >= 500 && httpStatus <= 599) return err("unavailable", httpStatus !== 501, extra);
  return err("unavailable", false, extra);
}

/** "1234s" / "1234.5s" → seconds; anything else → null. */
export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return m ? Number(m[1]) : null;
}

export function parseComputeRoutesResponse(body: unknown, computedAt: string): RouteResult {
  if (!body || typeof body !== "object") return { ok: false, error: err("malformedResponse", false) };
  const routes = (body as { routes?: unknown }).routes;
  // An empty object means the provider found no route.
  if (routes === undefined || (Array.isArray(routes) && routes.length === 0)) return { ok: false, error: err("notFound", false) };
  if (!Array.isArray(routes)) return { ok: false, error: err("malformedResponse", false) };

  const first = routes[0] as { distanceMeters?: unknown; duration?: unknown };
  const meters = first?.distanceMeters;
  const seconds = parseDurationSeconds(first?.duration);
  // proto3 omits zero values, so a missing distance is not trustworthy either.
  if (typeof meters !== "number" || !Number.isFinite(meters) || meters <= 0 || seconds === null || seconds <= 0) {
    return { ok: false, error: err("malformedResponse", false) };
  }

  const route: RoadRoute = {
    distanceKm: meters / 1000,
    durationMinutes: seconds / 60,
    method: "road",
    provider: GOOGLE_PROVIDER_ID,
    computedAt,
  };
  return { ok: true, route };
}

function retryAfterMs(header: string | null, cap: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, cap) : null;
}

export function createGoogleRoutesProvider(options: GoogleRoutesOptions): RouteProvider {
  const apiKey = options.apiKey;
  if (!apiKey || !apiKey.trim()) throw new Error("Google Routes provider requires an API key");

  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxRetries = Math.max(0, Math.min(MAX_RETRIES_CAP, Math.floor(options.maxRetries ?? 1)));
  const baseDelay = options.retryBaseDelayMs ?? 300;
  const maxRetryAfter = options.maxRetryAfterMs ?? 2000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => new Date());
  const endpoint = options.endpoint ?? GOOGLE_ROUTES_ENDPOINT;

  async function attempt(body: string): Promise<{ result: RouteResult; retryAfter: number | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_ROUTES_FIELD_MASK,
        },
        body,
        signal: controller.signal,
        cache: "no-store",
      });
      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      if (!response.ok) {
        return { result: { ok: false, error: classifyHttpError(response.status, json) }, retryAfter: retryAfterMs(response.headers.get("retry-after"), maxRetryAfter) };
      }
      return { result: parseComputeRoutesResponse(json, now().toISOString()), retryAfter: null };
    } catch (e) {
      const aborted = controller.signal.aborted || (e instanceof Error && e.name === "AbortError");
      return { result: { ok: false, error: aborted ? err("timeout", true) : err("unavailable", true) }, retryAfter: null };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: GOOGLE_PROVIDER_ID,
    async computeRoute(request: RouteRequest): Promise<RouteResult> {
      const payload = buildComputeRoutesBody(request, options);
      // Unresolved locations are never sent: no spend, and no provider guessing.
      if (!payload) return { ok: false, error: err("unresolvedAddress", false, { attempts: 0 }) };
      const body = JSON.stringify(payload);

      let last: RouteResult = { ok: false, error: err("unavailable", true) };
      for (let i = 0; i <= maxRetries; i++) {
        const { result, retryAfter } = await attempt(body);
        if (result.ok) return result;
        last = { ok: false, error: { ...result.error, attempts: i + 1 } };
        if (!result.error.retryable || i === maxRetries) break;
        await sleep(retryAfter ?? baseDelay * 2 ** i);
      }
      return last;
    },
  };
}
