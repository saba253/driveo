/**
 * Telegram pairing and the one-time test message, end to end against real
 * PostgreSQL (PGlite + all migrations) with a FAKE Telegram API. Nothing is
 * sent to Telegram and nothing touches a remote project.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import type { TelegramApi, TelegramResult, TelegramUpdate } from "../../src/lib/telegram/api.ts";
import { TELEGRAM_TEST_MESSAGE } from "../../src/lib/telegram/messages.ts";
import { startToken } from "../../src/lib/telegram/pairing.ts";
import { createTelegramAdminService, type AdminRpc } from "../../src/lib/telegram/service.ts";
import { ANON, as, createTestDb, createUser, q, SERVICE, sqlState, user, type Actor } from "./db.ts";

const TOKEN = "123456789:AAFakeTokenForTestsOnly_abcdefghijklmn";
const FOUNDER_CHAT = 555000111;

function rpcAs(db: PGlite, actor: Actor): AdminRpc {
  return async (fn, args) => {
    const names = Object.keys(args);
    const list = names.map((k, i) => `${k} => $${i + 1}`).join(", ");
    try {
      const rows = await as(db, actor, async (tx) => (await tx.query<{ r: unknown }>(`select * from public.${fn}(${list}) as r`, names.map((k) => args[k]))).rows);
      // Scalar functions return {r}; table functions return their columns.
      const data = rows.length === 1 && "r" in rows[0] ? rows[0].r : rows;
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { code: (e as { code?: string }).code } };
    }
  };
}

type Sent = { chatId: number; text: string };
function fakeTelegram(opts: { canJoinGroups?: boolean; chatType?: "private" | "group"; sendResult?: TelegramResult<{ message_id: number }> } = {}) {
  const sent: Sent[] = [];
  let pending: TelegramUpdate[] = [];
  let nextId = 1;
  const api: TelegramApi = {
    getMe: async () => ({ ok: true, result: { id: 1, is_bot: true, username: "driveo_founder_bot", can_join_groups: opts.canJoinGroups ?? false } }),
    getUpdates: async ({ offset }) => {
      if (offset !== undefined) pending = pending.filter((u) => u.update_id >= offset);
      return { ok: true, result: pending };
    },
    getChat: async (chatId) => ({ ok: true, result: { id: chatId, type: opts.chatType ?? "private" } }),
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
      // A forced failure applies to the test message only, so pairing still works.
      if (opts.sendResult && text === TELEGRAM_TEST_MESSAGE) return opts.sendResult;
      return { ok: true, result: { message_id: 100 + sent.length } };
    },
  };
  return {
    api,
    sent,
    /** Simulates the founder (or someone else) pressing Start in Telegram. */
    userSends(text: string, chat: { id: number; type: "private" | "group" | "supergroup" | "channel" } = { id: FOUNDER_CHAT, type: "private" }, fromId = chat.id) {
      pending.push({ update_id: nextId++, message: { message_id: nextId, date: Math.floor(Date.now() / 1000), chat, from: { id: fromId, is_bot: false }, text } });
    },
  };
}

function service(db: PGlite, actor: Actor, tg: ReturnType<typeof fakeTelegram>, o: { session?: string; testSendAllowed?: boolean; code?: string } = {}) {
  return createTelegramAdminService({
    api: tg.api,
    rpc: rpcAs(db, actor),
    token: TOKEN,
    sessionId: o.session ?? "session-a",
    testSendAllowed: o.testSendAllowed ?? true,
    log: () => {},
    randomCode: () => o.code ?? "123456",
  });
}

/** Full pairing as the founder. Returns the service for further use. */
async function pair(db: PGlite, admin: Actor, tg: ReturnType<typeof fakeTelegram>, o: { testSendAllowed?: boolean } = {}) {
  const svc = service(db, admin, tg, o);
  const started = await svc.startPairing();
  assert.equal(started.status, "started");
  if (started.status !== "started") throw new Error("not started");
  tg.userSends(`/start ${startToken(started.challengeId)}`);
  assert.deepEqual(await svc.checkPairing(started.challengeId, new Date(started.startedAt)), { status: "code_sent" });
  assert.deepEqual(await svc.verifyPairing(started.challengeId, "123456"), { status: "paired" });
  return svc;
}

