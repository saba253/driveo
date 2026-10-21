# DRIVEO — Supabase preflight and founder setup (Step 1.7B.2)

Status: **preflight complete. Nothing is connected.** No Supabase project, account or key has been created or used by this repository. The setup below is done by the founder, on a **development** project only, after approval.

Never paste a password, key, database password, TOTP secret or QR code into a chat, ticket or screenshot. Enter them only in the Supabase dashboard, your password manager, or the local `.env.local` file, which git ignores.

---

## 1. Preflight findings

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | The Supabase URL and key used `NEXT_PUBLIC_` names, although nothing in the browser uses Supabase. A secret key put in such a variable by mistake would be shipped to browsers. | High | **Fixed.** The names are now server-only: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The app refuses `sb_secret_…` keys and legacy `service_role` JWTs as the session key, and refuses to start Supabase at all if any `NEXT_PUBLIC_` variable holds a secret. |
| F2 | `@supabase/ssr` writes auth cookies that browser scripts can read (`httpOnly: false`) and that last 400 days. | Medium | **Fixed.** Cookies are now HttpOnly, SameSite=Lax, Secure in production, and expire after at most 12 hours. No browser code needs them. |
| F3 | Admin login would be reachable in production with only in-memory attempt limits. | High | **Fixed.** In production the admin area reports "not configured" unless `ADMIN_AUTH_PRODUCTION_ENABLED=true`. Set it only after §5's production safeguards are in place. |
| F4 | The server read the assurance level through a session helper, not from the verified token. | Low | **Fixed.** The level is now read from `getClaims()`, the signature-verified JWT. That is the same `aal` claim the database checks, and its `sub` must match the user from `getUser()`. |
| F5 | There was no way to add a backup authenticator. Supabase recovery codes are experimental. | Medium | **Fixed.** An admin at AAL2 can add **one** backup TOTP factor at `/admin/security`, for a maximum of 2. See §4. |
| F6 | The migration files were dated tomorrow (`20261022…`). A migration created today with `supabase migration new` would have sorted before them. | Low | **Fixed.** Renamed to `20261021000100/200/300`. They have never been applied anywhere. |
| F7 | Supabase Auth is a public API. Anyone who knows the password, the project URL and the publishable key can sign in **directly** (bypassing DRIVEO), and could enroll their own TOTP factor if the founder hasn't enrolled yet. | High until setup is finished | **Procedure.** Use a unique generated password. Enroll TOTP *immediately* after creating the account. Enable the "MFA factor enrolled" security email. Then restrict TOTP enrollment in the dashboard (§6, step 9). The live check tests whether an AAL1 session can enroll (§7). |
| F8 | Security Advisor will flag some objects by design: <br>• **0029**: `admin_*` SECURITY DEFINER functions can be executed by `authenticated`. <br>• **0008**: the `driveo_private` tables have RLS on and no policies. <br>• **0006**: `admin_users` has two permissive SELECT policies. <br>• **0027**: `authenticated` can see table metadata in GraphQL. | Info | **Expected.** <br>• 0029: every one of these functions starts with `require_admin()` (AAL2 + active admin). <br>• 0008: no access at all is intended. <br>• 0006: a performance note only. <br>• 0027: metadata only; RLS still filters rows. Optionally disable `pg_graphql` (§6, step 5). <br>Any **other** security warning is a stop. |
| F9 | `claim_notification_events(null, …)` would claim without a limit. | Low | Deferred to the worker step. Only `service_role` can call it, and no worker exists. |
| F10 | "Append-only" triggers stop app roles and accidental edits. The table owner (`postgres`, i.e. the SQL Editor) could still disable them. | Info | Accepted. Access to the dashboard and database password is the trust boundary, so protect them with MFA. |
| F11 | Global sign-out revokes refresh tokens. Access tokens already issued stay valid until they expire (default 1 hour). | Info | Accepted. Deactivating `admin_users.is_active` cuts database access at once anyway. |
| F12 | The local `supabase/config.toml` that `supabase init` creates has `enable_signup = true` for the *local* stack. | Medium if pushed | **Never run `supabase config push`.** All hosted Auth settings are made in the dashboard. |

**Revoking table grants does not break the server functions.**
- All writes run inside SECURITY DEFINER functions owned by `postgres`, the table owner. They bypass RLS through ownership, so `service_role` and `authenticated` need no table write grants.
- Confirmed offline: the PGlite tests submit, transition, propose, accept and run the outbox with every table grant revoked.
- It will be confirmed live by `--with-test-booking` (§7).
- No access control was weakened in this step.

### What PGlite cannot tell us about Supabase

