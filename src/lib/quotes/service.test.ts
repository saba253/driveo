import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PricingEngineConfig, ServiceTariff } from "../pricing/engine-types.ts";
import type { AutomaticPricingPolicy } from "../pricing/eligibility.ts";
import { DEFAULT_AUTOMATIC_PRICING_POLICY } from "../pricing/pilot.ts";
import { FIXTURE_ELIGIBLE_POLICY, FIXTURE_TARIFF, FIXTURE_TBILISI_CONFIG } from "../pricing/test-fixtures.ts";
import { createMockRouteProvider, type MockRoute } from "../routing/mock-provider.ts";
import type { RouteProvider } from "../routing/types.ts";
import { createRateLimiter } from "../routing/usage.ts";
import { tbilisiNow } from "./input.ts";
import { toPublicQuoteResponse } from "./public.ts";
import { QuoteServiceConfigError, createQuoteService, type PricingSetup, type QuoteServiceResult } from "./service.ts";
import { createInMemoryQuoteStore } from "./store.ts";

/*
 * MOCK routing + FIXTURE tariffs/fares only. Home base: configured Tbilisi.
 * Beta/Gamma/Delta are fictional zones; distances are mock values.
 */

const PLACES = {
  tbilisi: { locality: "Tbilisi", placeId: "place-tbilisi-001" },
  beta: { locality: "Beta", placeId: "place-beta-00001" },
  gamma: { locality: "Gamma", placeId: "place-gamma-0001" },
  delta: { locality: "Delta", placeId: "place-delta-0001" },
} as const;
type Place = (typeof PLACES)[keyof typeof PLACES];

const MOCK_ROUTES: Record<string, MockRoute> = {
  "place-tbilisi-001->place-beta-00001": { distanceKm: 200, durationMinutes: 180 },
  "place-beta-00001->place-gamma-0001": { distanceKm: 150, durationMinutes: 140 },
  "place-tbilisi-001->place-delta-0001": { distanceKm: 100, durationMinutes: 90 },
  "place-delta-0001->place-beta-00001": { distanceKm: 120, durationMinutes: 110 },
  "place-tbilisi-001->place-gamma-0001": { error: "timeout" },
  // Road must be longer than the ~265 km straight line, or the engine (rightly) refuses it.
  "41.71500,44.82700->41.64000,41.63000": { distanceKm: 340, durationMinutes: 300 },
};

const T0 = new Date("2026-10-21T08:00:00.000Z"); // 12:00 in Tbilisi

const input = (from: Place, to: Place, over: Record<string, unknown> = {}) => ({
  pickup: { locality: from.locality, address: "Pickup street 1", placeId: from.placeId },
  delivery: { locality: to.locality, address: "Delivery avenue 2", placeId: to.placeId },
  schedule: { date: "2026-10-25", time: "09:00" },
  vehicle: { powertrain: "petrol", transmission: "automatic", drivableConfirmed: true },
  ...over,
});

function harness(opts: { setup?: Partial<PricingSetup>; limit?: number; allowTestCoordinates?: boolean; policy?: Partial<AutomaticPricingPolicy> } = {}) {
  let clock = T0;
  let ids = 0;
  let routeCalls = 0;
  const setup: PricingSetup = { tariff: FIXTURE_TARIFF, config: FIXTURE_TBILISI_CONFIG, ...opts.setup };
  const mock = createMockRouteProvider({ routes: MOCK_ROUTES, now: () => clock });
  const provider: RouteProvider = { id: mock.id, computeRoute: (r) => (routeCalls++, mock.computeRoute(r)) };
  const store = createInMemoryQuoteStore();
  // Mutable copy so a test can record a newly approved tariff version.
  const policy: AutomaticPricingPolicy = { ...FIXTURE_ELIGIBLE_POLICY, ...opts.policy };
  const service = createQuoteService({
    automaticPricingPolicy: policy,
    routeProvider: provider,
    loadPricingSetup: async () => setup,
    store,
    rateLimiter: opts.limit ? createRateLimiter({ limit: opts.limit, windowMs: 60_000, now: () => clock.getTime() }) : undefined,
    now: () => clock,
    newId: () => `id-${++ids}`,
    allowFixtures: true,
    allowTestCoordinates: opts.allowTestCoordinates,
  });
  return {
    service,
    store,
    setup,
    policy,
    routeCalls: () => routeCalls,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
    request: (raw: unknown) => service.requestQuote(raw, { clientKey: "client-1" }),
  };
}

