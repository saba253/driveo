# DRIVEO — database foundation and admin authentication (Step 1.7B.1)

Status: **prepared, not connected.** No Supabase project exists yet. No admin account has been created. Booking submission is still off, and nothing sends Telegram or email messages.

## 1. Files

| Path | Purpose |
| --- | --- |
| `supabase/migrations/20261022000100_booking_foundation.sql` | Tables, constraints, indexes and append-only triggers |
| `supabase/migrations/20261022000200_booking_functions.sql` | The lifecycle rules plus every function that writes (all SECURITY DEFINER) |
| `supabase/migrations/20261022000300_security.sql` | Revokes, minimal grants and RLS policies |
| `supabase/tests/supabase-shim.sql` | **Test only.** A minimal imitation of Supabase roles, `auth.*` and default grants |
| `supabase/tests/database.test.ts` | Authorization, lifecycle, evidence, outbox, rate-limit and pairing tests (PGlite) |
| `src/lib/booking/lifecycle.ts` | TypeScript mirror of the transition rules. A test compares it with the database. |
| `src/lib/auth/admin-access.ts` | The pure admin-access decision, unit-tested |
| `src/server/supabase.ts`, `src/server/admin-auth.ts` | Server-only Supabase client and the admin data-access layer |
| `src/proxy.ts` | Refreshes the session and sets no-index/no-store headers on `/admin` only |
| `src/app/admin/*` | Sign-in, MFA and dashboard shell |

## 2. Data model

- **bookings** holds the request itself.
  - `reference` has the format `DRV-YYYY-NNNNNN`.
  - `submission_id` and `submission_hash` give idempotency.
  - `pricing_mode` defaults to `manual_assessment`, so **a booking needs no quote**.
  - Also stored: cities, addresses, the requested local date and time (Asia/Tbilisi), the vehicle, and the policy versions accepted.
  - No coordinates and no raw IP; only an optional salted IP hash.
- **booking_contacts** keeps the name, E.164 phone, optional email and preferred channel apart from the booking, so it can be anonymized on its own (`phone_e164 = 'REDACTED'` is allowed).
- **booking_status_events** is the append-only status history.
- **price_proposals** holds manual prices.
  - Whole GEL only (`amount_minor % 100 = 0`).
  - Fuel and charging are always excluded.
  - At most one open proposal per booking.
  - The price must be sent in writing (sms, email or WhatsApp). Validity is **12 h from sending**.
- **price_acceptances** holds the evidence of customer acceptance. It is append-only. See §4.
- **admin_audit_log** is append-only. It stores identifiers and codes only, never personal data.
- **admin_users** and **drivers** each start with one row: the founder.
- `driveo_private`, an internal schema that must **never be exposed to the API**, holds:
  - **notification_outbox** and **notification_attempts**: Telegram first, email fallback, a dedupe key, and an attempt history.
  - **telegram_pairing_challenges**
  - **rate_limit_counters**

Every timestamp is `timestamptz`. Status values use text plus CHECK constraints.

## 3. Lifecycle

`submitted` is shown to the customer as: «მოთხოვნა მიღებულია — ეს არ ნიშნავს შეკვეთის დადასტურებას.» Only the admin moves a booking forward.

| From | To | How |
| --- | --- | --- |
| submitted | under_review, declined, cancelled | admin |
| under_review | info_requested, declined, cancelled | admin |
| under_review | price_proposed | only by `admin_mark_proposal_sent` |
| info_requested | under_review, declined, cancelled | admin |
| price_proposed | under_review (withdraws the price), declined, cancelled | admin |
| price_proposed | under_review | by a new proposal replacing a sent one |
| price_proposed | customer_accepted | only by `admin_record_price_acceptance` |
| customer_accepted | confirmed, declined, cancelled | admin. Confirming also requires a recorded acceptance. |
| confirmed | completed, cancelled | admin |

`declined`, `cancelled` and `completed` are terminal. Each change locks the booking row, checks it against `driveo_private.booking_transition_rules()`, appends a history event and writes an audit entry, all in one transaction.