| Area | Offline (PGlite) | Live check needed |
| --- | --- | --- |
| Roles | The shim creates `anon`, `authenticated` and `service_role` (BYPASSRLS). | The real roles, plus `authenticator` and `supabase_admin` |
| Ownership | Owner actions run as a superuser. | In Supabase, `postgres` is not a superuser. The functions work because `postgres` **owns** the tables and RLS is not forced. The check SQL confirms both. |
| Default grants | Imitates the old "expose everything" defaults. | They vary by project and the "Automatically expose new tables" toggle. The migrations grant and revoke explicitly, so both settings end in the same state. |
| `auth.uid()` / `auth.jwt()` | Read `request.jwt.claims`. | Supabase's versions read the same setting, plus legacy fallbacks. |
| PostgREST | Not present. | Schema exposure, error codes (`42501`, `PGRST106`, `PGRST202`), the OpenAPI listing, and RPC parameter handling |
| GoTrue (Auth) | Not present. | Sign-in, MFA enroll/verify, the `aal` claim in real tokens, disabled sign-up, global sign-out |
| PostgreSQL version | 18.3 | Supabase runs 15 or 17. The migrations use nothing newer than 15. The check SQL prints the version. |
| Event triggers and Realtime | None | Supabase's own event triggers are compatible. No table is added to the Realtime publication, and the checks confirm it. |

---

## 2. Security model on Supabase (what the setup must preserve)

- **Anonymous clients:** no table and no function access.
- **Signed-in non-admins:** see nothing. A user can read only their own `admin_users` row, and only if one exists.
- **AAL1 sessions (password only):** see nothing except their own admin row, and can't call admin functions.
- **Active admin at AAL2:** reads the booking tables and calls the `admin_*` functions. All writes go through those functions.
- **`driveo_private`:** must **not** be in the Data API's exposed schemas.
- **Secret key (`sb_secret_…`, the `service_role` role):**
  - Server-only, and not used by the app yet.
  - It has no table access at all, only the six service functions.
  - Supabase also rejects secret keys sent from browsers, but that's a safeguard, not a reason to expose one.

---

## 3. Rate limiting assessment

**Current state:** sign-in and MFA attempts are limited in memory (5 per client and 30 overall per 15 minutes).

Why that isn't enough for production:
1. **Serverless memory isn't shared.** Every function instance and every cold start has its own empty counters, so an attacker spread across instances gets many times the limit.
2. **Supabase sees our server's IP.** Its per-IP limits are 150 per 5 minutes on `/token` (password sign-in) and 15 per minute on MFA verify. With every login proxied through DRIVEO's server, all users share one bucket. An attacker could exhaust it and lock the founder out.
3. **The Auth API can be called directly,** bypassing DRIVEO's limits entirely. Supabase's per-IP limits apply there.

**Production proposal (all required before setting `ADMIN_AUTH_PRODUCTION_ENABLED=true`):**
1. **CAPTCHA on Supabase Auth.** Use Cloudflare Turnstile or hCaptcha (Authentication → Bot and Abuse Protection). It protects both DRIVEO's login and direct API calls. The sign-in Server Action forwards the `captchaToken`.
2. **Persistent limiter.** Switch the Server Actions to `public.consume_rate_limit`, already built and tested, called with the secret key from server code. Keys are HMAC hashes: `login.ip:<hmac(ip)>`, `login.account:<hmac(email)>`, plus one global key. This counts across all instances.
3. **Edge rate-limit rule** at the host's firewall, for example a Vercel WAF rule: about 10 POSTs per minute per IP on `/admin/*`.
4. **Optional:** enable Supabase IP-address forwarding and send `Sb-Forwarded-For` so Supabase limits by the real client IP. Supabase accepts this header only with a secret key, so it means calling Auth from the server with that key. Weigh this carefully.

---

## 4. MFA, backup factor and account recovery

Verified against current Supabase documentation (October 2026):
- TOTP is free and on by default.
- Verifying a factor promotes the session to AAL2 and signs out other sessions.
- Removing a verified factor requires AAL2.
- Enrollment and verification can each be restricted in the dashboard.
- **Recovery codes exist only behind an experimental client flag, so DRIVEO does not use them.**
- The docs don't confirm whether enrolling an *additional* factor requires AAL2. The live check tests this, and the dashboard restriction in §6 step 9 covers it either way.

**Plan:**
- **Primary factor:** an authenticator app on the founder's phone. Enroll it at `/admin/mfa` immediately after the account is created.
- **Backup factor:** a second authenticator on a **different** device, for example a tablet or a password manager with TOTP. Add it at `/admin/security`, which needs AAL2. That page allows at most 2 factors.
- **Lost primary device:** sign in with the backup factor. Then remove the lost factor in the dashboard (Authentication → Users → the user → MFA factors) and add a new backup.
- **Both devices lost:**
  1. Sign in to the **Supabase dashboard**, protected by its own MFA and its own recovery codes kept offline.
  2. Go to Authentication → Users → the user and delete the TOTP factors.
  3. Temporarily allow TOTP enrollment again, sign in to `/admin` and enroll a new factor at once.
  4. Restrict enrollment again.
  5. Review `admin_audit_log`.