/** The customer's acknowledgement of the exact total they were shown. */
const ack = (q: { commercial: { total: { amountMinor: number } } }) => ({ totalMinor: q.commercial.total.amountMinor });

const quoted = (r: QuoteServiceResult) => {
  assert.equal(r.status, "quoted", r.status === "manual_pricing" ? JSON.stringify(r.reasons) : r.status === "invalid_input" ? JSON.stringify(r.issues) : "");
  return (r as Extract<QuoteServiceResult, { status: "quoted" }>).quote;
};
const manual = (r: QuoteServiceResult) => {
  assert.equal(r.status, "manual_pricing");
  return (r as Extract<QuoteServiceResult, { status: "manual_pricing" }>).reasons.map((x) => `${x.code}${x.detail ? `:${x.detail}` : ""}`);
};
const issues = (r: QuoteServiceResult) => {
  assert.equal(r.status, "invalid_input");
  return (r as Extract<QuoteServiceResult, { status: "invalid_input" }>).issues.map((i) => `${i.field}:${i.code}`);
};

describe("quote orchestration — mocked routing and pricing", () => {
  it("prices Tbilisi → Beta with positioning and return each exactly once", async () => {
    const h = harness();
    const q = quoted(await h.request(input(PLACES.tbilisi, PLACES.beta)));
    const legs = q.commercial.lines.filter((l) => l.kind === "positioning" || l.kind === "return").map((l) => `${l.kind}:${l.source}`);
    assert.deepEqual(legs, ["positioning:t-tbilisi-tbilisi", "return:t-beta-tbilisi"]);
    assert.equal(q.commercial.zones.base, "tbilisi");
    assert.equal(q.computedBy, "server");
    assert.equal(q.authoritative, true);
    assert.equal(q.commercial.testData, true);
    assert.equal(q.providerDerived?.route.provider, "mock-routes");
    assert.equal(q.providerDerived?.route.distanceKm, 200);
    assert.deepEqual(await h.store.get(q.quoteId), q);
  });

  it("routes that neither start nor end in Tbilisi use both base legs", async () => {
    const q = quoted(await harness().request(input(PLACES.beta, PLACES.gamma)));
    const legs = q.commercial.lines.filter((l) => l.kind === "positioning" || l.kind === "return").map((l) => l.source);
    assert.deepEqual(legs, ["t-tbilisi-beta", "t-gamma-tbilisi"]);
  });

  it("no route → manual pricing", async () => {
    assert.deepEqual(manual(await harness().request(input(PLACES.beta, PLACES.tbilisi))), ["routeUnavailable:notFound"]);
  });

  it("routing timeout → manual pricing", async () => {
    assert.deepEqual(manual(await harness().request(input(PLACES.tbilisi, PLACES.gamma))), ["routeUnavailable:timeout"]);
  });

  it("missing tariff → manual pricing without calling the routing provider", async () => {
    const h = harness({ setup: { tariff: null } });
    assert.deepEqual(manual(await h.request(input(PLACES.tbilisi, PLACES.beta))), ["missingTariff"]);
    assert.equal(h.routeCalls(), 0);
  });

  it("missing configuration → manual pricing without calling the routing provider", async () => {
    const h = harness({ setup: { config: null } });
    assert.deepEqual(manual(await h.request(input(PLACES.tbilisi, PLACES.beta))), ["invalidConfig:no pricing configuration"]);
    assert.equal(h.routeCalls(), 0);
  });

  it("missing positioning or return rule → manual pricing, never zero", async () => {
    assert.deepEqual(manual(await harness().request(input(PLACES.delta, PLACES.beta))), ["missingPositioningRule:tbilisi → delta"]);
    assert.deepEqual(manual(await harness().request(input(PLACES.tbilisi, PLACES.delta))), ["missingReturnRule:delta → tbilisi"]);
  });

  it("unconfigured overnight policy → manual pricing", async () => {
    const config: PricingEngineConfig = { ...FIXTURE_TBILISI_CONFIG, overnight: { mode: "notConfigured" } };
    assert.deepEqual(manual(await harness({ setup: { config } }).request(input(PLACES.tbilisi, PLACES.beta))), ["overnightPolicyNotConfigured"]);
  });

  it("uses the driver's own base when the setup names a driver", async () => {
    const h = harness({ setup: { driver: { id: "driver-beta", base: { zoneId: "beta", locality: "Beta" } } } });
    const q = quoted(await h.request(input(PLACES.beta, PLACES.gamma)));
    assert.equal(q.commercial.driverId, "driver-beta");
    assert.equal(q.commercial.zones.base, "beta");
  });
});

