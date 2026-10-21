import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLiveTarget } from "./live-target.ts";

const REF = "abcdefghijklmnopqrst";
const ok = { SUPABASE_URL: `https://${REF}.supabase.co`, DRIVEO_LIVE_TARGET: "development", DRIVEO_LIVE_PROJECT_REF: REF };

test("runs only against an explicitly confirmed development project", () => {
  assert.deepEqual(checkLiveTarget(ok), { ok: true, url: ok.SUPABASE_URL, projectRef: REF });
});

test("refuses without confirmation, with a mismatched ref, in production, or against the production project", () => {
  assert.equal(checkLiveTarget({ ...ok, DRIVEO_LIVE_TARGET: undefined }).ok, false);
  assert.equal(checkLiveTarget({ ...ok, DRIVEO_LIVE_TARGET: "production" }).ok, false);
  assert.equal(checkLiveTarget({ ...ok, DRIVEO_LIVE_PROJECT_REF: "zzzzzzzzzzzzzzzzzzzz" }).ok, false);
  assert.equal(checkLiveTarget({ ...ok, NODE_ENV: "production" }).ok, false);
  assert.equal(checkLiveTarget({ ...ok, DRIVEO_PRODUCTION_PROJECT_REF: REF }).ok, false);
  assert.equal(checkLiveTarget({ ...ok, SUPABASE_URL: "https://example.com" }).ok, false);
});
