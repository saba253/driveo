import { test } from "node:test";
import assert from "node:assert/strict";
import { ka } from "../../content/ka.ts";
import { toSubmissionPayload } from "./submission-contract.ts";
import { handleBookingPost } from "./submission-http.ts";
import {
  createBookingSubmissionService,
  createRpcBookingStore,
  createRpcRateLimiter,
  SUBMISSION_RATE_LIMITS,
  type BookingStore,
  type RateLimiter,
  type Rpc,
} from "./submission-service.ts";
import { VALID_DRAFT } from "./test-fixtures.ts";

const ORIGIN = "http://localhost:3000";
const KEY = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

type Logged = { event: string; detail?: Record<string, unknown> };

function setup(opts: { store?: BookingStore; limiter?: RateLimiter } = {}) {
  const logs: Logged[] = [];
  const calls: unknown[] = [];
  const store: BookingStore = opts.store ?? {
    async submit(input) {
      calls.push(input);
      return { kind: "stored", reference: "DRV-2026-000001", duplicate: false };
    },
  };
  const limiter: RateLimiter = opts.limiter ?? { consume: async () => true };
  const log = (event: string, detail?: Record<string, string | number | boolean>) => logs.push({ event, detail });
  const service = createBookingSubmissionService({
    store,
    limiter,
    hashSecret: "h".repeat(32),
    allowedCities: ka.booking.cities,
    tbilisiNow: () => ({ date: "2026-10-22", time: "09:00" }),
    clock: () => new Date("2026-10-22T05:00:00Z"),
    test: true,
    log,
  });
  return { service, logs, calls, log };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "Idempotency-Key": KEY, "X-Forwarded-For": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const PII = /ტესტაძე|555|\+995|სატესტო ქუჩა|203\.0\.113\.7/;

test("with the flag off, nothing is read or stored and the answer is 503", async () => {
  let touched = false;
  const req = new Request(`${ORIGIN}/api/bookings`, { method: "POST", body: "x" });
  Object.defineProperty(req, "json", { value: () => ((touched = true), {}) });
  const res = await handleBookingPost(req, { service: null, allowedOrigin: null, log: () => {} });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { status: "unavailable" });
  assert.equal(touched, false);
  assert.equal(req.bodyUsed, false);
});

test("a valid request is stored once and answered minimally", async () => {
  const { service, calls, logs, log } = setup();
  const res = await handleBookingPost(request(toSubmissionPayload(VALID_DRAFT)), { service, allowedOrigin: ORIGIN, log });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { status: "received", reference: "DRV-2026-000001", duplicate: false });
  assert.doesNotMatch(text, PII);
  assert.equal(calls.length, 1);
  const call = calls[0] as { submissionId: string; submissionHash: string; ipHash: string; booking: Record<string, unknown> };
  assert.equal(call.submissionId, KEY);
  assert.match(call.submissionHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(call.ipHash, /^[0-9a-f]{64}$/);
  assert.equal(call.booking.pricing_mode, "manual_assessment");
  assert.doesNotMatch(JSON.stringify(logs), PII);
});

test("request-level checks happen before any service call", async () => {
  const { service, calls, log } = setup();
  const deps = { service, allowedOrigin: ORIGIN, log };
  const body = toSubmissionPayload(VALID_DRAFT);
  const cases: [Request, number][] = [
    [request(body, { Origin: "https://evil.example" }), 403],
    [request(body, { "Sec-Fetch-Site": "cross-site" }), 403],
    [new Request(`${ORIGIN}/api/bookings`, { method: "POST", headers: { Origin: ORIGIN, "Idempotency-Key": KEY }, body: JSON.stringify(body) }), 415],
    [request(body, { "Content-Type": "text/plain" }), 415],
    [request(body, { "Idempotency-Key": "" }), 400],
    [request(body, { "Idempotency-Key": "not-a-uuid" }), 400],
    [request("{not json"), 400],
    [request("x".repeat(20_000)), 413],
  ];
  for (const [req, status] of cases) {
    const res = await handleBookingPost(req, deps);
    assert.equal(res.status, status, `${req.headers.get("origin")} ${req.headers.get("content-type")} ${status}`);
    assert.equal((await res.json()).status, "rejected");
  }
  assert.equal(calls.length, 0);
});

test("invalid input returns field codes only, with nothing stored", async () => {
  const { service, calls, log } = setup();
  const res = await handleBookingPost(request(toSubmissionPayload({ ...VALID_DRAFT, customerPhone: "12", pickupAddress: "" })), {
    service,
    allowedOrigin: ORIGIN,
    log,
  });
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { status: "invalid", errors: { customerPhone: "invalidPhone", pickupAddress: "required" } });
  assert.equal(calls.length, 0);
});

