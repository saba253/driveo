import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateEnergy } from "../fuel/estimate.ts";
import { PricingError, calculateServicePrice, createQuoteSnapshot } from "./calculate.ts";
import { DEFAULT_PRICING_CONFIG, isQuoteExpired, quoteExpiry } from "./config.ts";
import { gel, money } from "./money.ts";
import type { ServicePriceInput, Tariff } from "./types.ts";

/*
 * TEST FIXTURES ONLY — invented numbers to exercise the arithmetic.
 * They are not DRIVEO tariffs or real route distances and must never be shown to customers.
 */
const FIXTURE_TARIFF: Tariff = {
  id: "fixture-tariff-not-real",
  version: 1,
  currency: "GEL",
  baseFee: gel(30),
  perKmMinor: 120, // 1.20 GEL per km
  minimumFee: gel(80),
  effectiveFrom: "2026-01-01T00:00:00Z",
  scope: { driverId: null, region: null },
};

const fixtureRoute = (distanceKm: number): ServicePriceInput["route"] => ({
  distanceKm,
  method: "road",
  provider: "fixture-provider",
  computedAt: "2026-10-21T08:00:00Z",
});

describe("calculateServicePrice", () => {
  it("prices base fee plus road distance", () => {
    const r = calculateServicePrice({ route: fixtureRoute(100), tariff: FIXTURE_TARIFF });
    assert.equal(r.drivingSubtotal.amountMinor, 3000 + 12000);
    assert.equal(r.total.amountMinor, 15000);
    assert.equal(r.minimumApplied, false);
    assert.deepEqual(
      r.lines.map((l) => l.kind),
      ["baseFee", "distance"],
    );
    assert.equal(r.lines[1].quantity, 100);
  });

  it("raises short trips to the minimum fee with an explicit adjustment line", () => {
    const r = calculateServicePrice({ route: fixtureRoute(10), tariff: FIXTURE_TARIFF });
    assert.equal(r.drivingSubtotal.amountMinor, 4200);
    assert.equal(r.drivingTotal.amountMinor, 8000);
    assert.equal(r.minimumApplied, true);
    const adj = r.lines.find((l) => l.kind === "minimumAdjustment");
    assert.equal(adj?.amount.amountMinor, 3800);
    assert.equal(r.total.amountMinor, 8000);
  });

  it("adds return transport and extra charges on top of the minimum", () => {
    const r = calculateServicePrice({
      route: fixtureRoute(10),
      tariff: FIXTURE_TARIFF,
      returnTransport: { mode: "minibus", cost: gel(15) },
      additionalCharges: [
        { code: "waiting", label: "Waiting time", amount: gel(20) },
        { code: "parking", label: "Parking", amount: gel(5) },
      ],
    });
    assert.equal(r.drivingTotal.amountMinor, 8000);
    assert.equal(r.total.amountMinor, 8000 + 1500 + 2000 + 500);
    assert.deepEqual(
      r.lines.map((l) => l.code),
      ["baseFee", "distance", "minimumAdjustment", "minibus", "waiting", "parking"],
    );
  });

  it("ignores return transport with mode 'none'", () => {
    const r = calculateServicePrice({ route: fixtureRoute(100), tariff: FIXTURE_TARIFF, returnTransport: { mode: "none", cost: gel(0) } });
    assert.equal(r.lines.length, 2);
  });

  it("rounds fractional distance charges to whole tetri", () => {
    const r = calculateServicePrice({ route: fixtureRoute(12.345), tariff: FIXTURE_TARIFF });
    assert.equal(r.lines[1].amount.amountMinor, 1481); // 12.345 × 120 = 1481.4
  });

  it("rejects anything that is not a road distance", () => {
    const route = { ...fixtureRoute(50), method: "straightLine" } as unknown as ServicePriceInput["route"];
    assert.throws(() => calculateServicePrice({ route, tariff: FIXTURE_TARIFF }), PricingError);
  });

  it("rejects missing or implausible distances", () => {
    for (const km of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 5000]) {
      assert.throws(() => calculateServicePrice({ route: fixtureRoute(km), tariff: FIXTURE_TARIFF }), PricingError, `km=${km}`);
    }
  });

  it("rejects negative fees, duplicate charge codes and non-GEL money", () => {
    assert.throws(
      () => calculateServicePrice({ route: fixtureRoute(50), tariff: { ...FIXTURE_TARIFF, baseFee: money(-1) } }),
      PricingError,
    );
    assert.throws(
      () =>
        calculateServicePrice({
          route: fixtureRoute(50),
          tariff: FIXTURE_TARIFF,
          additionalCharges: [
            { code: "x", label: "X", amount: gel(1) },
            { code: "x", label: "X again", amount: gel(1) },
          ],
        }),
      PricingError,
    );
    const usd = { amountMinor: 100, currency: "USD" } as unknown as ReturnType<typeof gel>;
    assert.throws(
      () => calculateServicePrice({ route: fixtureRoute(50), tariff: FIXTURE_TARIFF, additionalCharges: [{ code: "y", label: "Y", amount: usd }] }),
      PricingError,
    );
  });
});

