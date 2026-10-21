import type { RouteErrorKind, RoutePoint, RouteProvider, RouteRequest, RouteResult } from "./types.ts";

/**
 * MOCK road-routing provider for development and tests. Returns scripted
 * distances/durations per origin→destination pair — never real route data.
 * It refuses to exist in a production runtime.
 */

export const MOCK_PROVIDER_ID = "mock-routes";

export type MockRoute = { distanceKm: number; durationMinutes: number } | { error: RouteErrorKind };

export type MockRouteProviderOptions = {
  /** Keyed by `${originKey}->${destinationKey}`; see mockPointKey(). */
  routes: Record<string, MockRoute>;
  now?: () => Date;
  /** Simulated latency, e.g. to exercise timeouts. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** Place id when present, else rounded coordinates; unresolved points have no key. */
export function mockPointKey(point: RoutePoint): string | null {
  if (point.placeId?.trim()) return point.placeId.trim();
  const c = point.coordinates;
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) return `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
  return null;
}

const RETRYABLE: ReadonlySet<RouteErrorKind> = new Set(["timeout", "unavailable", "rateLimited"]);

export function createMockRouteProvider(options: MockRouteProviderOptions): RouteProvider {
  if (globalThis.process?.env?.NODE_ENV === "production") {
    throw new Error("The mock route provider must never be used in production");
  }
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    id: MOCK_PROVIDER_ID,
    async computeRoute(request: RouteRequest): Promise<RouteResult> {
      if (options.delayMs) await sleep(options.delayMs);
      const from = mockPointKey(request.origin);
      const to = mockPointKey(request.destination);
      if (!from || !to) return { ok: false, error: { kind: "unresolvedAddress", retryable: false, attempts: 0 } };

      const entry = options.routes[`${from}->${to}`];
      if (!entry) return { ok: false, error: { kind: "notFound", retryable: false, attempts: 1 } };
      if ("error" in entry) return { ok: false, error: { kind: entry.error, retryable: RETRYABLE.has(entry.error), attempts: 1 } };

      return {
        ok: true,
        route: {
          distanceKm: entry.distanceKm,
          durationMinutes: entry.durationMinutes,
          method: "road",
          provider: MOCK_PROVIDER_ID,
          computedAt: now().toISOString(),
        },
      };
    },
  };
}
