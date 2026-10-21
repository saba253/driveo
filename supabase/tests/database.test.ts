/**
 * Database authorization and lifecycle tests, run against real PostgreSQL (PGlite)
 * with a Supabase imitation (see supabase-shim.sql). They prove the migrations'
 * grants, RLS policies, triggers and functions behave as designed in PostgreSQL;
 * they do NOT prove a live Supabase project is configured correctly.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { TRANSITION_RULES } from "../../src/lib/booking/lifecycle.ts";
import { ANON, SERVICE, bookingId, createTestDb, createUser, hash, q, sqlState, submission, submit, user, type Actor } from "./db.ts";

const PUBLIC_TABLES = [
  "admin_users",
  "drivers",
  "bookings",
  "booking_contacts",
  "booking_status_events",
  "price_proposals",
  "price_acceptances",
  "admin_audit_log",
];
const PRIVATE_TABLES = ["notification_outbox", "notification_attempts", "telegram_pairing_challenges", "rate_limit_counters"];

const ADMIN_FUNCTIONS = [
  "admin_transition_booking",
  "admin_create_price_proposal",
  "admin_mark_proposal_sent",
  "admin_record_price_acceptance",
  "admin_retry_notification",
  "admin_notification_history",
  "admin_start_telegram_pairing",
  "admin_verify_telegram_pairing",
];
const SERVICE_FUNCTIONS = [
  "submit_booking_request",
  "claim_notification_events",
  "record_notification_attempt",
  "complete_notification_event",
  "consume_rate_limit",
  "attach_telegram_pairing_code",
];

const hex = (n: number | string) => String(n).padStart(64, "0");
const uuid = () => crypto.randomUUID();

let db: PGlite;
let admin: Actor; // active admin at AAL2
let adminAal1: Actor; // same admin, password only
let adminId: string;
let stranger: Actor; // authenticated, not an admin, even at AAL2
let inactiveAdmin: Actor;

before(async () => {
  db = await createTestDb();
  adminId = await createUser(db, { admin: true });
  admin = user(adminId, "aal2");
  adminAal1 = user(adminId, "aal1");
  stranger = user(await createUser(db), "aal2");
  inactiveAdmin = user(await createUser(db, { admin: true, active: false }), "aal2");
});

async function newBooking(): Promise<{ id: string; reference: string }> {
  const r = await submit(db, uuid(), hash(uuid().replaceAll("-", "")));
  return { id: await bookingId(db, r.reference), reference: r.reference };
}

const call = (actor: Actor, sql: string, params: unknown[] = []) => q(db, actor, sql, params);
const statusOf = async (id: string) => (await db.query<{ status: string }>("select status from public.bookings where id = $1", [id])).rows[0].status;

/* ------------------------------------------------------------------ structure */

