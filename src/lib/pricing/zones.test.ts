import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalQuoteInputs, fingerprintQuoteInputs } from "./fingerprint.ts";
import { gel } from "./money.ts";
import { pricingContext } from "./quote.ts";
import { FIXTURE_CONFIG, FIXTURE_TARIFF, fixtureRequest } from "./test-fixtures.ts";

const CTX = pricingContext(FIXTURE_TARIFF, FIXTURE_CONFIG);
import { findTravelRule, matchLocality, normalizeLocality, validatePricingConfig } from "./zones.ts";

/* Zones and rules are TEST FIXTURES (see test-fixtures.ts). */

describe("normalizeLocality", () => {
  it("ignores case, spacing, punctuation and city prefixes in both scripts", () => {
    for (const v of ["Tbilisi", "  TBILISI ", "Tbilisi city", "City of Tbilisi", "tbilisi."]) assert.equal(normalizeLocality(v), "tbilisi", v);
    for (const v of ["თბილისი", "ქ. თბილისი", "ქალაქი თბილისი", "  თბილისი  "]) assert.equal(normalizeLocality(v), "თბილისი", v);
    // Mtavruli (Georgian capitals) folds to Mkhedruli.
    assert.equal(normalizeLocality("ᲗᲑᲘᲚᲘᲡᲘ"), "თბილისი");
  });
});

describe("matchLocality", () => {
  it("matches any configured spelling to its zone", () => {
    assert.deepEqual(matchLocality(FIXTURE_CONFIG.zones, "ალფა"), { zoneId: "alpha", locality: "ალფა" });
    assert.equal(matchLocality(FIXTURE_CONFIG.zones, "BETA village")?.zoneId, "beta");
  });

  it("returns null for unknown or empty localities", () => {
    assert.equal(matchLocality(FIXTURE_CONFIG.zones, "Nowhere"), null);
    assert.equal(matchLocality(FIXTURE_CONFIG.zones, "   "), null);
  });
});

describe("findTravelRule", () => {
  const z = (name: string) => matchLocality(FIXTURE_CONFIG.zones, name)!;

  it("prefers locality-specific rules and falls back to the zone rule", () => {
    assert.equal(findTravelRule(FIXTURE_CONFIG.travelRules, z("Beta Village"), z("Alpha"))?.id, "r-betavillage-alpha");
    assert.equal(findTravelRule(FIXTURE_CONFIG.travelRules, z("Beta"), z("Alpha"))?.id, "r-beta-alpha");
  });

  it("is directional and returns null when no rule exists", () => {
    assert.equal(findTravelRule(FIXTURE_CONFIG.travelRules, z("Gamma"), z("Alpha"))?.id, "r-gamma-alpha");
    assert.equal(findTravelRule(FIXTURE_CONFIG.travelRules, z("Alpha"), z("Gamma")), null);
    assert.equal(findTravelRule(FIXTURE_CONFIG.travelRules, z("Delta"), z("Alpha")), null);
  });
});

describe("validatePricingConfig", () => {
  it("accepts the fixture configuration", () => {
    assert.deepEqual(validatePricingConfig(FIXTURE_CONFIG), []);
  });

  it("reports structural problems", () => {
    const rule0 = FIXTURE_CONFIG.travelRules[0];
    const issues = validatePricingConfig({
      ...FIXTURE_CONFIG,
      quoteValidityHours: 0,
      roundingStepMinor: 0.5,
      zones: [...FIXTURE_CONFIG.zones, { id: "alpha", name: "dup", localities: [] }],
      travelRules: [
        ...FIXTURE_CONFIG.travelRules,
        { ...rule0 }, // duplicate id and leg
        { ...rule0, id: "neg", fromZoneId: "beta", toZoneId: "beta", fare: gel(-1) },
        { ...rule0, id: "none-paid", fromZoneId: "gamma", toZoneId: "gamma", mode: "none", fare: gel(5) },
        { ...rule0, id: "bad-loc", fromZoneId: "gamma", toZoneId: "alpha", fromLocality: "Beta" },
      ],
      plausibility: { maxRoadKm: 0, minAvgSpeedKmh: 50, maxAvgSpeedKmh: 40, maxRoadToStraightRatio: 0.5 },
    });
    for (const fragment of [
      "quoteValidityHours",
      "roundingStepMinor",
      'zone id "alpha"',
      'zone "alpha" has no localities',
      'travel rule id "r-alpha-alpha"',
      "duplicates another rule",
      '"neg": fare',
      '"none-paid": mode "none"',
      '"bad-loc": fromLocality',
      "maxRoadKm",
      "speed limits",
      "maxRoadToStraightRatio",
    ]) {
      assert.ok(issues.some((i) => i.includes(fragment)), `missing issue containing ${fragment}\n${issues.join("\n")}`);
    }
  });
});

