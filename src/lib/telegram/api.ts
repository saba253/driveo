/**
 * Minimal client for the official Telegram Bot API (https://core.telegram.org/bots/api).
 * Only the four methods DRIVEO needs. One attempt per call: no automatic retries,
 * so a message can never be duplicated by this layer.
 *
 * Errors carry a short code only. The token (which is part of every request
 * URL), the URL and Telegram's free-text descriptions never appear in them.
 */

export type TelegramFailure = {
  ok: false;
  /** api_error: Telegram answered and refused. Others: the outcome is unknown. */
  kind: "api_error" | "timeout" | "network" | "bad_response";
  status: number | null;
  code: string;
};
export type TelegramResult<T> = { ok: true; result: T } | TelegramFailure;

export type TelegramUser = { id: number; is_bot: boolean; username?: string; can_join_groups?: boolean };
export type TelegramChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  forward_origin?: unknown;
  forward_date?: number;
  via_bot?: TelegramUser;
};
export type TelegramUpdate = { update_id: number; message?: TelegramMessage };

export type TelegramApi = {
  getMe(): Promise<TelegramResult<TelegramUser>>;
  getUpdates(opts: { offset?: number; limit?: number }): Promise<TelegramResult<TelegramUpdate[]>>;
  getChat(chatId: number): Promise<TelegramResult<TelegramChat>>;
  sendMessage(chatId: number, text: string): Promise<TelegramResult<{ message_id: number }>>;
};

/** A refusal that proves nothing was delivered (4xx answer from Telegram). */
export const definitelyNotDelivered = (f: TelegramFailure) => f.kind === "api_error" && f.status !== null && f.status >= 400 && f.status < 500;

export function createTelegramApi(opts: { token: string; fetch?: typeof fetch; timeoutMs?: number }): TelegramApi {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function call<T>(method: string, params: Record<string, unknown>): Promise<TelegramResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`https://api.telegram.org/bot${opts.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return { ok: false, kind: aborted ? "timeout" : "network", status: null, code: aborted ? "telegram_timeout" : "telegram_network" };
    } finally {
      clearTimeout(timer);
    }
    type Body = { ok?: unknown; result?: unknown; error_code?: unknown } | null;
    const body: Body = await res.json().then(
      (v: unknown) => (v && typeof v === "object" ? (v as Body) : null),
      () => null,
    );
    if (body && body.ok === true) return { ok: true, result: body.result as T };
    if (body && body.ok === false) {
      const code = typeof body.error_code === "number" ? body.error_code : res.status;
      return { ok: false, kind: "api_error", status: res.status, code: `telegram_${code}` };
    }
    return { ok: false, kind: "bad_response", status: res.status, code: `telegram_http_${res.status}` };
  }

  return {
    getMe: () => call<TelegramUser>("getMe", {}),
    getUpdates: ({ offset, limit = 100 }) =>
      call<TelegramUpdate[]>("getUpdates", { ...(offset !== undefined ? { offset } : {}), limit, timeout: 0, allowed_updates: ["message"] }),
    getChat: (chatId) => call<TelegramChat>("getChat", { chat_id: chatId }),
    sendMessage: (chatId, text) =>
      call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
  };
}
