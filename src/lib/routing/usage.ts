import type { RouteProvider, RouteRequest, RouteResult } from "./types.ts";

/**
 * API usage controls. In-memory implementations: they protect a single server
 * instance. Before production on serverless/multi-instance hosting, back them
 * with a shared store (planned with persistence in Step 1.7).
 */

/* ------------------------------------------------------------ usage guard */

export type UsageGuard = {
  /** Records one provider call if allowed; otherwise reports which cap was hit. */
  tryConsume(): { ok: true } | { ok: false; scope: "daily" | "monthly" };
  snapshot(): { day: string; dayCount: number; month: string; monthCount: number };
};

/**
 * Caps provider calls per UTC day and month, independently of the provider's
 * own quotas, so a bug or abuse cannot run up a bill.
 */
export function createUsageGuard(opts: { dailyLimit: number; monthlyLimit: number; now?: () => Date }): UsageGuard {
  const now = opts.now ?? (() => new Date());
  let day = "";
  let month = "";
  let dayCount = 0;
  let monthCount = 0;

  const roll = () => {
    const iso = now().toISOString();
    const d = iso.slice(0, 10);
    const m = iso.slice(0, 7);
    if (d !== day) [day, dayCount] = [d, 0];
    if (m !== month) [month, monthCount] = [m, 0];
  };

  return {
    tryConsume() {
      roll();
      if (dayCount >= opts.dailyLimit) return { ok: false, scope: "daily" };
      if (monthCount >= opts.monthlyLimit) return { ok: false, scope: "monthly" };
      dayCount++;
      monthCount++;
      return { ok: true };
    },
    snapshot() {
      roll();
      return { day, dayCount, month, monthCount };
    },
  };
}

/** Wraps a provider so calls beyond the guard's caps fail fast with "usageLimit". */
export function withUsageGuard(provider: RouteProvider, guard: UsageGuard): RouteProvider {
  return {
    id: provider.id,
    async computeRoute(request: RouteRequest): Promise<RouteResult> {
      const allowed = guard.tryConsume();
      if (!allowed.ok) return { ok: false, error: { kind: "usageLimit", retryable: false, providerStatus: allowed.scope.toUpperCase() } };
      return provider.computeRoute(request);
    },
  };
}

/* ----------------------------------------------------------- rate limiter */

export type RateLimiter = {
  /** Counts a request for `key` (e.g. client IP) if within the limit. */
  check(key: string): { allowed: true } | { allowed: false; retryAfterMs: number };
};

/**
 * Sliding-window limiter per client key, for the future quote endpoint.
 * Bounded memory: the oldest keys are evicted beyond `maxKeys`.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const maxKeys = opts.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();

  return {
    check(key: string) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < opts.windowMs);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: opts.windowMs - (t - recent[0]) };
      }
      recent.push(t);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return { allowed: true };
    },
  };
}
