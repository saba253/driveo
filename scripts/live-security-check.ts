/**
 * DRIVEO — live security check against the founder's Supabase DEVELOPMENT project.
 * NOT run by `npm test`. Run it only after the founder approves (docs/supabase-setup.md §7):
 *
 *   node --env-file=.env.local scripts/live-security-check.ts [--expect-inactive-admin] [--with-test-booking]
 *
 * Requires in .env.local: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
 * DRIVEO_LIVE_TARGET=development, DRIVEO_LIVE_PROJECT_REF=<ref of the dev project>.
 * --with-test-booking also needs SUPABASE_SECRET_KEY and writes ONE fictional
 * booking that stays in the dev database (history is append-only).
 *
 * Passwords and the TOTP code are typed at hidden prompts — never put them in
 * files, arguments or chat. The script prints PASS/FAIL lines only, never
 * tokens, keys, emails or row contents.
 */
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "../src/lib/supabase/config.ts";
import { checkLiveTarget, SCHEMA_NOT_EXPOSED } from "../src/lib/supabase/live-target.ts";

const PUBLIC_TABLES = ["admin_users", "drivers", "bookings", "booking_contacts", "booking_status_events", "price_proposals", "price_acceptances", "admin_audit_log"];
const PRIVATE_TABLES = ["notification_outbox", "notification_attempts", "telegram_pairing_challenges", "rate_limit_counters"];
const RANDOM_ID = "00000000-0000-4000-8000-000000000000";
const LIVE_KEY = "live.check:0000000000000000";