describe("quote orchestration — automatic-pricing gate", () => {
  it("the shipped default policy sends everything to manual assessment without calling the routing provider", async () => {
    const h = harness({ policy: DEFAULT_AUTOMATIC_PRICING_POLICY });
    const r = await h.request(input(PLACES.tbilisi, PLACES.beta));
    assert.equal(r.status, "manual_pricing");
    if (r.status !== "manual_pricing") return;
    assert.ok(r.eligibility.reasons.some((x) => x.code === "automaticPricingDisabled"));
    assert.ok(!r.eligibility.reasons.some((x) => x.code === "routeUnavailable"), "route not computed, so not blamed");
    assert.equal(h.routeCalls(), 0);
    const pub = toPublicQuoteResponse(r, { publishPrices: true });
    assert.equal(pub.status, "manual_pricing");
    assert.equal(pub.status === "manual_pricing" && pub.message, "ეს მოთხოვნა ინდივიდუალურად შეფასდება. ფასსა და ხელმისაწვდომობას დაგიდასტურებთ.");
  });

  it("a computable price that fails the gate is never stored or returned", async () => {
    const h = harness({ policy: { pilotRoutes: [] } });
    const r = await h.request(input(PLACES.tbilisi, PLACES.beta));
    assert.equal(r.status, "manual_pricing");
    if (r.status !== "manual_pricing") return;
    assert.deepEqual(r.reasons, []);
    assert.deepEqual(r.eligibility.reasons.map((x) => x.code), ["routeNotInPilot"]);
    assert.equal(h.routeCalls(), 1);
    assert.equal(await h.store.get("id-2"), null, "no quote stored");
    assert.ok(!JSON.stringify(toPublicQuoteResponse(r, { publishPrices: true })).includes("amountMinor"));
  });

  it("eligible requests are shown as 'under review' — never as an accepted or automatic price", async () => {
    const r = await harness().request(input(PLACES.tbilisi, PLACES.beta));
    assert.equal(r.status, "quoted");
    const pub = toPublicQuoteResponse(r, { publishPrices: false });
    assert.equal(pub.status, "price_pending");
    assert.equal(pub.status === "price_pending" && pub.message, "თქვენი მოთხოვნა განხილვის პროცესშია. ფასსა და ხელმისაწვდომობას დადასტურებამდე გაცნობებთ.");
  });
});

