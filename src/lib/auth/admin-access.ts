/**
 * Admin access decision — pure, so every branch is unit-tested. The server
 * gathers the facts (src/server/admin-auth.ts); this decides. The database
 * re-checks AAL2 + an active admin row on every read and every action, so a
 * bug here cannot by itself expose data.
 *
 * Order matters: a user who is not an admin is never offered MFA enrollment.
 */

export type AuthLevel = "aal1" | "aal2";

export type AdminAccessFacts = {
  /** Supabase URL and anon key are present. */
  configured: boolean;
  /** Verified by the Auth server (getUser), not just decoded from a cookie. */
  userId: string | null;
  /** Assurance level of the current session. */
  currentLevel: AuthLevel | null;
  /** Number of VERIFIED TOTP factors on the account. */
  verifiedTotpFactors: number;
  /** The user's own admin_users row, if any (readable before MFA via RLS). */
  adminRecord: { isActive: boolean } | null;
};

export type AdminAccess =
  | { kind: "not_configured" }
  | { kind: "signed_out" }
  | { kind: "not_admin" }
  | { kind: "needs_mfa_enrollment" }
  | { kind: "needs_mfa_challenge" }
  | { kind: "ok"; userId: string };

export function decideAdminAccess(f: AdminAccessFacts): AdminAccess {
  if (!f.configured) return { kind: "not_configured" };
  if (!f.userId) return { kind: "signed_out" };
  if (!f.adminRecord || !f.adminRecord.isActive) return { kind: "not_admin" };
  if (f.verifiedTotpFactors < 1) return { kind: "needs_mfa_enrollment" };
  if (f.currentLevel !== "aal2") return { kind: "needs_mfa_challenge" };
  return { kind: "ok", userId: f.userId };
}

/** Where each state belongs. `null` = render the requested admin page. */
export function adminRedirectFor(access: AdminAccess, page: "login" | "mfa" | "dashboard"): string | null {
  switch (access.kind) {
    case "not_configured":
      return page === "login" ? null : "/admin/login";
    case "signed_out":
    case "not_admin":
      return page === "login" ? null : "/admin/login";
    case "needs_mfa_enrollment":
    case "needs_mfa_challenge":
      return page === "mfa" ? null : "/admin/mfa";
    case "ok":
      return page === "dashboard" ? null : "/admin";
  }
}

/** A TOTP code as typed: 6 digits, spaces tolerated. */
export function normalizeTotpCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}
