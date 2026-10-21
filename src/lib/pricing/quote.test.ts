import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PRICING_CONFIG, roundUpMinor } from "./config.ts";
import {
  SERVICE_EXTRA_CATEGORIES,
  type PricingEngineConfig,
  type QuoteOutcome,
  type QuoteRequest,
  type RouteLookup,
  type ServiceExtraCategory,
  type ServiceQuote,
  type ServiceTariff,
} from "./engine-types.ts";
import { fingerprintQuoteInputs } from "./fingerprint.ts";
import { gel, money } from "./money.ts";
import { QuoteError, checkQuoteUsable, priceQuote, pricingContext, stripProviderDerived, supersedeQuote, type QuoteMeta } from "./quote.ts";
import { FIXTURE_CONFIG, FIXTURE_TARIFF, fixtureRequest, fixtureRoute } from "./test-fixtures.ts";

/* All amounts and distances here are TEST FIXTURES (see test-fixtures.ts). */

const NOW = "2026-10-21T08:00:00.000Z";
const META: QuoteMeta = { quoteId: "q1", version: 1, computedBy: "server", now: NOW };

type Args = {
  request?: QuoteRequest;
  route?: RouteLookup;
  tariff?: ServiceTariff | null;
  config?: PricingEngineConfig;
  meta?: Partial<QuoteMeta>;
  allowFixtures?: boolean;
};

const ok = (km: number, min: number): RouteLookup => ({ ok: true, route: fixtureRoute(km, min) });

function run(a: Args = {}): Promise<QuoteOutcome> {
  return priceQuote({
    request: a.request ?? fixtureRequest("Alpha", "Beta"),
    route: a.route ?? ok(230, 200),
    tariff: a.tariff === undefined ? FIXTURE_TARIFF : a.tariff,
    config: a.config ?? FIXTURE_CONFIG,
    meta: { ...META, ...a.meta },
    allowFixtures: a.allowFixtures ?? true,
  });
}

async function quoted(a: Args = {}): Promise<ServiceQuote> {
  const outcome = await run(a);
  assert.equal(outcome.status, "quoted", outcome.status === "manual_pricing" ? JSON.stringify(outcome.reasons) : "");
  return (outcome as Extract<QuoteOutcome, { status: "quoted" }>).quote;
}

async function manualCodes(a: Args = {}): Promise<string[]> {
  const outcome = await run(a);
  assert.equal(outcome.status, "manual_pricing");
  return (outcome as Extract<QuoteOutcome, { status: "manual_pricing" }>).reasons.map((r) => r.code);
}

const lineAmount = (q: ServiceQuote, kind: string) => q.commercial.lines.find((l) => l.kind === kind)?.amount.amountMinor;

describe("priceQuote — driving, positioning and return", () => {
  it("short trip inside the base zone: minimum applies to driving only; both travel legs are added", async () => {
    const q = await quoted({ request: fixtureRequest("Alpha", "Alpha"), route: ok(12, 25) });
    assert.equal(q.commercial.drivingSubtotal.amountMinor, 3000 + 1440);
    assert.equal(q.commercial.drivingTotal.amountMinor, 8000);
    assert.equal(lineAmount(q, "minimumAdjustment"), 3560);
    assert.equal(lineAmount(q, "positioning"), 1000 + 300); // fare + 30 min × 6.00/h
    assert.equal(lineAmount(q, "return"), 1300);
    assert.equal(q.commercial.total.amountMinor, 10600);
    assert.equal(q.commercial.roundingAdjustment.amountMinor, 0);
  });

  it("pickup at the base, delivery elsewhere: positioning inside the base zone, return from the delivery zone", async () => {
    const q = await quoted({ request: fixtureRequest("Alpha", "Beta"), route: ok(230, 200) });
    assert.equal(q.commercial.drivingTotal.amountMinor, 3000 + 27600);
    assert.equal(lineAmount(q, "positioning"), 1300);
    assert.equal(lineAmount(q, "return"), 2000 + 1800);
    assert.equal(q.commercial.total.amountMinor, 35700);
    assert.deepEqual(q.commercial.zones, { base: "alpha", pickup: "alpha", delivery: "beta" });
  });

  it("pickup elsewhere, delivery at the base: positioning to the pickup zone, return inside the base zone", async () => {
    const q = await quoted({ request: fixtureRequest("ბეტა", "ალფა"), route: ok(230, 200) });
    const sources = q.commercial.lines.filter((l) => l.kind === "positioning" || l.kind === "return").map((l) => l.source);
    assert.deepEqual(sources, ["r-alpha-beta", "r-alpha-alpha"]);
    assert.equal(q.commercial.total.amountMinor, 35700);
  });

  it("uses the more specific locality rule over the zone-wide rule", async () => {
    const q = await quoted({ request: fixtureRequest("Alpha", "Beta Village"), route: ok(150, 150) });
    const ret = q.commercial.lines.find((l) => l.kind === "return");
    assert.equal(ret?.source, "r-betavillage-alpha");
    assert.equal(ret?.amount.amountMinor, 3500 + 2400);
    assert.equal(q.commercial.total.amountMinor, 21000 + 1300 + 5900);
  });

  it("adds extras after the minimum and keeps every amount in whole tetri", async () => {
    const q = await quoted({
      request: fixtureRequest("Alpha", "Alpha", { extras: [{ category: "waiting", code: "waiting", label: "Waiting time", amount: gel(20) }] }),
      route: ok(12, 25),
    });
    assert.equal(q.commercial.total.amountMinor, 10600 + 2000);
    for (const l of q.commercial.lines) assert.ok(Number.isSafeInteger(l.amount.amountMinor), l.code);
  });
});