describe("quote orchestration — invalidation before booking", () => {
  it("accepts an unchanged, unexpired quote", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const q = quoted(await h.request(raw));
    const check = await h.service.checkQuoteForBooking(q.quoteId, raw, ack(q));
    assert.equal(check.ok, true);
  });

  it("uses only server-created timestamps; clients cannot supply them", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const q = quoted(await h.request(raw));
    assert.equal(q.computedAt, T0.toISOString());
    assert.equal(q.validUntil, "2026-10-21T20:00:00.000Z");
    for (const key of ["computedAt", "validUntil", "now"]) {
      assert.deepEqual(issues(await h.request({ ...raw, [key]: "2099-01-01T00:00:00Z" })), [`${key}:unknownField`]);
    }
  });

  it("is invalidated by every relevant change", async () => {
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const changed: Array<[string, Record<string, unknown>]> = [
      ["address", { ...raw, delivery: { ...raw.delivery, address: "Another street 9" } }],
      ["place", { ...raw, delivery: { ...raw.delivery, placeId: "place-beta-00002" } }],
      ["date", { ...raw, schedule: { date: "2026-10-26", time: "09:00" } }],
      ["time", { ...raw, schedule: { date: "2026-10-25", time: "10:00" } }],
      ["vehicle", { ...raw, vehicle: { ...raw.vehicle, transmission: "manual" } }],
      ["drivable", { ...raw, vehicle: { ...raw.vehicle, drivableConfirmed: false } }],
    ];
    for (const [what, changedInput] of changed) {
      const h = harness();
      const q = quoted(await h.request(raw));
      const check = await h.service.checkQuoteForBooking(q.quoteId, changedInput, ack(q));
      assert.deepEqual(check, { ok: false, reason: "inputsChanged" }, what);
    }
  });

  it("is invalidated by a new tariff version, configuration or driver base", async () => {
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const mutations: Array<[string, (s: PricingSetup) => void]> = [
      ["tariff", (s) => (s.tariff = { ...(s.tariff as ServiceTariff), version: 2 })],
      ["config", (s) => (s.config = { ...(s.config as PricingEngineConfig), version: "fixture-tbilisi-config-2" })],
      ["driver", (s) => (s.driver = { id: "driver-beta", base: { zoneId: "beta", locality: "Beta" } })],
    ];
    for (const [what, mutate] of mutations) {
      const h = harness();
      const q = quoted(await h.request(raw));
      mutate(h.setup);
      assert.deepEqual(await h.service.checkQuoteForBooking(q.quoteId, raw, ack(q)), { ok: false, reason: "inputsChanged" }, what);
    }
  });

  it("is valid at 11 h 59 min and expired at exactly 12 h and at 12 h 1 min (server clock)", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const q = quoted(await h.request(raw));
    const MIN = 60_000;
    h.advance(11 * 60 * MIN + 59 * MIN);
    assert.equal((await h.service.checkQuoteForBooking(q.quoteId, raw, ack(q))).ok, true, "11:59");
    h.advance(MIN);
    assert.deepEqual(await h.service.checkQuoteForBooking(q.quoteId, raw, ack(q)), { ok: false, reason: "expired" }, "12:00");
    h.advance(MIN);
    assert.deepEqual(await h.service.checkQuoteForBooking(q.quoteId, raw, ack(q)), { ok: false, reason: "expired" }, "12:01");
  });

  it("an expired quote is rejected and a re-quote creates a new, usable version", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const first = quoted(await h.request(raw));
    h.advance(12 * 3_600_000);
    assert.deepEqual(await h.service.checkQuoteForBooking(first.quoteId, raw, ack(first)), { ok: false, reason: "expired" });
    const second = quoted(await h.request({ ...raw, previousQuoteId: first.quoteId }));
    assert.equal(second.version, 2);
    assert.equal(second.validUntil, new Date(Date.parse(second.computedAt) + 12 * 3_600_000).toISOString());
    assert.equal((await h.service.checkQuoteForBooking(second.quoteId, raw, ack(second))).ok, true);
  });

  it("supports a non-default validity from the configuration", async () => {
    const config: PricingEngineConfig = { ...FIXTURE_TBILISI_CONFIG, quoteValidityHours: 3 };
    const h = harness({ setup: { config } });
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const q = quoted(await h.request(raw));
    assert.equal(q.validUntil, "2026-10-21T11:00:00.000Z");
    h.advance(3 * 3_600_000);
    assert.deepEqual(await h.service.checkQuoteForBooking(q.quoteId, raw, ack(q)), { ok: false, reason: "expired" });
  });

  it("requires the customer to acknowledge the exact total, and again after a price change", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const first = quoted(await h.request(raw));
    assert.deepEqual(await h.service.checkQuoteForBooking(first.quoteId, raw, { totalMinor: null }), {
      ok: false,
      reason: "acknowledgementRequired",
      priceChanged: false,
    });
    assert.deepEqual(await h.service.checkQuoteForBooking(first.quoteId, raw, { totalMinor: first.commercial.total.amountMinor + 100 }), {
      ok: false,
      reason: "acknowledgementRequired",
      priceChanged: false,
    });

    // The tariff changes (fixture only) and the customer re-quotes: the price changes.
    h.setup.tariff = { ...(h.setup.tariff as ServiceTariff), version: 2, perKmMinor: 130 };
    h.policy.tariffApproval = { ...h.policy.tariffApproval!, tariffVersion: 2 };
    const secondResult = await h.request({ ...raw, previousQuoteId: first.quoteId });
    const second = quoted(secondResult);
    assert.equal(second.priceChange?.changed, true);
    assert.deepEqual(second.priceChange?.previousTotal, first.commercial.total);
    const pub = toPublicQuoteResponse(secondResult, { publishPrices: false });
    assert.equal(pub.status, "price_pending");
    assert.equal(pub.status === "price_pending" && pub.priceChanged, true);

    // Acknowledging the OLD total is not enough.
    assert.deepEqual(await h.service.checkQuoteForBooking(second.quoteId, raw, ack(first)), {
      ok: false,
      reason: "acknowledgementRequired",
      priceChanged: true,
    });
    assert.equal((await h.service.checkQuoteForBooking(second.quoteId, raw, ack(second))).ok, true);
  });

  it("a re-quote supersedes the previous version", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    const first = quoted(await h.request(raw));
    const second = quoted(await h.request({ ...raw, previousQuoteId: first.quoteId }));
    assert.equal(second.version, 2);
    assert.equal(second.requestId, first.requestId);
    assert.equal(second.supersedes, first.quoteId);
    assert.deepEqual(await h.service.checkQuoteForBooking(first.quoteId, raw, ack(first)), { ok: false, reason: "superseded" });
    assert.equal((await h.service.checkQuoteForBooking(second.quoteId, raw, ack(second))).ok, true);
    assert.equal(second.priceChange?.changed, false);
    // A superseded quote cannot be re-quoted again.
    assert.deepEqual(issues(await h.request({ ...raw, previousQuoteId: first.quoteId })), ["previousQuoteId:invalid"]);
  });

  it("unknown quotes and invalid inputs are refused", async () => {
    const h = harness();
    assert.deepEqual(await h.service.checkQuoteForBooking("nope", input(PLACES.tbilisi, PLACES.beta), { totalMinor: 1 }), { ok: false, reason: "unknownQuote" });
    const check = await h.service.checkQuoteForBooking("nope", { pickup: {} }, { totalMinor: 1 });
    assert.equal(!check.ok && check.reason, "invalidInput");
  });
});

