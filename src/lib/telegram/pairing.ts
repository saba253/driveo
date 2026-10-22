/**
 * Pairing helpers (server-side). The founder proves control of a PRIVATE chat:
 * the bot receives "/start <challenge>" there, sends a one-time code back to
 * that chat, and the founder types the code into the same admin session.
 * The browser never supplies a chat id.
 */
import { createHmac, randomInt } from "node:crypto";
import type { TelegramUpdate } from "./api.ts";

/** Hex digest keyed by the bot token, so stored references are useless without it. */
export function keyedHash(token: string, purpose: "session" | "code" | "chat", value: string): string {
  return createHmac("sha256", token).update(`driveo.telegram.${purpose}:${value}`).digest("hex");
}

/** Telegram start parameters allow [A-Za-z0-9_-], up to 64 characters. */
export const startToken = (challengeId: string) => challengeId.replace(/-/g, "").toLowerCase();

const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function deepLink(botUsername: string, challengeId: string): string | null {
  if (!USERNAME.test(botUsername) || !/bot$/i.test(botUsername)) return null;
  return `https://t.me/${botUsername}?start=${startToken(challengeId)}`;
}

export const pairingCode = (rand: (max: number) => number = randomInt) => String(rand(1_000_000)).padStart(6, "0");

/**
 * The first update that is "/start <token>" typed by a person in their own
 * private chat with the bot, sent after the challenge started. Groups,
 * channels, bots, forwarded or relayed messages never match.
 */
export function findPairingStart(updates: readonly TelegramUpdate[], opts: { challengeId: string; notBefore: Date }): { chatId: number } | null {
  const expected = `/start ${startToken(opts.challengeId)}`;
  const earliest = Math.floor(opts.notBefore.getTime() / 1000) - 60;
  for (const u of updates) {
    const m = u.message;
    if (!m || !m.from) continue;
    if (m.chat.type !== "private" || m.chat.id <= 0) continue;
    if (m.from.is_bot || m.from.id !== m.chat.id) continue;
    if (m.forward_origin !== undefined || m.forward_date !== undefined || m.via_bot !== undefined) continue;
    if (m.date < earliest) continue;
    if ((m.text ?? "").trim() !== expected) continue;
    return { chatId: m.chat.id };
  }
  return null;
}

export const nextOffset = (updates: readonly TelegramUpdate[]) =>
  updates.length === 0 ? undefined : Math.max(...updates.map((u) => u.update_id)) + 1;