describe("priceQuote — no double counting", () => {
  it("never charges the driving duration: a slower route with the same distance costs the same", async () => {
    const fast = await quoted({ route: ok(230, 200) });
    const slow = await quoted({ route: ok(230, 320) });
    assert.equal(slow.commercial.total.amountMinor, fast.commercial.total.amountMinor);
  });

  it("charges the driver's travel time only inside travel legs, and distance only in the distance line", async () => {
    const q = await quoted();
    const kinds = q.commercial.lines.map((l) => l.kind);
    assert.equal(kinds.filter((k) => k === "distance").length, 1);
    assert.equal(kinds.filter((k) => k === "positioning").length, 1);
    assert.equal(kinds.filter((k) => k === "return").length, 1);
    assert.equal(
      q.commercial.total.amountMinor,
      q.commercial.lines.reduce((s, l) => s + l.amount.amountMinor, 0),
    );
    assert.equal(q.commercial.travelTotal.amountMinor, (lineAmount(q, "positioning") ?? 0) + (lineAmount(q, "return") ?? 0));
  });
});

describe("priceQuote — final rounding up to whole GEL (approved)", () => {
  // Explicit zero-cost travel rule so totals can hit exact boundaries (FIXTURE ONLY).
  const freeLegs: PricingEngineConfig = {
    ...FIXTURE_CONFIG,
    travelRules: [{ ...FIXTURE_CONFIG.travelRules[0], id: "r-free", mode: "none", fare: gel(0), travelMinutes: 0, availability: undefined }],
  };
  const totalWith = async (extraMinor: number) =>
    (
      await quoted({
        config: freeLegs,
        request: fixtureRequest("Alpha", "Alpha", { extras: [{ category: "waiting", code: "waiting", label: "Waiting", amount: money(extraMinor) }] }),
        route: ok(12, 25), // driving raised to the 80.00 fixture minimum
      })
    ).commercial;

  it("84.00 → 84, 84.01 → 85, 184.30 → 185 (GEL)", async () => {
    assert.equal(DEFAULT_PRICING_CONFIG.roundingStepMinor, 100);
    const exact = await totalWith(400); // 80.00 + 4.00
    assert.equal(exact.total.amountMinor, 8400);
    assert.equal(exact.roundingAdjustment.amountMinor, 0);
    const cent = await totalWith(401); // 84.01
    assert.equal(cent.total.amountMinor, 8500);
    assert.equal(cent.roundingAdjustment.amountMinor, 99);
    const frac = await totalWith(10430); // 184.30
    assert.equal(frac.total.amountMinor, 18500);
    assert.equal(frac.roundingAdjustment.amountMinor, 70);
  });

  it("rounds only after driving, positioning, return and extras are all added", async () => {
    const q = await quoted({
      request: fixtureRequest("Alpha", "Beta", { extras: [{ category: "toll", code: "toll", label: "Toll", amount: money(1) }] }),
      route: ok(230, 200),
    });
    const kinds = q.commercial.lines.map((l) => l.kind);
    assert.deepEqual(kinds, ["baseFee", "distance", "positioning", "return", "additional", "rounding"]);
    const beforeRounding = q.commercial.lines.filter((l) => l.kind !== "rounding").reduce((s, l) => s + l.amount.amountMinor, 0);
    assert.equal(beforeRounding, 35701);
    assert.equal(q.commercial.total.amountMinor, 35800);
    assert.ok(!q.commercial.lines.some((l) => /fuel|charg/i.test(l.code)));
  });
});