describe("quote orchestration — fuel/charging, restricted data and publishing", () => {
  it("customers cannot send extras, overrides, prices, tariffs or drivers", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    for (const key of ["extras", "overrides", "price", "tariff", "driver", "total"]) {
      assert.deepEqual(issues(await h.request({ ...raw, [key]: [] })), [`${key}:unknownField`]);
    }
    assert.deepEqual(issues(await h.request({ ...raw, vehicle: { ...raw.vehicle, fuelIncluded: true } })), ["vehicle.fuelIncluded:unknownField"]);
  });

  it("quotes never include fuel or charging", async () => {
    const q = quoted(await harness().request(input(PLACES.tbilisi, PLACES.beta, { vehicle: { powertrain: "electric", transmission: "automatic", drivableConfirmed: true } })));
    assert.deepEqual([...q.commercial.excludes], ["fuel", "charging"]);
    assert.ok(q.commercial.lines.every((l) => !/fuel|charg|energy|petrol|diesel|electric/i.test(`${l.kind}${l.code}`)));
    assert.equal(q.commercial.total.amountMinor, q.commercial.lines.reduce((s, l) => s + l.amount.amountMinor, 0));
  });

  it("the public response never contains restricted provider data or internals", async () => {
    const h = harness();
    const results = [
      await h.request(input(PLACES.tbilisi, PLACES.beta)),
      await h.request(input(PLACES.beta, PLACES.tbilisi)),
      await h.request(input(PLACES.delta, PLACES.beta)),
    ];
    for (const r of results) {
      for (const publishPrices of [false, true]) {
        const json = JSON.stringify(toPublicQuoteResponse(r, { publishPrices }));
        for (const banned of ["distance", "duration", "mock-routes", "providerDerived", "provider", "tbilisi", "t-", "fixture", "commitment", "amountMinor", "zone", "detail"]) {
          assert.ok(!json.includes(banned), `${banned} leaked in ${json}`);
        }
      }
    }
    // Restricted data stays server-side, separately purgeable.
    const q = quoted(results[0]);
    assert.ok(q.providerDerived);
    assert.ok(!JSON.stringify(q.commercial).includes("distanceKm"));
  });

  it("fixture-based prices are never published, even when publishing is enabled", async () => {
    const r = await harness().request(input(PLACES.tbilisi, PLACES.beta));
    const pub = toPublicQuoteResponse(r, { publishPrices: true });
    assert.equal(pub.status, "price_pending");
  });

  it("only a non-test, authoritative quote with publishing enabled shows a price", async () => {
    // Test-only clones flagged as non-fixture purely to exercise the publishing gate.
    const tariff: ServiceTariff = { ...FIXTURE_TARIFF, id: "gate-test-tariff", fixture: false };
    const config: PricingEngineConfig = { ...FIXTURE_TBILISI_CONFIG, version: "gate-test-config", fixture: false };
    const policy = {
      tariffApproval: { tariffId: tariff.id, tariffVersion: tariff.version, approval: FIXTURE_ELIGIBLE_POLICY.masterApproval },
      configApproval: { configVersion: config.version, approval: FIXTURE_ELIGIBLE_POLICY.masterApproval },
    };
    // Without approval the gate refuses even a computable price.
    const refused = await harness({ setup: { tariff, config } }).request(input(PLACES.tbilisi, PLACES.beta));
    assert.equal(refused.status, "manual_pricing");
    const r = await harness({ setup: { tariff, config }, policy }).request(input(PLACES.tbilisi, PLACES.beta));
    assert.equal(toPublicQuoteResponse(r, { publishPrices: false }).status, "price_pending");
    const pub = toPublicQuoteResponse(r, { publishPrices: true });
    assert.equal(pub.status, "price_available");
    if (pub.status === "price_available") {
      assert.deepEqual(Object.keys(pub).sort(), ["excludes", "message", "priceChanged", "quoteId", "status", "total", "validUntil"]);
      assert.equal(pub.total.amountMinor % 100, 0, "published totals are whole GEL");
      assert.deepEqual([...pub.excludes], ["fuel", "charging"]);
    }
  });

  it("manual pricing is shown to customers only as coarse categories", async () => {
    const r = await harness({ setup: { tariff: null } }).request(input(PLACES.tbilisi, PLACES.beta));
    const manualMessage = "ეს მოთხოვნა ინდივიდუალურად შეფასდება. ფასსა და ხელმისაწვდომობას დაგიდასტურებთ.";
    assert.deepEqual(toPublicQuoteResponse(r, { publishPrices: true }), { status: "manual_pricing", categories: ["service"], message: manualMessage });
    const noRoute = await harness().request(input(PLACES.beta, PLACES.tbilisi));
    assert.deepEqual(toPublicQuoteResponse(noRoute, { publishPrices: true }), { status: "manual_pricing", categories: ["route"], message: manualMessage });
  });
});

