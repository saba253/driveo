import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGoogleRoutesProvider } from "../routing/google-routes.ts";
import { disabledRouteProvider, type RouteProvider, type RouteRequest } from "../routing/types.ts";
import { createUsageGuard, withUsageGuard } from "../routing/usage.ts";
import type { QuoteOutcome, QuoteRequest } from "./engine-types.ts";
import { priceQuote } from "./quote.ts";
import { FIXTURE_TARIFF, FIXTURE_TBILISI_CONFIG, fixtureRequest } from "./test-fixtures.ts";

/*
 * Provider → pricing engine, with MOCKED Google responses and FIXTURE tariffs.
 * Home base is the configured Tbilisi base; fares are fixtures.
 */

const NOW = "2026-10-21T08:00:00.000Z";

const toRouteRequest = (q: QuoteRequest): RouteRequest => ({
  origin: { city: q.pickup.locality, address: q.pickup.address, placeId: q.pickup.placeId },
  destination: { city: q.delivery.locality, address: q.delivery.address, placeId: q.delivery.placeId },
});

async function quoteVia(provider: RouteProvider, request: QuoteRequest): Promise<QuoteOutcome> {
  const route = await provider.computeRoute(toRouteRequest(request));
  return priceQuote({
    request,
    route,
    tariff: FIXTURE_TARIFF,
    config: FIXTURE_TBILISI_CONFIG,
    meta: { quoteId: "q1", version: 1, computedBy: "server", now: NOW },
    allowFixtures: true,
  });
}

const mockGoogle = (response: () => Response) =>
  createGoogleRoutesProvider({
    apiKey: "test-key-NOT-REAL",
    fetch: (async () => response()) as typeof fetch,
    now: () => new Date(NOW),
    sleep: async () => {},
    maxRetries: 1,
  });

const resolved = (from: string, to: string) =>
  fixtureRequest(from, to, {
    pickup: { locality: from, address: "pickup", placeId: "place-pickup" },
    delivery: { locality: to, address: "delivery", placeId: "place-delivery" },
  });

const reasons = (o: QuoteOutcome) => (o.status === "manual_pricing" ? o.reasons.map((r) => `${r.code}:${r.detail ?? ""}`) : []);

describe("routing provider → quote engine", () => {
  it("a successful (mocked) Google route produces a server quote with provider data kept separate", async () => {
    const google = mockGoogle(() => Response.json({ routes: [{ distanceMeters: 200_000, duration: "10800s" }] }));
    const o = await quoteVia(google, resolved("Tbilisi", "Beta"));
    assert.equal(o.status, "quoted");
    if (o.status !== "quoted") return;
    assert.equal(o.quote.providerDerived?.route.provider, "google-routes");
    assert.equal(o.quote.providerDerived?.route.distanceKm, 200);
    assert.equal(o.quote.commercial.zones.base, "tbilisi");
    assert.ok(!JSON.stringify(o.quote.commercial).includes("google"));
  });

  it("every provider failure becomes manual pricing — nothing is substituted", async () => {
    const cases: Array<[string, RouteProvider]> = [
      ["disabled", disabledRouteProvider],
      ["notFound", mockGoogle(() => Response.json({}))],
      ["auth", mockGoogle(() => Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 }))],
      ["unavailable", mockGoogle(() => Response.json({}, { status: 503 }))],
      ["rateLimited", mockGoogle(() => Response.json({}, { status: 429 }))],
      ["malformedResponse", mockGoogle(() => Response.json({ routes: [{ duration: "60s" }] }))],
      ["usageLimit", withUsageGuard(mockGoogle(() => Response.json({})), createUsageGuard({ dailyLimit: 0, monthlyLimit: 0 }))],
    ];
    for (const [kind, provider] of cases) {
      const o = await quoteVia(provider, resolved("Tbilisi", "Beta"));
      assert.equal(o.status, "manual_pricing", kind);
      assert.deepEqual(reasons(o), [`routeUnavailable:${kind}`]);
      assert.ok(!JSON.stringify(o).includes("amountMinor"));
    }
  });

  it("free-text addresses without a place id go to manual pricing without calling Google", async () => {
    let called = false;
    const google = createGoogleRoutesProvider({
      apiKey: "test-key-NOT-REAL",
      fetch: (async () => {
        called = true;
        return Response.json({});
      }) as typeof fetch,
    });
    const o = await quoteVia(google, fixtureRequest("Tbilisi", "Beta"));
    assert.deepEqual(reasons(o), ["routeUnavailable:unresolvedAddress"]);
    assert.equal(called, false);
  });

  it("an implausible provider distance is caught by the engine", async () => {
    const google = mockGoogle(() => Response.json({ routes: [{ distanceMeters: 5_000_000, duration: "180000s" }] }));
    const o = await quoteVia(google, resolved("Tbilisi", "Beta"));
    assert.equal(o.status, "manual_pricing");
    assert.ok(reasons(o).some((r) => r.startsWith("implausibleDistance")));
  });
});
