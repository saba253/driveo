import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hardenAuthCookie, readSupabaseConfig } from "@/lib/supabase/config";

/**
 * Admin-only proxy: refreshes the Supabase session cookies before admin pages
 * render (Server Components cannot write cookies) and marks every admin
 * response as private and non-indexable.
 *
 * This is NOT the authorization boundary — every admin page and action checks
 * access itself (src/server/admin-auth.ts), and the database checks again.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const result = readSupabaseConfig(process.env);
  if (result.ok) {
    const secure = process.env.NODE_ENV === "production";
    const supabase = createServerClient(result.config.url, result.config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, hardenAuthCookie(options, secure));
        },
      },
    });
    // Validates the token with the Auth server and rotates it if needed.
    await supabase.auth.getUser();
  }

  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