describe("quote orchestration — input validation and abuse protection", () => {
  it("requires a selected place id; free text is not routed", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    assert.deepEqual(issues(await h.request({ ...raw, pickup: { locality: "Tbilisi", address: "Some street 5" } })), ["pickup:locationNotResolved"]);
    assert.deepEqual(issues(await h.request({ ...raw, pickup: { ...raw.pickup, placeId: "bad id!" } })), ["pickup.placeId:invalid"]);
    assert.equal(h.routeCalls(), 0);
  });

  it("accepts trusted test coordinates only when allowed, and only inside Georgia", async () => {
    const coords = {
      pickup: { locality: "Tbilisi", address: "Test point A", coordinates: { lat: 41.715, lng: 44.827 } },
      delivery: { locality: "Beta", address: "Test point B", coordinates: { lat: 41.64, lng: 41.63 } },
    };
    const raw = { ...input(PLACES.tbilisi, PLACES.beta), ...coords };
    assert.deepEqual(issues(await harness().request(raw)), ["pickup.coordinates:testCoordinatesNotAllowed", "delivery.coordinates:testCoordinatesNotAllowed"]);
    const allowed = harness({ allowTestCoordinates: true });
    assert.equal((await allowed.request(raw)).status, "quoted");
    const outside = { ...raw, delivery: { ...coords.delivery, coordinates: { lat: 48.85, lng: 2.35 } } };
    assert.deepEqual(issues(await allowed.request(outside)), ["delivery.coordinates:outsideServiceArea"]);
  });

  it("rejects past dates and times already passed in Tbilisi", async () => {
    const h = harness();
    const raw = input(PLACES.tbilisi, PLACES.beta);
    assert.deepEqual(issues(await h.request({ ...raw, schedule: { date: "2026-10-20", time: "09:00" } })), ["schedule.date:dateInPast"]);
    assert.deepEqual(issues(await h.request({ ...raw, schedule: { date: "2026-10-21", time: "11:59" } })), ["schedule.time:timeInPast"]);
    assert.equal((await h.request({ ...raw, schedule: { date: "2026-10-21", time: "12:30" } })).status, "quoted");
    assert.deepEqual(issues(await h.request({ ...raw, schedule: { date: "2026-02-30", time: "09:00" } })), ["schedule.date:invalid"]);
  });

  it("computes 'now' in Tbilisi regardless of the server time zone", () => {
    assert.deepEqual(tbilisiNow(new Date("2026-10-21T20:30:00Z")), { date: "2026-10-22", time: "00:30" });
  });

  it("validates vehicle facts strictly", async () => {
    const raw = input(PLACES.tbilisi, PLACES.beta);
    assert.deepEqual(issues(await harness().request({ ...raw, vehicle: { powertrain: "steam", transmission: "automatic", drivableConfirmed: "yes" } })), [
      "vehicle.powertrain:invalid",
      "vehicle.drivableConfirmed:required",
    ]);
    // A false confirmation is valid input but never priced automatically.
    assert.deepEqual(manual(await harness().request({ ...raw, vehicle: { ...raw.vehicle, drivableConfirmed: false } })), [
      "vehicleNotEligible:drivable confirmation missing",
    ]);
  });

  it("rate-limits per client before doing any work", async () => {
    const h = harness({ limit: 2 });
    const raw = input(PLACES.tbilisi, PLACES.beta);
    await h.request(raw);
    await h.request(raw);
    const third = await h.request(raw);
    assert.equal(third.status, "rate_limited");
    assert.equal(h.routeCalls(), 2);
    assert.deepEqual(toPublicQuoteResponse(third, { publishPrices: false }), { status: "rate_limited", retryAfterSeconds: 60 });
  });
});

describe("production guards", () => {
  it("refuses mock routing, fixtures, test coordinates and in-memory stores in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      assert.throws(() => createMockRouteProvider({ routes: {} }));
      assert.throws(() => createInMemoryQuoteStore());
      const base = {
        automaticPricingPolicy: DEFAULT_AUTOMATIC_PRICING_POLICY,
        loadPricingSetup: async () => ({ tariff: null, config: null }),
        store: { get: async () => null, save: async () => {} },
      };
      assert.throws(() => createQuoteService({ ...base, routeProvider: { id: "mock-routes", computeRoute: async () => ({ ok: false, error: { kind: "disabled", retryable: false } }) } }), QuoteServiceConfigError);
      const real: RouteProvider = { id: "google-routes", computeRoute: async () => ({ ok: false, error: { kind: "disabled", retryable: false } }) };
      assert.throws(() => createQuoteService({ ...base, routeProvider: real, allowFixtures: true }), QuoteServiceConfigError);
      assert.throws(() => createQuoteService({ ...base, routeProvider: real, allowTestCoordinates: true }), QuoteServiceConfigError);
      assert.doesNotThrow(() => createQuoteService({ ...base, routeProvider: real }));
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
