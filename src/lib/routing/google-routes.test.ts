import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GOOGLE_ROUTES_ENDPOINT,
  GOOGLE_ROUTES_FIELD_MASK,
  buildComputeRoutesBody,
  createGoogleRoutesProvider,
  parseDurationSeconds,
} from "./google-routes.ts";
import type { RouteRequest } from "./types.ts";

/*
 * All provider responses are MOCKED. No request leaves the machine.
 * Distances/durations below are arbitrary test values, not real routes.
 */

const KEY = "test-key-NOT-REAL-123";
const NOW = new Date("2026-10-21T08:00:00.000Z");

const REQUEST: RouteRequest = {
  origin: { city: "A", address: "a", placeId: "place-origin" },
  destination: { city: "B", address: "b", placeId: "place-destination" },
};

type Call = { url: string; init: RequestInit };

/** A fetch double that replays scripted responses and records calls. */
function mockFetch(script: Array<Response | Error | ((init: RequestInit) => Promise<Response>)>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step(init);
    return step.clone();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const OK_BODY = { routes: [{ distanceMeters: 230_400, duration: "12345s" }] };

function provider(script: Parameters<typeof mockFetch>[0], extra: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  const mock = mockFetch(script);
  const p = createGoogleRoutesProvider({
    apiKey: KEY,
    fetch: mock.fn,
    now: () => NOW,
    sleep: async (ms) => void sleeps.push(ms),
    retryBaseDelayMs: 100,
    ...extra,
  });
  return { p, calls: mock.calls, sleeps };
}

describe("request building", () => {
  it("uses place ids or coordinates, DRIVE, TRAFFIC_UNAWARE and Georgian locale", () => {
    const body = buildComputeRoutesBody({
      origin: { city: "A", address: "a", placeId: "p1" },
      destination: { city: "B", address: "b", coordinates: { lat: 41.6, lng: 41.6 } },
    });
    assert.deepEqual(body, {
      origin: { placeId: "p1" },
      destination: { location: { latLng: { latitude: 41.6, longitude: 41.6 } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      computeAlternativeRoutes: false,
      units: "METRIC",
      languageCode: "ka",
      regionCode: "ge",
    });
  });

  it("refuses unresolved free-text addresses and invalid coordinates", () => {
    assert.equal(buildComputeRoutesBody({ origin: { city: "A", address: "street 1" }, destination: REQUEST.destination }), null);
    assert.equal(
      buildComputeRoutesBody({ origin: { city: "A", address: "a", coordinates: { lat: 200, lng: 0 } }, destination: REQUEST.destination }),
      null,
    );
  });

  it("sends the key and a minimal field mask as headers, to the Routes endpoint", async () => {
    const { p, calls } = provider([json(OK_BODY)]);
    await p.computeRoute(REQUEST);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GOOGLE_ROUTES_ENDPOINT);
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-Goog-Api-Key"], KEY);
    assert.equal(headers["X-Goog-FieldMask"], GOOGLE_ROUTES_FIELD_MASK);
    assert.equal(GOOGLE_ROUTES_FIELD_MASK, "routes.distanceMeters,routes.duration");
    assert.ok(!String(calls[0].init.body).includes(KEY), "key never in the body");
  });

  it("requires an API key", () => {
    assert.throws(() => createGoogleRoutesProvider({ apiKey: " " }));
  });
});

describe("response normalization", () => {
  it("converts metres and seconds into km and minutes", async () => {
    const { p } = provider([json(OK_BODY)]);
    assert.deepEqual(await p.computeRoute(REQUEST), {
      ok: true,
      route: { distanceKm: 230.4, durationMinutes: 205.75, method: "road", provider: "google-routes", computedAt: NOW.toISOString() },
    });
  });

  it("an empty response means no route", async () => {
    for (const body of [{}, { routes: [] }]) {
      const { p } = provider([json(body)]);
      const r = await p.computeRoute(REQUEST);
      assert.equal(!r.ok && r.error.kind, "notFound");
    }
  });

  it("rejects malformed or untrustworthy data instead of guessing", async () => {
    for (const body of [
      { routes: [{ duration: "100s" }] }, // missing distance (proto3 omits zero)
      { routes: [{ distanceMeters: 0, duration: "100s" }] },
      { routes: [{ distanceMeters: 1000 }] },
      { routes: [{ distanceMeters: 1000, duration: "1h" }] },
      { routes: [{ distanceMeters: "1000", duration: "100s" }] },
      { routes: "nope" },
    ]) {
      const { p } = provider([json(body)]);
      const r = await p.computeRoute(REQUEST);
      assert.equal(!r.ok && r.error.kind, "malformedResponse", JSON.stringify(body));
    }
    const { p } = provider([new Response("<html>oops</html>", { status: 200 })]);
    const r = await p.computeRoute(REQUEST);
    assert.equal(!r.ok && r.error.kind, "malformedResponse");
  });

  it("parses duration strings strictly", () => {
    assert.equal(parseDurationSeconds("165s"), 165);
    assert.equal(parseDurationSeconds("1.5s"), 1.5);
    for (const v of ["165", "s", "-5s", 165, null]) assert.equal(parseDurationSeconds(v), null);
  });
});

describe("error handling, timeout and bounded retries", () => {
  const errorBody = (status: string) => ({ error: { code: 0, status, message: `details mentioning ${KEY}` } });

  it("maps HTTP errors to normalized kinds without retrying permanent failures", async () => {
    for (const [http, status, kind] of [
      [400, "INVALID_ARGUMENT", "invalidRequest"],
      [401, "UNAUTHENTICATED", "auth"],
      [403, "PERMISSION_DENIED", "auth"],
      [404, "NOT_FOUND", "unresolvedAddress"],
      [501, "NOT_IMPLEMENTED", "unavailable"],
    ] as const) {
      const { p, calls } = provider([json(errorBody(status), http)]);
      const r = await p.computeRoute(REQUEST);
      assert.ok(!r.ok);
      if (r.ok) continue;
      assert.equal(r.error.kind, kind, `${http}`);
      assert.equal(r.error.retryable, false);
      assert.equal(r.error.httpStatus, http);
      assert.equal(r.error.providerStatus, status);
      assert.equal(calls.length, 1, `no retry for ${http}`);
    }
  });

  it("retries transient failures a bounded number of times with backoff", async () => {
    const { p, calls, sleeps } = provider([json(errorBody("UNAVAILABLE"), 503), json(errorBody("UNAVAILABLE"), 503), json(OK_BODY)], { maxRetries: 2 });
    const r = await p.computeRoute(REQUEST);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [100, 200]);
  });

  it("gives up after the retry budget and reports attempts", async () => {
    const { p, calls } = provider([json(errorBody("UNAVAILABLE"), 503)], { maxRetries: 1 });
    const r = await p.computeRoute(REQUEST);
    assert.deepEqual(!r.ok && { kind: r.error.kind, attempts: r.error.attempts }, { kind: "unavailable", attempts: 2 });
    assert.equal(calls.length, 2);
  });

  it("caps retries at 3 regardless of configuration", async () => {
    const { p, calls } = provider([json(errorBody("UNAVAILABLE"), 500)], { maxRetries: 50 });
    await p.computeRoute(REQUEST);
    assert.equal(calls.length, 4);
  });

  it("honours a capped Retry-After on rate limiting", async () => {
    const { p, sleeps } = provider([json(errorBody("RESOURCE_EXHAUSTED"), 429, { "Retry-After": "30" }), json(OK_BODY)], { maxRetryAfterMs: 1500 });
    const r = await p.computeRoute(REQUEST);
    assert.equal(r.ok, true);
    assert.deepEqual(sleeps, [1500]);
  });

  it("times out slow responses and treats network failures as unavailable", async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const slow = provider([hang], { timeoutMs: 20, maxRetries: 0 });
    const r1 = await slow.p.computeRoute(REQUEST);
    assert.equal(!r1.ok && r1.error.kind, "timeout");

    const down = provider([new TypeError("fetch failed")], { maxRetries: 0 });
    const r2 = await down.p.computeRoute(REQUEST);
    assert.equal(!r2.ok && r2.error.kind, "unavailable");
  });

  it("never includes the API key or provider message text in results", async () => {
    for (const script of [[json(errorBody("PERMISSION_DENIED"), 403)], [json({ error: { status: `bad ${KEY}` } }, 400)], [new TypeError(KEY)]]) {
      const { p } = provider(script as Parameters<typeof mockFetch>[0], { maxRetries: 0 });
      const r = await p.computeRoute(REQUEST);
      assert.ok(!JSON.stringify(r).includes(KEY));
      assert.ok(!JSON.stringify(r).includes("details mentioning"));
    }
  });

  it("does not call the provider for unresolved addresses", async () => {
    const { p, calls } = provider([json(OK_BODY)]);
    const r = await p.computeRoute({ origin: { city: "A", address: "free text" }, destination: REQUEST.destination });
    assert.equal(!r.ok && r.error.kind, "unresolvedAddress");
    assert.equal(calls.length, 0);
  });
});