describe("priceQuote — rounding", () => {
  const roundingCase = (step: number | null) =>
    quoted({ config: { ...FIXTURE_CONFIG, roundingStepMinor: step }, route: ok(123.45, 120) });

  it("rounds the total UP to the configured step and records the adjustment", async () => {
    // 3000 + round(123.45 × 120 = 14814) + 1300 + 3800 = 22914
    const none = await roundingCase(null);
    assert.equal(none.commercial.total.amountMinor, 22914);
    assert.ok(!none.commercial.lines.some((l) => l.kind === "rounding"));

    const gelStep = await roundingCase(100);
    assert.equal(gelStep.commercial.total.amountMinor, 23000);
    assert.equal(gelStep.commercial.roundingAdjustment.amountMinor, 86);
    assert.equal(gelStep.commercial.lines.at(-1)?.kind, "rounding");

    assert.equal((await roundingCase(50)).commercial.total.amountMinor, 22950);
  });

  it("roundUpMinor never rounds down and leaves aligned amounts alone", () => {
    assert.equal(roundUpMinor(10600, 100), 10600);
    assert.equal(roundUpMinor(10601, 100), 10700);
    assert.equal(roundUpMinor(1, 500), 500);
    assert.equal(roundUpMinor(0, 100), 0);
    assert.equal(DEFAULT_PRICING_CONFIG.roundingStepMinor, 100);
    assert.throws(() => roundUpMinor(100, 0), RangeError);
    assert.throws(() => roundUpMinor(100.5, 100), RangeError);
  });
});

