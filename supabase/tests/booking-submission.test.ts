/**
 * The booking submission service against real PostgreSQL (PGlite + the DRIVEO
 * migrations), calling the database exactly as production would: as
 * service_role, through public.submit_booking_request and
 * public.consume_rate_limit. Nothing here touches a remote project.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { ka } from "../../src/content/ka.ts";
import { toSubmissionPayload } from "../../src/lib/booking/submission-contract.ts";
import {
  createBookingSubmissionService,
  createRpcBookingStore,
  createRpcRateLimiter,
  SUBMISSION_RATE_LIMITS,
  type Rpc,
} from "../../src/lib/booking/submission-service.ts";
import { VALID_DRAFT } from "../../src/lib/booking/test-fixtures.ts";
import type { BookingDraft } from "../../src/lib/booking/types.ts";
import { as, createTestDb, SERVICE } from "./db.ts";

let db: PGlite;
before(async () => {
  db = await createTestDb();
});

/** supabase-js-like rpc, executed as service_role (the role the secret key maps to). */
const pgRpc: Rpc = async (fn, args) => {
  const names = Object.keys(args);
  const params = names.map((k) => {
    const v = args[k];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  const list = names.map((k, i) => `${k} => $${i + 1}${args[k] !== null && typeof args[k] === "object" ? "::jsonb" : ""}`).join(", ");
  try {
    const rows = await as(db, SERVICE, async (tx) => (await tx.query<{ r: unknown }>(`select public.${fn}(${list}) as r`, params)).rows);
    return { data: rows[0]?.r ?? null, error: null };
  } catch (e) {
    return { data: null, error: { code: (e as { code?: string }).code, message: "db error" } };
  }
};

const logs: string[] = [];
const service = createBookingSubmissionService({
  store: createRpcBookingStore(pgRpc),
  limiter: createRpcRateLimiter(pgRpc),
  hashSecret: "s".repeat(32),
  allowedCities: ka.booking.cities,
  tbilisiNow: () => ({ date: "2026-10-22", time: "09:00" }),
  clock: () => new Date(),
  test: true,
  log: (event, detail) => logs.push(`${event} ${JSON.stringify(detail ?? {})}`),
});

let ipCounter = 0;
const freshIp = () => `198.51.100.${++ipCounter}`;
const submit = (draft: Partial<BookingDraft> = {}, ctx: { key?: string; ip?: string } = {}) =>
  service.submit(toSubmissionPayload({ ...VALID_DRAFT, ...draft }), { clientIp: ctx.ip ?? freshIp(), idempotencyKey: ctx.key ?? crypto.randomUUID() });

let phoneCounter = 100000;
/** A different fictional phone per booking, so the per-phone limit does not interfere. */
const freshPhone = () => `555 ${++phoneCounter}`.replace(/^555 (\d{3})(\d{3})$/, "555 $1 $2");

const count = async (sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0].n;

describe("booking submission against PostgreSQL", () => {
  test("a manual-assessment booking is stored atomically with no quote", async () => {
    const key = crypto.randomUUID();
    const res = await submit({ customerPhone: freshPhone() }, { key });
    assert.equal(res.status, "received");
    if (res.status !== "received") return;
    assert.match(res.reference, /^DRV-\d{4}-\d{6}$/);
    assert.equal(res.duplicate, false);
    assert.doesNotMatch(JSON.stringify(res), /ტესტაძე|\+995|სატესტო/);

    const { rows } = await db.query<{ id: string; pricing_mode: string; quote_reference: string | null; is_test: boolean; status: string; terms_version: string | null }>(
      "select id, pricing_mode, quote_reference, is_test, status, terms_version from public.bookings where submission_id = $1",
      [key],
    );
    assert.equal(rows.length, 1);
    const b = rows[0];
    assert.deepEqual(
      { mode: b.pricing_mode, quote: b.quote_reference, test: b.is_test, status: b.status, terms: b.terms_version },
      { mode: "manual_assessment", quote: null, test: true, status: "submitted", terms: null },
    );
    assert.equal(await count("select count(*)::int as n from public.booking_contacts where booking_id = $1", [b.id]), 1);
    assert.equal(await count("select count(*)::int as n from public.booking_status_events where booking_id = $1 and to_status = 'submitted'", [b.id]), 1);
    assert.equal(await count("select count(*)::int as n from public.admin_audit_log where entity_id = $1::text", [b.id]), 1);
  });

  test("personal data stays in booking_contacts; the outbox payload and the booking row carry none", async () => {
    const key = crypto.randomUUID();
    await submit({ customerPhone: "599 11 22 33" }, { key });
    const { rows } = await db.query<{ payload: object; booking: object }>(
      `select o.payload, to_jsonb(b) - 'pickup_address' - 'delivery_address' as booking
       from public.bookings b join driveo_private.notification_outbox o on o.booking_id = b.id where b.submission_id = $1`,
      [key],
    );
    assert.doesNotMatch(JSON.stringify(rows[0].payload), /599|ტესტაძე|სატესტო/);
    assert.doesNotMatch(JSON.stringify(rows[0].booking), /599112233|ტესტაძე/);
    const { rows: c } = await db.query<{ phone_e164: string }>(
      "select c.phone_e164 from public.booking_contacts c join public.bookings b on b.id = c.booking_id where b.submission_id = $1",
      [key],
    );
    assert.equal(c[0].phone_e164, "+995599112233");
  });

  test("no notification is sent: the test booking's outbox event is suppressed, with no attempts", async () => {
    const key = crypto.randomUUID();
    await submit({ customerPhone: freshPhone() }, { key });
    const { rows } = await db.query<{ status: string; attempts: number; id: string }>(
      "select o.id, o.status, o.attempts from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.submission_id = $1",
      [key],
    );
    assert.deepEqual({ status: rows[0].status, attempts: rows[0].attempts }, { status: "suppressed_test", attempts: 0 });
    assert.equal(await count("select count(*)::int as n from driveo_private.notification_attempts where event_id = $1", [rows[0].id]), 0);
  });

  test("retrying with the same key returns the same booking and creates nothing new", async () => {
    const key = crypto.randomUUID();
    const phone = freshPhone();
    const first = await submit({ customerPhone: phone }, { key });
    const again = await submit({ customerPhone: phone }, { key });
    assert.equal(first.status, "received");
    assert.deepEqual(again, { status: "received", reference: first.status === "received" ? first.reference : "", duplicate: true });
    assert.equal(await count("select count(*)::int as n from public.bookings where submission_id = $1", [key]), 1);
    assert.equal(
      await count("select count(*)::int as n from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.submission_id = $1", [key]),
      1,
    );
  });

  test("the same key with different content is a conflict and leaves the original untouched", async () => {
    const key = crypto.randomUUID();
    const phone = freshPhone();
    await submit({ customerPhone: phone }, { key });
    const res = await submit({ customerPhone: phone, vehicleModel: "Corolla" }, { key });
    assert.deepEqual(res, { status: "conflict" });
    const { rows } = await db.query<{ vehicle_model: string }>("select vehicle_model from public.bookings where submission_id = $1", [key]);
    assert.deepEqual(rows, [{ vehicle_model: "Prius" }]);
  });

  test("if any step of the transaction fails, nothing is left behind", async () => {
    // Simulate a failure in the LAST step (the outbox insert) — owner-level fixture, test DB only.
    await db.exec(`
      create function driveo_private.test_fail() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$;
      create trigger test_fail before insert on driveo_private.notification_outbox for each row execute function driveo_private.test_fail();
    `);
    const key = crypto.randomUUID();
    const before = await Promise.all(
      ["public.bookings", "public.booking_contacts", "public.booking_status_events", "public.admin_audit_log", "driveo_private.notification_outbox"].map((t) =>
        count(`select count(*)::int as n from ${t}`),
      ),
    );
    try {
      const res = await submit({ customerPhone: freshPhone() }, { key });
      assert.deepEqual(res, { status: "unavailable" });
    } finally {
      await db.exec("drop trigger test_fail on driveo_private.notification_outbox; drop function driveo_private.test_fail();");
    }
    const after = await Promise.all(
      ["public.bookings", "public.booking_contacts", "public.booking_status_events", "public.admin_audit_log", "driveo_private.notification_outbox"].map((t) =>
        count(`select count(*)::int as n from ${t}`),
      ),
    );
    assert.deepEqual(after, before);
    assert.equal(await count("select count(*)::int as n from public.bookings where submission_id = $1", [key]), 0);
    // The same key works once the failure is gone: nothing half-stored blocks it.
    const retry = await submit({ customerPhone: freshPhone() }, { key });
    assert.equal(retry.status, "received");
  });

  test("invalid submissions store nothing", async () => {
    const total = await count("select count(*)::int as n from public.bookings");
    const res = await submit({ customerPhone: "12", vehicleDrivable: false });
    assert.equal(res.status, "invalid");
    assert.equal(await count("select count(*)::int as n from public.bookings"), total);
  });

  test("persistent per-client limit: the next request from the same address is refused", async () => {
    const ip = freshIp();
    const { limit } = SUBMISSION_RATE_LIMITS.perClient;
    // Invalid requests still count against the client's budget.
    for (let i = 0; i < limit; i++) assert.equal((await submit({ customerPhone: "1" }, { ip })).status, "invalid");
    assert.equal((await submit({ customerPhone: freshPhone() }, { ip })).status, "rate_limited");
    assert.equal((await submit({ customerPhone: freshPhone() })).status, "received"); // other clients unaffected
  });

  test("persistent per-phone limit across different clients", async () => {
    const phone = "577 00 11 22";
    const { limit } = SUBMISSION_RATE_LIMITS.perPhone;
    for (let i = 0; i < limit; i++) assert.equal((await submit({ customerPhone: phone, pickupAddress: `სატესტო ქუჩა ${i + 10}` })).status, "received");
    assert.equal((await submit({ customerPhone: phone, pickupAddress: "სატესტო ქუჩა 99" })).status, "rate_limited");
  });

  test("logs contain event names and codes only", () => {
    assert.ok(logs.length > 0);
    assert.doesNotMatch(logs.join("\n"), /ტესტაძე|\+995|5\d\d \d\d|სატესტო|198\.51\.100/);
  });
});
