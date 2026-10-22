/**
 * Fictional TEST bookings are isolated from real ones (migration
 * 20261022000100): their notification events can never be claimed or sent,
 * test mode fails closed on a database without the fix, and the owner-only
 * purge removes test data while leaving real records and the audit log intact.
 * PGlite only — nothing here touches a remote project.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { ka } from "../../src/content/ka.ts";
import { toSubmissionPayload } from "../../src/lib/booking/submission-contract.ts";
import { createBookingSubmissionService, createRpcBookingStore, createRpcRateLimiter, type Rpc } from "../../src/lib/booking/submission-service.ts";
import { VALID_DRAFT } from "../../src/lib/booking/test-fixtures.ts";
import { ANON, as, createTestDb, createUser, q, SERVICE, sqlState, user, type Actor } from "./db.ts";

function rpcFor(db: PGlite): Rpc {
  return async (fn, args) => {
    const names = Object.keys(args);
    const isObj = (v: unknown) => v !== null && typeof v === "object";
    const params = names.map((k) => (isObj(args[k]) ? JSON.stringify(args[k]) : args[k]));
    const list = names.map((k, i) => `${k} => $${i + 1}${isObj(args[k]) ? "::jsonb" : ""}`).join(", ");
    try {
      const rows = await as(db, SERVICE, async (tx) => (await tx.query<{ r: unknown }>(`select public.${fn}(${list}) as r`, params)).rows);
      return { data: rows[0]?.r ?? null, error: null };
    } catch (e) {
      return { data: null, error: { code: (e as { code?: string }).code, message: "db error" } };
    }
  };
}

function serviceFor(db: PGlite, test: boolean) {
  const rpc = rpcFor(db);
  return createBookingSubmissionService({
    store: createRpcBookingStore(rpc),
    limiter: createRpcRateLimiter(rpc),
    hashSecret: "i".repeat(32),
    allowedCities: ka.booking.cities,
    tbilisiNow: () => ({ date: "2026-10-22", time: "09:00" }),
    clock: () => new Date(),
    test,
    log: () => {},
  });
}

let seq = 0;
const send = (svc: ReturnType<typeof serviceFor>, key = crypto.randomUUID()) => {
  seq++;
  const phone = `555 ${String(200000 + seq).slice(0, 3)} ${String(200000 + seq).slice(3)}`;
  return svc.submit(toSubmissionPayload({ ...VALID_DRAFT, customerPhone: phone, pickupAddress: `სატესტო ქუჩა ${seq}` }), {
    clientIp: `192.0.2.${seq}`,
    idempotencyKey: key,
  });
};

const outboxOf = async (db: PGlite, key: string) =>
  (
    await db.query<{ id: string; status: string; is_test: boolean; completed_at: Date | null }>(
      "select o.id, o.status, o.is_test, o.completed_at from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.submission_id = $1",
      [key],
    )
  ).rows[0];

describe("test bookings never reach a notification channel", () => {
  let db: PGlite;
  let admin: Actor;
  before(async () => {
    db = await createTestDb();
    admin = user(await createUser(db, { admin: true }), "aal2");
  });

  test("a test booking is flagged and its event is born suppressed; a real one is pending", async () => {
    const testKey = crypto.randomUUID();
    const realKey = crypto.randomUUID();
    assert.equal((await send(serviceFor(db, true), testKey)).status, "received");
    assert.equal((await send(serviceFor(db, false), realKey)).status, "received");

    const t = await outboxOf(db, testKey);
    const r = await outboxOf(db, realKey);
    assert.deepEqual({ status: t.status, is_test: t.is_test, completed: t.completed_at !== null }, { status: "suppressed_test", is_test: true, completed: true });
    assert.deepEqual({ status: r.status, is_test: r.is_test, completed: r.completed_at !== null }, { status: "pending", is_test: false, completed: false });
    const { rows } = await db.query<{ is_test: boolean }>("select is_test from public.bookings where submission_id = $1", [testKey]);
    assert.equal(rows[0].is_test, true);
  });

  test("the worker claim returns real events only", async () => {
    const testKey = crypto.randomUUID();
    await send(serviceFor(db, true), testKey);
    const claimed = await q<{ event_id: string }>(db, SERVICE, "select * from public.claim_notification_events(50, 60)");
    const testEvent = await outboxOf(db, testKey);
    assert.ok(claimed.length >= 1, "real events are claimable");
    assert.ok(!claimed.some((c) => c.event_id === testEvent.id), "the test event was claimed");
    assert.equal((await outboxOf(db, testKey)).status, "suppressed_test");
  });

  test("the database refuses to make a test event deliverable, or a real event suppressed", async () => {
    const testKey = crypto.randomUUID();
    const realKey = crypto.randomUUID();
    await send(serviceFor(db, true), testKey);
    await send(serviceFor(db, false), realKey);
    const t = await outboxOf(db, testKey);
    const r = await outboxOf(db, realKey);
    for (const sql of [
      "update driveo_private.notification_outbox set status = 'pending', completed_at = null where id = $1",
      "update driveo_private.notification_outbox set status = 'processing', completed_at = null where id = $1",
      "update driveo_private.notification_outbox set status = 'sent_telegram' where id = $1",
      "update driveo_private.notification_outbox set is_test = false where id = $1",
    ]) {
      await assert.rejects(db.query(sql, [t.id]), sqlState("23514"), sql);
    }
    await assert.rejects(
      db.query("update driveo_private.notification_outbox set status = 'suppressed_test', completed_at = now() where id = $1", [r.id]),
      sqlState("23514"),
    );
    // Admin recovery only re-queues failed real events.
    await assert.rejects(q(db, admin, "select public.admin_retry_notification($1)", [t.id]), sqlState("DV007"));
  });

  test("a submission key cannot switch between test and real", async () => {
    const key = crypto.randomUUID();
    await send(serviceFor(db, true), key);
    seq--; // same content as the first send
    assert.deepEqual(await send(serviceFor(db, false), key), { status: "conflict" });
  });

  test("only the server role can create bookings at all (anon, admins cannot)", async () => {
    await assert.rejects(q(db, ANON, "select public.submit_booking_request($1, 'sha256:x', '{}', '{}', null, true)", [crypto.randomUUID()]), sqlState("42501"));
    await assert.rejects(q(db, admin, "select public.submit_booking_request($1, 'sha256:x', '{}', '{}', null, true)", [crypto.randomUUID()]), sqlState("42501"));
  });
});

describe("test mode fails closed on a database without test isolation", () => {
  test("nothing is stored and the request is answered 'unavailable'", async () => {
    const old = await createTestDb({ before: "20261022000100" });
    const res = await send(serviceFor(old, true));
    assert.deepEqual(res, { status: "unavailable" });
    const { rows } = await old.query<{ n: number }>("select count(*)::int as n from public.bookings");
    assert.equal(rows[0].n, 0);
  });
});

describe("purging test bookings", () => {
  let db: PGlite;
  let admin: Actor;
  before(async () => {
    db = await createTestDb();
    admin = user(await createUser(db, { admin: true }), "aal2");
  });

  const count = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

  test("removes every row of test bookings, keeps real bookings and the audit log", async () => {
    // Two test bookings, one taken through the whole price flow (status events, proposal, acceptance).
    const k1 = crypto.randomUUID();
    const k2 = crypto.randomUUID();
    const kReal = crypto.randomUUID();
    await send(serviceFor(db, true), k1);
    await send(serviceFor(db, true), k2);
    await send(serviceFor(db, false), kReal);
    const id1 = (await db.query<{ id: string }>("select id from public.bookings where submission_id = $1", [k1])).rows[0].id;
    await q(db, admin, "select public.admin_transition_booking($1, 'under_review')", [id1]);
    const proposal = (await q<{ id: string }>(db, admin, "select public.admin_create_price_proposal($1, 15000) as id", [id1]))[0].id;
    await q(db, admin, "select public.admin_mark_proposal_sent($1, 'sms')", [proposal]);
    await q(db, admin, "select public.admin_record_price_acceptance($1, 'sms', 'SMS 22 Oct 10:05', 'ვეთანხმები', now(), 15000)", [proposal]);

    const auditBefore = await count("select count(*)::int as n from public.admin_audit_log");
    const realBefore = await db.query("select b.*, c.full_name, c.phone_e164 from public.bookings b join public.booking_contacts c on c.booking_id = b.id where not b.is_test order by b.id");

    await assert.rejects(db.query("select driveo_private.purge_test_bookings('yes')"), sqlState("22023"));
    const purged = (await db.query<{ n: number }>("select driveo_private.purge_test_bookings('DELETE TEST BOOKINGS') as n")).rows[0].n;
    assert.equal(purged, 2);

    assert.equal(await count("select count(*)::int as n from public.bookings where is_test"), 0);
    for (const t of ["public.booking_contacts", "public.booking_status_events", "public.price_proposals", "public.price_acceptances", "driveo_private.notification_outbox"]) {
      assert.equal(
        await count(`select count(*)::int as n from ${t} x where not exists (select 1 from public.bookings b where b.id = x.booking_id)`),
        0,
        `orphans in ${t}`,
      );
    }
    assert.equal(await count("select count(*)::int as n from driveo_private.notification_outbox where is_test"), 0);
    const realAfter = await db.query("select b.*, c.full_name, c.phone_e164 from public.bookings b join public.booking_contacts c on c.booking_id = b.id where not b.is_test order by b.id");
    assert.deepEqual(realAfter.rows, realBefore.rows);
    assert.equal(await count("select count(*)::int as n from public.admin_audit_log"), auditBefore + 1);
    assert.equal(await count("select count(*)::int as n from public.admin_audit_log where action = 'test_booking.purged'"), 1);
    assert.equal(await count("select count(*)::int as n from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where o.status = 'pending'"), 1);
  });

  test("history stays append-only outside a purge, and the purge flag alone grants nothing", async () => {
    await assert.rejects(db.query("delete from public.booking_status_events"), sqlState("42501"));
    // Even the owner, with the purge flag on, can never delete the audit log.
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query("select set_config('driveo.test_purge', 'on', true)");
        await tx.query("delete from public.admin_audit_log");
      }),
      sqlState("42501"),
    );
    for (const actor of [ANON, admin, SERVICE]) {
      await assert.rejects(q(db, actor, "select driveo_private.purge_test_bookings('DELETE TEST BOOKINGS')"), sqlState("42501"));
      await assert.rejects(
        as(db, actor, async (tx) => {
          await tx.query("select set_config('driveo.test_purge', 'on', true)");
          await tx.query("delete from public.booking_status_events");
        }),
        sqlState("42501"),
      );
    }
  });

  test("with no test bookings the purge does nothing", async () => {
    const before = await count("select count(*)::int as n from public.admin_audit_log");
    assert.equal((await db.query<{ n: number }>("select driveo_private.purge_test_bookings('DELETE TEST BOOKINGS') as n")).rows[0].n, 0);
    assert.equal(await count("select count(*)::int as n from public.admin_audit_log"), before);
  });
});