describe("calculateServicePrice — final rounding up to whole GEL (approved)", () => {
  it("rounds the final total up after every permitted component, and only then", () => {
    // 3000 + round(100.5 × 120 = 12060) = 15060 → 15100
    const r = calculateServicePrice({ route: fixtureRoute(100.5), tariff: FIXTURE_TARIFF });
    assert.equal(r.total.amountMinor, 15100);
    assert.equal(r.roundingAdjustment.amountMinor, 40);
    assert.equal(r.lines.at(-1)?.kind, "rounding");
    assert.equal(r.total.amountMinor - r.roundingAdjustment.amountMinor, 15060);
  });

  it("includes return transport and extras before rounding", () => {
    const r = calculateServicePrice({
      route: fixtureRoute(100),
      tariff: FIXTURE_TARIFF,
      returnTransport: { mode: "bus", cost: money(1) },
      additionalCharges: [{ code: "parking", label: "Parking", amount: money(29) }],
    });
    assert.equal(r.total.amountMinor, 15100); // 15000 + 1 + 29 = 15030 → 15100
  });

  it("leaves whole-GEL totals unchanged and supports disabling rounding", () => {
    const whole = calculateServicePrice({ route: fixtureRoute(100), tariff: FIXTURE_TARIFF });
    assert.equal(whole.total.amountMinor, 15000);
    assert.equal(whole.roundingAdjustment.amountMinor, 0);
    assert.ok(!whole.lines.some((l) => l.kind === "rounding"));
    assert.equal(calculateServicePrice({ route: fixtureRoute(100.5), tariff: FIXTURE_TARIFF }, null).total.amountMinor, 15060);
  });
});

