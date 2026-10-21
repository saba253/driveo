import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to the request's auth cookies, acting as
 * the signed-in user (anon key + user JWT): every query runs under RLS.
 *
 * Deliberately NO service-role client in this step: booking submission and
 * notification workers are not enabled. When added, the service-role key must
 * stay server-only (never NEXT_PUBLIC_) and is only able to call the functions
 * granted to service_role (see supabase/migrations/*_security.sql).
 */

export type SupabaseConfig = { url: string; anonKey: string };

export function readSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || !/^https:\/\/[a-z0-9.-]+$/i.test(url.replace(/\/$/, ""))) return null;
  return { url: url.replace(/\/$/, ""), anonKey };
}

export async function createSupabaseServerClient(config: SupabaseConfig): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; proxy.ts refreshes them.
        }
      },
    },
  });
}
