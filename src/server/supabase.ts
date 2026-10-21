import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { hardenAuthCookie, readSupabaseConfig, type SupabaseConfig } from "@/lib/supabase/config";

/**
 * Server-side Supabase client bound to the request's auth cookies, acting as
 * the signed-in user (publishable key + user JWT): every query runs under RLS.
 *
 * Deliberately NO secret-key (service_role) client in this step: booking
 * submission and notification workers are not enabled. When added, the secret
 * key must stay server-only (SUPABASE_SECRET_KEY, never NEXT_PUBLIC_) and can
 * only call the functions granted to service_role.
 */

export type { SupabaseConfig };

export function supabaseConfig(): SupabaseConfig | null {
  const result = readSupabaseConfig(process.env);
  return result.ok ? result.config : null;
}

export const secureCookies = () => process.env.NODE_ENV === "production";

export async function createSupabaseServerClient(config: SupabaseConfig): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, hardenAuthCookie(options, secureCookies()));
        } catch {
          // Called from a Server Component, where cookies are read-only; proxy.ts refreshes them.
        }
      },
    },
  });
}