describe("createQuoteSnapshot", () => {
  const input: ServicePriceInput = { route: fixtureRoute(100), tariff: FIXTURE_TARIFF };

  it("marks client-side calculations as non-authoritative estimates, whatever status is requested", () => {
    const s = createQuoteSnapshot(input, {
      quoteId: "q1",
      version: 1,
      computedBy: "client",
      computedAt: "2026-10-21T08:00:00Z",
      status: "agreed",
    });
    assert.equal(s.status, "estimate");
    assert.equal(s.authoritative, false);
  });

  it("records inputs and versions for server snapshots and freezes them", () => {
    const s = createQuoteSnapshot(input, { quoteId: "q1", version: 2, computedBy: "server", computedAt: "2026-10-21T08:00:00Z" });
    assert.equal(s.status, "pending_review");
    assert.equal(s.authoritative, true);
    assert.equal(s.version, 2);
    assert.deepEqual(s.inputs, {
      tariffId: "fixture-tariff-not-real",
      tariffVersion: 1,
      distanceKm: 100,
      routeProvider: "fixture-provider",
      routeComputedAt: "2026-10-21T08:00:00Z",
    });
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.breakdown) && Object.isFrozen(s.breakdown.lines[0]));
  });

  it("expires 12 hours after server creation by default (approved)", () => {
    assert.equal(DEFAULT_PRICING_CONFIG.quoteValidityHours, 12);
    const s = createQuoteSnapshot(input, { quoteId: "q1", version: 1, computedBy: "server", computedAt: "2026-10-21T08:00:00.000Z" });
    assert.equal(s.validUntil, "2026-10-21T20:00:00.000Z");
    assert.equal(isQuoteExpired(s.validUntil, "2026-10-21T19:59:00.000Z"), false, "11 h 59 min: valid");
    assert.equal(isQuoteExpired(s.validUntil, "2026-10-21T19:59:59.999Z"), false);
    assert.equal(isQuoteExpired(s.validUntil, "2026-10-21T20:00:00.000Z"), true, "exactly 12 h: expired");
    assert.equal(isQuoteExpired(s.validUntil, "2026-10-21T20:01:00.000Z"), true, "12 h 1 min: expired");

    const short = createQuoteSnapshot(input, {
      quoteId: "q2",
      version: 1,
      computedBy: "server",
      computedAt: "2026-10-21T08:00:00.000Z",
      config: { quoteValidityHours: 2 },
    });
    assert.equal(short.validUntil, "2026-10-21T10:00:00.000Z");
    assert.equal(quoteExpiry("2026-10-21T08:00:00.000Z", 0.5), "2026-10-21T08:30:00.000Z");
    assert.throws(() => quoteExpiry("not a date", 12), RangeError);
    assert.throws(() => quoteExpiry("2026-10-21T08:00:00.000Z", 0), RangeError);
  });

  it("rejects invalid versions", () => {
    assert.throws(() => createQuoteSnapshot(input, { quoteId: "q", version: 0, computedBy: "server", computedAt: "x" }), PricingError);
  });
});

describe("fuel and charging stay outside the service price", () => {
  it("never contains a fuel or charging line and its total equals the sum of its lines", () => {
    const r = calculateServicePrice({
      route: fixtureRoute(220),
      tariff: FIXTURE_TARIFF,
      returnTransport: { mode: "bus", cost: gel(12) },
    });
    assert.deepEqual([...r.excludes], ["fuel", "charging"]);
    assert.ok(r.lines.every((l) => !/fuel|charg|energy/i.test(l.code)));
    assert.equal(
      r.total.amountMinor,
      r.lines.reduce((sum, l) => sum + l.amount.amountMinor, 0),
    );
  });

  it("is unchanged by a fuel estimate for the same trip", () => {
    const input: ServicePriceInput = { route: fixtureRoute(220), tariff: FIXTURE_TARIFF };
    const before = calculateServicePrice(input).total.amountMinor;

    const fuel = estimateEnergy({
      distanceKm: 220,
      carrier: "petrol",
      consumption: { carrier: "petrol", unit: "l", per100km: 8, source: "customer" },
      price: {
        carrier: "petrol",
        unit: "l",
        pricePerUnit: gel(3), // fixture, not a market price
        source: { name: "fixture", updatedAt: "2026-10-21T00:00:00Z" },
      },
    });

    const charging = estimateEnergy({
      distanceKm: 220,
      carrier: "electricity",
      consumption: { carrier: "electricity", unit: "kWh", per100km: 17, source: "manufacturer" },
      price: {
        carrier: "electricity",
        unit: "kWh",
        pricePerUnit: gel(0.4), // fixture, not a market price
        source: { name: "fixture", updatedAt: "2026-10-21T00:00:00Z" },
      },
    });

    for (const e of [fuel, charging]) {
      assert.equal(e.status, "estimated");
      assert.equal(e.includedInServicePrice, false);
    }
    assert.equal(calculateServicePrice(input).total.amountMinor, before);
  });
});