- **Forgotten password:** send a reset email from the dashboard. Never set or share a password through chat.
- **Suspected compromise:**
  1. `update public.admin_users set is_active = false, deactivated_at = now() where user_id = (select id from auth.users where email = '<founder email>');` This cuts access at once.
  2. Sign out all sessions in the dashboard.
  3. Change the password and replace both factors.
  4. Rotate API keys if there's any doubt.
  5. Review the audit log.
  6. Reactivate with `set is_active = true, deactivated_at = null`.

**Initial enrollment safety:**
- A password-only (AAL1) session reaches nothing but its own admin row. This is enforced by RLS and the restrictive AAL2 policies, and was tested offline.
- DRIVEO's enrollment action runs only for an active admin with **zero** verified factors.
- The remaining risk is F7: someone with the password enrolling first. The procedure in §6 removes it.

---

## 5. Production prerequisites (not part of this step)

- The rate-limit measures in §3 (CAPTCHA, persistent limiter, edge rule).
- A **separate production project**. The development project is never promoted.
- Leaked-password protection, if the plan allows it.
- Session time-box and inactivity timeout, if the plan allows them.
- `ADMIN_AUTH_PRODUCTION_ENABLED=true` set only after the live checks pass on the production project too.

---

## 6. Founder setup guide (development project)

You'll need: a password manager, the authenticator app on your phone, a second device for the backup authenticator, and about an hour. Supabase sometimes renames dashboard menus. If a name differs slightly, look for the closest match and don't guess at settings. Stop and ask instead.

1. **Create the project.**
   1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → New project.
   2. Name it `driveo-dev`.
   3. **Database password:** use the generator and save it straight into your password manager.
   4. **Region:** a European one. **Central EU (Frankfurt)** is recommended.
   5. If shown: keep **Enable Data API** on, turn **Automatically expose new tables** off, and turn **automatic RLS** on.
   6. Turn on MFA for your Supabase *account* (Account → Security) and keep its recovery codes offline.
2. **Disable public sign-ups.** In Authentication → Sign In / Providers:
   1. Turn **Allow new users to sign up** off.
   2. Turn **Allow anonymous sign-ins** off.
   3. Keep the Email provider on, with **Confirm email** on.
3. **URL configuration.** In Authentication → URL Configuration, set the Site URL to `http://localhost:3000`. Add no other redirect URLs.
4. **Security emails.** In Authentication → Emails (or Notifications), enable the security notifications for **password changed**, **email changed**, **MFA factor enrolled** and **MFA factor removed**.
5. **Data API exposure.**
   1. Open Integrations → Data API → Settings (also reachable as Project Settings → Data API).
   2. **Exposed schemas** must be `public` (and `graphql_public` if listed) and must **not** include `driveo_private`.
   3. Optional: Database → Extensions → disable `pg_graphql`. DRIVEO doesn't use GraphQL.
6. **Keys.**
   1. Go to Project Settings → API Keys.
   2. Copy the **Project URL** (also in the Connect dialog) and the **publishable key** (`sb_publishable_…`) into `.env.local` in the project folder:
      ```
      SUPABASE_URL=https://<project-ref>.supabase.co
      SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
      ```
   3. **Don't copy the secret key** now.
   4. Never use a `NEXT_PUBLIC_` name for either value; the app refuses that.
7. **Apply the migrations.** Only after approval of §8. These commands use the official Supabase CLI, pinned version:
   1. Log in. This opens the browser, and the token is stored on your computer:
      ```bash
      npx supabase@2.120.0 login
      ```
   2. Only if `supabase/config.toml` doesn't exist yet: run the next command and answer **N** to the editor questions. Never run `supabase config push`.
      ```bash
      npx supabase@2.120.0 init
      ```
   3. Link the project. It asks for the database password; type it at the prompt:
      ```bash
      npx supabase@2.120.0 link --project-ref <project-ref>
      ```
   4. Do a dry run. It must list exactly the three DRIVEO migrations:
      ```bash
      npx supabase@2.120.0 db push --dry-run
      ```
   5. Apply them:
      ```bash
      npx supabase@2.120.0 db push
      ```
   6. Open the SQL Editor and run `supabase/verification/post-migration-checks.sql`. **Query 1 must return no rows.** Query 2 must list the migration versions `20261021000100`, `20261021000200` and `20261021000300`.
   7. Do **not** apply `supabase/tests/supabase-shim.sql`. It's for tests only.
