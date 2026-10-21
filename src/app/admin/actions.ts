"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canAddBackupFactor, normalizeTotpCode } from "@/lib/auth/admin-access";
import { createRateLimiter } from "@/lib/routing/usage";
import { ka } from "@/content/ka";
import { getAdminContext } from "@/server/admin-auth";
import { createSupabaseServerClient, supabaseConfig } from "@/server/supabase";

/*
 * Admin Server Actions. Each one re-derives the caller's state on the server
 * (Server Actions are public HTTP endpoints) and only proceeds from the state it
 * belongs to. Errors shown to the user are generic: no account enumeration, no
 * provider messages.
 */

export type FormState = { error: string | null };

const t = ka.admin;

// Supabase Auth rate-limits by IP, but these calls come from our server's IP, so the
// app limits attempts itself. In-memory = per server instance; a persistent limiter
// (consume_rate_limit) replaces this once the service-role worker exists.
const WINDOW_MS = 15 * 60_000;
const perClient = createRateLimiter({ limit: 5, windowMs: WINDOW_MS });
const overall = createRateLimiter({ limit: 30, windowMs: WINDOW_MS });

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

async function attemptAllowed(scope: string): Promise<boolean> {
  return perClient.check(`${scope}:${await clientKey()}`).allowed && overall.check(scope).allowed;
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const config = supabaseConfig();
  if (!config) return { error: t.notConfigured.title };
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password || email.length > 254 || password.length > 200) return { error: t.login.failed };
  if (!(await attemptAllowed("login"))) return { error: t.login.failed };

  const supabase = await createSupabaseServerClient(config);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: t.login.failed };
  // The MFA page decides: enroll, challenge, or deny.
  redirect("/admin/mfa");
}

export type EnrollmentState = { error: string | null; factorId?: string; qrCode?: string; secret?: string };

type Supabase = NonNullable<Awaited<ReturnType<typeof getAdminContext>>["supabase"]>;

async function beginTotpEnrollment(supabase: Supabase, friendlyName: string): Promise<EnrollmentState> {
  // Remove abandoned, never-verified factors so setup can be restarted safely.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName });
  if (error || !data) return { error: t.mfa.failed };
  return { error: null, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

async function completeTotpEnrollment(supabase: Supabase, prev: EnrollmentState, form: FormData): Promise<EnrollmentState | null> {
  const code = normalizeTotpCode(form.get("code"));
  const factorId = String(form.get("factorId") ?? "");
  if (!code) return { ...prev, error: t.mfa.invalidCode };
  if (!(await attemptAllowed("mfa"))) return { ...prev, error: t.mfa.invalidCode };

  // The factor must be this user's own pending TOTP factor.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const own = factors?.all.find((f) => f.id === factorId && f.factor_type === "totp" && f.status === "unverified");
  if (!own) return { error: t.mfa.failed };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ...prev, error: t.mfa.invalidCode };
  return null;
}

/** First-time TOTP setup. Only for an active admin who has NO verified factor yet. */
export async function startEnrollmentAction(): Promise<EnrollmentState> {
  const { access, supabase } = await getAdminContext();
  if (access.kind !== "needs_mfa_enrollment" || !supabase) return { error: t.mfa.failed };
  return beginTotpEnrollment(supabase, "DRIVEO admin");
}

export async function verifyEnrollmentAction(prev: EnrollmentState, form: FormData): Promise<EnrollmentState> {
  const { access, supabase } = await getAdminContext();
  if (access.kind !== "needs_mfa_enrollment" || !supabase) return { error: t.mfa.failed };
  const failed = await completeTotpEnrollment(supabase, prev, form);
  if (failed) return failed;
  redirect("/admin");
}

/** Backup authenticator on a second device. Only at AAL2, and only while exactly one factor exists. */
export async function startBackupEnrollmentAction(): Promise<EnrollmentState> {
  const { access, supabase, verifiedTotpFactors } = await getAdminContext();
  if (!canAddBackupFactor(access, verifiedTotpFactors) || !supabase) return { error: t.mfa.failed };
  return beginTotpEnrollment(supabase, "DRIVEO backup");
}

export async function verifyBackupEnrollmentAction(prev: EnrollmentState, form: FormData): Promise<EnrollmentState> {
  const { access, supabase, verifiedTotpFactors } = await getAdminContext();
  if (!canAddBackupFactor(access, verifiedTotpFactors) || !supabase) return { error: t.mfa.failed };
  const failed = await completeTotpEnrollment(supabase, prev, form);
  if (failed) return failed;
  redirect("/admin/security");
}

export async function verifyChallengeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { access, supabase } = await getAdminContext();
  if (access.kind !== "needs_mfa_challenge" || !supabase) return { error: t.mfa.failed };
  const code = normalizeTotpCode(form.get("code"));
  if (!code) return { error: t.mfa.invalidCode };
  if (!(await attemptAllowed("mfa"))) return { error: t.mfa.invalidCode };

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) return { error: t.mfa.failed };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: t.mfa.invalidCode };
  redirect("/admin");
}

/** Signs out everywhere: revokes all refresh tokens for this user, then clears cookies. */
export async function signOutAction(): Promise<void> {
  const config = supabaseConfig();
  if (config) {
    const supabase = await createSupabaseServerClient(config);
    await supabase.auth.signOut({ scope: "global" });
  }
  redirect("/admin/login");
}
