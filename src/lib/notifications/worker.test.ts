import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffSeconds, classifyFailure, createBookingNotificationWorker, WORKER_LIMITS } from "./booking-worker.ts";
import { handleWorkerRun } from "./worker-http.ts";
import { readWorkerSettings } from "./worker-settings.ts";
import { FAKE_BOT_TOKEN } from "../telegram/test-fixtures.ts";

const ENV = {
  BOOKING_NOTIFICATIONS: "telegram",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_fixture_not_real",
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  NOTIFICATIONS_WORKER_SECRET: "w".repeat(40),
};

test("worker settings: off by default, only 'telegram' enables, never in production, needs every setting", () => {
  assert.deepEqual(readWorkerSettings({}), { enabled: false, reason: "off" });
  assert.deepEqual(readWorkerSettings({ ...ENV, BOOKING_NOTIFICATIONS: "on" }), { enabled: false, reason: "unknown_mode" });
  assert.deepEqual(readWorkerSettings({ ...ENV, NODE_ENV: "production" }), { enabled: false, reason: "not_allowed_in_production" });
  for (const broken of [{ SUPABASE_SECRET_KEY: "sb_publishable_x" }, { NOTIFICATIONS_WORKER_SECRET: "short" }, { TELEGRAM_BOT_TOKEN: "" }, { SUPABASE_URL: "https://x.com" }]) {
    assert.deepEqual(readWorkerSettings({ ...ENV, ...broken }), { enabled: false, reason: "misconfigured" }, JSON.stringify(broken));
  }
  const ok = readWorkerSettings(ENV);
  assert.equal(ok.enabled, true);
  assert.equal(ok.enabled && ok.adminUrl, null);
  const withUrl = readWorkerSettings({ ...ENV, DRIVEO_APP_URL: "https://driveo.ge" });
  assert.equal(withUrl.enabled && withUrl.adminUrl, "https://driveo.ge/admin");
});

test("trigger endpoint: 404 when disabled, 401 without the exact secret, runs only when authorized", async () => {
  let runs = 0;
  const run = async () => ((runs += 1), { status: "done" as const, claimed: 0, sent: 0, retrying: 0, failed: 0, uncertain: 0 });
  const req = (auth?: string) => new Request("http://localhost/api/internal/notifications/run", { method: "POST", headers: auth ? { Authorization: auth } : {} });

  assert.equal((await handleWorkerRun(req(`Bearer ${"w".repeat(40)}`), { secret: null, run: null })).status, 404);
  for (const auth of [undefined, "Bearer ", `Bearer ${"w".repeat(39)}`, `Bearer ${"w".repeat(41)}`, `Basic ${"w".repeat(40)}`, "w".repeat(40)]) {
    assert.equal((await handleWorkerRun(req(auth), { secret: "w".repeat(40), run })).status, 401, String(auth));
  }
  assert.equal(runs, 0);
  const ok = await handleWorkerRun(req(`Bearer ${"w".repeat(40)}`), { secret: "w".repeat(40), run });
  assert.equal(ok.status, 200);
  assert.equal(runs, 1);
});

test("failure classification is conservative", () => {
  assert.equal(classifyFailure({ ok: false, kind: "api_error", status: 429, code: "telegram_429" }), "retry");
  assert.equal(classifyFailure({ ok: false, kind: "api_error", status: 403, code: "telegram_403" }), "failed");
  assert.equal(classifyFailure({ ok: false, kind: "api_error", status: 400, code: "telegram_400" }), "failed");
  for (const kind of ["timeout", "network"] as const) assert.equal(classifyFailure({ ok: false, kind, status: null, code: `telegram_${kind}` }), "uncertain");
  assert.equal(classifyFailure({ ok: false, kind: "bad_response", status: 502, code: "telegram_http_502" }), "uncertain");
  assert.equal(classifyFailure({ ok: false, kind: "api_error", status: 500, code: "telegram_500" }), "uncertain");
  assert.deepEqual([1, 2, 3, 10].map(backoffSeconds), [60, 120, 240, WORKER_LIMITS.maxBackoffSeconds]);
});

test("a disabled worker touches neither the database nor Telegram", async () => {
  let calls = 0;
  const count = async () => ((calls += 1), { data: null, error: null });
  const api = { getMe: count, getUpdates: count, getChat: count, sendMessage: count } as never;
  const w = createBookingNotificationWorker({ enabled: false, rpc: count, api, adminUrl: null, log: () => {} });
  assert.deepEqual(await w.run(), { status: "disabled" });
  assert.equal(calls, 0);
});
