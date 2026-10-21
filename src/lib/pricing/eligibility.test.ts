import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_PRICING_CONFIG } from "./config.ts";
import { evaluateAutomaticPricingEligibility, type AutomaticPricingPolicy, type EligibilityArgs } from "./eligibility.ts";
import type { PricingEngineConfig, QuoteRequest, RouteLookup, TravelRule } from "./engine-types.ts";
import { gel } from "./money.ts";
import { DEFAULT_AUTOMATIC_PRICING_POLICY, MODERATE_RESEARCH_SCENARIO, PROPOSED_OPERATING_POLICY } from "./pilot.ts";
import { priceQuote } from "./quote.ts";
import { FIXTURE_APPROVAL, FIXTURE_PILOT_CONFIG, FIXTURE_PILOT_POLICY, FIXTURE_TARIFF, fixtureRoute } from "./test-fixtures.ts";

/*
 * Real zone names (Tbilisi, Rustavi) with INVENTED fares, minutes and
 * timetables; "Gamma" is fictional. Approvals are fixtures, not founder decisions.
 */

const NOW = "2026-10-21T08:00:00.000Z";
const ok = (km: number, min: number): RouteLookup => ({ ok: true, route: fixtureRoute(km, min) });

const request = (from: string, to: string, over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  requestId: "req-1",
  pickup: { locality: from, address: "Pickup street 1", placeId: "place-pickup-001" },
  delivery: { locality: to, address: "Delivery avenue 2", placeId: "place-delivery-01" },
  schedule: { date: "2026-10-25", time: "10:00" },
  vehicle: { powertrain: "petrol", transmission: "automatic", drivableConfirmed: true },
  ...over,
});

function evaluate(over: Partial<EligibilityArgs> = {}) {
  return evaluateAutomaticPricingEligibility({
    request: request("Tbilisi", "Tbilisi"),
    route: ok(12, 40),
    tariff: FIXTURE_TARIFF,
    config: FIXTURE_PILOT_CONFIG,
    policy: FIXTURE_PILOT_POLICY,
    now: NOW,
    allowFixtures: true,
    ...over,
  });
}
const codes = (over: Partial<EligibilityArgs> = {}) => evaluate(over).reasons.map((r) => r.code);

const withRules = (rules: readonly TravelRule[]): PricingEngineConfig => ({ ...FIXTURE_PILOT_CONFIG, travelRules: rules });
const rulesWithout = (id: string) => FIXTURE_PILOT_CONFIG.travelRules.filter((r) => r.id !== id);
const replaceRule = (id: string, patch: Partial<TravelRule>) => FIXTURE_PILOT_CONFIG.travelRules.map((r) => (r.id === id ? { ...r, ...patch } : r));

/** Gamma pairs enabled, to exercise timetable deadlines outside the real pilot. */
const withGamma: AutomaticPricingPolicy = {
  ...FIXTURE_PILOT_POLICY,
  pilotRoutes: [
    ...FIXTURE_PILOT_POLICY.pilotRoutes,
    { id: "pilot-tbilisi-gamma", fromZoneId: "tbilisi", toZoneId: "gamma", automaticPricingEnabled: true, approval: FIXTURE_APPROVAL },
  ],
};