describe("schema hardening", () => {
  test("RLS is enabled on every table in public and driveo_private", async () => {
    const { rows } = await db.query<{ relname: string; nspname: string; relrowsecurity: boolean }>(
      `select c.relname, n.nspname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname in ('public', 'driveo_private')`,
    );
    assert.deepEqual(rows.map((r) => r.relname).sort(), [...PUBLIC_TABLES, ...PRIVATE_TABLES].sort());
    for (const r of rows) assert.equal(r.relrowsecurity, true, `${r.nspname}.${r.relname}`);
  });

  test("no views exist that could bypass RLS", async () => {
    const { rows } = await db.query("select table_name from information_schema.views where table_schema in ('public', 'driveo_private')");
    assert.equal(rows.length, 0);
  });

  test("anon, authenticated and service_role have no write privilege on any table", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const [schema, tables] of [["public", PUBLIC_TABLES], ["driveo_private", PRIVATE_TABLES]] as const) {
        for (const t of tables) {
          for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
            const { rows } = await db.query<{ ok: boolean }>("select has_table_privilege($1, $2, $3) as ok", [role, `${schema}.${t}`, priv]);
            assert.equal(rows[0].ok, false, `${role} ${priv} ${schema}.${t}`);
          }
        }
      }
    }
  });

  test("only authenticated has SELECT, and only on public tables (RLS then filters)", async () => {
    for (const t of PUBLIC_TABLES) {
      for (const [role, expected] of [["anon", false], ["authenticated", true], ["service_role", false]] as const) {
        const { rows } = await db.query<{ ok: boolean }>("select has_table_privilege($1, $2, 'SELECT') as ok", [role, `public.${t}`]);
        assert.equal(rows[0].ok, expected, `${role} SELECT ${t}`);
      }
    }
    for (const t of PRIVATE_TABLES) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const { rows } = await db.query<{ ok: boolean }>("select has_table_privilege($1, $2, 'SELECT') as ok", [role, `driveo_private.${t}`]);
        assert.equal(rows[0].ok, false, `${role} SELECT private ${t}`);
      }
    }
  });

  test("every function pins search_path, and SECURITY DEFINER functions are exactly the expected set", async () => {
    const { rows } = await db.query<{ name: string; nspname: string; definer: boolean; config: string[] | null }>(
      `select p.proname as name, n.nspname, p.prosecdef as definer, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'driveo_private')`,
    );
    for (const r of rows) assert.ok(r.config?.includes('search_path=""'), `${r.nspname}.${r.name} search_path ${r.config}`);
    const definers = rows.filter((r) => r.definer).map((r) => `${r.nspname}.${r.name}`).sort();
    assert.deepEqual(
      definers,
      [...ADMIN_FUNCTIONS, ...SERVICE_FUNCTIONS].map((f) => `public.${f}`).concat(["driveo_private.is_admin", "driveo_private.require_admin"]).sort(),
    );
  });

  test("EXECUTE grants: admin functions → authenticated only; worker functions → service_role only; anon → nothing", async () => {
    const { rows } = await db.query<{ name: string; anon: boolean; auth: boolean; service: boolean; pub: boolean }>(
      `select p.proname as name,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as pub
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'driveo_private')`,
    );
    for (const r of rows) {
      assert.equal(r.anon, false, `anon can execute ${r.name}`);
      assert.equal(r.pub, false, `PUBLIC can execute ${r.name}`);
      const expectAuth = ADMIN_FUNCTIONS.includes(r.name) || r.name === "is_admin" || r.name === "current_aal";
      assert.equal(r.auth, expectAuth, `authenticated execute ${r.name}`);
      assert.equal(r.service, SERVICE_FUNCTIONS.includes(r.name), `service_role execute ${r.name}`);
    }
  });

  test("the TypeScript lifecycle mirror matches the database transition rules exactly", async () => {
    const { rows } = await db.query<{ from_status: string; to_status: string; via: string }>(
      "select from_status, to_status, via from driveo_private.booking_transition_rules()",
    );
    const key = (r: { from: string; to: string; via: string }) => `${r.from}>${r.to}@${r.via}`;
    assert.deepEqual(
      rows.map((r) => key({ from: r.from_status, to: r.to_status, via: r.via })).sort(),
      TRANSITION_RULES.map(key).sort(),
    );
  });
});

/* --------------------------------------------------------------- access control */

describe("public (anon) access is denied", () => {
  test("anon cannot read any public table", async () => {
    for (const t of PUBLIC_TABLES) await assert.rejects(call(ANON, `select * from public.${t}`), sqlState("42501"), t);
  });

  test("anon cannot reach the private schema", async () => {
    for (const t of PRIVATE_TABLES) await assert.rejects(call(ANON, `select * from driveo_private.${t}`), sqlState("42501"), t);
  });

  test("anon cannot submit, write or call any function", async () => {
    const s = submission();
    await assert.rejects(call(ANON, "select public.submit_booking_request($1, $2, $3, $4)", [uuid(), hash(9), s.booking, s.contact]), sqlState("42501"));
    await assert.rejects(call(ANON, "insert into public.bookings (reference) values ('DRV-2026-999999')"), sqlState("42501"));
    await assert.rejects(call(ANON, "select public.admin_transition_booking($1, 'under_review')", [uuid()]), sqlState("42501"));
    await assert.rejects(call(ANON, "select public.consume_rate_limit('booking.ip:00000000000000000000', 5, 60)"), sqlState("42501"));
  });
});