describe("Telegram pairing (fake Telegram, real PostgreSQL)", () => {
  let db: PGlite;
  let admin: Actor;
  let adminId: string;
  before(async () => {
    db = await createTestDb();
    adminId = await createUser(db, { admin: true });
    admin = user(adminId, "aal2");
  });

  test("the founder pairs a private chat: code sent to that chat only, recipient stored, status hides the chat id", async () => {
    const tg = fakeTelegram();
    const svc = service(db, admin, tg);
    const started = await svc.startPairing();
    assert.equal(started.status, "started");
    if (started.status !== "started") return;
    assert.equal(started.deepLink, `https://t.me/driveo_founder_bot?start=${startToken(started.challengeId)}`);

    assert.deepEqual(await svc.checkPairing(started.challengeId, new Date(started.startedAt)), { status: "waiting" });
    tg.userSends(`/start ${startToken(started.challengeId)}`, { id: -100777, type: "supergroup" }, 4242); // a group: ignored
    tg.userSends("/start somethingelse"); // wrong token: ignored
    assert.deepEqual(await svc.checkPairing(started.challengeId, new Date(started.startedAt)), { status: "waiting" });
    tg.userSends(`/start ${startToken(started.challengeId)}`);
    assert.deepEqual(await svc.checkPairing(started.challengeId, new Date(started.startedAt)), { status: "code_sent" });

    assert.equal(tg.sent.length, 1);
    assert.equal(tg.sent[0].chatId, FOUNDER_CHAT);
    assert.match(tg.sent[0].text, /123456/);

    assert.deepEqual(await svc.verifyPairing(started.challengeId, "000000"), { status: "invalid" });
    assert.deepEqual(await svc.verifyPairing(started.challengeId, "123456"), { status: "paired" });
    assert.deepEqual(await svc.verifyPairing(started.challengeId, "123456"), { status: "invalid" }); // single use

    const status = await svc.status();
    assert.equal(status?.paired, true);
    assert.doesNotMatch(JSON.stringify(status), new RegExp(String(FOUNDER_CHAT)));
    const { rows } = await db.query<{ chat_id: string; n: number }>(
      "select chat_id::text, count(*) over ()::int as n from driveo_private.telegram_recipients where revoked_at is null",
    );
    assert.deepEqual(rows, [{ chat_id: String(FOUNDER_CHAT), n: 1 }]);
  });

  test("the code must be typed in the SAME admin session that started pairing", async () => {
    const tg = fakeTelegram();
    const svcA = service(db, admin, tg, { session: "session-a" });
    const started = await svcA.startPairing();
    if (started.status !== "started") throw new Error("not started");
    tg.userSends(`/start ${startToken(started.challengeId)}`);
    const svcB = service(db, admin, tg, { session: "session-b" });
    assert.deepEqual(await svcB.checkPairing(started.challengeId, new Date(started.startedAt)), { status: "expired" }); // attach refused
    assert.equal(tg.sent.length, 0);
    tg.userSends(`/start ${startToken(started.challengeId)}`);
    assert.deepEqual(await svcA.checkPairing(started.challengeId, new Date(started.startedAt)), { status: "code_sent" });
    assert.deepEqual(await svcB.verifyPairing(started.challengeId, "123456"), { status: "invalid" });
  });

  test("a bot that may join groups is refused before anything happens", async () => {
    const tg = fakeTelegram({ canJoinGroups: true });
    assert.deepEqual(await service(db, admin, tg).startPairing(), { status: "bot_allows_groups" });
    assert.deepEqual(await service(db, admin, tg).sendTestMessage(), { status: "bot_allows_groups" });
    assert.equal(tg.sent.length, 0);
  });

  test("non-admins and AAL1 sessions cannot pair; the database rejects non-private chat ids", async () => {
    for (const actor of [user(await createUser(db), "aal2"), user(adminId, "aal1")]) {
      assert.deepEqual(await service(db, actor, fakeTelegram()).startPairing(), { status: "not_authorized" });
      assert.deepEqual(await service(db, actor, fakeTelegram()).sendTestMessage(), { status: "not_authorized" });
    }
    const id = (await q<{ id: string }>(db, admin, "select public.admin_start_telegram_pairing('" + "a".repeat(64) + "') as id"))[0].id;
    const attachNegative = await q<{ ok: boolean }>(db, admin, "select public.admin_attach_telegram_pairing_code($1, $2, $3, $4, -100123) as ok", [id, "a".repeat(64), "b".repeat(64), "c".repeat(64)]);
    assert.equal(attachNegative[0].ok, false);
    await assert.rejects(
      db.query("insert into driveo_private.telegram_recipients (admin_user_id, chat_id, chat_ref_hash, challenge_id) values ($1, -42, $2, $3)", [adminId, "d".repeat(64), id]),
      sqlState("23514"),
    );
  });

  test("no API role can read recipients or test sends directly", async () => {
    for (const actor of [ANON, admin, SERVICE]) {
      for (const t of ["telegram_recipients", "telegram_test_sends"]) {
        await assert.rejects(q(db, actor, `select * from driveo_private.${t}`), sqlState("42501"), `${actor.role} ${t}`);
      }
    }
  });
});