describe("pilot routes — eligible when everything is approved, verified and schedulable", () => {
  it("within Tbilisi: eligible, with a full planned day", () => {
    const r = evaluate();
    assert.deepEqual(r.reasons, []);
    assert.equal(r.eligible, true);
    assert.equal(r.customerStatus, "under_review", "eligible requests are still reviewed manually");
    // 09:15 leave → 10:00 pickup → 10:30–11:10 drive → 11:40 delivered → 11:50 board → 12:25 back
    assert.deepEqual(r.schedule, {
      positioningStart: 555,
      pickupAt: 600,
      driveStart: 630,
      driveEnd: 670,
      deliveryDone: 700,
      returnBoarding: 710,
      end: 745,
      minutes: { positioning: 45, handover: 60, driving: 40, breaks: 0, waiting: 0, returnTravel: 45, total: 190 },
    });
  });

  it("Tbilisi → Rustavi and Rustavi → Tbilisi use direction-specific rules", () => {
    const out = evaluate({ request: request("Tbilisi", "Rustavi"), route: ok(25, 40) });
    const back = evaluate({ request: request("რუსთავი", "თბილისი"), route: ok(25, 40) });
    assert.equal(out.eligible, true, JSON.stringify(out.reasons));
    assert.equal(back.eligible, true, JSON.stringify(back.reasons));
    // Outbound returns on the Rustavi → Tbilisi minibus (80 min); inbound positions on Tbilisi → Rustavi (70 min).
    assert.equal(out.schedule?.minutes.returnTravel, 80);
    assert.equal(out.schedule?.minutes.positioning, 45);
    assert.equal(back.schedule?.minutes.positioning, 70);
    assert.equal(back.schedule?.minutes.returnTravel, 45);
  });

  it("a route outside the pilot goes to manual assessment, but can still be requested", () => {
    const r = evaluate({ request: request("Tbilisi", "Gamma"), route: ok(300, 240) });
    assert.equal(r.eligible, false);
    assert.ok(r.reasons.some((x) => x.code === "routeNotInPilot"));
    assert.equal(r.customerStatus, "manual_assessment");
  });
});

describe("switches and approvals fail safe", () => {
  it("the shipped default policy keeps everything disabled", () => {
    const c = codes({ policy: DEFAULT_AUTOMATIC_PRICING_POLICY });
    for (const code of ["automaticPricingDisabled", "pilotRouteDisabled", "configNotApproved", "tariffNotApproved", "operatingPolicyMissing", "evidencePolicyNotApproved"]) {
      assert.ok(c.includes(code as never), `${code} missing in ${c}`);
    }
    assert.equal(DEFAULT_AUTOMATIC_PRICING_POLICY.automaticPricingEnabled, false);
    assert.ok(DEFAULT_AUTOMATIC_PRICING_POLICY.pilotRoutes.every((p) => !p.automaticPricingEnabled && p.approval.status === "proposed"));
    assert.deepEqual(
      DEFAULT_AUTOMATIC_PRICING_POLICY.pilotRoutes.map((p) => `${p.fromZoneId}->${p.toZoneId}`),
      ["tbilisi->tbilisi", "tbilisi->rustavi", "rustavi->tbilisi"],
    );
  });

  it("an inactive pilot-route switch blocks only that route", () => {
    const policy = { ...FIXTURE_PILOT_POLICY, pilotRoutes: FIXTURE_PILOT_POLICY.pilotRoutes.map((p) => (p.id === "pilot-tbilisi-rustavi" ? { ...p, automaticPricingEnabled: false } : p)) };
    assert.deepEqual(codes({ policy, request: request("Tbilisi", "Rustavi"), route: ok(25, 40) }), ["pilotRouteDisabled"]);
    assert.deepEqual(codes({ policy }), [], "within Tbilisi unaffected");
  });

  it("enabled but unapproved switches are refused", () => {
    const proposed = { status: "proposed", note: "x" } as const;
    assert.deepEqual(codes({ policy: { ...FIXTURE_PILOT_POLICY, masterApproval: proposed } }), ["masterSwitchNotApproved"]);
    const routeUnapproved = { ...FIXTURE_PILOT_POLICY, pilotRoutes: FIXTURE_PILOT_POLICY.pilotRoutes.map((p) => ({ ...p, approval: proposed })) };
    assert.deepEqual(codes({ policy: routeUnapproved }), ["pilotRouteNotApproved"]);
    const anonymous = { ...FIXTURE_PILOT_POLICY, masterApproval: { status: "approved", approvedBy: " ", approvedAt: "2026-10-01" } as const };
    assert.deepEqual(codes({ policy: anonymous }), ["masterSwitchNotApproved"]);
  });

  it("missing tariff, or a tariff/config version that was not approved", () => {
    assert.deepEqual(codes({ tariff: null }), ["tariffMissing"]);
    assert.deepEqual(codes({ tariff: { ...FIXTURE_TARIFF, version: 2 } }), ["tariffNotApproved"]);
    assert.deepEqual(codes({ tariff: { ...FIXTURE_TARIFF, status: "draft" } }), ["tariffNotApproved"]);
    assert.deepEqual(codes({ config: { ...FIXTURE_PILOT_CONFIG, version: "edited" } }), ["configNotApproved"]);
    assert.ok(codes({ config: null }).includes("noPricingConfiguration"));
  });

  it("the proposed research operating policy (13 h day) is not treated as approved", () => {
    assert.deepEqual(codes({ policy: { ...FIXTURE_PILOT_POLICY, operating: null } }), ["operatingPolicyMissing"]);
    assert.deepEqual(codes({ policy: { ...FIXTURE_PILOT_POLICY, operating: PROPOSED_OPERATING_POLICY } }), ["operatingPolicyNotApproved"]);
    assert.equal(MODERATE_RESEARCH_SCENARIO.approval.status, "proposed");
  });

  it("an unconfigured overnight policy blocks automatic pricing", () => {
    assert.deepEqual(codes({ config: { ...FIXTURE_PILOT_CONFIG, overnight: { mode: "notConfigured" } } }), ["overnightPolicyMissing"]);
  });

  it("test data is refused in production even if allowed", () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      assert.ok(codes().includes("testDataNotAllowed"));
    } finally {
      env.NODE_ENV = previous;
    }
    assert.ok(codes({ allowFixtures: false }).includes("testDataNotAllowed"));
  });
});

