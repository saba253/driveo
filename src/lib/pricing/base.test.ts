import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { HOME_BASE_ZONE, INITIAL_HOME_BASE } from "./base.ts";
import type { QuoteDriver, QuoteOutcome, RouteLookup, ServiceQuote } from "./engine-types.ts";
import { priceQuote } from "./quote.ts";
import { FIXTURE_TARIFF, FIXTURE_TBILISI_CONFIG, fixtureRequest, fixtureRoute } from "./test-fixtures.ts";
import { matchLocality, validatePricingConfig } from "./zones.ts";

/*
 * Home base = Tbilisi (founder decision). Fares, minutes, tariffs and route
 * distances are TEST FIXTURES; Beta/Gamma/Delta are fictional zones.
 */

const ok = (km: number, min: number): RouteLookup => ({ ok: true, route: fixtureRoute(km, min) });

async function run(from: string, to: string, opts: { driver?: QuoteDriver; km?: number; min?: number } = {}): Promise<QuoteOutcome> {
  return priceQuote({
    request: fixtureRequest(from, to),
    route: ok(opts.km ?? 200, opts.min ?? 180),
    tariff: FIXTURE_TARIFF,
    config: FIXTURE_TBILISI_CONFIG,
    meta: { quoteId: "q1", version: 1, computedBy: "server", now: "2026-10-21T08:00:00.000Z" },
    driver: opts.driver,
    allowFixtures: true,
  });
}

async function quoted(from: string, to: string, opts?: Parameters<typeof run>[2]): Promise<ServiceQuote> {
  const o = await run(from, to, opts);
  assert.equal(o.status, "quoted", o.status === "manual_pricing" ? JSON.stringify(o.reasons) : "");
  return (o as Extract<QuoteOutcome, { status: "quoted" }>).quote;
}

const legs = (q: ServiceQuote) =>
  q.commercial.lines.filter((l) => l.kind === "positioning" || l.kind === "return").map((l) => `${l.kind}:${l.source}:${l.amount.amountMinor}`);

