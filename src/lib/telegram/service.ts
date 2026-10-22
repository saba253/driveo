/**
 * Founder-only Telegram flows, run by the server on behalf of an admin who is
 * signed in at AAL2. Database calls go through the admin's own session (the
 * admin_* functions re-check AAL2 + active admin); Telegram calls use the bot
 * token on the server. Dependencies are injected so everything is tested with
 * a mocked Telegram API and real PostgreSQL.
 *
 * Nothing here runs automatically: every Telegram call is a direct result of
 * the founder pressing a button in /admin/telegram.
 */
import { definitelyNotDelivered, type TelegramApi } from "./api.ts";
import { TELEGRAM_TEST_MESSAGE, pairingCodeMessage } from "./messages.ts";
import { deepLink, findPairingStart, keyedHash, nextOffset, pairingCode } from "./pairing.ts";

export type AdminRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
/** Event names and short codes only: never tokens, chat ids or message text. */
export type TelegramLog = (event: string, detail?: Record<string, string | number | boolean>) => void;

export type TelegramStatus = { paired: false } | { paired: true; verifiedAt: string; testSend: "claimed" | "sent" | "failed" | "unknown" | null };

export type StartResult =
  | { status: "started"; challengeId: string; deepLink: string; startedAt: string }
  | { status: "bot_allows_groups" | "bot_unavailable" | "not_authorized" | "failed" };
export type CheckResult = { status: "code_sent" | "waiting" | "expired" | "telegram_error" | "not_authorized" | "failed" };
export type VerifyResult = { status: "paired" | "invalid" | "not_authorized" | "failed" };
export type TestSendResult = {
  status: "sent" | "failed" | "unknown" | "already_sent" | "not_paired" | "not_private" | "not_authorized_by_flag" | "bot_allows_groups" | "bot_unavailable" | "not_authorized";
};

