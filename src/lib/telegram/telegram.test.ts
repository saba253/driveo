import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelegramApi, definitelyNotDelivered, type TelegramUpdate } from "./api.ts";
import { readTelegramSettings } from "./config.ts";
import { TELEGRAM_TEST_MESSAGE, pairingCodeMessage } from "./messages.ts";
import { deepLink, findPairingStart, keyedHash, nextOffset, pairingCode, startToken } from "./pairing.ts";
import { FAKE_BOT_TOKEN, OTHER_FAKE_BOT_TOKEN } from "./test-fixtures.ts";

// Fictional token in the right format (not a real bot).
const TOKEN = FAKE_BOT_TOKEN;

test("settings: off without a token, refused for malformed tokens, in production, or in a NEXT_PUBLIC_ variable", () => {
  assert.deepEqual(readTelegramSettings({}), { ok: false, reason: "missing" });
  assert.deepEqual(readTelegramSettings({ TELEGRAM_BOT_TOKEN: "abc" }), { ok: false, reason: "invalid_token" });
  assert.deepEqual(readTelegramSettings({ TELEGRAM_BOT_TOKEN: TOKEN, NODE_ENV: "production" }), { ok: false, reason: "production_not_enabled" });
  assert.deepEqual(readTelegramSettings({ TELEGRAM_BOT_TOKEN: TOKEN, NEXT_PUBLIC_BOT: TOKEN }), { ok: false, reason: "token_in_public_env" });
  assert.deepEqual(readTelegramSettings({ TELEGRAM_BOT_TOKEN: TOKEN }), { ok: true, token: TOKEN, testSendAllowed: false });
  const s = readTelegramSettings({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_TEST_SEND: "once" });
  assert.equal(s.ok && s.testSendAllowed, true);
  const t = readTelegramSettings({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_TEST_SEND: "yes" });
  assert.equal(t.ok && t.testSendAllowed, false);
});

test("the test message is exactly the approved text and contains no customer data", () => {
  assert.equal(
    TELEGRAM_TEST_MESSAGE,
    ["🚗 DRIVEO — TEST", "✅ Telegram connection successful.", "This is a test notification.", "No real booking has been created."].join("\n"),
  );
  assert.equal(TELEGRAM_TEST_MESSAGE.split("\n").length, 4);
  assert.match(pairingCodeMessage("042731"), /042731/);
});

function fakeFetch(handler: (url: string, body: Record<string, unknown>) => Response | Promise<Response>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(url), body });
    return handler(String(url), body);
  }) as typeof fetch;
  return { f, calls };
}

test("api: calls the official endpoint once, and never puts the token in an error", async () => {
  const { f, calls } = fakeFetch(() => Response.json({ ok: true, result: { message_id: 7 } }));
  const api = createTelegramApi({ token: TOKEN, fetch: f });
  const r = await api.sendMessage(42, "hi");
  assert.deepEqual(r, { ok: true, result: { message_id: 7 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(calls[0].body.chat_id, 42);

  const refused = createTelegramApi({ token: TOKEN, fetch: fakeFetch(() => Response.json({ ok: false, error_code: 403, description: `Forbidden: bot ${TOKEN} was blocked by the user` }, { status: 403 })).f });
  const e = await refused.sendMessage(42, "hi");
  assert.deepEqual(e, { ok: false, kind: "api_error", status: 403, code: "telegram_403" });
  assert.ok(!e.ok && definitelyNotDelivered(e));
  assert.doesNotMatch(JSON.stringify(e), /TEST-ONLY|blocked|api\.telegram/);

  const server = createTelegramApi({ token: TOKEN, fetch: fakeFetch(() => new Response("oops", { status: 502 })).f });
  const s = await server.sendMessage(42, "hi");
  assert.deepEqual(s, { ok: false, kind: "bad_response", status: 502, code: "telegram_http_502" });
  assert.ok(!s.ok && !definitelyNotDelivered(s));
});

test("api: timeouts and network errors are reported as unknown outcomes, without retrying", async () => {
  let calls = 0;
  const hanging = (async (_url: unknown, init?: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  }) as typeof fetch;
  const r = await createTelegramApi({ token: TOKEN, fetch: hanging, timeoutMs: 20 }).sendMessage(1, "x");
  assert.deepEqual(r, { ok: false, kind: "timeout", status: null, code: "telegram_timeout" });
  assert.equal(calls, 1);
  assert.ok(!r.ok && !definitelyNotDelivered(r));
  const broken = (async () => {
    throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/x`);
  }) as typeof fetch;
  const n = await createTelegramApi({ token: TOKEN, fetch: broken }).getMe();
  assert.deepEqual(n, { ok: false, kind: "network", status: null, code: "telegram_network" });
});

const CHALLENGE = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const STARTED = new Date("2026-10-22T10:00:00Z");
const at = (s: number) => Math.floor(STARTED.getTime() / 1000) + s;
const msg = (over: Partial<NonNullable<TelegramUpdate["message"]>> = {}, updateId = 1): TelegramUpdate => ({
  update_id: updateId,
  message: {
    message_id: 1,
    date: at(30),
    chat: { id: 555000111, type: "private" },
    from: { id: 555000111, is_bot: false },
    text: `/start ${startToken(CHALLENGE)}`,
    ...over,
  },
});

test("pairing: only '/start <challenge>' typed by a person in their own private chat matches", () => {
  const opts = { challengeId: CHALLENGE, notBefore: STARTED };
  assert.deepEqual(findPairingStart([msg()], opts), { chatId: 555000111 });
  const rejected: TelegramUpdate[] = [
    msg({ chat: { id: -100123, type: "supergroup" } }),
    msg({ chat: { id: -42, type: "group" } }),
    msg({ chat: { id: -100999, type: "channel" } }),
    msg({ chat: { id: -5, type: "private" } }),
    msg({ from: { id: 555000111, is_bot: true } }),
    msg({ from: { id: 999, is_bot: false } }),
    msg({ text: "/start wrongtoken" }),
    msg({ text: `/start ${startToken(CHALLENGE)} extra` }),
    msg({ date: at(-3600) }),
    msg({ forward_origin: { type: "user" } }),
    msg({ via_bot: { id: 1, is_bot: true } }),
    { update_id: 9 },
  ];
  for (const u of rejected) assert.equal(findPairingStart([u], opts), null, JSON.stringify(u));
  assert.deepEqual(findPairingStart([...rejected, msg({}, 20)], opts), { chatId: 555000111 });
  assert.equal(nextOffset([msg({}, 5), msg({}, 12)]), 13);
  assert.equal(nextOffset([]), undefined);
});

test("pairing: deep links, codes and keyed hashes", () => {
  assert.equal(deepLink("driveo_alerts_bot", CHALLENGE), `https://t.me/driveo_alerts_bot?start=${startToken(CHALLENGE)}`);
  assert.equal(deepLink("not a bot", CHALLENGE), null);
  assert.equal(deepLink("driveo_alerts", CHALLENGE), null); // bot usernames end in "bot"
  assert.match(startToken(CHALLENGE), /^[0-9a-f]{32}$/);
  assert.equal(pairingCode(() => 42), "000042");
  assert.match(pairingCode(), /^\d{6}$/);
  const h = keyedHash(TOKEN, "chat", "555000111");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, keyedHash(OTHER_FAKE_BOT_TOKEN, "chat", "555000111"));
  assert.notEqual(h, keyedHash(TOKEN, "session", "555000111"));
});