let failures = 0;
function report(ok: boolean, label: string, note = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${note ? `  (${note})` : ""}`);
}

/** Prompt; with `hidden`, typed characters are not echoed. */
function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const internal = rl as unknown as { _writeToOutput: (s: string) => void };
    const write = internal._writeToOutput.bind(rl);
    internal._writeToOutput = (s: string) => write(s.startsWith(question) ? question : "");
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const client = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const denied = (e: { code?: string } | null) => !!e && e.code === "42501";
/** For RPC, PostgREST may also hide a function the role cannot execute (PGRST202). Both are denials. */
const deniedRpc = (e: { code?: string } | null) => denied(e) || e?.code === "PGRST202";

async function expectTablesDenied(db: SupabaseClient, who: string) {
  for (const t of PUBLIC_TABLES) {
    const { error } = await db.from(t).select("*").limit(1);
    report(denied(error), `${who}: public.${t} is denied`, error?.code ?? "no error");
  }
}

async function expectTablesEmpty(db: SupabaseClient, who: string, except: string[] = []) {
  for (const t of PUBLIC_TABLES.filter((x) => !except.includes(x))) {
    const { data, error } = await db.from(t).select("*").limit(5);
    report(!error && data?.length === 0, `${who}: public.${t} shows no rows`, error?.code ?? `${data?.length} rows`);
  }
}

async function expectPrivateHidden(db: SupabaseClient, who: string) {
  for (const t of PRIVATE_TABLES) {
    const { error } = await db.schema("driveo_private").from(t).select("*").limit(1);
    report(error?.code === SCHEMA_NOT_EXPOSED, `${who}: driveo_private.${t} is not exposed`, error?.code ?? "no error");
  }
}

async function expectAdminRpcDenied(db: SupabaseClient, who: string) {
  const { error } = await db.rpc("admin_transition_booking", { p_booking_id: RANDOM_ID, p_to_status: "under_review" });
  report(deniedRpc(error), `${who}: admin_transition_booking is denied`, error?.code ?? "no error");
  const { error: e2 } = await db.rpc("consume_rate_limit", { p_key: LIVE_KEY, p_limit: 1, p_window_seconds: 60 });
  report(deniedRpc(e2), `${who}: service-only consume_rate_limit is denied`, e2?.code ?? "no error");
}

async function signIn(url: string, key: string, label: string): Promise<SupabaseClient | null> {
  const email = await ask(`${label} email: `);
  const password = await ask(`${label} password (hidden): `, true);
  const db = client(url, key);
  const { error } = await db.auth.signInWithPassword({ email, password });
  report(!error, `${label}: password sign-in works`, error?.code ?? "");
  return error ? null : db;
}

async function testBooking(url: string): Promise<string | null> {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("--with-test-booking needs SUPABASE_SECRET_KEY in .env.local");
  if ((await ask("Write ONE fictional booking to the DEVELOPMENT database? Type yes: ")) !== "yes") return null;
  const service = client(url, secret);
  const booking = {
    pricing_mode: "manual_assessment",
    pickup_city: "თბილისი",
    pickup_address: "სატესტო ქუჩა 1 (TEST)",
    delivery_city: "რუსთავი",
    delivery_address: "სატესტო გამზირი 2 (TEST)",
    requested_date: "2030-01-15",
    requested_time: "10:00",
    vehicle_make: "TEST",
    vehicle_model: "TEST",
    powertrain: "petrol",
    transmission: "automatic",
    drivable_confirmed: true,
    fuel_policy_id: "customer-provided",
    fuel_policy_version: 2,
    consented_at: new Date().toISOString(),
  };
  const contact = { full_name: "ტესტი ტესტაძე", phone_e164: "+995500000000", preferred_contact: "phone" };
  const params = {
    p_submission_id: randomUUID(),
    p_submission_hash: `sha256:${createHash("sha256").update(JSON.stringify({ booking, contact })).digest("hex")}`,
    p_booking: booking,
    p_contact: contact,
  };
  const first = await service.rpc("submit_booking_request", params);
  report(!first.error && first.data?.status === "submitted" && first.data?.duplicate === false, "service: manual booking without a quote is accepted", first.error?.code ?? "");
  const again = await service.rpc("submit_booking_request", params);
  report(!again.error && again.data?.duplicate === true && again.data?.reference === first.data?.reference, "service: a retried submission is not duplicated");
  const { error: direct } = await service.from("bookings").select("id").limit(1);
  report(denied(direct), "service: direct table read is denied (functions only)", direct?.code ?? "no error");
  return (first.data?.reference as string | undefined) ?? null;
}

async function main() {
  const target = checkLiveTarget(process.env);
  if (!target.ok) throw new Error(`Refusing to run: ${target.reason}`);
  const cfg = readSupabaseConfig({ ...process.env, NODE_ENV: undefined });
  if (!cfg.ok) throw new Error(`Supabase config invalid: ${cfg.reason}`);
  const { url, publishableKey } = cfg.config;
  const args = new Set(process.argv.slice(2));
  console.log(`Target: development project ${target.projectRef}\n`);

  // 1. Auth settings anyone can read.
  const settings = (await (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } })).json()) as {
    disable_signup?: boolean;
    external?: Record<string, boolean>;
  };
  report(settings.disable_signup === true, "Auth: public sign-up is disabled");
  if (settings.external && "anonymous_users" in settings.external) {
    report(settings.external.anonymous_users === false, "Auth: anonymous sign-ins are disabled");
  } else {
    console.log("INFO  Auth: anonymous sign-in setting not reported here; confirm it is off in the dashboard");
  }

  // 2. Anonymous (publishable key, no session).
  const anon = client(url, publishableKey);
  await expectTablesDenied(anon, "anon");
  await expectPrivateHidden(anon, "anon");
  await expectAdminRpcDenied(anon, "anon");
  const { error: submitErr } = await anon.rpc("submit_booking_request", {
    p_submission_id: randomUUID(),
    p_submission_hash: `sha256:${"0".repeat(64)}`,
    p_booking: {},
    p_contact: {},
  });
  report(deniedRpc(submitErr), "anon: submit_booking_request is denied", submitErr?.code ?? "no error");
  const spec = await fetch(`${url}/rest/v1/`, { headers: { apikey: publishableKey } });
  const specText = spec.ok ? await spec.text() : "";
  report(!/booking_contacts|admin_users|submit_booking_request/.test(specText), "anon: the API listing reveals no app tables or functions", `HTTP ${spec.status}`);

  // 3. Authenticated, not an admin.
  const nonAdmin = await signIn(url, publishableKey, "Non-admin TEST user");
  if (nonAdmin) {
    await expectTablesEmpty(nonAdmin, "non-admin");
    await expectPrivateHidden(nonAdmin, "non-admin");
    await expectAdminRpcDenied(nonAdmin, "non-admin");
    await nonAdmin.auth.signOut({ scope: "local" });
  }

  // 4. Optional: one fictional manual-assessment booking through the secret key.
  const testReference = args.has("--with-test-booking") ? await testBooking(url) : null;

  // 5. Founder: AAL1 first, then AAL2 on the same session.
  const admin = await signIn(url, publishableKey, "Admin (founder)");
  if (admin) {
    const { data: own } = await admin.from("admin_users").select("is_active");
    report(own?.length === 1, "admin AAL1: sees only their own admin row", `${own?.length ?? 0} rows`);
    await expectTablesEmpty(admin, "admin AAL1", ["admin_users"]);
    await expectAdminRpcDenied(admin, "admin AAL1");

    const { data: factors } = await admin.auth.mfa.listFactors();
    const factor = factors?.totp[0];
    report(!!factor, "admin: has a verified TOTP factor", `${factors?.totp.length ?? 0} verified`);
    const { data: extra, error: enrollErr } = await admin.auth.mfa.enroll({ factorType: "totp", friendlyName: `live-check-${Date.now()}` });
    report(!!enrollErr, "admin AAL1: cannot enroll another factor without AAL2", enrollErr?.code ?? "ENROLLED — see note below");
    if (extra) {
      await admin.auth.mfa.unenroll({ factorId: extra.id });
      console.log("NOTE  An AAL1 session could start enrolling a factor. Restrict TOTP enrollment in the dashboard (setup guide §4).");
    }

    if (factor) {
      const code = await ask("Current 6-digit code from the authenticator app (hidden): ", true);
      const { error } = await admin.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      report(!error, "admin: TOTP verification succeeds", error?.code ?? "");
      if (!error) {
        const { data: rows, error: readErr } = await admin.from("bookings").select("reference").limit(50);
        if (args.has("--expect-inactive-admin")) {
          report(!readErr && rows?.length === 0, "inactive admin AAL2: sees no bookings", readErr?.code ?? `${rows?.length} rows`);
          await expectAdminRpcDenied(admin, "inactive admin AAL2");
        } else {
          report(!readErr, "admin AAL2: can read bookings", readErr?.code ?? `${rows?.length} rows`);
          const { error: cErr } = await admin.from("booking_contacts").select("booking_id").limit(1);
          report(!cErr, "admin AAL2: can read contacts", cErr?.code ?? "");
          if (testReference) report(!!rows?.some((r) => r.reference === testReference), "admin AAL2: sees the test booking");
          const { error: tErr } = await admin.rpc("admin_transition_booking", { p_booking_id: RANDOM_ID, p_to_status: "under_review" });
          report(tErr?.code === "DV003", "admin AAL2: admin functions authorize (unknown id gives DV003; nothing changes)", tErr?.code ?? "no error");
          const { error: sErr } = await admin.rpc("consume_rate_limit", { p_key: LIVE_KEY, p_limit: 1, p_window_seconds: 60 });
          report(deniedRpc(sErr), "admin AAL2: service-only function still denied", sErr?.code ?? "no error");
          await expectPrivateHidden(admin, "admin AAL2");
        }
        const { data: session } = await admin.auth.getSession();
        const refreshToken = session.session?.refresh_token ?? "";
        await admin.auth.signOut({ scope: "global" });
        const { error: refreshErr } = await client(url, publishableKey).auth.refreshSession({ refresh_token: refreshToken });
        report(!!refreshErr, "sign-out (global): the old refresh token no longer works", refreshErr?.code ?? "REFRESH SUCCEEDED");
      }
    }
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED. Do not continue to real data.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e: Error) => {
  console.error(`ERROR  ${e.message}`);
  process.exitCode = 1;
});
