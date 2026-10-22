import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { adminRedirectFor, decideAdminAccess, type AdminAccess, type AuthLevel } from "@/lib/auth/admin-access";
import { createSupabaseServerClient, supabaseConfig } from "./supabase";

/**
 * Admin Data Access Layer. Every admin page and every admin Server Action calls
 * this; the proxy is not an authorization boundary. Results are never cached.
 */

export type AdminContext = { access: AdminAccess; supabase: SupabaseClient | null; verifiedTotpFactors: number };

export async function getAdminContext(): Promise<AdminContext> {
  // Admin data is per request and per session: never prerendered. This also keeps
  // the Supabase client (which reads the clock) out of the prerender pass.
  await connection();
  const config = supabaseConfig();
  if (!config) return { access: decideAdminAccess(emptyFacts(false)), supabase: null, verifiedTotpFactors: 0 };

  const supabase = await createSupabaseServerClient(config);
  // getUser() asks the Auth server to validate the token (a cookie alone is not trusted).
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userError ? null : (userData.user?.id ?? null);
  if (!userId) return { access: decideAdminAccess(emptyFacts(true)), supabase, verifiedTotpFactors: 0 };

  const [{ data: claimsData }, { data: factors }, { data: adminRow }] = await Promise.all([
    // The assurance level is read from the signature-verified JWT claims (the same
    // `aal` claim the database checks), never from the unverified session object.
    supabase.auth.getClaims(),
    supabase.auth.mfa.listFactors(),
    // RLS: before MFA a user can read only their own row; nothing else.
    supabase.from("admin_users").select("is_active").eq("user_id", userId).maybeSingle(),
  ]);

  const claims = claimsData?.claims;
  const aal = claims && claims.sub === userId ? claims.aal : null;
  const currentLevel = aal === "aal1" || aal === "aal2" ? (aal as AuthLevel) : null;
  const verifiedTotpFactors = factors?.totp.length ?? 0;
  return {
    access: decideAdminAccess({
      configured: true,
      userId,
      currentLevel,
      verifiedTotpFactors,
      adminRecord: adminRow ? { isActive: adminRow.is_active === true } : null,
    }),
    supabase,
    verifiedTotpFactors,
  };
}

function emptyFacts(configured: boolean) {
  return { configured, userId: null, currentLevel: null, verifiedTotpFactors: 0, adminRecord: null };
}

/** For pages: redirect anywhere else this state belongs, otherwise return the context. */
export async function routeAdminPage(page: "login" | "mfa" | "dashboard"): Promise<AdminContext> {
  const ctx = await getAdminContext();
  const target = adminRedirectFor(ctx.access, page);
  if (target) redirect(target);
  return ctx;
}

/** For actions that need a fully authorized admin (AAL2 + active admin row). */
export async function requireAdmin(): Promise<{ userId: string; supabase: SupabaseClient }> {
  const ctx = await getAdminContext();
  if (ctx.access.kind !== "ok" || !ctx.supabase) redirect(adminRedirectFor(ctx.access, "dashboard") ?? "/admin/login");
  return { userId: ctx.access.userId, supabase: ctx.supabase };
}