describe("priceQuote — manual pricing instead of guessing", () => {
  it("missing positioning rule → manual pricing, never a zero cost", async () => {
    assert.deepEqual(await manualCodes({ request: fixtureRequest("Gamma", "Alpha") }), ["missingPositioningRule"]);
  });

  it("missing return rule → manual pricing", async () => {
    assert.deepEqual(await manualCodes({ request: fixtureRequest("Alpha", "Delta") }), ["missingReturnRule"]);
  });

  it("reports every problem at once and never includes amounts", async () => {
    const outcome = await run({ request: fixtureRequest("Gamma", "Delta"), tariff: null });
    assert.equal(outcome.status, "manual_pricing");
    if (outcome.status !== "manual_pricing") return;
    assert.deepEqual(outcome.reasons.map((r) => r.code).sort(), ["missingPositioningRule", "missingReturnRule", "missingTariff"]);
    assert.ok(!JSON.stringify(outcome).includes("amountMinor"));
  });

  it("unknown localities → manual pricing", async () => {
    assert.deepEqual(await manualCodes({ request: fixtureRequest("Nowhere", "Elsewhere") }), [
      "unknownPickupLocality",
      "unknownDeliveryLocality",
    ]);
  });

  it("route unavailable → manual pricing; nothing is substituted", async () => {
    for (const kind of ["disabled", "notFound", "unresolvedAddress", "auth", "rateLimited", "usageLimit", "timeout", "unavailable", "malformedResponse"] as const) {
      assert.deepEqual(await manualCodes({ route: { ok: false, error: { kind, retryable: false } } }), ["routeUnavailable"], kind);
    }
  });

  it("rejects non-road distances", async () => {
    const route = { ok: true, route: { ...fixtureRoute(100, 90), method: "straightLine" } } as unknown as RouteLookup;
    assert.deepEqual(await manualCodes({ route }), ["nonRoadDistance"]);
  });

  it("rejects implausible distances and durations", async () => {
    for (const km of [0, -3, Number.NaN, 1200]) assert.deepEqual(await manualCodes({ route: ok(km, 120) }), ["implausibleDistance"], `km=${km}`);
    assert.deepEqual(await manualCodes({ route: ok(230, 60) }), ["implausibleDuration"]); // 230 km/h
    assert.deepEqual(await manualCodes({ route: ok(230, 2000) }), ["implausibleDuration"]); // ~7 km/h
    assert.deepEqual(await manualCodes({ route: ok(230, 0) }), ["implausibleDuration"]);
  });

  it("uses straight-line distance only to catch impossible routes", async () => {
    const at = (lng: number) => ({ lat: 0, lng });
    const withCoords = (from: number, to: number) =>
      fixtureRequest("Alpha", "Beta", {
        pickup: { locality: "Alpha", address: "a", placeId: null, coordinates: at(from) },
        delivery: { locality: "Beta", address: "b", placeId: null, coordinates: at(to) },
      });
    // ~100 km apart in a straight line.
    assert.deepEqual(await manualCodes({ request: withCoords(0, 0.9), route: ok(50, 60) }), ["roadShorterThanStraightLine"]);
    assert.deepEqual(await manualCodes({ request: withCoords(0, 0.9), route: ok(400, 400) }), ["routeTooIndirect"]);
    const fine = await quoted({ request: withCoords(0, 0.9), route: ok(130, 120) });
    // The price comes from the road distance, never the straight line.
    assert.equal(lineAmount(fine, "distance"), 130 * 120);
  });

  it("refuses missing, inactive, fixture-in-production and malformed tariffs", async () => {
    assert.deepEqual(await manualCodes({ tariff: null }), ["missingTariff"]);
    assert.deepEqual(await manualCodes({ tariff: { ...FIXTURE_TARIFF, status: "draft" } }), ["tariffNotActive"]);
    assert.deepEqual(await manualCodes({ tariff: { ...FIXTURE_TARIFF, status: "retired" } }), ["tariffNotActive"]);
    assert.deepEqual(await manualCodes({ allowFixtures: false }), ["fixtureConfigNotAllowed", "fixtureTariffNotAllowed"]);
    assert.deepEqual(await manualCodes({ tariff: { ...FIXTURE_TARIFF, perKmMinor: -1 } }), ["invalidTariff"]);
    assert.deepEqual(await manualCodes({ tariff: { ...FIXTURE_TARIFF, baseFee: money(-100) } }), ["invalidTariff"]);
  });

  it("refuses broken configuration", async () => {
    const dupLocality = { ...FIXTURE_CONFIG, zones: [...FIXTURE_CONFIG.zones, { id: "eps", name: "Eps", localities: ["beta"] }] };
    const badBase = { ...FIXTURE_CONFIG, base: { zoneId: "alpha", locality: "Beta" } };
    const badRule = { ...FIXTURE_CONFIG, travelRules: [...FIXTURE_CONFIG.travelRules, { ...FIXTURE_CONFIG.travelRules[0], id: "x", toZoneId: "ghost" }] };
    for (const config of [dupLocality, badBase, badRule]) assert.deepEqual(await manualCodes({ config }), ["invalidConfig"]);
  });

  it("refuses fuel/charging categories, unknown categories, disguised energy charges and malformed extras", async () => {
    const extras = (category: string, code: string, label = "x", amount = gel(5)) =>
      fixtureRequest("Alpha", "Beta", { extras: [{ category: category as ServiceExtraCategory, code, label, amount }] });
    for (const req of [
      // Explicit energy categories — the primary guard.
      extras("fuel", "a"),
      extras("charging", "b"),
      // Anything outside the allow-list.
      extras("discount", "c"),
      extras("", "d"),
      // Secondary text guard inside an allowed category.
      extras("otherService", "fuel-topup"),
      extras("otherService", "ev_charging"),
      extras("otherService", "misc", "საწვავი"),
      extras("waiting", "misc", "Diesel refill"),
      extras("waiting", "neg", "x", money(-1)),
    ]) {
      assert.deepEqual(await manualCodes({ request: req }), ["invalidExtras"], JSON.stringify(req.extras));
    }
    for (const category of SERVICE_EXTRA_CATEGORIES) {
      assert.equal((await run({ request: extras(category, `ok-${category}`, "service") })).status, "quoted", category);
    }
    const dup = fixtureRequest("Alpha", "Beta", {
      extras: [
        { category: "waiting", code: "waiting", label: "a", amount: gel(1) },
        { category: "waiting", code: "waiting", label: "b", amount: gel(1) },
      ],
    });
    assert.deepEqual(await manualCodes({ request: dup }), ["invalidExtras"]);
  });
});

