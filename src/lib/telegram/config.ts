/**
 * Telegram settings — server-only environment, validated here so the rules are
 * unit-tested. The bot token never has a NEXT_PUBLIC_ name, never reaches the
 * browser, and is never logged.
 *
 *  TELEGRAM_BOT_TOKEN   founder's bot token from @BotFather (enables pairing)
 *  TELEGRAM_TEST_SEND   "once" allows exactly one standalone test message per
 *                       verified recipient; anything else (default) forbids it
 *
 * Production stays off for now, like the admin login itself.
 */

export const BOT_TOKEN_PATTERN = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;
const TOKEN_ANYWHERE = /\d{6,12}:[A-Za-z0-9_-]{30,64}/;

export type TelegramSettings =
  | { ok: true; token: string; testSendAllowed: boolean }
  | { ok: false; reason: "missing" | "invalid_token" | "token_in_public_env" | "production_not_enabled" };

export function readTelegramSettings(env: Record<string, string | undefined>): TelegramSettings {
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && value && TOKEN_ANYWHERE.test(value)) return { ok: false, reason: "token_in_public_env" };
  }
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (!token) return { ok: false, reason: "missing" };
  if (!BOT_TOKEN_PATTERN.test(token)) return { ok: false, reason: "invalid_token" };
  if (env.NODE_ENV === "production") return { ok: false, reason: "production_not_enabled" };
  return { ok: true, token, testSendAllowed: env.TELEGRAM_TEST_SEND?.trim() === "once" };
}