test("injected privileged fields are rejected with nothing stored", async () => {
  const { service, calls, log } = setup();
  for (const extra of [{ price: 0 }, { status: "confirmed" }, { pricing_mode: "automatic_quote" }, { tariffOverride: {} }]) {
    const res = await handleBookingPost(request({ ...toSubmissionPayload(VALID_DRAFT), ...extra }), { service, allowedOrigin: ORIGIN, log });
    assert.equal(res.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("duplicates answer 200 with the same reference; conflicts answer 409", async () => {
  const dup = setup({ store: { submit: async () => ({ kind: "stored", reference: "DRV-2026-000009", duplicate: true }) } });
  const res = await handleBookingPost(request(toSubmissionPayload(VALID_DRAFT)), { service: dup.service, allowedOrigin: ORIGIN, log: dup.log });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "received", reference: "DRV-2026-000009", duplicate: true });

  const conflict = setup({ store: { submit: async () => ({ kind: "conflict" }) } });
  const res2 = await handleBookingPost(request(toSubmissionPayload(VALID_DRAFT)), { service: conflict.service, allowedOrigin: ORIGIN, log: conflict.log });
  assert.equal(res2.status, 409);
  assert.deepEqual(await res2.json(), { status: "conflict" });
});

test("database failures become a generic 503 without details", async () => {
  for (const result of [{ kind: "failed", code: "PGRST301" }, { kind: "rejected_by_database", code: "23514" }] as const) {
    const s = setup({ store: { submit: async () => result } });
    const res = await handleBookingPost(request(toSubmissionPayload(VALID_DRAFT)), { service: s.service, allowedOrigin: ORIGIN, log: s.log });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: "unavailable" });
    assert.ok(s.logs.some((l) => l.detail?.code === result.code));
  }
  const thrown = setup({ store: { submit: async () => Promise.reject(new Error("fetch failed for +995555123456")) } });
  const res = await handleBookingPost(request(toSubmissionPayload(VALID_DRAFT)), { service: thrown.service, allowedOrigin: ORIGIN, log: thrown.log });
  assert.equal(res.status, 503);
  assert.doesNotMatch(JSON.stringify(thrown.logs), /\+995555123456/);
});

test("rate limits: per client first, then per phone and overall; an unreachable limiter fails closed", async () => {
  const keys: string[] = [];
  const limited = (blocked: RegExp) =>
    setup({
      limiter: {
        consume: async (key) => {
          keys.push(key);
          return !blocked.test(key);
        },
      },
    });

  const byClient = limited(/^booking\.ip:/);
  const r1 = await handleBookingPost(request(toSubmissionPayload(VALID_DRAFT)), { service: byClient.service, allowedOrigin: ORIGIN, log: byClient.log });
  assert.equal(r1.status, 429);
  assert.equal(r1.headers.get("retry-after"), String(SUBMISSION_RATE_LIMITS.perClient.windowSeconds));
  assert.equal(byClient.calls.length, 0);

  const byPhone = limited(/^booking\.phone:/);
  const r2 = await handleBookingPost(request(toSubmissionPayload(VALID_DRAFT)), { service: byPhone.service, allowedOrigin: ORIGIN, log: byPhone.log });
  assert.equal(r2.status, 429);
  assert.equal(byPhone.calls.length, 0);

  // Keys are hashed: no raw IP or phone number reaches the counter store.
  for (const k of keys) assert.match(k, /^[a-z.]+:[0-9a-f]{64}$/);

  const down = setup({ limiter: { consume: async () => Promise.reject(new Error("rate_limit_unavailable:PGRST000")) } });
  const r3 = await handleBookingPost(request(toSubmissionPayload(VALID_DRAFT)), { service: down.service, allowedOrigin: ORIGIN, log: down.log });
  assert.equal(r3.status, 503);
  assert.equal(down.calls.length, 0);
});

test("rpc adapters map database error codes", async () => {
  const rpcWith = (result: { data: unknown; error: { code: string } | null }): Rpc => async () => result;
  const input = { submissionId: KEY, submissionHash: "sha256:x", booking: {}, contact: {}, ipHash: null };
  assert.deepEqual(await createRpcBookingStore(rpcWith({ data: null, error: { code: "DV002" } })).submit(input), { kind: "conflict" });
  assert.deepEqual(await createRpcBookingStore(rpcWith({ data: null, error: { code: "23514" } })).submit(input), { kind: "rejected_by_database", code: "23514" });
  assert.deepEqual(await createRpcBookingStore(rpcWith({ data: null, error: { code: "42501" } })).submit(input), { kind: "failed", code: "42501" });
  assert.deepEqual(await createRpcBookingStore(rpcWith({ data: { reference: "DRV-2026-000002", duplicate: false }, error: null })).submit(input), {
    kind: "stored",
    reference: "DRV-2026-000002",
    duplicate: false,
  });
  assert.equal(await createRpcRateLimiter(rpcWith({ data: false, error: null })).consume("k", 1, 1), false);
  await assert.rejects(createRpcRateLimiter(rpcWith({ data: null, error: { code: "PGRST000" } })).consume("k", 1, 1));
});
