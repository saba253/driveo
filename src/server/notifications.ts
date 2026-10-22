import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createBookingNotificationWorker, type WorkerLog, type WorkerRunResult } from "@/lib/notifications/booking-worker";
import { readWorkerSettings } from "@/lib/notifications/worker-settings";
import { createTelegramApi } from "@/lib/telegram/api";

/**
 * Server wiring for the booking notification worker (Step 1.7E.2).
 * OFF unless BOOKING_NOTIFICATIONS=telegram with all settings valid, and even
 * then it runs only when the protected endpoint is called with the secret.
 * Secret key, bot token and worker secret never leave the server.
 */

/** Codes and counts only. Never chat ids, tokens, payloads or message text. */
const log: WorkerLog = (event, detail) => console.warn(`[notify] ${event}${detail ? ` ${JSON.stringify(detail)}` : ""}`);

export function notificationWorker(): { secret: string | null; run: (() => Promise<WorkerRunResult>) | null } {
  const settings = readWorkerSettings(process.env);
  if (!settings.enabled) return { secret: null, run: null };
  const client = createClient(settings.supabaseUrl, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const worker = createBookingNotificationWorker({
    enabled: true,
    rpc: (fn, args) => client.rpc(fn, args),
    api: createTelegramApi({ token: settings.botToken }),
    adminUrl: settings.adminUrl,
    log,
  });
  return { secret: settings.workerSecret, run: () => worker.run() };
}