describe("input fingerprints", () => {
  it("is stable for cosmetic differences and ignores provider coordinates", async () => {
    const a = fixtureRequest("Alpha", "Beta");
    const b = fixtureRequest(" ALPHA ", "beta", {
      pickup: { locality: " ALPHA ", address: "  fixture   STREET 1.", placeId: null, coordinates: { lat: 1, lng: 2 } },
    });
    assert.equal(await fingerprintQuoteInputs(a, CTX), await fingerprintQuoteInputs(b, CTX));
    assert.match(await fingerprintQuoteInputs(a, CTX), /^sha256:[0-9a-f]{64}$/);
  });

  it("changes when anything price-relevant changes", async () => {
    const base = fixtureRequest("Alpha", "Beta");
    const variants = [
      { ...base, pickup: { ...base.pickup, address: "Fixture street 2" } },
      { ...base, delivery: { ...base.delivery, locality: "Gamma" } },
      { ...base, delivery: { ...base.delivery, placeId: "place-123" } },
      { ...base, schedule: { ...base.schedule, time: "10:00" } },
      { ...base, extras: [{ category: "waiting" as const, code: "waiting", label: "w", amount: gel(10) }] },
      { ...base, overrides: { return: { fare: gel(5), travelMinutes: 10, reason: "r", by: "a" } } },
      // Eligibility-relevant vehicle facts.
      { ...base, vehicle: { ...base.vehicle, powertrain: "electric" as const } },
      { ...base, vehicle: { ...base.vehicle, transmission: "manual" as const } },
      { ...base, vehicle: { ...base.vehicle, drivableConfirmed: false } },
    ];
    const original = canonicalQuoteInputs(base, CTX);
    for (const v of variants) assert.notEqual(canonicalQuoteInputs(v, CTX), original, JSON.stringify(v));
  });

  it("changes when the pricing context changes (tariff, configuration, driver, base)", () => {
    const req = fixtureRequest("Alpha", "Beta");
    const original = canonicalQuoteInputs(req, CTX);
    for (const ctx of [
      pricingContext(null, FIXTURE_CONFIG),
      pricingContext({ ...FIXTURE_TARIFF, version: 2 }, FIXTURE_CONFIG),
      pricingContext({ ...FIXTURE_TARIFF, id: "other" }, FIXTURE_CONFIG),
      pricingContext(FIXTURE_TARIFF, { ...FIXTURE_CONFIG, version: "fixture-config-2" }),
      pricingContext(FIXTURE_TARIFF, FIXTURE_CONFIG, { id: "driver-2", base: FIXTURE_CONFIG.base }),
      pricingContext(FIXTURE_TARIFF, FIXTURE_CONFIG, { id: "driver-2", base: { zoneId: "beta", locality: "Beta" } }),
    ]) {
      assert.notEqual(canonicalQuoteInputs(req, ctx), original, JSON.stringify(ctx));
    }
  });

  it("does not depend on extras order or the request id", () => {
    const e1 = { category: "parking" as const, code: "a", label: "A", amount: gel(1) };
    const e2 = { category: "toll" as const, code: "b", label: "B", amount: gel(2) };
    assert.equal(
      canonicalQuoteInputs(fixtureRequest("Alpha", "Beta", { extras: [e1, e2] }), CTX),
      canonicalQuoteInputs({ ...fixtureRequest("Alpha", "Beta", { extras: [e2, e1] }), requestId: "other" }, CTX),
    );
  });
});