export function createTelegramAdminService(deps: {
  api: TelegramApi;
  rpc: AdminRpc;
  token: string;
  /** The Supabase session id of the signed-in admin (from verified JWT claims). */
  sessionId: string;
  testSendAllowed: boolean;
  log: TelegramLog;
  randomCode?: () => string;
}) {
  const binding = keyedHash(deps.token, "session", deps.sessionId);
  const denied = (e: { code?: string } | null) => e?.code === "42501";

  /** The bot must exist and must NOT be allowed into groups (BotFather → Allow Groups: off). */
  async function checkBot(): Promise<{ ok: true; username: string } | { ok: false; status: "bot_allows_groups" | "bot_unavailable" }> {
    const me = await deps.api.getMe();
    if (!me.ok || !me.result.is_bot || !me.result.username) {
      deps.log("telegram.bot_unavailable", { code: me.ok ? "not_a_bot" : me.code });
      return { ok: false, status: "bot_unavailable" };
    }
    if (me.result.can_join_groups !== false) {
      deps.log("telegram.bot_allows_groups");
      return { ok: false, status: "bot_allows_groups" };
    }
    return { ok: true, username: me.result.username };
  }

  return {
    async status(): Promise<TelegramStatus | null> {
      const { data, error } = await deps.rpc("admin_telegram_status", {});
      if (error) return null;
      const d = data as { paired?: boolean; verified_at?: string; test_send?: "claimed" | "sent" | "failed" | "unknown" | null } | null;
      if (!d?.paired) return { paired: false };
      return { paired: true, verifiedAt: String(d.verified_at), testSend: d.test_send ?? null };
    },

    async startPairing(): Promise<StartResult> {
      const bot = await checkBot();
      if (!bot.ok) return { status: bot.status };
      const { data, error } = await deps.rpc("admin_start_telegram_pairing", { p_session_binding_hash: binding });
      if (error) return { status: denied(error) ? "not_authorized" : "failed" };
      const challengeId = String(data);
      const link = deepLink(bot.username, challengeId);
      if (!link) return { status: "bot_unavailable" };
      deps.log("telegram.pairing_started");
      return { status: "started", challengeId, deepLink: link, startedAt: new Date().toISOString() };
    },

    /** Looks for "/start <challenge>" in a private chat; if found, sends the one-time code there. */
    async checkPairing(challengeId: string, startedAt: Date): Promise<CheckResult> {
      const updates = await deps.api.getUpdates({});
      if (!updates.ok) {
        deps.log("telegram.updates_failed", { code: updates.code });
        return { status: "telegram_error" };
      }
      const offset = nextOffset(updates.result);
      // Acknowledge what was read so it is not processed again (strangers' messages are simply dropped).
      if (offset !== undefined) await deps.api.getUpdates({ offset, limit: 1 });

      const match = findPairingStart(updates.result, { challengeId, notBefore: startedAt });
      if (!match) return { status: "waiting" };

      const code = (deps.randomCode ?? pairingCode)();
      const { data, error } = await deps.rpc("admin_attach_telegram_pairing_code", {
        p_challenge_id: challengeId,
        p_session_binding_hash: binding,
        p_code_hash: keyedHash(deps.token, "code", `${challengeId}:${code}`),
        p_chat_ref_hash: keyedHash(deps.token, "chat", String(match.chatId)),
        p_chat_id: match.chatId,
      });
      if (error) return { status: denied(error) ? "not_authorized" : "failed" };
      if (data !== true) return { status: "expired" };

      const sent = await deps.api.sendMessage(match.chatId, pairingCodeMessage(code));
      if (!sent.ok) {
        deps.log("telegram.code_send_failed", { code: sent.code });
        return { status: "telegram_error" };
      }
      deps.log("telegram.code_sent");
      return { status: "code_sent" };
    },

    async verifyPairing(challengeId: string, code: string): Promise<VerifyResult> {
      if (!/^\d{6}$/.test(code)) return { status: "invalid" };
      const { data, error } = await deps.rpc("admin_verify_telegram_pairing", {
        p_challenge_id: challengeId,
        p_session_binding_hash: binding,
        p_code_hash: keyedHash(deps.token, "code", `${challengeId}:${code}`),
      });
      if (error) return { status: denied(error) ? "not_authorized" : "failed" };
      if (typeof data !== "string") return { status: "invalid" };
      deps.log("telegram.paired");
      return { status: "paired" };
    },

    async revoke(): Promise<boolean> {
      const { data, error } = await deps.rpc("admin_revoke_telegram_recipient", {});
      return !error && data === true;
    },

    /** Exactly one standalone test message, only when the server flag allows it. Never retried. */
    async sendTestMessage(): Promise<TestSendResult> {
      if (!deps.testSendAllowed) return { status: "not_authorized_by_flag" };
      const bot = await checkBot();
      if (!bot.ok) return { status: bot.status };

      const target = await deps.rpc("admin_telegram_send_target", {});
      if (target.error) return { status: denied(target.error) ? "not_authorized" : "not_paired" };
      const row = (target.data as { recipient_id: string; chat_id: number | string }[] | null)?.[0];
      if (!row) return { status: "not_paired" };
      const chatId = Number(row.chat_id);

      // Re-confirm with Telegram that this is still a private chat before anything is claimed.
      const chat = await deps.api.getChat(chatId);
      if (!chat.ok || chat.result.type !== "private" || chat.result.id !== chatId) {
        deps.log("telegram.target_not_private", { code: chat.ok ? chat.result.type : chat.code });
        return { status: "not_private" };
      }

      const claim = await deps.rpc("admin_claim_telegram_test_send", {});
      if (claim.error) {
        if (claim.error.code === "DV009") return { status: "already_sent" };
        if (claim.error.code === "DV008") return { status: "not_paired" };
        return { status: denied(claim.error) ? "not_authorized" : "not_paired" };
      }
      const sendId = String(claim.data);

      const sent = await deps.api.sendMessage(chatId, TELEGRAM_TEST_MESSAGE);
      const outcome = sent.ok ? "sent" : definitelyNotDelivered(sent) ? "failed" : "unknown";
      await deps.rpc("admin_complete_telegram_test_send", {
        p_send_id: sendId,
        p_status: outcome,
        p_telegram_message_id: sent.ok ? sent.result.message_id : null,
        p_error_code: sent.ok ? null : sent.code,
      });
      deps.log("telegram.test_send", { outcome });
      return { status: outcome };
    },
  };
}

export type TelegramAdminService = ReturnType<typeof createTelegramAdminService>;