describe("initial home base: Tbilisi", () => {
  it("is configured as data and matches its zone in both scripts", () => {
    assert.equal(INITIAL_HOME_BASE.zoneId, HOME_BASE_ZONE.id);
    for (const name of ["თბილისი", "ქ. თბილისი", "Tbilisi", "TBILISI"]) {
      assert.equal(matchLocality([HOME_BASE_ZONE], name)?.zoneId, "tbilisi", name);
    }
    assert.deepEqual(validatePricingConfig(FIXTURE_TBILISI_CONFIG), []);
  });

  it("is not hardcoded into the pricing functions", () => {
    for (const file of ["quote.ts", "zones.ts", "checks.ts", "fingerprint.ts", "config.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      assert.ok(!/tbilisi|თბილის/i.test(source), `${file} mentions Tbilisi`);
    }
  });
});

describe("positioning from Tbilisi and return to Tbilisi (fixture fares)", () => {
  // Travel leg = fare + minutes × 6.00/h (fixture travel-time rate).
  const TBILISI_LOCAL = 1000 + 300; // 30 min
  const BETA = 2000 + 1800; // 180 min
  const GAMMA = 2500 + 2000; // 200 min

  it("Tbilisi → Beta: local positioning inside Tbilisi, return Beta → Tbilisi", async () => {
    const q = await quoted("Tbilisi", "Beta");
    assert.deepEqual(legs(q), [`positioning:t-tbilisi-tbilisi:${TBILISI_LOCAL}`, `return:t-beta-tbilisi:${BETA}`]);
    assert.equal(q.commercial.zones.base, "tbilisi");
    assert.equal(q.commercial.driverId, null);
  });

  it("Beta → Tbilisi: positioning Tbilisi → Beta, local return inside Tbilisi", async () => {
    const q = await quoted("ბეტა", "თბილისი");
    assert.deepEqual(legs(q), [`positioning:t-tbilisi-beta:${BETA}`, `return:t-tbilisi-tbilisi:${TBILISI_LOCAL}`]);
  });

  it("routes need not start or end in Tbilisi: Beta → Gamma uses both base legs", async () => {
    const q = await quoted("Beta", "Gamma");
    assert.deepEqual(legs(q), [`positioning:t-tbilisi-beta:${BETA}`, `return:t-gamma-tbilisi:${GAMMA}`]);
    // 3000 + 200 km × 120 = 27000 driving, plus both legs, rounded to whole GEL.
    assert.equal(q.commercial.drivingTotal.amountMinor, 27000);
    assert.equal(q.commercial.travelTotal.amountMinor, BETA + GAMMA);
    assert.equal(q.commercial.total.amountMinor, 27000 + BETA + GAMMA);
  });

  it("each travel leg is counted exactly once and the total is the sum of its lines", async () => {
    for (const [from, to] of [
      ["Tbilisi", "Tbilisi"],
      ["Tbilisi", "Gamma"],
      ["Gamma", "Beta"],
      ["Beta", "Beta"],
    ] as const) {
      const q = await quoted(from, to, { km: 60, min: 70 });
      const kinds = q.commercial.lines.map((l) => l.kind);
      assert.equal(kinds.filter((k) => k === "positioning").length, 1, `${from}→${to}`);
      assert.equal(kinds.filter((k) => k === "return").length, 1, `${from}→${to}`);
      assert.equal(q.commercial.total.amountMinor, q.commercial.lines.reduce((s, l) => s + l.amount.amountMinor, 0));
    }
  });

  it("missing travel rule to or from Tbilisi → manual pricing, never a zero cost", async () => {
    for (const [from, to, code] of [
      ["Delta", "Tbilisi", "missingPositioningRule"],
      ["Tbilisi", "Delta", "missingReturnRule"],
    ] as const) {
      const o = await run(from, to);
      assert.equal(o.status, "manual_pricing");
      if (o.status === "manual_pricing") assert.deepEqual(o.reasons.map((r) => r.code), [code]);
    }
  });
});

describe("per-driver home bases (future multi-driver support)", () => {
  const betaDriver: QuoteDriver = { id: "driver-beta", base: { zoneId: "beta", locality: "Beta" } };

  it("prices positioning and return from the driver's own base", async () => {
    const q = await quoted("Beta", "Gamma", { driver: betaDriver });
    assert.deepEqual(legs(q), ["positioning:t-beta-beta:1000", "return:t-gamma-beta:2700"]);
    assert.equal(q.commercial.driverId, "driver-beta");
    assert.equal(q.commercial.zones.base, "beta");
  });

  it("the same trip differs only in travel legs between bases", async () => {
    const fromTbilisi = await quoted("Beta", "Gamma");
    const fromBeta = await quoted("Beta", "Gamma", { driver: betaDriver });
    assert.deepEqual(fromBeta.commercial.drivingTotal, fromTbilisi.commercial.drivingTotal);
    assert.notEqual(fromBeta.commercial.travelTotal.amountMinor, fromTbilisi.commercial.travelTotal.amountMinor);
  });

  it("a driver base without rules, or outside the configured zones, goes to manual pricing", async () => {
    const gammaDriver: QuoteDriver = { id: "driver-gamma", base: { zoneId: "gamma", locality: "Gamma" } };
    const o1 = await run("Gamma", "Beta", { driver: gammaDriver });
    assert.equal(o1.status, "manual_pricing"); // no gamma → gamma or beta → gamma rule

    const lost: QuoteDriver = { id: "driver-x", base: { zoneId: "nowhere", locality: "Nowhere" } };
    const o2 = await run("Beta", "Gamma", { driver: lost });
    assert.equal(o2.status, "manual_pricing");
    if (o2.status === "manual_pricing") assert.ok(o2.reasons.some((r) => r.code === "invalidDriverBase"));

    const mismatched: QuoteDriver = { id: "driver-y", base: { zoneId: "gamma", locality: "Beta" } };
    const o3 = await run("Beta", "Gamma", { driver: mismatched });
    assert.equal(o3.status, "manual_pricing");
    if (o3.status === "manual_pricing") assert.ok(o3.reasons.some((r) => r.code === "invalidDriverBase"));
  });
});