describe("travel rules — direction, verification and freshness", () => {
  it("a missing return rule (Rustavi → Tbilisi) blocks Tbilisi → Rustavi only", () => {
    const config = withRules(rulesWithout("p-rustavi-tbilisi"));
    assert.ok(codes({ config, request: request("Tbilisi", "Rustavi"), route: ok(25, 40) }).includes("missingReturnRule"));
    // Rustavi → Tbilisi returns inside Tbilisi, so it does not need that rule.
    assert.deepEqual(codes({ config, request: request("Rustavi", "Tbilisi"), route: ok(25, 40) }), []);
  });

  it("rules without evidence, or with future-dated evidence, are unverified", () => {
    const noEvidence = withRules(replaceRule("p-rustavi-tbilisi", { evidence: undefined }));
    assert.deepEqual(codes({ config: noEvidence, request: request("Tbilisi", "Rustavi"), route: ok(25, 40) }), ["travelRuleUnverified"]);
    const future = withRules(replaceRule("p-rustavi-tbilisi", { evidence: { source: "x", verifiedBy: "y", verifiedAt: "2027-01-01T00:00:00Z" } }));
    assert.deepEqual(codes({ config: future, request: request("Tbilisi", "Rustavi"), route: ok(25, 40) }), ["travelRuleUnverified"]);
  });

  it("evidence older than the approved age is stale", () => {
    // Fixture evidence: 2026-10-15; 90 days later → 2027-01-13.
    assert.deepEqual(codes({ now: "2027-01-13T00:00:00Z" }), []);
    assert.deepEqual(codes({ now: "2027-01-14T00:00:01Z" }), ["travelRuleEvidenceStale"]);
    assert.deepEqual(codes({ policy: { ...FIXTURE_PILOT_POLICY, evidenceMaxAgeDays: null } }), ["evidencePolicyMissing"]);
  });
});