describe("admin access requires AAL2 and an active admin record", () => {
  test("a full admin (AAL2, active) sees bookings and contact details", async () => {
    const b = await newBooking();
    const rows = await call(admin, "select b.reference, c.phone_e164 from public.bookings b join public.booking_contacts c on c.booking_id = b.id where b.id = $1", [b.id]);
    assert.equal(rows.length, 1);
  });

  test("the same admin at AAL1 sees no business rows and cannot act", async () => {
    const b = await newBooking();
    for (const t of PUBLIC_TABLES.filter((t) => t !== "admin_users")) assert.equal((await call(adminAal1, `select * from public.${t}`)).length, 0, t);
    await assert.rejects(call(adminAal1, "select public.admin_transition_booking($1, 'under_review')", [b.id]), sqlState("42501"));
  });

  test("before MFA, a user sees only their own admin row (to be routed to enrollment)", async () => {
    const rows = await call(adminAal1, "select user_id from public.admin_users");
    assert.deepEqual(rows.map((r) => r.user_id), [adminId]);
    assert.equal((await call(stranger, "select * from public.admin_users")).length, 0);
  });

  test("an authenticated non-admin sees nothing and cannot call admin functions, even at AAL2", async () => {
    const b = await newBooking();
    for (const t of PUBLIC_TABLES) assert.equal((await call(stranger, `select * from public.${t}`)).length, 0, t);
    for (const sql of [
      "select public.admin_transition_booking($1, 'under_review')",
      "select public.admin_create_price_proposal($1, 10000)",
      "select * from public.admin_notification_history($1)",
    ])
      await assert.rejects(call(stranger, sql, [b.id]), sqlState("42501"), sql);
  });

  test("a deactivated admin is denied immediately, even at AAL2", async () => {
    const b = await newBooking();
    assert.equal((await call(inactiveAdmin, "select * from public.bookings")).length, 0);
    await assert.rejects(call(inactiveAdmin, "select public.admin_transition_booking($1, 'under_review')", [b.id]), sqlState("42501"));
  });

  test("a forged role claim does not help: claims without an admin row are still denied", async () => {
    const forged = user(uuid(), "aal2");
    await assert.rejects(call(forged, "select public.admin_start_telegram_pairing($1)", [hex(1)]), sqlState("42501"));
  });

  test("unauthorized callers cannot probe whether a booking exists (same error for real and fake ids)", async () => {
    const b = await newBooking();
    for (const id of [b.id, uuid()]) {
      await assert.rejects(call(stranger, "select public.admin_transition_booking($1, 'under_review')", [id]), (e: Error & { code?: string }) => {
        assert.equal(e.code, "42501");
        assert.equal(e.message, "not_authorized");
        return true;
      });
    }
  });

  test("even an admin cannot write tables directly — only through the audited functions", async () => {
    const b = await newBooking();
    await assert.rejects(call(admin, "update public.bookings set status = 'confirmed' where id = $1", [b.id]), sqlState("42501"));
    await assert.rejects(call(admin, "delete from public.booking_status_events"), sqlState("42501"));
    await assert.rejects(call(admin, "insert into public.admin_users (user_id, display_name) values ($1, 'x')", [uuid()]), sqlState("42501"));
    await assert.rejects(call(admin, "select * from driveo_private.notification_outbox"), sqlState("42501"));
  });

  test("authenticated users (admin included) cannot call service-only functions", async () => {
    const s = submission();
    await assert.rejects(call(admin, "select public.submit_booking_request($1, $2, $3, $4)", [uuid(), hash(5), s.booking, s.contact]), sqlState("42501"));
    await assert.rejects(call(admin, "select * from public.claim_notification_events()"), sqlState("42501"));
    await assert.rejects(call(admin, "select public.consume_rate_limit('booking.ip:00000000000000000000', 5, 60)"), sqlState("42501"));
  });
});

describe("service_role is limited to its functions (it bypasses RLS, so grants are the control)", () => {
  test("service_role cannot read or write tables directly", async () => {
    for (const t of PUBLIC_TABLES) await assert.rejects(call(SERVICE, `select * from public.${t}`), sqlState("42501"), t);
    for (const t of PRIVATE_TABLES) await assert.rejects(call(SERVICE, `select * from driveo_private.${t}`), sqlState("42501"), t);
    await assert.rejects(call(SERVICE, "update public.bookings set status = 'confirmed'"), sqlState("42501"));
  });

  test("service_role cannot call admin functions", async () => {
    const b = await newBooking();
    await assert.rejects(call(SERVICE, "select public.admin_transition_booking($1, 'under_review')", [b.id]), sqlState("42501"));
  });
});

/* ------------------------------------------------------------------ submission */

