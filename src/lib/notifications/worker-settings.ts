/**
 * Server-side switch for the booking notification worker. OFF unless
 * BOOKING_NOTIFICATIONS is exactly "telegram" AND every required server-only
 * setting is valid. Refused in production for now (like the admin login).
 *
 *  BOOKING_NOTIFICATIONS        "telegram" enables delivery; anything else = off
 *  NOTIFICATIONS_WORKER_SECRET  32+ chars; required to trigger a worker run
 *  SUPABASE_URL / SUPABASE_SECRET_KEY / TELEGRAM_BOT_TOKEN  existing settings
 *  DRIVEO_APP_URL               optional; admin link only if it is a clean origin
 *
 * Nothing schedules the worker: a run happens only when the protected endpoint
 * is called with the secret.
 */
import { adminDashboardUrl } from "../telegram/booking-message.ts";
import { readTelegramSettings } from "../telegram/config.ts";
import { looksLikeSecretKey, projectRefOf } from "../supabase/config.ts";

export type WorkerSettings =
  | { enabled: false; reason: "off" | "unknown_mode" | "not_allowed_in_production" | "misconfigured" }
  | { enabled: true; supabaseUrl: string; secretKey: string; botToken: string; workerSecret: string; adminUrl: string | null };

export function readWorkerSettings(env: Record<string, string | undefined>): WorkerSettings {
  const flag = env.BOOKING_NOTIFICATIONS?.trim() ?? "";
  if (flag === "" || flag === "off") return { enabled: false, reason: "off" };
  if (flag !== "telegram") return { enabled: false, reason: "unknown_mode" };
  if (env.NODE_ENV === "production") return { enabled: false, reason: "not_allowed_in_production" };

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const secretKey = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const workerSecret = env.NOTIFICATIONS_WORKER_SECRET?.trim() ?? "";
  const telegram = readTelegramSettings(env);
  if (!projectRefOf(supabaseUrl) || !looksLikeSecretKey(secretKey) || workerSecret.length < 32 || !telegram.ok) {
    return { enabled: false, reason: "misconfigured" };
  }
  return { enabled: true, supabaseUrl, secretKey, botToken: telegram.token, workerSecret, adminUrl: adminDashboardUrl(env.DRIVEO_APP_URL) };
}
