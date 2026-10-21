import "server-only";

import { createGoogleRoutesProvider } from "@/lib/routing/google-routes";
import { readRoutingSettings, type RoutingSettings } from "@/lib/routing/settings";
import { disabledRouteProvider, type RouteProvider } from "@/lib/routing/types";
import { createRateLimiter, createUsageGuard, withUsageGuard, type RateLimiter } from "@/lib/routing/usage";

/**
 * Server-only entry point for road routing. Importing this from a Client
 * Component fails the build ("server-only"), so the API key cannot reach the browser.
 *
 * Live Google requests are OFF unless GOOGLE_ROUTES_ENABLED=true and
 * GOOGLE_MAPS_SERVER_API_KEY is set. Nothing in the app calls this yet.
 */

let cached: { settings: RoutingSettings; provider: RouteProvider; limiter: RateLimiter } | null = null;

function init() {
  if (cached) return cached;
  const settings = readRoutingSettings(process.env);
  const limiter = createRateLimiter({ limit: settings.limits.perClientPerMinute, windowMs: 60_000 });

  let provider: RouteProvider = disabledRouteProvider;
  if (settings.enabled) {
    const guard = createUsageGuard({
      dailyLimit: settings.limits.dailyRequestLimit,
      monthlyLimit: settings.limits.monthlyRequestLimit,
    });
    provider = withUsageGuard(createGoogleRoutesProvider({ apiKey: settings.apiKey, timeoutMs: settings.timeoutMs, maxRetries: settings.maxRetries }), guard);
  }

  cached = { settings, provider, limiter };
  return cached;
}

export function getRouteProvider(): RouteProvider {
  return init().provider;
}

/** Per-client limiter for the future quote endpoint (Step 1.6C.2). */
export function getQuoteRateLimiter(): RateLimiter {
  return init().limiter;
}

/** Non-secret status for diagnostics/admin. Never includes the key. */
export function routingStatus(): { enabled: boolean; reason?: string } {
  const { settings } = init();
  return settings.enabled ? { enabled: true } : { enabled: false, reason: settings.reason };
}
