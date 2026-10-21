import { test } from "node:test";
import assert from "node:assert/strict";
import { readBookingSubmissionSettings } from "./submission-settings.ts";

const TEST_ENV = {
  BOOKING_SUBMISSIONS: "test",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_fixture_not_real",
  BOOKING_HASH_SECRET: "x".repeat(32),
};

test("submissions are OFF by default", () => {
  assert.deepEqual(readBookingSubmissionSettings({}), { mode: "disabled", reason: "off" });
  assert.deepEqual(readBookingSubmissionSettings({ BOOKING_SUBMISSIONS: "off" }), { mode: "disabled", reason: "off" });
});

test("only the exact value 'test' enables anything; there is no live mode", () => {
  for (const v of ["true", "on", "live", "production", "TEST", "1"]) {
    assert.deepEqual(readBookingSubmissionSettings({ ...TEST_ENV, BOOKING_SUBMISSIONS: v }), { mode: "disabled", reason: "unknown_mode" }, v);
  }
});

test("test mode is refused in production", () => {
  assert.deepEqual(readBookingSubmissionSettings({ ...TEST_ENV, NODE_ENV: "production" }), { mode: "disabled", reason: "not_allowed_in_production" });
});

test("test mode needs a real secret key, a hash secret and a project URL; otherwise it stays off", () => {
  assert.equal(readBookingSubmissionSettings(TEST_ENV).mode, "test");
  for (const broken of [
    { SUPABASE_SECRET_KEY: "" },
    { SUPABASE_SECRET_KEY: "sb_publishable_wrong_key" },
    { BOOKING_HASH_SECRET: "short" },
    { SUPABASE_URL: "https://example.com" },
    { BOOKING_ALLOWED_ORIGIN: "javascript:alert(1)" },
    { NEXT_PUBLIC_LEAK: "sb_secret_oops" },
  ]) {
    assert.deepEqual(readBookingSubmissionSettings({ ...TEST_ENV, ...broken }), { mode: "disabled", reason: "misconfigured" }, JSON.stringify(broken));
  }
});

test("the allowed origin defaults to the local dev server", () => {
  const s = readBookingSubmissionSettings(TEST_ENV);
  assert.equal(s.mode === "test" && s.allowedOrigin, "http://localhost:3000");
  const t = readBookingSubmissionSettings({ ...TEST_ENV, BOOKING_ALLOWED_ORIGIN: "http://127.0.0.1:3000/" });
  assert.equal(t.mode === "test" && t.allowedOrigin, "http://127.0.0.1:3000");
});