describe("booking submission", () => {
  test("creates the booking, contact, first event, outbox entry and audit entry in one call", async () => {
    const r = await submit(db, uuid(), hash(101));
    assert.match(r.reference, /^DRV-\d{4}-\d{6}$/);
    assert.equal(r.status, "submitted");
    assert.equal(r.duplicate, false);
    const id = await bookingId(db, r.reference);
    const count = async (sql: string) => (await db.query<{ n: number }>(sql, [id])).rows[0].n;
    assert.equal(await count("select count(*)::int as n from public.booking_contacts where booking_id = $1"), 1);
    assert.equal(await count("select count(*)::int as n from public.booking_status_events where booking_id = $1 and to_status = 'submitted' and actor_type = 'system'"), 1);
    assert.equal(await count("select count(*)::int as n from driveo_private.notification_outbox where booking_id = $1 and status = 'pending'"), 1);
    assert.equal(await count("select count(*)::int as n from public.admin_audit_log where entity_id = $1::text and action = 'booking.submitted'"), 1);
  });

  test("a manual-assessment booking needs no quote", async () => {
    const r = await submit(db, uuid(), hash(102));
    const { rows } = await db.query<{ pricing_mode: string; quote_reference: string | null }>(
      "select pricing_mode, quote_reference from public.bookings where reference = $1",
      [r.reference],
    );
    assert.deepEqual(rows[0], { pricing_mode: "manual_assessment", quote_reference: null });
  });

  test("a retried submission (same id, same content) returns the same booking without duplicates", async () => {
    const id = uuid();
    const s = submission();
    const first = await submit(db, id, hash(103), s);
    const again = await submit(db, id, hash(103), s);
    assert.equal(again.reference, first.reference);
    assert.equal(again.duplicate, true);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.submission_id = $1",
      [id],
    );
    assert.equal(rows[0].n, 1);
  });

  test("a reused submission id with different content is rejected", async () => {
    const id = uuid();
    await submit(db, id, hash(104));
    await assert.rejects(submit(db, id, hash(105)), sqlState("DV002"));
  });

  test("automatic pricing submissions are refused at the database level", async () => {
    await assert.rejects(submit(db, uuid(), hash(106), submission({ booking: { pricing_mode: "automatic_quote", quote_reference: "q1" } })), sqlState("DV001"));
  });

  test("invalid data is rejected by constraints and nothing is stored", async () => {
    const before = (await db.query<{ n: number }>("select count(*)::int as n from public.bookings")).rows[0].n;
    const bad = [
      submission({ contact: { phone_e164: "555 12 34 56" } }),
      submission({ booking: { drivable_confirmed: false } }),
      submission({ booking: { powertrain: "steam" } }),
      submission({ booking: { pickup_city: "რუსთავი", pickup_address: "სატესტო გამზირი 1" } }), // same as delivery
    ];
    for (const s of bad) await assert.rejects(submit(db, uuid(), hash(107), s), sqlState("23514"));
    const after = (await db.query<{ n: number }>("select count(*)::int as n from public.bookings")).rows[0].n;
    assert.equal(after, before);
  });

  test("the notification payload is minimal: no name, phone or street address", async () => {
    const r = await submit(db, uuid(), hash(108));
    const { rows } = await db.query<{ payload: Record<string, string> }>(
      "select o.payload from driveo_private.notification_outbox o join public.bookings b on b.id = o.booking_id where b.reference = $1",
      [r.reference],
    );
    const p = rows[0].payload;
    assert.deepEqual(Object.keys(p).sort(), ["delivery_city", "pickup_city", "reference", "submitted_at", "vehicle_make", "vehicle_model"]);
    const text = JSON.stringify(p);
    assert.doesNotMatch(text, /\+995|ტესტაძე|ქუჩა|გამზირი/);
  });

  test("the database refuses a payload carrying personal data, even from the owner", async () => {
    const b = await newBooking();
    for (const payload of [
      { reference: "DRV-2026-000001", phone: "+995555000111" },
      { reference: "DRV-2026-000001", pickup_address: "ქუჩა 1" },
      { reference: "DRV-2026-000001", pickup_city: { nested: true } },
      { pickup_city: "თბილისი" },
    ]) {
      await assert.rejects(
        db.query("insert into driveo_private.notification_outbox (event_type, booking_id, dedupe_key, payload) values ('booking.submitted', $1, $2, $3)", [b.id, uuid(), payload]),
        sqlState("23514"),
      );
    }
  });

  test("one notification event per booking: the dedupe key cannot be reused", async () => {
    const b = await newBooking();
    await assert.rejects(
      db.query("insert into driveo_private.notification_outbox (event_type, booking_id, dedupe_key, payload) values ('booking.submitted', $1, $2, $3)", [
        b.id,
        `booking.submitted:${b.id}`,
        { reference: b.reference },
      ]),
      sqlState("23505"),
    );
  });
});