describe("priceQuote — vehicle eligibility", () => {
  it("requires the drivable confirmation and known vehicle types", async () => {
    const vehicle = (v: Partial<QuoteRequest["vehicle"]>) =>
      fixtureRequest("Alpha", "Beta", { vehicle: { powertrain: "electric", transmission: "manual", drivableConfirmed: true, ...v } });
    assert.equal((await run({ request: vehicle({}) })).status, "quoted");
    assert.deepEqual(await manualCodes({ request: vehicle({ drivableConfirmed: false }) }), ["vehicleNotEligible"]);
    assert.deepEqual(await manualCodes({ request: vehicle({ powertrain: "steam" as never }) }), ["vehicleNotEligible"]);
    assert.deepEqual(await manualCodes({ request: vehicle({ transmission: "cvt?" as never }) }), ["vehicleNotEligible"]);
  });
});

describe("priceQuote — fixture tariffs never reach production", () => {
  it("refuses fixture tariffs and fixture configs in a production runtime even when allowFixtures is set", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      assert.deepEqual(await manualCodes({ allowFixtures: true }), ["fixtureConfigNotAllowed", "fixtureTariffNotAllowed"]);
    } finally {
      env.NODE_ENV = previous;
    }
  });
});

describe("priceQuote — admin overrides", () => {
  it("an audited override replaces a missing rule", async () => {
    const request = fixtureRequest("Gamma", "Alpha", {
      overrides: { positioning: { fare: gel(30), travelMinutes: 120, reason: "village road, confirmed by phone", by: "admin" } },
    });
    const q = await quoted({ request, route: ok(200, 180) });
    const pos = q.commercial.lines.find((l) => l.kind === "positioning");
    assert.equal(pos?.source, "override");
    assert.equal(pos?.amount.amountMinor, 3000 + 1200);
  });

  it("an override without reason or author is rejected", async () => {
    const request = fixtureRequest("Gamma", "Alpha", { overrides: { positioning: { fare: gel(30), travelMinutes: 120, reason: " ", by: "admin" } } });
    assert.deepEqual(await manualCodes({ request, route: ok(200, 180) }), ["invalidOverride"]);
  });
});

describe("priceQuote — overnight eligibility", () => {
  const overnight: PricingEngineConfig = { ...FIXTURE_CONFIG, overnight: { mode: "manualReviewAbove", maxSameDayMinutes: 600, handoverMinutes: 40 } };

  it("an unconfigured policy blocks automatic pricing (safe default)", async () => {
    const config: PricingEngineConfig = { ...FIXTURE_CONFIG, overnight: { mode: "notConfigured" } };
    assert.deepEqual(await manualCodes({ config, route: ok(12, 25), request: fixtureRequest("Alpha", "Alpha") }), ["overnightPolicyNotConfigured"]);
  });

  it("an explicit, attributed waiver is recorded on the quote", async () => {
    assert.deepEqual((await quoted({ route: ok(230, 600) })).commercial.overnight, { status: "waived", approvedBy: "fixture" });
    const anonymous = { ...FIXTURE_CONFIG, overnight: { mode: "waived", approvedBy: " ", reason: "x" } } as PricingEngineConfig;
    assert.deepEqual(await manualCodes({ config: anonymous }), ["invalidConfig"]);
  });

  it("passes within the limit, including exactly at it", async () => {
    // 30 (positioning) + 40 (handover) + driving + 180 (return)
    const within = await quoted({ config: overnight, route: ok(230, 200) });
    assert.deepEqual(within.commercial.overnight, { status: "within_limit", limitMinutes: 600 });
    assert.equal(within.providerDerived?.commitmentMinutes, 450);
    assert.equal((await quoted({ config: overnight, route: ok(230, 350) })).commercial.overnight.status, "within_limit");
  });

  it("sends jobs above the limit to manual pricing and computes no allowance", async () => {
    const outcome = await run({ config: overnight, route: ok(230, 351) });
    assert.equal(outcome.status, "manual_pricing");
    if (outcome.status === "manual_pricing") assert.deepEqual(outcome.reasons.map((r) => r.code), ["overnightRequired"]);
  });

  it("rejects an incomplete overnight policy", async () => {
    const bad = { ...FIXTURE_CONFIG, overnight: { mode: "manualReviewAbove", maxSameDayMinutes: 0, handoverMinutes: 40 } } as PricingEngineConfig;
    assert.deepEqual(await manualCodes({ config: bad }), ["invalidConfig"]);
  });
});

