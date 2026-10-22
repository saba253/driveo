/**
 * TEST ONLY: boots the DRIVEO migrations inside PGlite (PostgreSQL compiled to
 * WASM) on top of a small Supabase imitation, and runs queries as a given role
 * with given JWT claims — the same way PostgREST does (SET LOCAL ROLE +
 * request.jwt.claims). This verifies real PostgreSQL grant/RLS semantics, but not
 * a live Supabase project (see docs/database-and-auth.md, "What the tests cover").
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const ROOT = join(import.meta.dirname, "..");

/** Migration files in order; `before` keeps only those whose name sorts before it. */
export function migrationFiles(before?: string): string[] {
  return readdirSync(join(ROOT, "migrations"))
    .filter((f) => f.endsWith(".sql") && (!before || f < before))
    .sort()
    .map((f) => join(ROOT, "migrations", f));
}

export async function createTestDb(opts: { before?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(ROOT, "tests", "supabase-shim.sql"), "utf8"));
  for (const file of migrationFiles(opts.before)) await db.exec(readFileSync(file, "utf8"));
  return db;
}

export type Role = "anon" | "authenticated" | "service_role";
export interface Actor {
  role: Role;
  sub?: string;
  aal?: "aal1" | "aal2";
}

export const ANON: Actor = { role: "anon" };
export const SERVICE: Actor = { role: "service_role" };
export const user = (sub: string, aal: "aal1" | "aal2"): Actor => ({ role: "authenticated", sub, aal });

/** Runs `fn` in one transaction as `actor`. A thrown error rolls the transaction back. */
export async function as<T>(db: PGlite, actor: Actor, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const claims: Record<string, string> = { role: actor.role };
    if (actor.sub) claims.sub = actor.sub;
    if (actor.aal) claims.aal = actor.aal;
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.query(`set local role ${actor.role}`);
    return fn(tx);
  });
}

/** Convenience: one statement as `actor`, returning the rows. */
export async function q<R = Record<string, unknown>>(db: PGlite, actor: Actor, sql: string, params: unknown[] = []): Promise<R[]> {
  return as(db, actor, async (tx) => (await tx.query<R>(sql, params)).rows);
}

/** Matcher for assert.rejects: a PostgreSQL error with this SQLSTATE. */
export const sqlState = (code: string) => (err: unknown) => {
  const actual = (err as { code?: string }).code;
  if (actual !== code) throw new Error(`expected SQLSTATE ${code}, got ${actual}: ${(err as Error).message}`);
  return true;
};

/** Creates an auth user (as the superuser, like the dashboard would) and optionally an admin row. */
export async function createUser(db: PGlite, opts: { admin?: boolean; active?: boolean } = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values (gen_random_uuid()::text || '@example.test') returning id");
  const id = rows[0].id;
  if (opts.admin) {
    const active = opts.active ?? true;
    await db.query("insert into public.admin_users (user_id, display_name, is_active, deactivated_at) values ($1, 'Test admin', $2, $3)", [
      id,
      active,
      active ? null : new Date().toISOString(),
    ]);
  }
  return id;
}

let submissionCounter = 0;

/** A valid manual-assessment submission (fictional data). */
export function submission(overrides: { booking?: Record<string, unknown>; contact?: Record<string, unknown> } = {}) {
  submissionCounter++;
  return {
    booking: {
      pricing_mode: "manual_assessment",
      pickup_city: "თბილისი",
      pickup_address: `ტესტის ქუჩა ${submissionCounter}`,
      delivery_city: "რუსთავი",
      delivery_address: "სატესტო გამზირი 1",
      requested_date: "2026-11-02",
      requested_time: "10:00",
      vehicle_make: "Toyota",
      vehicle_model: "Prius",
      powertrain: "hybrid",
      transmission: "automatic",
      drivable_confirmed: true,
      fuel_policy_id: "customer-provided",
      fuel_policy_version: 2,
      consented_at: "2026-10-21T08:00:00Z",
      ...overrides.booking,
    },
    contact: {
      full_name: "ტესტი ტესტაძე",
      phone_e164: "+995555000111",
      preferred_contact: "phone",
      ...overrides.contact,
    },
  };
}

export const hash = (n: number | string) => `sha256:${String(n).padStart(64, "0")}`;

export interface SubmitResult {
  reference: string;
  status: string;
  duplicate: boolean;
}

export async function submit(db: PGlite, submissionId: string, submissionHash: string, s = submission()): Promise<SubmitResult> {
  const rows = await q<{ r: SubmitResult }>(db, SERVICE, "select public.submit_booking_request($1, $2, $3, $4) as r", [
    submissionId,
    submissionHash,
    s.booking,
    s.contact,
  ]);
  return rows[0].r;
}

export async function bookingId(db: PGlite, reference: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("select id from public.bookings where reference = $1", [reference]);
  return rows[0].id;
}
