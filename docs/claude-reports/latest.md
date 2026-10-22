# DRIVEO — Claude Code development report

DRIVEO — Claude Code development report. Please review the completed work, identify any issues, update the progress tracker, and prepare the next safe development step.

- **Step:** 1.7C.2-A, Test Booking Safety Preparation
- **Date:** 2026-10-22
- **Commit:** `d0df5dc` (pushed to `origin/main`; local and remote match, working tree clean)
- **Previous:** `e2c5f46` (Step 1.7C.1)

## Completed

Reviewed:
- `POST /api/bookings`
- the `BOOKING_SUBMISSIONS` flag
- the submission service
- `submit_booking_request`
- the admin bookings list
- the notification outbox
- `docs/booking-submissions.md`

Admin authentication and MFA were not modified.

## Security issue found and fixed

**Issue:** fictional test bookings were marked only in `bookings.eligibility_reasons`. Their notification outbox events were created as `pending`, and `claim_notification_events` would have handed them to a future Telegram or email worker.

**Fix:** migration `supabase/migrations/20261022000100_test_booking_isolation.sql`.
- New columns `bookings.is_test` and `notification_outbox.is_test`. Only the server sets them, through `submit_booking_request(..., p_is_test)`, which only `service_role` can execute.
- A test booking's outbox event is created as `suppressed_test`, already completed.
- A CHECK constraint `(status = 'suppressed_test') = is_test`: a test event can never be pending, processing or sent, and a real event can never be suppressed.
- `claim_notification_events` also skips `is_test` events.
- **Fails closed:** the app always sends `p_is_test`. On a database without this migration the call fails, nothing is stored, and the response is `unavailable`.
- **Cleanup:** `driveo_private.purge_test_bookings('DELETE TEST BOOKINGS')`. It can be run only by the owner (no role has execute) and only from the SQL Editor. It removes test bookings and all their dependent rows in one transaction, keeps real records, and keeps the audit log, adding one summary entry. It has been designed and tested but not run anywhere.
- The post-migration SQL check now reports when this migration is missing.
- The admin dashboard labels test bookings from `is_test`.
- The live-check script's optional test booking uses `p_is_test`.

Telegram and email delivery remain unbuilt and disabled.

## Tests

- TypeScript: pass
- Lint: pass
- Production build: pass
- Unit and integration tests: **313/313 pass**
  - New tests: suppression; claim exclusion; constraint enforcement; admin retry refused; test/real key switching gives a conflict; anon and admins cannot submit; fail-closed on a database without the migration; purge (complete removal, real rows unchanged, audit kept, wrong phrase refused, other roles refused, no-op when empty); the check script detects the missing migration.
  - Writes went to local PGlite databases only.
- Client bundle scan: no secret key, publishable key, project ref or hash secret.

## Live-test prerequisites

| Check | Status |
| --- | --- |
| `BOOKING_SUBMISSIONS=off` by default (not set locally) | PASS |
| Test mode impossible in production | PASS |
| No real pricing in test mode (manual assessment forced; extra fields rejected; DB refuses automatic quotes) | PASS |
| Fictional data accepted | PASS |
| Rollback and idempotency intact | PASS |
| No secrets in the browser | PASS |
| No existing customer records modified (remote had 0 bookings at the last read-only check) | PASS |
| Test-notification isolation on the remote dev database | NOT VERIFIED: migration not applied yet |
| Reference and status visible to the founder admin | NOT VERIFIED: needs one test booking |

## Remote database

**No changes.** Migration `20261022000100` has **not** been applied to the development project. No test booking has been written. No remote connection was made in this step.

## Feature flag

`BOOKING_SUBMISSIONS` is **off** (not set in `.env.local`). No secret key and no hash secret are configured locally.

## Remaining blockers

- Before the first test booking: founder approvals.
- Before real customers:
  - live non-admin and AAL1/AAL2 checks
  - session expiry and sign-out check
  - persistent rate limits for admin login
  - CAPTCHA / bot protection
  - approved Terms of Use and Privacy Policy, with consent checkboxes
  - insurance and liability
  - Telegram and email notification worker
  - production configuration

## Progress estimate (rough)

- Development MVP: about 65–70%
- Production readiness: about 40%

## Recommended next step: checkpoint 1.7C.2-B

It needs two separate founder approvals:
- (a) apply migration `20261022000100` to the development project: dry run first, then the post-migration checks
- (b) write ONE fictional test booking

Then the founder follows `docs/booking-submissions.md` §8:
1. Create a dev-only secret key `local-booking-test`.
2. Add it and a generated `BOOKING_HASH_SECRET` to `.env.local` locally.
3. Enable `BOOKING_SUBMISSIONS=test` and restart.
4. Send one fictional booking.
5. Find it in the admin dashboard (ტესტი label).
6. Turn the flag off and delete the key.

Cleanup is in §7 and needs separate approval.