describe("quotes — authority, validity and replacement", () => {
  it("client calculations are never authoritative; server quotes await review", async () => {
    const client = await quoted({ meta: { computedBy: "client", status: "agreed" } });
    assert.equal(client.status, "estimate");
    assert.equal(client.authoritative, false);
    const server = await quoted();
    assert.equal(server.status, "pending_review");
    assert.equal(server.authoritative, true);
    assert.ok(Object.isFrozen(server.commercial.lines[0]));
  });

  it("expires 12 hours after its server-side creation timestamp (approved default)", async () => {
    assert.equal(DEFAULT_PRICING_CONFIG.quoteValidityHours, 12);
    assert.equal(FIXTURE_CONFIG.quoteValidityHours, 12);
    const q = await quoted();
    assert.equal(q.computedAt, NOW, "created at the server's clock");
    assert.equal(q.validUntil, "2026-10-21T20:00:00.000Z");

    const fp = q.inputFingerprint;
    const at = (iso: string) => checkQuoteUsable(q, { now: iso, inputFingerprint: fp });
    assert.deepEqual(at("2026-10-21T19:59:00.000Z"), { usable: true }, "11 h 59 min");
    assert.deepEqual(at("2026-10-21T20:00:00.000Z"), { usable: false, reason: "expired" }, "exactly 12 h");
    assert.deepEqual(at("2026-10-21T20:01:00.000Z"), { usable: false, reason: "expired" }, "12 h 1 min");
  });

  it("supports a non-default validity", async () => {
    const short = await quoted({ config: { ...FIXTURE_CONFIG, quoteValidityHours: 2 } });
    assert.equal(short.validUntil, "2026-10-21T10:00:00.000Z");
    const long = await quoted({ config: { ...FIXTURE_CONFIG, quoteValidityHours: 48 } });
    assert.equal(long.validUntil, "2026-10-23T08:00:00.000Z");
  });

  it("is usable only while valid, authoritative and for the same inputs", async () => {
    const request = fixtureRequest("Alpha", "Beta");
    const q = await quoted({ request });
    const ctx = pricingContext(FIXTURE_TARIFF, FIXTURE_CONFIG);
    const fp = await fingerprintQuoteInputs(request, ctx);

    assert.deepEqual(checkQuoteUsable(q, { now: "2026-10-21T19:59:59.000Z", inputFingerprint: fp }), { usable: true });
    assert.deepEqual(checkQuoteUsable(q, { now: "2026-10-21T20:00:00.000Z", inputFingerprint: fp }), { usable: false, reason: "expired" });

    const moved = await fingerprintQuoteInputs({ ...request, delivery: { ...request.delivery, address: "Other street 9" } }, ctx);
    assert.deepEqual(checkQuoteUsable(q, { now: NOW, inputFingerprint: moved }), { usable: false, reason: "inputsChanged" });

    const otherDay = await fingerprintQuoteInputs({ ...request, schedule: { date: "2026-10-26", time: "09:00" } }, ctx);
    assert.deepEqual(checkQuoteUsable(q, { now: NOW, inputFingerprint: otherDay }), { usable: false, reason: "inputsChanged" });

    // A new tariff version or configuration also invalidates the quote.
    const newTariff = await fingerprintQuoteInputs(request, pricingContext({ ...FIXTURE_TARIFF, version: 2 }, FIXTURE_CONFIG));
    assert.deepEqual(checkQuoteUsable(q, { now: NOW, inputFingerprint: newTariff }), { usable: false, reason: "inputsChanged" });
    const newConfig = await fingerprintQuoteInputs(request, pricingContext(FIXTURE_TARIFF, { ...FIXTURE_CONFIG, version: "fixture-config-2" }));
    assert.deepEqual(checkQuoteUsable(q, { now: NOW, inputFingerprint: newConfig }), { usable: false, reason: "inputsChanged" });

    const client = await quoted({ request, meta: { computedBy: "client" } });
    assert.deepEqual(checkQuoteUsable(client, { now: NOW, inputFingerprint: fp }), { usable: false, reason: "notAuthoritative" });
  });

  it("supersedes a quote with the next version and blocks the old one", async () => {
    const first = await quoted();
    const second = await quoted({ meta: { quoteId: "q2", version: 2, supersedes: "q1", previousTotal: first.commercial.total } });
    assert.deepEqual(second.priceChange, { previousQuoteId: "q1", previousTotal: first.commercial.total, changed: false });
    assert.equal(first.priceChange, null);
    const old = supersedeQuote(first, second);
    assert.equal(old.status, "superseded");
    assert.equal(old.supersededBy, "q2");
    assert.equal(first.supersededBy, null, "the original object is not mutated");
    assert.deepEqual(checkQuoteUsable(old, { now: NOW, inputFingerprint: old.inputFingerprint }), { usable: false, reason: "superseded" });

    assert.throws(() => supersedeQuote(old, second), QuoteError);
    const skipped = await quoted({ meta: { quoteId: "q3", version: 3, supersedes: "q1", previousTotal: first.commercial.total } });
    assert.throws(() => supersedeQuote(first, skipped), QuoteError);
    const otherRequest = await quoted({
      request: { ...fixtureRequest("Alpha", "Beta"), requestId: "req-2" },
      meta: { quoteId: "q2", version: 2, supersedes: "q1", previousTotal: first.commercial.total },
    });
    assert.throws(() => supersedeQuote(first, otherRequest), QuoteError);
  });

  it("flags a changed price on re-quote, and requires the previous total", async () => {
    const first = await quoted({ route: ok(230, 200) });
    const cheaper = await quoted({ route: ok(200, 180), meta: { quoteId: "q2", version: 2, supersedes: "q1", previousTotal: first.commercial.total } });
    assert.equal(cheaper.priceChange?.changed, true);
    assert.notEqual(cheaper.commercial.total.amountMinor, first.commercial.total.amountMinor);
    await assert.rejects(run({ meta: { quoteId: "q2", version: 2, supersedes: "q1" } }), QuoteError);
  });

  it("rejects invalid quote metadata", async () => {
    await assert.rejects(run({ meta: { version: 0 } }), QuoteError);
    await assert.rejects(run({ meta: { now: "not a date" } }), QuoteError);
  });
});