describe("schedules — departures, limits and overnight", () => {
  it("no return departure late in the evening → manual", () => {
    // Pickup 22:00 → delivered 23:40 → at the stop 23:55, after the 23:00 last minibus.
    const r = evaluate({ request: request("Tbilisi", "Rustavi", { schedule: { date: "2026-10-25", time: "22:00" } }), route: ok(25, 40) });
    assert.ok(r.reasons.some((x) => x.code === "returnDepartureUnavailable"));
  });

  it("unknown availability, or a timetable not verified for the date → manual", () => {
    const unknown = withRules(replaceRule("p-rustavi-tbilisi", { availability: { kind: "unknown" } }));
    assert.deepEqual(codes({ config: unknown, request: request("Tbilisi", "Rustavi"), route: ok(25, 40) }), ["returnDepartureUnknown"]);
    const missing = withRules(replaceRule("p-rustavi-tbilisi", { availability: undefined }));
    assert.deepEqual(codes({ config: missing, request: request("Tbilisi", "Rustavi"), route: ok(25, 40) }), ["returnDepartureUnknown"]);
    const r = evaluate({ policy: withGamma, request: request("Tbilisi", "Gamma", { schedule: { date: "2027-02-01", time: "08:00" } }), route: ok(300, 240) });
    assert.ok(r.reasons.some((x) => x.code === "returnDepartureUnknown"), JSON.stringify(r.reasons));
  });

  it("a timetable-bound long day exceeds the limit even when every departure is caught", () => {
    // 07:15 → 08:00 pickup → 08:30 drive 300 min + 45 min break → 14:45 delivered → 15:15 at station → 16:50 train → 21:20 back.
    const r = evaluate({ policy: withGamma, request: request("Tbilisi", "Gamma", { schedule: { date: "2026-10-25", time: "08:00" } }), route: ok(300, 300) });
    assert.equal(r.schedule?.minutes.breaks, 45);
    assert.equal(r.schedule?.returnBoarding, 16 * 60 + 50);
    assert.equal(r.schedule?.minutes.waiting, 95);
    assert.equal(r.schedule?.minutes.total, 845);
    assert.deepEqual(r.reasons.map((x) => x.code), ["dayExceedsLimit"]);
  });

  it("missing the last timetabled departure → manual", () => {
    const r = evaluate({ policy: withGamma, request: request("Tbilisi", "Gamma", { schedule: { date: "2026-10-25", time: "12:00" } }), route: ok(300, 240) });
    assert.ok(r.reasons.some((x) => x.code === "returnDepartureUnavailable"));
  });

  it("driving limit, latest drive start and crossing midnight", () => {
    const tooLong = evaluate({ policy: withGamma, request: request("Tbilisi", "Gamma", { schedule: { date: "2026-10-25", time: "06:30" } }), route: ok(400, 400) });
    assert.ok(tooLong.reasons.some((x) => x.code === "drivingExceedsLimit"));

    const lateStart = { ...FIXTURE_PILOT_POLICY, operating: { ...FIXTURE_PILOT_POLICY.operating!, latestDriveStart: "19:00" } };
    assert.ok(codes({ policy: lateStart, request: request("Tbilisi", "Tbilisi", { schedule: { date: "2026-10-25", time: "19:00" } }) }).includes("driveStartTooLate"));

    const early = evaluate({ request: request("Tbilisi", "Tbilisi", { schedule: { date: "2026-10-25", time: "00:30" } }) });
    assert.ok(early.reasons.some((x) => x.code === "positioningDepartureUnavailable"));
  });

  it("the configured overnight limit is enforced", () => {
    const strict = { ...FIXTURE_PILOT_CONFIG, overnight: { mode: "manualReviewAbove" as const, maxSameDayMinutes: 120, handoverMinutes: 60 } };
    assert.ok(codes({ config: strict }).includes("overnightRequired"));
  });

  it("an invalid operating policy fails safe", () => {
    const broken = { ...FIXTURE_PILOT_POLICY, operating: { ...FIXTURE_PILOT_POLICY.operating!, maxTotalMinutes: 0 } };
    assert.deepEqual(codes({ policy: broken }), ["invalidOperatingPolicy"]);
  });
});

