/**
 * Requested pickup date/time: stored exactly as submitted, carried in the
 * notification payload (migration 20261023000100), and rendered in the
 * Telegram template — while test-booking notifications stay suppressed.
 * PGlite only; nothing touches a remote project or Telegram.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { toAdminBookingItem, type AdminBookingRow } from "../../src/lib/booking/admin-list.ts";
import { bookingNotificationMessage, readBookingNotificationPayload } from "../../src/lib/telegram/booking-message.ts";
import { as, createTestDb, createUser, q, SERVICE, sqlState, submission, user, type Actor } from "./db.ts";

let db: PGlite;
let admin: Actor;
before(async () => {
  db = await createTestDb();
  admin = user(await createUser(db, { admin: true }), "aal2");
});

const submitRow = async (isTest: boolean, time: string) => {
  const s = submission({ booking: { requested_date: "2026-10-29", requested_time: time, pickup_address: `სატესტო ქუჩა ${time}` } });
  const rows = await as(db, SERVICE, async (tx) =>
    (await tx.query<{ r: { reference: string } }>("select public.submit_booking_request($1, $2, $3, $4, null, $5) as r", [crypto.randomUUID(), `sha256:${"a".repeat(63)}${isTest ? "1" : "0"}${time.replace(":", "")}`.slice(0, 71), s.booking, s.contact, isTest])).rows,
  );
  return rows[0].r.reference;
};

describe("requested pickup time", () => {
  test("is persisted exactly, separately from the submission time, and the admin list shows it", async () => {
    const ref = await submitRow(true, "10:00");
    const rows = await q<AdminBookingRow>(
      db,
      admin,
      "select reference, status, pickup_city, delivery_city, requested_date::text, requested_time::text, submitted_at::text, is_test from public.bookings where reference = $1",
      [ref],
    );
    assert.equal(rows[0].requested_date, "2026-10-29");
    assert.equal(rows[0].requested_time, "10:00:00");
    const item = toAdminBookingItem(rows[0]);
    assert.equal(item.pickup.combined, "29 ოქტომბერი, 2026 — 10:00");
    assert.notEqual(item.submittedAt, null);
    assert.doesNotMatch(item.submittedAt ?? "", /29 ოქტომბერი, 2026 — 10:00/);
  });

  test("is carried in the outbox payload and rendered by the Telegram template", async () => {
    const ref = await submitRow(false, "07:45");
    const { rows } = await db.query<{ payload: unknown; status: string }>(
      "select o.payload, o.status from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.reference = $1",
      [ref],
    );
    assert.equal(rows[0].status, "pending");
    const b = readBookingNotificationPayload(rows[0].payload);
    assert.ok(b);
    const text = bookingNotificationMessage(b!, { adminUrl: null });
    assert.match(text, /📅 გაყვანის თარიღი: 29 ოქტომბერი, 2026/);
    assert.match(text, /🕐 გაყვანის დრო: 07:45/);
    assert.doesNotMatch(text, /\+995|ტესტაძე|სატესტო ქუჩა/);
  });

  test("test bookings stay suppressed and are never claimed, with the new payload too", async () => {
    const ref = await submitRow(true, "12:30");
    const { rows } = await db.query<{ id: string; status: string; is_test: boolean; payload: { requested_time: string } }>(
      "select o.id, o.status, o.is_test, o.payload from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.reference = $1",
      [ref],
    );
    assert.deepEqual({ status: rows[0].status, is_test: rows[0].is_test, time: rows[0].payload.requested_time }, { status: "suppressed_test", is_test: true, time: "12:30" });
    const claimed = await q<{ event_id: string }>(db, SERVICE, "select * from public.claim_notification_events(50, 60)");
    assert.ok(!claimed.some((c) => c.event_id === rows[0].id));
    await assert.rejects(db.query("update driveo_private.notification_outbox set status = 'pending', completed_at = null where id = $1", [rows[0].id]), sqlState("23514"));
  });

  test("the payload allowlist still refuses personal data", async () => {
    const ref = await submitRow(false, "09:00");
    const { rows } = await db.query<{ booking_id: string }>("select o.booking_id from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.reference = $1", [ref]);
    for (const extra of [{ phone: "+995555000111" }, { requested_time: { h: 9 } }, { requested_date: "x".repeat(100) }]) {
      await assert.rejects(
        db.query("insert into driveo_private.notification_outbox (event_type, booking_id, dedupe_key, payload) values ('booking.submitted', $1, $2, $3)", [
          rows[0].booking_id,
          crypto.randomUUID(),
          { reference: ref, ...extra },
        ]),
        sqlState("23514"),
        JSON.stringify(extra),
      );
    }
  });

  test("events created before the migration keep their old payload (not rewritten)", async () => {
    const old = await createTestDb({ before: "20261023000100" });
    const s = submission();
    await as(old, SERVICE, (tx) => tx.query("select public.submit_booking_request($1, $2, $3, $4, null, true)", [crypto.randomUUID(), `sha256:${"b".repeat(64)}`, s.booking, s.contact]));
    const before = (await old.query<{ payload: Record<string, string>; status: string }>("select payload, status from driveo_private.notification_outbox")).rows[0];
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await old.exec(readFileSync(join(import.meta.dirname, "..", "migrations", "20261023000100_notification_pickup_time.sql"), "utf8"));
    const after = (await old.query<{ payload: Record<string, string>; status: string }>("select payload, status from driveo_private.notification_outbox")).rows[0];
    assert.deepEqual(after, before);
    assert.equal(after.status, "suppressed_test");
    assert.ok(!("requested_time" in after.payload));
  });
});
