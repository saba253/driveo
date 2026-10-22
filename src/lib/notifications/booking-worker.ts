/**
 * Booking notification worker: delivers committed, REAL booking events from
 * the outbox to the founder's verified private Telegram chat.
 *
 * Flow per run:
 *  1. Exactly one active verified recipient must exist (else nothing is claimed).
 *  2. Telegram must confirm the bot cannot join groups and the chat is private.
 *  3. Claim a few FRESH pending events (claim_booking_notifications: never test
 *     events, never stale 'processing' ones; row locks stop concurrent workers).
 *  4. Send each message once — plain text, built only from the allowlisted payload.
 *  5. Record the attempt, then finish the event:
 *       accepted                 → sent_telegram
 *       429 (rate limited)       → retry later with backoff, at most MAX_ATTEMPTS
 *       other 4xx (refused)      → failed_all (definite; no retry)
 *       timeout / network / 5xx  → failed_all, NOT retried: Telegram may have
 *                                  delivered it, so a person decides (admin retry)
 *
 * Logs carry event names and short codes only — never chat ids, tokens or
 * message text.
 */
import { definitelyNotDelivered, type TelegramApi, type TelegramFailure } from "../telegram/api.ts";
import { bookingNotificationMessage, readBookingNotificationPayload } from "../telegram/booking-message.ts";

export type ServiceRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
export type WorkerLog = (event: string, detail?: Record<string, string | number | boolean>) => void;

export const WORKER_LIMITS = {
  batchSize: 5,
  lockSeconds: 120,
  /** Total Telegram attempts per event before giving up on rate limiting. */
  maxAttempts: 3,
  /** Backoff for 429: 60 s, 120 s, 240 s… capped. */
  baseBackoffSeconds: 60,
  maxBackoffSeconds: 900,
} as const;

export type WorkerRunResult =
  | { status: "disabled" }
  | { status: "no_recipient" | "ambiguous_recipient" | "recipient_not_private" | "bot_allows_groups" | "bot_unavailable" | "database_error" }
  | { status: "done"; claimed: number; sent: number; retrying: number; failed: number; uncertain: number };

export function backoffSeconds(attemptNo: number): number {
  return Math.min(WORKER_LIMITS.baseBackoffSeconds * 2 ** Math.max(0, attemptNo - 1), WORKER_LIMITS.maxBackoffSeconds);
}

type Outcome = "sent" | "retry" | "failed" | "uncertain";

export function classifyFailure(f: TelegramFailure): Exclude<Outcome, "sent"> {
  if (f.kind === "api_error" && f.status === 429) return "retry";
  if (definitelyNotDelivered(f)) return "failed";
  return "uncertain";
}

export function createBookingNotificationWorker(deps: {
  enabled: boolean;
  rpc: ServiceRpc;
  api: TelegramApi;
  adminUrl: string | null;
  log: WorkerLog;
}) {
  async function finish(eventId: string, outcome: Outcome, attemptsSoFar: number): Promise<Outcome> {
    if (outcome === "sent") {
      await deps.rpc("complete_notification_event", { p_event_id: eventId, p_outcome: "sent_telegram", p_retry_in_seconds: null });
      return "sent";
    }
    if (outcome === "retry" && attemptsSoFar < WORKER_LIMITS.maxAttempts) {
      await deps.rpc("complete_notification_event", { p_event_id: eventId, p_outcome: "retry", p_retry_in_seconds: backoffSeconds(attemptsSoFar) });
      return "retry";
    }
    await deps.rpc("complete_notification_event", { p_event_id: eventId, p_outcome: "failed_all", p_retry_in_seconds: null });
    return outcome === "uncertain" ? "uncertain" : "failed";
  }

  async function record(eventId: string, ok: boolean, messageId: number | null, status: number | null, code: string | null) {
    return deps.rpc("record_notification_attempt", {
      p_event_id: eventId,
      p_channel: "telegram",
      p_result: ok ? "accepted" : "failed",
      p_provider_message_id: messageId === null ? null : String(messageId),
      p_http_status: status,
      p_error_code: ok ? null : code,
      p_error_summary: null,
    });
  }

  return {
    async run(): Promise<WorkerRunResult> {
      if (!deps.enabled) return { status: "disabled" };

      const recipients = await deps.rpc("worker_telegram_recipient", {});
      if (recipients.error) {
        deps.log("notify.recipient_error", { code: recipients.error.code ?? "unknown" });
        return { status: "database_error" };
      }
      const rows = (recipients.data as { chat_id: number | string }[] | null) ?? [];
      if (rows.length === 0) return { status: "no_recipient" };
      if (rows.length > 1) {
        deps.log("notify.ambiguous_recipient", { count: rows.length });
        return { status: "ambiguous_recipient" };
      }
      const chatId = Number(rows[0].chat_id);
      if (!Number.isSafeInteger(chatId) || chatId <= 0) return { status: "recipient_not_private" };

      const me = await deps.api.getMe();
      if (!me.ok || !me.result.is_bot) return { status: "bot_unavailable" };
      if (me.result.can_join_groups !== false) return { status: "bot_allows_groups" };
      const chat = await deps.api.getChat(chatId);
      if (!chat.ok || chat.result.type !== "private" || chat.result.id !== chatId) {
        deps.log("notify.recipient_not_private", { code: chat.ok ? chat.result.type : chat.code });
        return { status: "recipient_not_private" };
      }

      const claim = await deps.rpc("claim_booking_notifications", { p_limit: WORKER_LIMITS.batchSize, p_lock_seconds: WORKER_LIMITS.lockSeconds });
      if (claim.error) {
        deps.log("notify.claim_error", { code: claim.error.code ?? "unknown" });
        return { status: "database_error" };
      }
      const events = (claim.data as { event_id: string; payload: unknown; attempts: number }[] | null) ?? [];
      const totals = { claimed: events.length, sent: 0, retrying: 0, failed: 0, uncertain: 0 };

      for (const ev of events) {
        const booking = readBookingNotificationPayload(ev.payload);
        let outcome: Outcome;
        if (!booking) {
          await record(ev.event_id, false, null, null, "payload_invalid");
          outcome = await finish(ev.event_id, "failed", WORKER_LIMITS.maxAttempts);
        } else {
          const sent = await deps.api.sendMessage(chatId, bookingNotificationMessage(booking, { adminUrl: deps.adminUrl }));
          if (sent.ok) {
            await record(ev.event_id, true, sent.result.message_id, 200, null);
            outcome = await finish(ev.event_id, "sent", ev.attempts + 1);
          } else {
            await record(ev.event_id, false, null, sent.status, sent.code);
            outcome = await finish(ev.event_id, classifyFailure(sent), ev.attempts + 1);
          }
        }
        if (outcome === "sent") totals.sent++;
        else if (outcome === "retry") totals.retrying++;
        else if (outcome === "uncertain") totals.uncertain++;
        else totals.failed++;
        deps.log("notify.event", { outcome });
      }
      return { status: "done", ...totals };
    },
  };
}
