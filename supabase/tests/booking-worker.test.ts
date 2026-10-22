/**
 * Booking notification worker end to end: real PostgreSQL (PGlite + all
 * migrations, as service_role) and a FAKE Telegram API. Nothing reaches
 * Telegram or a remote project.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { createBookingNotificationWorker, WORKER_LIMITS, type ServiceRpc } from "../../src/lib/notifications/booking-worker.ts";
import type { TelegramApi, TelegramResult } from "../../src/lib/telegram/api.ts";
import { as, createTestDb, createUser, q, SERVICE, sqlState, submission } from "./db.ts";

const CHAT = 555000111;
const TOKEN_SHAPE = /\d{6,12}:AA/;

function serviceRpc(db: PGlite): ServiceRpc {
  return async (fn, args) => {
    const names = Object.keys(args);
    const list = names.map((k, i) => `${k} => $${i + 1}`).join(", ");
    try {
      const rows = await as(db, SERVICE, async (tx) => (await tx.query<Record<string, unknown>>(`select * from public.${fn}(${list}) as r`, names.map((k) => args[k]))).rows);
      return { data: rows.length === 1 && "r" in rows[0] ? rows[0].r : rows, error: null };
    } catch (e) {
      return { data: null, error: { code: (e as { code?: string }).code } };
    }
  };
}

type Sent = { chatId: number; text: string };
function fakeTelegram(o: { canJoinGroups?: boolean; chatType?: "private" | "group"; results?: TelegramResult<{ message_id: number }>[] } = {}) {
  const sent: Sent[] = [];
  const queue = [...(o.results ?? [])];
  const api: TelegramApi = {
    getMe: async () => ({ ok: true, result: { id: 1, is_bot: true, username: "driveo_test_bot", can_join_groups: o.canJoinGroups ?? false } }),
    getUpdates: async () => ({ ok: true, result: [] }),
    getChat: async (chatId) => ({ ok: true, result: { id: chatId, type: o.chatType ?? "private" } }),
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
      return queue.shift() ?? { ok: true, result: { message_id: 1000 + sent.length } };
    },
  };
  return { api, sent };
}

async function setup(opts: { recipients?: number } = {}) {
  const db = await createTestDb();
  const admins: string[] = [];
  for (let i = 0; i < (opts.recipients ?? 1); i++) {
    const adminId = await createUser(db, { admin: true });
    admins.push(adminId);
    const challenge = (
      await db.query<{ id: string }>(
        `insert into driveo_private.telegram_pairing_challenges (admin_user_id, session_binding_hash, code_hash, chat_ref_hash, chat_id, expires_at, consumed_at, outcome)
         values ($1, $2, $3, $4, $5, now() + interval '5 minutes', now(), 'verified') returning id`,
        [adminId, "a".repeat(64), "b".repeat(64), "c".repeat(64), CHAT + i],
      )
    ).rows[0].id;
    await db.query("insert into driveo_private.telegram_recipients (admin_user_id, chat_id, chat_ref_hash, challenge_id) values ($1, $2, $3, $4)", [
      adminId,
      CHAT + i,
      "c".repeat(64),
      challenge,
    ]);
  }
  return { db, admins };
}

let n = 0;
async function book(db: PGlite, isTest: boolean, time = "10:00") {
  n++;
  const s = submission({ booking: { requested_date: "2026-10-29", requested_time: time, pickup_address: `სატესტო ქუჩა ${n}` } });
  const r = await as(db, SERVICE, async (tx) =>
    (
      await tx.query<{ r: { reference: string } }>("select public.submit_booking_request($1, $2, $3, $4, null, $5) as r", [
        crypto.randomUUID(),
        `sha256:${String(n).padStart(64, "0")}`,
        s.booking,
        s.contact,
        isTest,
      ])
    ).rows,
  );
  return r[0].r.reference;
}

const eventOf = async (db: PGlite, reference: string) =>
  (
    await db.query<{ id: string; status: string; attempts: number; next_attempt_at: Date; snapshot: string }>(
      "select o.id, o.status, o.attempts, o.next_attempt_at, md5(to_jsonb(o)::text) as snapshot from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.reference = $1",
      [reference],
    )
  ).rows[0];

function worker(db: PGlite, tg: ReturnType<typeof fakeTelegram>, logs: string[] = [], adminUrl: string | null = null) {
  return createBookingNotificationWorker({ enabled: true, rpc: serviceRpc(db), api: tg.api, adminUrl, log: (e, d) => logs.push(`${e} ${JSON.stringify(d ?? {})}`) });
}

describe("booking notification worker", () => {
  test("delivers a real booking once to the verified private chat, with the requested pickup time", async () => {
    const { db } = await setup();
    const ref = await book(db, false, "10:00");
    const tg = fakeTelegram();
    const logs: string[] = [];
    const result = await worker(db, tg, logs, "https://driveo.ge/admin").run();
    assert.deepEqual(result, { status: "done", claimed: 1, sent: 1, retrying: 0, failed: 0, uncertain: 0 });
    assert.equal(tg.sent.length, 1);
    assert.equal(tg.sent[0].chatId, CHAT);
    assert.equal(
      tg.sent[0].text,
      [
        "🚗 DRIVEO — ახალი შეკვეთა",
        `🆔 შეკვეთა: ${ref}`,
        "📍 მარშრუტი: თბილისი → რუსთავი",
        "📅 გაყვანის თარიღი: 29 ოქტომბერი, 2026",
        "🕐 გაყვანის დრო: 10:00",
        "📋 სტატუსი: მიღებული",
        "🔗 დეტალები: Admin Dashboard — https://driveo.ge/admin",
      ].join("\n"),
    );
    assert.doesNotMatch(tg.sent[0].text, /ტესტაძე|\+995|სატესტო ქუჩა/);
    const ev = await eventOf(db, ref);
    assert.deepEqual({ status: ev.status, attempts: ev.attempts }, { status: "sent_telegram", attempts: 1 });
    const { rows } = await db.query<{ result: string; provider_message_id: string }>("select result, provider_message_id from driveo_private.notification_attempts where event_id = $1", [ev.id]);
    assert.deepEqual(rows, [{ result: "accepted", provider_message_id: "1001" }]);
    assert.doesNotMatch(logs.join("\n"), new RegExp(`${CHAT}|${ref}|ტესტაძე|\\+995`));
    assert.doesNotMatch(logs.join("\n"), TOKEN_SHAPE);
  });

  test("test bookings are never delivered, and their suppressed events stay byte-for-byte unchanged", async () => {
    const { db } = await setup();
    const testRef = await book(db, true);
    const before = await eventOf(db, testRef);
    const tg = fakeTelegram();
    const result = await worker(db, tg).run();
    assert.deepEqual(result, { status: "done", claimed: 0, sent: 0, retrying: 0, failed: 0, uncertain: 0 });
    assert.equal(tg.sent.length, 0);
    const after = await eventOf(db, testRef);
    assert.equal(after.snapshot, before.snapshot);
    assert.equal(after.status, "suppressed_test");
    // Even the owner cannot make a test event claimable.
    await assert.rejects(db.query("update driveo_private.notification_outbox set status = 'pending', completed_at = null where id = $1", [after.id]), sqlState("23514"));
  });

  test("nothing exists to notify before the booking transaction commits", async () => {
    const { db } = await setup();
    await db.exec(`create function driveo_private.t_fail() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
                   create trigger t_fail before insert on public.admin_audit_log for each row execute function driveo_private.t_fail();`);
    await assert.rejects(book(db, false));
    await db.exec("drop trigger t_fail on public.admin_audit_log; drop function driveo_private.t_fail();");
    const tg = fakeTelegram();
    assert.deepEqual(await worker(db, tg).run(), { status: "done", claimed: 0, sent: 0, retrying: 0, failed: 0, uncertain: 0 });
    assert.equal((await db.query<{ n: number }>("select count(*)::int as n from driveo_private.notification_outbox")).rows[0].n, 0);
  });

  test("duplicate and concurrent runs never send the same event twice", async () => {
    const { db } = await setup();
    await book(db, false);
    await book(db, false);
    const tg = fakeTelegram();
    const [a, b] = await Promise.all([worker(db, tg).run(), worker(db, tg).run()]);
    const sentTotal = (a.status === "done" ? a.sent : 0) + (b.status === "done" ? b.sent : 0);
    assert.equal(sentTotal, 2);
    assert.equal(tg.sent.length, 2);
    assert.deepEqual(await worker(db, tg).run(), { status: "done", claimed: 0, sent: 0, retrying: 0, failed: 0, uncertain: 0 });
    assert.equal(tg.sent.length, 2);
  });

  test("a stale 'processing' event (worker stopped mid-send) is never re-claimed automatically", async () => {
    const { db } = await setup();
    const ref = await book(db, false);
    const ev = await eventOf(db, ref);
    await db.query("update driveo_private.notification_outbox set status = 'processing', locked_until = now() - interval '1 hour' where id = $1", [ev.id]);
    const tg = fakeTelegram();
    assert.equal((await worker(db, tg).run()).status, "done");
    assert.equal(tg.sent.length, 0);
    assert.equal((await eventOf(db, ref)).status, "processing");
  });

  test("timeouts are uncertain: recorded, marked failed, and NOT retried automatically", async () => {
    const { db } = await setup();
    const ref = await book(db, false);
    const tg = fakeTelegram({ results: [{ ok: false, kind: "timeout", status: null, code: "telegram_timeout" }] });
    assert.deepEqual(await worker(db, tg).run(), { status: "done", claimed: 1, sent: 0, retrying: 0, failed: 0, uncertain: 1 });
    const ev = await eventOf(db, ref);
    assert.equal(ev.status, "failed_all");
    assert.deepEqual(await worker(db, tg).run(), { status: "done", claimed: 0, sent: 0, retrying: 0, failed: 0, uncertain: 0 });
    assert.equal(tg.sent.length, 1);
    const { rows } = await db.query<{ result: string; error_code: string }>("select result, error_code from driveo_private.notification_attempts where event_id = $1", [ev.id]);
    assert.deepEqual(rows, [{ result: "failed", error_code: "telegram_timeout" }]);
  });

  test("a definite refusal (403) fails without retry", async () => {
    const { db } = await setup();
    const ref = await book(db, false);
    const tg = fakeTelegram({ results: [{ ok: false, kind: "api_error", status: 403, code: "telegram_403" }] });
    assert.deepEqual(await worker(db, tg).run(), { status: "done", claimed: 1, sent: 0, retrying: 0, failed: 1, uncertain: 0 });
    assert.equal((await eventOf(db, ref)).status, "failed_all");
  });

  test("rate limiting (429) retries with backoff, bounded by MAX_ATTEMPTS", async () => {
    const { db } = await setup();
    const ref = await book(db, false);
    const limited: TelegramResult<{ message_id: number }> = { ok: false, kind: "api_error", status: 429, code: "telegram_429" };
    const tg = fakeTelegram({ results: Array(WORKER_LIMITS.maxAttempts).fill(limited) });
    const w = worker(db, tg);
    assert.equal((await w.run()).status, "done");
    let ev = await eventOf(db, ref);
    assert.equal(ev.status, "pending");
    assert.ok(ev.next_attempt_at.getTime() > Date.now() + 50_000, "backoff pushes the next attempt into the future");
    assert.deepEqual(await w.run(), { status: "done", claimed: 0, sent: 0, retrying: 0, failed: 0, uncertain: 0 }); // not due yet
    for (let i = 1; i < WORKER_LIMITS.maxAttempts; i++) {
      await db.query("update driveo_private.notification_outbox set next_attempt_at = now() where id = $1", [ev.id]);
      await w.run();
    }
    ev = await eventOf(db, ref);
    assert.deepEqual({ status: ev.status, attempts: ev.attempts }, { status: "failed_all", attempts: WORKER_LIMITS.maxAttempts });
    assert.equal(tg.sent.length, WORKER_LIMITS.maxAttempts);
  });

  test("missing pickup time in an older payload is shown as not specified, never invented", async () => {
    const { db } = await setup();
    const ref = await book(db, false);
    const ev = await eventOf(db, ref);
    await db.query("update driveo_private.notification_outbox set payload = payload - 'requested_time' where id = $1", [ev.id]);
    const tg = fakeTelegram();
    await worker(db, tg).run();
    assert.match(tg.sent[0].text, /🕐 გაყვანის დრო: დრო მითითებული არ არის/);
  });

  test("no verified recipient, more than one, a non-private chat or a group-capable bot: nothing is claimed or sent", async () => {
    const none = await createTestDb();
    await book(none, false);
    const tg0 = fakeTelegram();
    assert.deepEqual(await worker(none, tg0).run(), { status: "no_recipient" });

    const two = await setup({ recipients: 2 });
    const ref2 = await book(two.db, false);
    assert.deepEqual(await worker(two.db, tg0).run(), { status: "ambiguous_recipient" });
    assert.equal((await eventOf(two.db, ref2)).status, "pending");

    const one = await setup();
    const ref1 = await book(one.db, false);
    const group = fakeTelegram({ chatType: "group" });
    assert.deepEqual(await worker(one.db, group).run(), { status: "recipient_not_private" });
    const joins = fakeTelegram({ canJoinGroups: true });
    assert.deepEqual(await worker(one.db, joins).run(), { status: "bot_allows_groups" });
    await one.db.query("update public.admin_users set is_active = false, deactivated_at = now() where user_id = $1", [one.admins[0]]);
    assert.deepEqual(await worker(one.db, tg0).run(), { status: "no_recipient" });
    assert.equal((await eventOf(one.db, ref1)).status, "pending");
    assert.equal(tg0.sent.length + group.sent.length + joins.sent.length, 0);
  });

  test("only the server role can use the worker functions", async () => {
    const { db, admins } = await setup();
    const admin = { role: "authenticated" as const, sub: admins[0], aal: "aal2" as const };
    for (const sql of ["select * from public.worker_telegram_recipient()", "select * from public.claim_booking_notifications(5, 120)"]) {
      await assert.rejects(q(db, { role: "anon" }, sql), sqlState("42501"), sql);
      await assert.rejects(q(db, admin, sql), sqlState("42501"), sql);
    }
  });
});