describe("provider data separation (Google Maps retention)", () => {
  it("keeps provider distance and duration out of the commercial record", async () => {
    const q = await quoted();
    const commercial = JSON.stringify(q.commercial);
    for (const key of ["distanceKm", "durationMinutes", "commitmentMinutes", "fixture-provider", "computedAt"]) {
      assert.ok(!commercial.includes(key), key);
    }
    assert.equal(q.providerDerived?.retention, "provider_restricted");
    assert.equal(q.providerDerived?.route.distanceKm, 230);
  });

  it("can strip provider data without touching the commercial record", async () => {
    const q = await quoted();
    const stripped = stripProviderDerived(q);
    assert.equal(stripped.providerDerived, null);
    assert.deepEqual(stripped.commercial, q.commercial);
    assert.notEqual(q.providerDerived, null, "original untouched");
  });
});

describe("fuel and EV charging never enter the service price", () => {
  it("excludes both, has no energy lines, and total equals the sum of its lines", async () => {
    for (const [from, to, km, min] of [
      ["Alpha", "Alpha", 12, 25],
      ["Alpha", "Beta", 230, 200],
      ["Beta", "Beta Village", 40, 60],
    ] as const) {
      const q = await quoted({ request: fixtureRequest(from, to), route: ok(km, min) });
      assert.deepEqual([...q.commercial.excludes], ["fuel", "charging"]);
      assert.ok(q.commercial.lines.every((l) => !/fuel|charg|energy|petrol|diesel/i.test(l.code)));
      assert.equal(q.commercial.total.amountMinor, q.commercial.lines.reduce((s, l) => s + l.amount.amountMinor, 0));
    }
  });
});
