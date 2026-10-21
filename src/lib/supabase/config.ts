/**
 * Supabase connection settings — pure, so the safety rules are unit-tested.
 *
 * DRIVEO never uses Supabase from the browser, so the URL and publishable key
 * are server-only variables (no NEXT_PUBLIC_ prefix): nothing Supabase-related
 * is shipped in client bundles. Secret / service_role keys are refused here so
 * one can never be used as the user-session key by mistake.
 */

export type SupabaseConfig = { url: string; publishableKey: string };

export type SupabaseConfigResult =
  | { ok: true; config: SupabaseConfig }
  | { ok: false; reason: "missing" | "invalid_url" | "secret_key_as_publishable" | "secret_in_public_env" | "production_not_enabled" };

const PROJECT_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;

/** True for any key that carries service_role power (new secret keys or legacy service_role JWTs). */
export function looksLikeSecretKey(value: string): boolean {
  const v = value.trim();
  if (v.startsWith("sb_secret_")) return true;
  const parts = v.split(".");
  if (parts.length === 3 && v.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown };
      return payload.role === "service_role";
    } catch {
      return false;
    }
  }
  return false;
}

/** The project ref from a hosted project URL, e.g. https://<ref>.supabase.co. */
export function projectRefOf(url: string): string | null {
  return PROJECT_URL.exec(url.trim().replace(/\/$/, ""))?.[1] ?? null;
}

export function readSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfigResult {
  // A secret in any NEXT_PUBLIC_ variable would be inlined into browser bundles.
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && value && looksLikeSecretKey(value)) return { ok: false, reason: "secret_in_public_env" };
  }

  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return { ok: false, reason: "missing" };
  if (!projectRefOf(url)) return { ok: false, reason: "invalid_url" };
  if (looksLikeSecretKey(publishableKey)) return { ok: false, reason: "secret_key_as_publishable" };

  // Production admin login stays off until persistent rate limiting and CAPTCHA
  // are in place (docs/supabase-setup.md §8). Development projects are unaffected.
  if (env.NODE_ENV === "production" && env.ADMIN_AUTH_PRODUCTION_ENABLED !== "true") {
    return { ok: false, reason: "production_not_enabled" };
  }
  return { ok: true, config: { url, publishableKey } };
}

/** Admin sessions are server-only and short-lived in the browser. */
export const ADMIN_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

export type CookieOptionsLike = {
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  path?: string;
  domain?: string;
};

/**
 * Hardens the cookie options @supabase/ssr asks for: HttpOnly (no browser
 * script needs the tokens), Secure outside local development, SameSite=Lax,
 * and at most 12 hours instead of the library default of 400 days.
 * Removals (maxAge 0) are passed through unchanged.
 */
export function hardenAuthCookie<T extends CookieOptionsLike>(options: T | undefined, secure: boolean): T & CookieOptionsLike {
  const o = { ...(options ?? {}) } as T & CookieOptionsLike;
  o.httpOnly = true;
  o.secure = secure;
  o.sameSite = "lax";
  o.path = "/";
  if (o.maxAge !== 0) {
    o.maxAge = Math.min(o.maxAge ?? ADMIN_COOKIE_MAX_AGE_SECONDS, ADMIN_COOKIE_MAX_AGE_SECONDS);
    delete o.expires;
  }
  return o;
}