describe("route and request content", () => {
  it("route unavailable or implausible → manual", () => {
    assert.deepEqual(codes({ route: { ok: false, error: { kind: "timeout", retryable: true } } }), ["routeUnavailable"]);
    assert.deepEqual(codes({ route: ok(12, 2) }), ["routeImplausible"]); // 360 km/h
    assert.deepEqual(codes({ route: ok(5000, 3000) }), ["routeImplausible"]);
    assert.deepEqual(codes({ route: null }), [], "not computed yet → no route reason, but no schedule either");
    assert.equal(evaluate({ route: null }).schedule, null);
  });

  it("admin overrides always need manual review and are recorded for audit", () => {
    const req = request("Tbilisi", "Tbilisi", { overrides: { return: { fare: gel(12), travelMinutes: 50, reason: "road works", by: "founder" } } });
    const r = evaluate({ request: req });
    assert.deepEqual(r.reasons.map((x) => x.code), ["adminOverride"]);
    assert.deepEqual(r.overrides, [{ leg: "return", by: "founder", reason: "road works", fareMinor: 1200, travelMinutes: 50 }]);
  });

  it("extras need manual review (no waiting or cancellation fees are approved)", () => {
    const req = request("Tbilisi", "Tbilisi", { extras: [{ category: "waiting", code: "waiting", label: "Waiting", amount: gel(10) }] });
    assert.deepEqual(codes({ request: req }), ["extrasRequireManualReview"]);
  });

  it("vehicle not confirmed drivable → manual", () => {
    assert.deepEqual(codes({ request: request("Tbilisi", "Tbilisi", { vehicle: { powertrain: "electric", transmission: "manual", drivableConfirmed: false } }) }), ["vehicleNotEligible"]);
  });

  it("a driver base without rules fails safe", () => {
    // A Rustavi-based driver has no Rustavi → Rustavi rules (fixture), so a local Rustavi job cannot be priced.
    const c = codes({ driver: { id: "driver-rustavi", base: { zoneId: "rustavi", locality: "Rustavi" } }, request: request("Rustavi", "Rustavi"), route: ok(10, 25) });
    assert.ok(c.includes("missingPositioningRule") && c.includes("missingReturnRule"));
    assert.ok(codes({ driver: { id: "x", base: { zoneId: "nowhere", locality: "Nowhere" } } }).includes("invalidDriverBase"));
  });

  it("the eligibility module contains no hardcoded geography", () => {
    const source = readFileSync(new URL("./eligibility.ts", import.meta.url), "utf8");
    assert.ok(!/tbilisi|rustavi|თბილის|რუსთავ|batumi|kutaisi/i.test(source));
  });
});

describe("regressions — quote validity and rounding unchanged", () => {
  it("an eligible pilot quote still expires after 12 h and rounds up to whole GEL", async () => {
    const req = request("Tbilisi", "Rustavi");
    const route = ok(25.3, 40);
    assert.equal(evaluate({ request: req, route }).eligible, true);
    const o = await priceQuote({
      request: req,
      route,
      tariff: FIXTURE_TARIFF,
      config: FIXTURE_PILOT_CONFIG,
      meta: { quoteId: "q1", version: 1, computedBy: "server", now: NOW },
      allowFixtures: true,
    });
    assert.equal(o.status, "quoted");
    if (o.status !== "quoted") return;
    assert.equal(DEFAULT_PRICING_CONFIG.quoteValidityHours, 12);
    assert.equal(o.quote.validUntil, "2026-10-21T20:00:00.000Z");
    assert.equal(o.quote.commercial.total.amountMinor % 100, 0);
    assert.ok(o.quote.commercial.roundingAdjustment.amountMinor >= 0);
    assert.deepEqual([...o.quote.commercial.excludes], ["fuel", "charging"]);
  });
});