describe("the one-time test message", () => {
  test("is not sent unless the server flag allows it", async () => {
    const db = await createTestDb();
    const admin = user(await createUser(db, { admin: true }), "aal2");
    const tg = fakeTelegram();
    const svc = await pair(db, admin, tg, { testSendAllowed: false });
    assert.deepEqual(await svc.sendTestMessage(), { status: "not_authorized_by_flag" });
    assert.equal(tg.sent.length, 1); // only the pairing code
  });

  test("is refused before pairing", async () => {
    const db = await createTestDb();
    const admin = user(await createUser(db, { admin: true }), "aal2");
    const tg = fakeTelegram();
    assert.deepEqual(await service(db, admin, tg).sendTestMessage(), { status: "not_paired" });
    assert.equal(tg.sent.length, 0);
  });

  test("sends the exact text once to the verified private chat; a second request is refused", async () => {
    const db = await createTestDb();
    const admin = user(await createUser(db, { admin: true }), "aal2");
    const tg = fakeTelegram();
    const svc = await pair(db, admin, tg);
    assert.deepEqual(await svc.sendTestMessage(), { status: "sent" });
    assert.deepEqual(await svc.sendTestMessage(), { status: "already_sent" });
    const tests = tg.sent.filter((s) => s.text === TELEGRAM_TEST_MESSAGE);
    assert.deepEqual(tests, [{ chatId: FOUNDER_CHAT, text: TELEGRAM_TEST_MESSAGE }]);
    assert.deepEqual(await svc.status().then((s) => s?.paired && s.testSend), "sent");
    const { rows } = await db.query<{ status: string; n: number }>("select status, count(*) over ()::int as n from driveo_private.telegram_test_sends");
    assert.deepEqual(rows, [{ status: "sent", n: 1 }]);
    // No booking, outbox event or attempt was created by any of this.
    for (const t of ["public.bookings", "driveo_private.notification_outbox", "driveo_private.notification_attempts"]) {
      assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n, 0, t);
    }
  });

  test("a timeout is recorded as 'unknown' and blocks any re-send (no duplicates)", async () => {
    const db = await createTestDb();
    const admin = user(await createUser(db, { admin: true }), "aal2");
    const tg = fakeTelegram({ sendResult: { ok: false, kind: "timeout", status: null, code: "telegram_timeout" } });
    const svc = await pair(db, admin, tg);
    assert.deepEqual(await svc.sendTestMessage(), { status: "unknown" });
    assert.deepEqual(await svc.sendTestMessage(), { status: "already_sent" });
    assert.equal(tg.sent.filter((s) => s.text === TELEGRAM_TEST_MESSAGE).length, 1);
  });

  test("a definite refusal (4xx) is recorded as failed and may be tried again by the founder", async () => {
    const db = await createTestDb();
    const admin = user(await createUser(db, { admin: true }), "aal2");
    const tg = fakeTelegram({ sendResult: { ok: false, kind: "api_error", status: 403, code: "telegram_403" } });
    const svc = await pair(db, admin, tg);
    assert.deepEqual(await svc.sendTestMessage(), { status: "failed" });
    assert.deepEqual(await svc.sendTestMessage(), { status: "failed" }); // a new explicit attempt, not an automatic retry
    const { rows } = await db.query<{ status: string; error_code: string }>("select status, error_code from driveo_private.telegram_test_sends order by requested_at");
    assert.deepEqual(rows, [
      { status: "failed", error_code: "telegram_403" },
      { status: "failed", error_code: "telegram_403" },
    ]);
  });

  test("refuses when Telegram no longer reports a private chat, before claiming", async () => {
    const db = await createTestDb();
    const admin = user(await createUser(db, { admin: true }), "aal2");
    const tg = fakeTelegram();
    const svc = await pair(db, admin, tg);
    const groupTg = fakeTelegram({ chatType: "group" });
    const svc2 = createTelegramAdminService({ api: groupTg.api, rpc: rpcAs(db, admin), token: TOKEN, sessionId: "session-a", testSendAllowed: true, log: () => {} });
    assert.deepEqual(await svc2.sendTestMessage(), { status: "not_private" });
    assert.equal(groupTg.sent.length, 0);
    assert.equal((await db.query<{ n: number }>("select count(*)::int as n from driveo_private.telegram_test_sends")).rows[0].n, 0);
    void svc;
  });

  test("revoking the recipient stops test sends", async () => {
    const db = await createTestDb();
    const admin = user(await createUser(db, { admin: true }), "aal2");
    const tg = fakeTelegram();
    const svc = await pair(db, admin, tg);
    assert.equal(await svc.revoke(), true);
    assert.deepEqual(await svc.sendTestMessage(), { status: "not_paired" });
    assert.deepEqual(await svc.status(), { paired: false });
  });
});
