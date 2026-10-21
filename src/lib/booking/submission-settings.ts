/**
 * Server-side feature flag for booking submissions. OFF unless
 * BOOKING_SUBMISSIONS is exactly "test" and everything it needs is present.
 *
 *  - "test": DEVELOPMENT only (refused when NODE_ENV=production). Bookings are
 *    marked as test submissions; use fictional data only.
 *  - There is deliberately no live/production mode yet: it requires approved
 *    Terms of Use and Privacy Policy versions, bot protection and the other
 *    blockers listed in docs/booking-submissions.md.
 */
import { looksLikeSecretKey, projectRefOf } from "../supabase/config.ts";

export type BookingSubmissionSettings =
  | { mode: "disabled"; reason: "off" | "not_allowed_in_production" | "misconfigured" | "unknown_mode" }
  | { mode: "test"; supabaseUrl: string; secretKey: string; hashSecret: string; allowedOrigin: string };

export function readBookingSubmissionSettings(env: Record<string, string | undefined>): BookingSubmissionSettings {
  const flag = env.BOOKING_SUBMISSIONS?.trim() ?? "";
  if (flag === "" || flag === "off") return { mode: "disabled", reason: "off" };
  if (flag !== "test") return { mode: "disabled", reason: "unknown_mode" };
  if (env.NODE_ENV === "production") return { mode: "disabled", reason: "not_allowed_in_production" };

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const secretKey = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const hashSecret = env.BOOKING_HASH_SECRET?.trim() ?? "";
  const allowedOrigin = (env.BOOKING_ALLOWED_ORIGIN?.trim() || "http://localhost:3000").replace(/\/$/, "");

  const publicSecret = Object.entries(env).some(([k, v]) => k.startsWith("NEXT_PUBLIC_") && !!v && looksLikeSecretKey(v));
  if (
    !projectRefOf(supabaseUrl) ||
    !looksLikeSecretKey(secretKey) ||
    hashSecret.length < 32 ||
    !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(allowedOrigin) ||
    publicSecret
  ) {
    return { mode: "disabled", reason: "misconfigured" };
  }
  return { mode: "test", supabaseUrl, secretKey, hashSecret, allowedOrigin };
}