/* -------------------------------------------------------------------- lifecycle */

const transition = (id: string, to: string, actor: Actor = admin) => call(actor, "select public.admin_transition_booking($1, $2) as s", [id, to]);
const propose = async (id: string, amountMinor: number) =>
  (await call(admin, "select public.admin_create_price_proposal($1, $2) as id", [id, amountMinor]))[0].id as string;
const markSent = async (proposalId: string, via = "sms") =>
  (await call(admin, "select public.admin_mark_proposal_sent($1, $2) as until", [proposalId, via]))[0].until as Date;
const accept = (proposalId: string, o: { method?: string; amount?: number; receivedAt?: string; evidence?: string; statement?: string } = {}) =>
  call(admin, "select public.admin_record_price_acceptance($1, $2, $3, $4, $5, $6) as id", [
    proposalId,
    o.method ?? "sms",
    o.evidence ?? "SMS from +995…111, 21 Oct 10:05",
    o.statement ?? "ვეთანხმები 150 ლარს",
    o.receivedAt ?? new Date().toISOString(),
    o.amount ?? 15000,
  ]);

describe("booking lifecycle", () => {
  test("happy path: review → price sent → written acceptance → confirmed → completed, fully recorded", async () => {
    const b = await newBooking();
    await transition(b.id, "under_review");
    const p = await propose(b.id, 15000);
    const until = await markSent(p);
    assert.equal(await statusOf(b.id), "price_proposed");
    const { rows: sent } = await db.query<{ sent_at: Date; valid_until: Date }>("select sent_at, valid_until from public.price_proposals where id = $1", [p]);
    assert.equal(sent[0].valid_until.getTime() - sent[0].sent_at.getTime(), 12 * 3600 * 1000);
    assert.equal(new Date(until).getTime(), sent[0].valid_until.getTime());
    await accept(p);
    assert.equal(await statusOf(b.id), "customer_accepted");
    await transition(b.id, "confirmed");
    await transition(b.id, "completed");
    const { rows } = await db.query<{ from_status: string | null; to_status: string }>(
      "select from_status, to_status from public.booking_status_events where booking_id = $1 order by id",
      [b.id],
    );
    assert.deepEqual(
      rows.map((r) => `${r.from_status}>${r.to_status}`),
      ["null>submitted", "submitted>under_review", "under_review>price_proposed", "price_proposed>customer_accepted", "customer_accepted>confirmed", "confirmed>completed"],
    );
    const audit = await db.query<{ n: number }>("select count(*)::int as n from public.admin_audit_log where actor_user_id = $1", [adminId]);
    assert.ok(audit.rows[0].n >= 5);
  });

  test("invalid transitions are rejected and leave no trace", async () => {
    const b = await newBooking();
    for (const to of ["confirmed", "completed", "price_proposed", "customer_accepted", "submitted", "nonsense"]) {
      await assert.rejects(transition(b.id, to), sqlState("DV004"), to);
    }
    assert.equal(await statusOf(b.id), "submitted");
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.booking_status_events where booking_id = $1", [b.id]);
    assert.equal(rows[0].n, 1);
  });

  test("terminal statuses cannot be left", async () => {
    const b = await newBooking();
    await transition(b.id, "declined");
    for (const to of ["under_review", "submitted", "confirmed", "cancelled"]) await assert.rejects(transition(b.id, to), sqlState("DV004"), to);
  });

  test("an unknown booking id is reported as not found to an admin", async () => {
    await assert.rejects(transition(uuid(), "under_review"), sqlState("DV003"));
  });

  test("leaving the price stage withdraws the sent proposal", async () => {
    const b = await newBooking();
    await transition(b.id, "under_review");
    const p = await propose(b.id, 20000);
    await markSent(p);
    await transition(b.id, "under_review");
    const { rows } = await db.query<{ status: string }>("select status from public.price_proposals where id = $1", [p]);
    assert.equal(rows[0].status, "withdrawn");
    await assert.rejects(accept(p, { amount: 20000 }), sqlState("DV006"));
  });
});

