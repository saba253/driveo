import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_COOKIE_MAX_AGE_SECONDS, hardenAuthCookie, looksLikeSecretKey, projectRefOf, readSupabaseConfig } from "./config.ts";

const URL_OK = "https://abcdefghijklmnopqrst.supabase.co";
const PUBLISHABLE = "sb_publishable_test_not_a_real_key";
const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

test("valid server-only configuration is accepted", () => {
  assert.deepEqual(readSupabaseConfig({ SUPABASE_URL: `${URL_OK}/`, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }), {
    ok: true,
    config: { url: URL_OK, publishableKey: PUBLISHABLE },
  });
});

test("missing values mean not configured", () => {
  assert.deepEqual(readSupabaseConfig({}), { ok: false, reason: "missing" });
  assert.deepEqual(readSupabaseConfig({ SUPABASE_URL: URL_OK }), { ok: false, reason: "missing" });
});

test("only hosted https project URLs are accepted", () => {
  for (const url of ["http://abcdefghijklmnopqrst.supabase.co", "https://evil.example.com", "https://abc.supabase.co"]) {
    assert.deepEqual(readSupabaseConfig({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }), { ok: false, reason: "invalid_url" }, url);
  }
  assert.equal(projectRefOf(URL_OK), "abcdefghijklmnopqrst");
});

test("secret and service_role keys are refused as the session key", () => {
  for (const key of ["sb_secret_xyz", jwt({ role: "service_role" })]) {
    assert.equal(looksLikeSecretKey(key), true);
    assert.deepEqual(readSupabaseConfig({ SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: key }), { ok: false, reason: "secret_key_as_publishable" });
  }
  assert.equal(looksLikeSecretKey(jwt({ role: "anon" })), false);
  assert.equal(looksLikeSecretKey(PUBLISHABLE), false);
});

test("a secret in any NEXT_PUBLIC_ variable blocks everything", () => {
  const env = { SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, NEXT_PUBLIC_SUPABASE_KEY: "sb_secret_oops" };
  assert.deepEqual(readSupabaseConfig(env), { ok: false, reason: "secret_in_public_env" });
});

test("production admin login is off unless explicitly enabled", () => {
  const base = { SUPABASE_URL: URL_OK, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, NODE_ENV: "production" };
  assert.deepEqual(readSupabaseConfig(base), { ok: false, reason: "production_not_enabled" });
  assert.equal(readSupabaseConfig({ ...base, ADMIN_AUTH_PRODUCTION_ENABLED: "yes" }).ok, false);
  assert.equal(readSupabaseConfig({ ...base, ADMIN_AUTH_PRODUCTION_ENABLED: "true" }).ok, true);
});

test("auth cookies are HttpOnly, Lax, Secure when asked, and capped at 12 hours", () => {
  const set = hardenAuthCookie({ maxAge: 400 * 24 * 3600, httpOnly: false, sameSite: "none" as const, expires: new Date(0) }, true);
  assert.deepEqual(set, { maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS, httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  assert.equal(hardenAuthCookie({ maxAge: 60 }, false).maxAge, 60);
  assert.equal(hardenAuthCookie({ maxAge: 0 }, true).maxAge, 0); // removals pass through
  assert.equal(hardenAuthCookie(undefined, false).maxAge, ADMIN_COOKIE_MAX_AGE_SECONDS);
});
