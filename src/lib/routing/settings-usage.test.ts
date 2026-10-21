import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROUTING_LIMITS, readRoutingSettings } from "./settings.ts";
import { disabledRouteProvider, type RouteProvider } from "./types.ts";
import { createRateLimiter, createUsageGuard, withUsageGuard } from "./usage.ts";

const REQUEST = { origin: { city: "A", address: "a", placeId: "p1" }, destination: { city: "B", address: "b", placeId: "p2" } };

describe("readRoutingSettings — live requests are off by default", () => {
  it("is disabled with no configuration", () => {
    const s = readRoutingSettings({});
    assert.equal(s.enabled, false);
    assert.equal(!s.enabled && s.reason, "flagOff");
    assert.deepEqual(s.limits, DEFAULT_ROUTING_LIMITS);
  });

  it("stays disabled unless the flag is exactly 'true'", () => {
    for (const flag of ["1", "TRUE", "yes", "true ", ""]) {
      assert.equal(readRoutingSettings({ GOOGLE_ROUTES_ENABLED: flag, GOOGLE_MAPS_SERVER_API_KEY: "k" }).enabled, false, flag);
    }
  });

  it("stays disabled without a key, even when flagged on", () => {
    const s = readRoutingSettings({ GOOGLE_ROUTES_ENABLED: "true" });
    assert.equal(!s.enabled && s.reason, "missingApiKey");
  });

  it("refuses to run if a Google key is exposed through a NEXT_PUBLIC_ variable", () => {
    const s = readRoutingSettings({ GOOGLE_ROUTES_ENABLED: "true", GOOGLE_MAPS_SERVER_API_KEY: "k", NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "k" });
    assert.equal(!s.enabled && s.reason, "exposedKey");
  });

  it("enables with flag and key, clamping timeouts, retries and limits", () => {
    const s = readRoutingSettings({
      GOOGLE_ROUTES_ENABLED: "true",
      GOOGLE_MAPS_SERVER_API_KEY: " k ",
      GOOGLE_ROUTES_TIMEOUT_MS: "999999",
      GOOGLE_ROUTES_MAX_RETRIES: "9",
      GOOGLE_ROUTES_DAILY_LIMIT: "-5",
      ROUTE_QUOTES_PER_CLIENT_PER_MINUTE: "abc",
    });
    assert.ok(s.enabled);
    if (!s.enabled) return;
    assert.equal(s.apiKey, "k");
    assert.equal(s.timeoutMs, 15_000);
    assert.equal(s.maxRetries, 3);
    assert.equal(s.limits.dailyRequestLimit, 0);
    assert.equal(s.limits.perClientPerMinute, DEFAULT_ROUTING_LIMITS.perClientPerMinute);
  });
});

describe("disabled provider", () => {
  it("always reports 'disabled' so pricing falls back to manual", async () => {
    assert.deepEqual(await disabledRouteProvider.computeRoute(REQUEST), { ok: false, error: { kind: "disabled", retryable: false } });
  });
});

describe("usage guard", () => {
  it("caps calls per UTC day and month, then resets", async () => {
    let t = new Date("2026-10-21T23:59:00Z");
    const guard = createUsageGuard({ dailyLimit: 2, monthlyLimit: 3, now: () => t });
    let calls = 0;
    const inner: RouteProvider = { id: "x", computeRoute: async () => (calls++, { ok: false, error: { kind: "notFound", retryable: false } }) };
    const p = withUsageGuard(inner, guard);

    await p.computeRoute(REQUEST);
    await p.computeRoute(REQUEST);
    const blocked = await p.computeRoute(REQUEST);
    assert.deepEqual(!blocked.ok && [blocked.error.kind, blocked.error.providerStatus], ["usageLimit", "DAILY"]);
    assert.equal(calls, 2, "blocked calls never reach the provider");

    t = new Date("2026-10-22T00:01:00Z");
    await p.computeRoute(REQUEST);
    const monthly = await p.computeRoute(REQUEST);
    assert.deepEqual(!monthly.ok && monthly.error.providerStatus, "MONTHLY");
    assert.equal(calls, 3);

    t = new Date("2026-11-01T00:00:00Z");
    assert.deepEqual(guard.tryConsume(), { ok: true });
  });

  it("a zero limit blocks everything", () => {
    assert.deepEqual(createUsageGuard({ dailyLimit: 0, monthlyLimit: 10 }).tryConsume(), { ok: false, scope: "daily" });
  });
});

describe("rate limiter", () => {
  it("allows N requests per window per key and reports when to retry", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });
    assert.deepEqual(limiter.check("ip-1"), { allowed: true });
    t = 10_000;
    assert.deepEqual(limiter.check("ip-1"), { allowed: true });
    t = 20_000;
    assert.deepEqual(limiter.check("ip-1"), { allowed: false, retryAfterMs: 40_000 });
    assert.deepEqual(limiter.check("ip-2"), { allowed: true }, "keys are independent");
    t = 60_001;
    assert.deepEqual(limiter.check("ip-1"), { allowed: true }, "window slides");
  });

  it("bounds memory by evicting the oldest keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2, now: () => 0 });
    limiter.check("a");
    limiter.check("b");
    limiter.check("c"); // evicts "a"
    assert.deepEqual(limiter.check("a"), { allowed: true });
  });
});
