import { test } from "node:test";
import assert from "node:assert/strict";
import { adminRedirectFor, canAddBackupFactor, decideAdminAccess, normalizeTotpCode, type AdminAccessFacts } from "./admin-access.ts";

const full: AdminAccessFacts = {
  configured: true,
  userId: "00000000-0000-4000-8000-000000000001",
  currentLevel: "aal2",
  verifiedTotpFactors: 1,
  adminRecord: { isActive: true },
};

test("only an active admin at AAL2 with a verified factor gets access", () => {
  assert.deepEqual(decideAdminAccess(full), { kind: "ok", userId: full.userId });
});

test("missing configuration is reported before anything else", () => {
  assert.equal(decideAdminAccess({ ...full, configured: false }).kind, "not_configured");
});

test("no verified user means signed out", () => {
  assert.equal(decideAdminAccess({ ...full, userId: null }).kind, "signed_out");
});

test("AAL1 is never enough", () => {
  assert.equal(decideAdminAccess({ ...full, currentLevel: "aal1" }).kind, "needs_mfa_challenge");
  assert.equal(decideAdminAccess({ ...full, currentLevel: null }).kind, "needs_mfa_challenge");
});

test("an admin without a verified factor must enroll first", () => {
  assert.equal(decideAdminAccess({ ...full, verifiedTotpFactors: 0, currentLevel: "aal1" }).kind, "needs_mfa_enrollment");
});

test("non-admins and deactivated admins are denied and never offered MFA enrollment", () => {
  for (const adminRecord of [null, { isActive: false }]) {
    for (const verifiedTotpFactors of [0, 1]) {
      for (const currentLevel of ["aal1", "aal2"] as const) {
        assert.equal(decideAdminAccess({ ...full, adminRecord, verifiedTotpFactors, currentLevel }).kind, "not_admin");
      }
    }
  }
});

test("each state is routed to exactly one page", () => {
  assert.equal(adminRedirectFor({ kind: "signed_out" }, "dashboard"), "/admin/login");
  assert.equal(adminRedirectFor({ kind: "signed_out" }, "mfa"), "/admin/login");
  assert.equal(adminRedirectFor({ kind: "signed_out" }, "login"), null);
  assert.equal(adminRedirectFor({ kind: "needs_mfa_challenge" }, "dashboard"), "/admin/mfa");
  assert.equal(adminRedirectFor({ kind: "needs_mfa_enrollment" }, "login"), "/admin/mfa");
  assert.equal(adminRedirectFor({ kind: "needs_mfa_enrollment" }, "mfa"), null);
  assert.equal(adminRedirectFor({ kind: "ok", userId: "x" }, "login"), "/admin");
  assert.equal(adminRedirectFor({ kind: "ok", userId: "x" }, "dashboard"), null);
  assert.equal(adminRedirectFor({ kind: "not_configured" }, "dashboard"), "/admin/login");
});

test("TOTP codes: exactly six digits", () => {
  assert.equal(normalizeTotpCode("123 456"), "123456");
  assert.equal(normalizeTotpCode("12345"), null);
  assert.equal(normalizeTotpCode("12345a"), null);
  assert.equal(normalizeTotpCode(123456), null);
});

test("a backup factor can be added only at AAL2 by an active admin with exactly one factor", () => {
  const ok = { kind: "ok", userId: "x" } as const;
  assert.equal(canAddBackupFactor(ok, 1), true);
  assert.equal(canAddBackupFactor(ok, 2), false);
  assert.equal(canAddBackupFactor(ok, 0), false);
  for (const kind of ["needs_mfa_challenge", "needs_mfa_enrollment", "not_admin", "signed_out", "not_configured"] as const) {
    assert.equal(canAddBackupFactor({ kind }, 1), false, kind);
  }
});
