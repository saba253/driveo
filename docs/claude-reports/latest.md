# DRIVEO — Claude Code development report

DRIVEO — Claude Code development report. Please review the completed work, identify any issues, update the progress tracker, and prepare the next safe development step.

- **Step:** 1.7C.2-B, founder approval (a): development database migration
- **Date:** 2026-10-22
- **Code commit:** `f9e679b` (unchanged; no code changes in this step)

## Completed

Migration `20261022000100_test_booking_isolation.sql` was applied to the Supabase **development** project `driveo-dev-eu` only, under the founder's explicit approval (a).

Pre-checks, all passed:
1. **Linked project:** the linked project is `driveo-dev-eu`, and it matches the project in `.env.local`.
2. **SQL review:** every DELETE and UPDATE sits inside function bodies, so none runs during migration. The two dropped constraints are re-created immediately. The old 5-argument `submit_booking_request` is replaced by the 6-argument version, executable by `service_role` only. New columns are added with defaults.
3. **Dry run:** `db push --linked --dry-run`.
4. **Pending list:** exactly one pending migration (`20261022000100`), with no seeds and no roles.

Before the push the remote had 0 bookings, 0 contacts, 0 outbox events and 0 audit entries, 1 admin and 1 auth user.

## Verification after the migration

- **Migration history:** all 4 migrations recorded remotely and matching local. A second dry run reports "Remote database is up to date".
- **Security checks:** post-migration Query 1 returned **0 problems** (RLS, owners, grants, search paths, no views, no Realtime exposure, append-only triggers, isolation present, no old function overload).
- **Live state:**
  - `bookings.is_test` and `notification_outbox.is_test` exist.
  - The constraint `(status = 'suppressed_test') = is_test` is active.
  - `claim_notification_events` skips test events.
  - `submit_booking_request` takes `p_is_test`, and only `service_role` can execute it; anon and authenticated cannot.
  - `purge_test_bookings` is not executable by any API role.
  - 16 RLS policies, unchanged.
- **No records changed:** 0 bookings, 0 contacts, 0 outbox events, 0 audit entries, 1 active admin, 1 auth user.
- **Dashboard query:** the dashboard's exact column list now resolves through the API: anonymous gets 401/42501 (permission denied), while a missing column gives 400/42703. The earlier "couldn't load the requests" error should therefore be gone. Founder sign-in is needed to see it.

## Not done (not authorized)

- no test bookings
- feature flag still off
- no API secrets created
- no deletions
- no other project touched
- no deployment

## Note

Each Supabase CLI call printed "Initialising login role", meaning the CLI set up its own temporary connection role.

## Tests

No code changes, so the previous result stands: TypeScript, lint and build pass, and 313/313 tests pass at `f9e679b`.

## Remaining blockers

- Before the first test booking: founder approval (b), plus the founder creating the dev-only secret key and hash secret locally.
- Before real customers:
  - live non-admin and AAL1/AAL2 checks
  - session expiry and sign-out check
  - persistent admin-login limits
  - CAPTCHA
  - approved Terms of Use and Privacy Policy
  - insurance and liability
  - notification worker
  - production setup

## Progress estimate (rough)

- Development MVP: about 72%
- Production readiness: about 40%

## Recommended next step

1. The founder signs in to `/admin` and confirms the empty bookings list loads.
2. The founder gives approval (b): write ONE fictional test booking.
3. The founder follows `docs/booking-submissions.md` §8: dev-only secret key, hash secret, `BOOKING_SUBMISSIONS=test`, restart, one fictional booking, check the dashboard, then turn the flag off and delete the key.