/* ------------------------------------------------------- manual price & evidence */

describe("manual price proposals and acceptance evidence", () => {
  async function sentProposal(amount = 15000) {
    const b = await newBooking();
    await transition(b.id, "under_review");
    const p = await propose(b.id, amount);
    await markSent(p);
    return { b, p };
  }

  test("prices must be positive whole GEL", async () => {
    const b = await newBooking();
    await transition(b.id, "under_review");
    for (const amount of [0, -100, 15050, 1]) await assert.rejects(propose(b.id, amount), sqlState("DV005"), String(amount));
  });

  test("a price cannot be proposed before review or after a decision", async () => {
    const b = await newBooking();
    await assert.rejects(propose(b.id, 10000), sqlState("DV004"));
    await transition(b.id, "declined");
    await assert.rejects(propose(b.id, 10000), sqlState("DV004"));
  });

  test("prices must be sent in writing (no 'phone' as a sending channel)", async () => {
    const b = await newBooking();
    await transition(b.id, "under_review");
    const p = await propose(b.id, 10000);
    await assert.rejects(markSent(p, "phone"), sqlState("DV005"));
    await markSent(p, "whatsapp");
    await assert.rejects(markSent(p, "sms"), sqlState("DV005")); // already sent
  });

  test("a new price supersedes the sent one and returns the booking to review", async () => {
    const { b, p } = await sentProposal();
    const p2 = await propose(b.id, 18000);
    const { rows } = await db.query<{ id: string; status: string; version: number }>(
      "select id, status, version from public.price_proposals where booking_id = $1 order by version",
      [b.id],
    );
    assert.deepEqual(rows.map((r) => [r.id, r.status, r.version]), [[p, "superseded", 1], [p2, "draft", 2]]);
    assert.equal(await statusOf(b.id), "under_review");
    await assert.rejects(accept(p), sqlState("DV006"));
  });

  test("only one open proposal can exist per booking", async () => {
    const b = await newBooking();
    await transition(b.id, "under_review");
    await propose(b.id, 10000);
    await assert.rejects(
      db.query("insert into public.price_proposals (booking_id, version, amount_minor, created_by) values ($1, 9, 10000, $2)", [b.id, adminId]),
      sqlState("23505"),
    );
  });

  test("acceptance without proper evidence is rejected", async () => {
    const { p } = await sentProposal(15000);
    const cases = [
      { amount: 14000 }, // customer acknowledged a different amount
      { method: "phone" }, // verbal only
      { method: "admin_checkbox" },
      { evidence: " " },
      { statement: "" },
      { receivedAt: new Date(Date.now() - 3600_000).toISOString() }, // before the price was sent
      { receivedAt: new Date(Date.now() + 3600_000).toISOString() }, // in the future
    ];
    for (const c of cases) await assert.rejects(accept(p, c), sqlState("DV006"), JSON.stringify(c));
  });

  test("acceptance must be received within the 12 h validity", async () => {
    const { b, p } = await sentProposal(15000);
    // Pretend the price was sent 13 hours ago (owner-level fixture change).
    await db.query("update public.price_proposals set sent_at = now() - interval '13 hours', valid_until = now() - interval '1 hour' where id = $1", [p]);
    await assert.rejects(accept(p, { receivedAt: new Date(Date.now() - 30 * 60_000).toISOString() }), sqlState("DV006"));
    // A written acceptance that arrived in time may still be recorded later.
    await accept(p, { receivedAt: new Date(Date.now() - 12.5 * 3600_000).toISOString() });
    assert.equal(await statusOf(b.id), "customer_accepted");
  });

  test("an acceptance cannot be recorded twice or for a draft", async () => {
    const { p } = await sentProposal(15000);
    await accept(p);
    await assert.rejects(accept(p), sqlState("DV006"));
    const b = await newBooking();
    await transition(b.id, "under_review");
    const draft = await propose(b.id, 15000);
    await assert.rejects(accept(draft), sqlState("DV006"));
  });
});

/* ------------------------------------------------------------------ append-only */

