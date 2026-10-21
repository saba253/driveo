import "server-only";

import { toPublicQuoteResponse, type PublicQuoteResponse } from "@/lib/quotes/public";
import { createQuoteService, type PricingSetup, type QuoteService } from "@/lib/quotes/service";
import { createInMemoryQuoteStore, unavailableQuoteStore } from "@/lib/quotes/store";
import { createMockRouteProvider, type MockRoute } from "@/lib/routing/mock-provider";
import { readRoutingSettings } from "@/lib/routing/settings";
import { disabledRouteProvider, type RouteProvider } from "@/lib/routing/types";
import { createRateLimiter } from "@/lib/routing/usage";

/**
 * Server-only quote orchestration wiring (Step 1.6C.2 — mock mode).
 *
 * - Routing: QUOTE_ROUTING_MODE=mock uses the mock provider (development only,
 *   routes from QUOTE_MOCK_ROUTES as JSON); anything else is disabled.
 *   Live Google routing is intentionally NOT wired in this step.
 * - Pricing setup: no real tariff or configuration exists yet, so every
 *   request ends in manual pricing. Fixtures are never loaded here.
 * - Prices are never published to customers in this step.
 * - Nothing in the app calls this yet (no endpoint, no UI).
 */

const PUBLISH_PRICES = false;

let service: QuoteService | null = null;

function mockRoutesFromEnv(json: string | undefined): Record<string, MockRoute> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return {};
    const routes: Record<string, MockRoute> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as { distanceKm?: unknown; durationMinutes?: unknown };
      if (typeof v?.distanceKm === "number" && typeof v?.durationMinutes === "number") {
        routes[key] = { distanceKm: v.distanceKm, durationMinutes: v.durationMinutes };
      }
    }
    return routes;
  } catch {
    return {};
  }
}

function selectRouteProvider(): RouteProvider {
  const production = process.env.NODE_ENV === "production";
  if (!production && process.env.QUOTE_ROUTING_MODE === "mock") {
    return createMockRouteProvider({ routes: mockRoutesFromEnv(process.env.QUOTE_MOCK_ROUTES) });
  }
  return disabledRouteProvider;
}

/** No production tariff/configuration exists yet; returning none forces manual pricing. */
async function loadPricingSetup(): Promise<PricingSetup> {
  return { tariff: null, config: null };
}

export function getQuoteService(): QuoteService {
  if (service) return service;
  const production = process.env.NODE_ENV === "production";
  const limits = readRoutingSettings(process.env).limits;
  service = createQuoteService({
    routeProvider: selectRouteProvider(),
    loadPricingSetup,
    // In-memory store and limiter protect a single dev instance only (see docs/production-readiness.md).
    store: production ? unavailableQuoteStore : createInMemoryQuoteStore(),
    rateLimiter: createRateLimiter({ limit: limits.perClientPerMinute, windowMs: 60_000 }),
  });
  return service;
}

/** Entry point for a future route handler: untrusted body in, customer-safe response out. */
export async function requestPublicQuote(body: unknown, clientKey: string): Promise<PublicQuoteResponse> {
  const result = await getQuoteService().requestQuote(body, { clientKey });
  return toPublicQuoteResponse(result, { publishPrices: PUBLISH_PRICES });
}

/**
 * Client key for rate limiting. x-forwarded-for is only trustworthy behind a
 * proxy that overwrites it (verify on the chosen hosting platform).
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