## 4. Evidence of customer acceptance

An admin checkbox is **not** proof. `admin_record_price_acceptance` requires all of the following:

- A **written** method: sms, email, WhatsApp or a signed document. A phone call must be followed by a written confirmation.
- An evidence reference, such as the message's thread, date and time, or a document ID.
- The customer's own words, copied verbatim.
- A `received_at` time between sending and `valid_until`, and not in the future.
- An acknowledged amount **exactly equal** to the proposed amount.
- A proposal that is still `sent`, so not withdrawn, superseded or already accepted.

**Limitation:** the database checks that the evidence is complete and consistent, but it cannot prove the message is authentic. The original message must be kept as long as the booking record. This is an operating rule for the founder.

## 5. Security model

| Role | Tables | Functions |
| --- | --- | --- |
| `anon` (browser without a session) | none | none |
| `authenticated` | `SELECT` only. RLS shows rows only to an **active admin at AAL2**, plus the user's own `admin_users` row. | `admin_*` functions, each starting with `require_admin()` |
| `service_role` (Next.js server only) | **none**. It bypasses RLS, so grants are its control. | `submit_booking_request`, the notification worker functions, `consume_rate_limit`, `attach_telegram_pairing_code` |

- Every function has `set search_path = ''` and uses fully qualified names.
  - EXECUTE is revoked from PUBLIC, anon, authenticated and service_role, then granted per function.
  - Default privileges for future objects are tightened too.
- Admin = `auth.uid()` + `aal = 'aal2'` in the JWT + an `admin_users.is_active` row. Deactivating that row cuts access at once, even with a valid token.
- Restrictive policies on the business tables require AAL2, even if a permissive policy is added by mistake later.
- Nobody writes tables directly, not even an admin. Every write goes through a function that checks state and writes history and audit.
- Errors return only a SQLSTATE (`DV001` to `DV007`, `42501`) and a short token. An unauthorized caller gets the same `not_authorized` for real and invented IDs.
- No views exist. A future view must use `security_invoker = true`.
- Notification payloads are checked by `is_minimal_notification_payload`. Only these keys are allowed, all short strings: `reference`, `pickup_city`, `delivery_city`, `vehicle_make`, `vehicle_model`, `submitted_at`. **No name, phone or street address.**
- Rate-limit keys must look like `scope:<hex hash>`, so a raw IP or phone number can't be stored.
- Booking references are sequential. That's acceptable because no public lookup by reference exists. A future customer status page needs a separate random token.
- The database refuses `automatic_quote` submissions until a persistent, server-verified quote store exists.

## 6. Admin authentication

- Supabase Auth. **Email and password + TOTP.** No public sign-up: disable sign-ups in the project.
- The server checks every admin page and Server Action (`src/server/admin-auth.ts`):
  - `getUser()` is validated by the Auth server.
  - The assurance level comes from `getAuthenticatorAssuranceLevel()`.
  - Factors come from `listFactors()`.
  - The user's own admin row is read through RLS.
- `decideAdminAccess` returns one of: not configured, signed out, not admin, needs enrollment, needs challenge, ok. A non-admin is never offered MFA enrollment.
- Enrollment is allowed only for an active admin with **no verified factor**. Abandoned unverified factors are removed first. A verified challenge promotes the session to AAL2.
- Sign-in and MFA attempts are limited per client and overall (5 and 30 per 15 min).
  - These calls reach Supabase from our server's IP, so Supabase's own per-IP limit isn't enough.
  - The limiter is in memory, per instance. It will move to `consume_rate_limit` once the service-role server code exists.
- Sign-out uses `scope: "global"`, which revokes every refresh token. Access tokens that were already issued stay valid until they expire (default 1 h). The database's active-admin check still applies.
- `/admin` responses send `X-Robots-Tag: noindex`, `Cache-Control: private, no-store`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. The pages also set `robots: noindex`. Nothing on the public site links to `/admin`.
- With no Supabase environment variables, every admin route shows «ადმინისტრირება ჯერ არ არის დაკავშირებული» and connects to nothing.