describe("append-only history", () => {
  test("status events, audit log, acceptances and attempts cannot be changed — even by the owner", async () => {
    const b = await newBooking();
    for (const sql of [
      "update public.booking_status_events set note = 'x'",
      "delete from public.booking_status_events",
      "truncate public.booking_status_events cascade",
      "update public.admin_audit_log set action = 'x.y'",
      "delete from public.admin_audit_log",
      "truncate public.admin_audit_log",
      "delete from public.price_acceptances",
      "truncate public.price_acceptances",
      "delete from driveo_private.notification_attempts",
      "truncate driveo_private.notification_attempts",
    ])
      await assert.rejects(db.query(sql), sqlState("42501"), sql);
    assert.ok((await db.query("select 1 from public.booking_status_events where booking_id = $1", [b.id])).rows.length > 0);
  });
});

/* --------------------------------------------------------------- notifications */

describe("notification outbox", () => {
  async function claimOwn(reference: string) {
    const rows = await call(SERVICE, "select * from public.claim_notification_events(50, 60)");
    const mine = rows.find((r) => (r.payload as { reference: string }).reference === reference);
    assert.ok(mine, "event claimed");
    return mine.event_id as string;
  }
  const attempt = (event: string, channel: string, result: string, errorCode: string | null = null, summary: string | null = null) =>
    call(SERVICE, "select public.record_notification_attempt($1, $2, $3, null, null, $4, $5) as n", [event, channel, result, errorCode, summary]);
  const complete = (event: string, outcome: string, retry: number | null = null) =>
    call(SERVICE, "select public.complete_notification_event($1, $2, $3) as s", [event, outcome, retry]);

  test("Telegram first; email only as a fallback after a Telegram failure", async () => {
    const b = await newBooking();
    const ev = await claimOwn(b.reference);
    await assert.rejects(complete(ev, "sent_telegram"), sqlState("DV007")); // nothing accepted yet
    await attempt(ev, "email", "accepted");
    await assert.rejects(complete(ev, "sent_email_fallback"), sqlState("DV007")); // Telegram not tried
    await attempt(ev, "telegram", "failed", "telegram_http_502", "Bad gateway");
    await complete(ev, "sent_email_fallback");
    await assert.rejects(complete(ev, "failed_all"), sqlState("DV007")); // already complete
    const history = await call(admin, "select * from public.admin_notification_history($1)", [b.id]);
    assert.deepEqual(history.map((h) => `${h.channel}:${h.attempt_no}:${h.result}`).sort(), ["email:1:accepted", "telegram:1:failed"]);
    assert.ok(history.every((h) => !("payload" in h)));
  });

  test("retry scheduling, failure, and admin recovery", async () => {
    const b = await newBooking();
    let ev = await claimOwn(b.reference);
    await attempt(ev, "telegram", "failed", "telegram_timeout");
    assert.equal((await complete(ev, "retry", 1))[0].s, "pending");
    await db.query("update driveo_private.notification_outbox set next_attempt_at = now() where id = $1", [ev]);
    ev = await claimOwn(b.reference);
    assert.equal((await attempt(ev, "telegram", "failed", "telegram_timeout"))[0].n, 2);
    await complete(ev, "failed_all");
    await assert.rejects(call(stranger, "select public.admin_retry_notification($1)", [ev]), sqlState("42501"));
    await call(admin, "select public.admin_retry_notification($1)", [ev]);
    await assert.rejects(call(admin, "select public.admin_retry_notification($1)", [ev]), sqlState("DV007")); // only failed events
    ev = await claimOwn(b.reference);
    await attempt(ev, "telegram", "accepted");
    assert.equal((await complete(ev, "sent_telegram"))[0].s, "sent_telegram");
  });

  test("attempts cannot be recorded for an unclaimed event, and error summaries cannot carry URLs, tokens or phones", async () => {
    const b = await newBooking();
    const { rows } = await db.query<{ id: string }>("select id from driveo_private.notification_outbox where booking_id = $1", [b.id]);
    await assert.rejects(attempt(rows[0].id, "telegram", "failed", "x"), sqlState("DV007"));
    const ev = await claimOwn(b.reference);
    for (const summary of ["see https://api.telegram.org/bot123/sendMessage", "token 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", "customer +995 555 00 01 11"])
      await assert.rejects(attempt(ev, "telegram", "failed", "telegram_error", summary), sqlState("23514"), summary);
  });
});

/* --------------------------------------------------------------- rate limiting */

