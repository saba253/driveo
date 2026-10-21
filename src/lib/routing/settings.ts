/**
 * Routing settings from environment variables. Live Google requests stay OFF
 * unless GOOGLE_ROUTES_ENABLED is exactly "true" AND a server key is present.
 * Limits below are internal safety caps (not prices) and can be tightened via env.
 */

export type RoutingSettings =
  | { enabled: false; reason: "flagOff" | "missingApiKey" | "exposedKey"; limits: RoutingLimits }
  | { enabled: true; apiKey: string; timeoutMs: number; maxRetries: number; limits: RoutingLimits };

export type RoutingLimits = {
  /** Provider calls allowed per UTC day / month by our own guard. */
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
  /** Quote requests allowed per client per minute (future quote endpoint). */
  perClientPerMinute: number;
};

/** Proposed conservative defaults, well below the provider's free monthly allowance. */
export const DEFAULT_ROUTING_LIMITS: RoutingLimits = {
  dailyRequestLimit: 100,
  monthlyRequestLimit: 2000,
  perClientPerMinute: 5,
};

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function readRoutingSettings(env: Record<string, string | undefined>): RoutingSettings {
  const limits: RoutingLimits = {
    dailyRequestLimit: int(env.GOOGLE_ROUTES_DAILY_LIMIT, DEFAULT_ROUTING_LIMITS.dailyRequestLimit, 0, 10_000),
    monthlyRequestLimit: int(env.GOOGLE_ROUTES_MONTHLY_LIMIT, DEFAULT_ROUTING_LIMITS.monthlyRequestLimit, 0, 100_000),
    perClientPerMinute: int(env.ROUTE_QUOTES_PER_CLIENT_PER_MINUTE, DEFAULT_ROUTING_LIMITS.perClientPerMinute, 1, 60),
  };

  // A Maps key in a NEXT_PUBLIC_ variable would be shipped to browsers: refuse to run.
  if (Object.keys(env).some((k) => /^NEXT_PUBLIC_.*GOOGLE.*(KEY|SECRET)/i.test(k) && env[k])) {
    return { enabled: false, reason: "exposedKey", limits };
  }
  if (env.GOOGLE_ROUTES_ENABLED !== "true") return { enabled: false, reason: "flagOff", limits };

  const apiKey = env.GOOGLE_MAPS_SERVER_API_KEY?.trim();
  if (!apiKey) return { enabled: false, reason: "missingApiKey", limits };

  return {
    enabled: true,
    apiKey,
    timeoutMs: int(env.GOOGLE_ROUTES_TIMEOUT_MS, 5000, 1000, 15_000),
    maxRetries: int(env.GOOGLE_ROUTES_MAX_RETRIES, 1, 0, 3),
    limits,
  };
}
