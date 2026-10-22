import "server-only";

import { createTelegramApi } from "@/lib/telegram/api";
import { readTelegramSettings, type TelegramSettings } from "@/lib/telegram/config";
import { createTelegramAdminService, type TelegramAdminService, type TelegramLog } from "@/lib/telegram/service";
import { requireAdmin } from "./admin-auth";

/**
 * Server wiring for the founder-only Telegram flows (Step 1.7E.1). The bot
 * token is read here and nowhere else; it never reaches the browser.
 * Every service instance is bound to the calling admin's verified session.
 */

/** Codes only. Never tokens, chat ids or message text. */
const log: TelegramLog = (event, detail) => console.warn(`[telegram] ${event}${detail ? ` ${JSON.stringify(detail)}` : ""}`);

export function telegramSettings(): TelegramSettings {
  return readTelegramSettings(process.env);
}

/** null when Telegram is not configured or the session id cannot be verified. Redirects non-admins. */
export async function telegramServiceForAdmin(): Promise<TelegramAdminService | null> {
  const settings = telegramSettings();
  const { supabase } = await requireAdmin();
  if (!settings.ok) return null;
  const { data } = await supabase.auth.getClaims();
  const sessionId = typeof data?.claims?.session_id === "string" ? data.claims.session_id : null;
  if (!sessionId) return null;
  return createTelegramAdminService({
    api: createTelegramApi({ token: settings.token }),
    rpc: (fn, args) => supabase.rpc(fn, args),
    token: settings.token,
    sessionId,
    testSendAllowed: settings.testSendAllowed,
    log,
  });
}