describe("persistent rate limit", () => {
  test("allows up to the limit in a window, then refuses", async () => {
    const key = `booking.ip:${"a".repeat(32)}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await call(SERVICE, "select public.consume_rate_limit($1, 3, 3600) as ok", [key]))[0].ok);
    assert.deepEqual(results, [true, true, true, false]);
  });

  test("raw IPs or phone numbers cannot be used as keys", async () => {
    for (const key of ["booking.ip:203.0.113.7", "booking.phone:+995555000111", "203.0.113.7"])
      await assert.rejects(call(SERVICE, "select public.consume_rate_limit($1, 3, 60)", [key]), sqlState("23514"), key);
  });
});

/* ------------------------------------------------------------- Telegram pairing */

describe("Telegram pairing challenge (prepared, inactive)", () => {
  const SESSION = hex("5e55");
  const CODE = hex("c0de");
  const CHAT = hex("c4a7");
  const start = async (actor: Actor = admin, session = SESSION) =>
    (await call(actor, "select public.admin_start_telegram_pairing($1) as id", [session]))[0].id as string;
  const attach = async (id: string, code = CODE) => (await call(SERVICE, "select public.attach_telegram_pairing_code($1, $2, $3) as ok", [id, code, CHAT]))[0].ok;
  const verify = async (id: string, session = SESSION, code = CODE, actor: Actor = admin) =>
    (await call(actor, "select public.admin_verify_telegram_pairing($1, $2, $3) as chat", [id, session, code]))[0].chat;

  test("only a full admin can start pairing", async () => {
    await assert.rejects(start(stranger), sqlState("42501"));
    await assert.rejects(start(adminAal1), sqlState("42501"));
  });

  test("succeeds once, from the same session, with the right code", async () => {
    const id = await start();
    assert.equal(await attach(id), true);
    assert.equal(await attach(id, hex("0ther")), false); // one code per challenge
    assert.equal(await verify(id, hex("0ther5e55")), null); // different session
    assert.equal(await verify(id), CHAT);
    assert.equal(await verify(id), null); // single use
  });

  test("five wrong codes lock the challenge", async () => {
    const id = await start();
    await attach(id);
    for (let i = 0; i < 5; i++) assert.equal(await verify(id, SESSION, hex(`bad${i}`)), null);
    assert.equal(await verify(id), null);
    const { rows } = await db.query<{ outcome: string; failed_attempts: number }>(
      "select outcome, failed_attempts from driveo_private.telegram_pairing_challenges where id = $1",
      [id],
    );
    assert.deepEqual(rows[0], { outcome: "locked", failed_attempts: 5 });
  });

  test("expired challenges cannot be used, and a new challenge supersedes the old one", async () => {
    const old = await start();
    const id = await start();
    const { rows } = await db.query<{ outcome: string }>("select outcome from driveo_private.telegram_pairing_challenges where id = $1", [old]);
    assert.equal(rows[0].outcome, "superseded");
    await attach(id);
    await db.query("update driveo_private.telegram_pairing_challenges set created_at = now() - interval '20 minutes', expires_at = now() - interval '11 minutes' where id = $1", [id]);
    assert.equal(await verify(id), null);
  });

  test("challenges cannot live longer than 10 minutes", async () => {
    await assert.rejects(
      db.query("insert into driveo_private.telegram_pairing_challenges (admin_user_id, session_binding_hash, expires_at) values ($1, $2, now() + interval '1 hour')", [adminId, SESSION]),
      sqlState("23514"),
    );
  });
});


/* ------------------------------------------- live verification script (offline) */

describe("post-migration check script", () => {
  test("query 1 of supabase/verification/post-migration-checks.sql reports no problems", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(import.meta.dirname, "..", "verification", "post-migration-checks.sql"), "utf8");
    const query1 = sql.slice(sql.indexOf("-- Query 1"), sql.indexOf("-- Query 2"));
    const { rows } = await db.query(query1);
    assert.deepEqual(rows, []);
  });

  test("the check script detects a weakened grant", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(import.meta.dirname, "..", "verification", "post-migration-checks.sql"), "utf8");
    const query1 = sql.slice(sql.indexOf("-- Query 1"), sql.indexOf("-- Query 2"));
    await db.exec("begin; grant select on public.booking_contacts to anon;");
    try {
      const { rows } = await db.query<{ check: string; detail: string }>(query1);
      assert.deepEqual(rows.map((r) => `${r.check}: ${r.detail}`), ["anon has a table privilege: public.booking_contacts SELECT"]);
    } finally {
      await db.exec("rollback;");
    }
  });
});