8. **Create the admin account and link it.**
   1. Go to Authentication → Users → Add user → Create new user.
   2. Enter your email and a **new, unique, generated** password (20+ characters) from the password manager. Tick **Auto Confirm User**.
   3. In the SQL Editor, replace only the email and run:
      ```sql
      insert into public.admin_users (user_id, display_name)
      select id, 'Founder' from auth.users where email = 'YOUR-EMAIL';

      insert into public.drivers (display_name, admin_user_id, base_zone_id, base_locality)
      select 'Founder', id, 'tbilisi', 'თბილისი' from auth.users where email = 'YOUR-EMAIL';

      select count(*) as active_admins from public.admin_users where is_active;  -- must be 1
      ```
9. **Enroll MFA. Do this straight away.**
   1. Start the app with `npm run dev` and open `http://localhost:3000/admin/login`.
   2. Sign in, scan the QR code with your phone and enter the code. You land on the dashboard.
   3. Open **Security** (`/admin/security`) and add the backup authenticator on your second device.
   4. In Authentication → Multi-Factor, restrict TOTP so new enrollments are no longer allowed while verification stays enabled. That's the option that keeps "verify" but disables "enroll". Write down that you changed it: re-enrolling later needs it switched back temporarily.
10. **Test user for the live check.**
    1. Create a second user, for example `you+drvtest@…`, with a random password. It gets **no** `admin_users` row.
    2. Keep its password in the password manager. You can delete the user after the checks.

---

## 7. Live verification plan (development project only)

Run this after §6 is done, and after approval of the "live check" checkpoint. All results are PASS/FAIL lines without secrets or data.

**A. Catalog checks** (SQL Editor): run `supabase/verification/post-migration-checks.sql`. Query 1 must return 0 rows.

**B. Access checks.** Add these to `.env.local`:
```
DRIVEO_LIVE_TARGET=development
DRIVEO_LIVE_PROJECT_REF=<project-ref>
```
Then run:
```bash
node --env-file=.env.local scripts/live-security-check.ts
```
The script refuses to run unless the target is explicitly marked as the development project and the ref matches the URL. It asks for passwords and the TOTP code at hidden prompts. It checks:

| Group | Checks |
| --- | --- |
| Auth settings | Public sign-up disabled; anonymous sign-ins disabled (if reported) |
| Anonymous | Every public table denied; `driveo_private` not exposed; admin, service and submit functions denied; the API listing shows no app tables |
| Non-admin user | Every table shows 0 rows; private schema hidden; admin and service functions denied |
| Founder at AAL1 | Only their own admin row; 0 bookings or contacts; admin functions denied; **can't enroll another factor** |
| Founder at AAL2 | Bookings and contacts readable; admin functions authorize (`DV003` for an unknown ID, nothing changes); service functions still denied; private schema hidden |
| Sign-out | After global sign-out, the old refresh token is rejected |

**C. Disabled admin.**
1. Deactivate the founder row with the SQL in §4.
2. Run the script with `--expect-inactive-admin`. Sign-in still works, but AAL2 sees no bookings and admin functions are denied.
3. Reactivate the row.

**D. Manual booking without an automatic quote.** Optional; it writes one fictional booking that stays in the dev database.
1. Create a temporary secret key named `local-live-check` under Project Settings → API Keys → Secret keys.
2. Add it to `.env.local` as `SUPABASE_SECRET_KEY`.
3. Run with `--with-test-booking`. The booking must be accepted with no quote, a retry must not duplicate it, the secret key must **not** be able to read tables directly, and the founder at AAL2 must see the booking.
4. Then **delete that secret key** in the dashboard and remove it from `.env.local`.

**E. Browser flows** (manual):
1. Sign in, then the TOTP challenge, then the dashboard.
2. Wrong code gives the generic error.
3. Six quick wrong passwords hit the limit.
4. Check `/admin/security` shows 2 of 2 factors.
5. Sign out. Then `/admin` must send you to sign-in.
6. In the browser dev tools, the `sb-…` cookies must show **HttpOnly**, and an expiry within 12 hours.

**F. Security Advisor:** Advisors → Security Advisor. Only the expected items in F8 may appear.

Any FAIL is a stop: report the line (it contains no secrets) and don't add real data.

---

## 8. Next checkpoint

**Checkpoint 1.7B.2-A, "Apply migrations to the development project."** The founder confirms:

- [ ] Steps 1 to 6 of §6 are done: a dev project in an EU region; sign-ups and anonymous sign-ins off; security emails on; `driveo_private` not exposed; `.env.local` holds only the URL and publishable key.
- [ ] Approval to run §6 step 7, applying the three migrations to the **development** project.

After that, steps 8 to 10 and the live verification in §7 are a second checkpoint (**1.7B.2-B**). Real customer data, booking submission, notifications, tariffs, Google APIs and production remain out of scope.