## 7. What the tests cover, and what they don't

Run with `npm test`. The database tests boot the real migrations in **PGlite**, which is PostgreSQL 18.3 compiled to WASM (Supabase projects run 15 or 17; the migrations use nothing newer than 15), on top of `supabase-shim.sql`. They run queries the way PostgREST does: `SET LOCAL ROLE` plus `request.jwt.claims`.

**Covered by real PostgreSQL behaviour:**

- grants and revokes, including Supabase-like default grants being revoked
- RLS policies, restrictive policies, and the AAL1/AAL2 and active/inactive admin checks
- forged claims
- SECURITY DEFINER settings and EXECUTE privileges for every function
- valid and invalid transitions
- idempotent and conflicting submissions
- manual booking without a quote
- constraint failures
- append-only guards, including against the table owner
- minimal payloads
- one event per booking
- Telegram-then-email ordering, retry and recovery
- error-summary redaction
- the rate limiter
- pairing expiry, single use, session binding and lockout after 5 attempts

**Not covered.** Don't treat RLS as fully verified until these have been checked against the real project:

- Real Supabase: GoTrue sign-in, MFA, AAL claims in real JWTs, token refresh, and signups being disabled.
- PostgREST's exposed-schema setting, which must not include `driveo_private`, and the real project's default privileges and role attributes. The shim imitates them; it is not them.
- The Next.js auth flow end to end. Only the decision logic is unit-tested, and the pages were checked only in the not-configured state.

Step 1.7B.2 must repeat the negative-access checks against the real project before any real data exists (§9).

## 8. Account recovery (solo founder)

| Situation | Procedure |
| --- | --- |
| Lost authenticator device | 1. Sign in to the **Supabase dashboard**, which is protected by its own MFA. 2. Auth → Users → the founder → delete the TOTP factor. 3. Sign in to `/admin` and enroll again. 4. Review `admin_audit_log`. |
| Forgotten admin password | Use the dashboard: send a password-reset email to the founder address. Never set a password over chat. |
| Suspected compromise | 1. `update public.admin_users set is_active = false, deactivated_at = now() where user_id = '<id>'`, run in the SQL editor. This cuts access at once. 2. Sign the user out of all sessions in the dashboard. 3. Rotate the password and the TOTP factor. 4. Rotate the service-role key if there's any doubt. 5. Review the audit log. 6. Reactivate. |
| Lost access to the Supabase dashboard itself | Use the Supabase account's recovery codes. Store them offline when setting up the account. |

Keep the dashboard account (GitHub or email login + MFA) separate from the admin app account where practical. Store recovery codes offline.

## 9. Founder actions for Step 1.7B.2 (not done yet)

1. Create a Supabase project, EU region. Turn on MFA for the dashboard account and store its recovery codes offline.
2. Authentication settings:
   - **disable sign-ups**
   - enable TOTP MFA
   - keep email confirmation on
   - set the site URL and redirect URLs
3. API settings: make sure the exposed schemas are `public` (and `graphql_public` if it's used). **Never add `driveo_private`.**
4. Apply the three migrations in order: `supabase db push`, or the SQL editor. The shim file is **not** applied.
5. Create the founder user in the dashboard (Auth → Users → Add user) with a unique, strong password. Then insert their `admin_users` and `drivers` rows in the SQL editor. No IDs or secrets go into code or chat.
6. Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` into `.env.local` and the hosting environment yourself. Don't add the service-role key until it's needed.
7. Sign in to `/admin` at once and enroll TOTP. Enroll **immediately after** creating the account: until it's enrolled, anyone who knows the password could enroll their own factor.
8. Run the live negative checks:
   - anon REST read of each table returns 401/permission denied
   - an RPC as anon is denied
   - an AAL1 session sees no bookings
   - an AAL2 session sees them
   - `driveo_private` is not reachable over REST
