# DRIVEO — booking submission foundation (Step 1.7C.1)

Status: **built and tested locally. OFF everywhere.** No booking has been written to any remote database, and the endpoint answers `503` until the server flag is switched on by the founder (§6).

## 1. Architecture

```
Browser form (BookingCard)
  └─ POST /api/bookings              src/app/api/bookings/route.ts (wiring only)
       └─ handleBookingPost()        src/lib/booking/submission-http.ts
            ├─ flag off → 503, body never read
            ├─ Origin + Sec-Fetch-Site must be same-origin → 403
            ├─ JSON only (415) · ≤ 16 KB (413) · Idempotency-Key UUID (400)
            └─ service.submit()      src/lib/booking/submission-service.ts
                 ├─ persistent limit per client (HMAC of IP)          → 429
                 ├─ strict parse     src/lib/booking/submission.ts    → 400 / 409 / 422
                 ├─ persistent limits per phone (HMAC) and overall    → 429
                 └─ ONE call: public.submit_booking_request (service_role)
                      in one transaction: booking + booking_contacts + first status
                      event + notification outbox event + audit entry — or nothing
```

- **Server wiring:** `src/server/bookings.ts` is server-only. It creates the secret-key client only when the flag is on. That key can call only the six service functions; every table grant is revoked for it.
- **Shared contract:** `src/lib/booking/submission-contract.ts` holds the request and response types plus the browser-side response reader. It has no server code.
- **No new migration.** The existing `submit_booking_request` already does the atomic insert, idempotency and minimal outbox payload. `consume_rate_limit` is the persistent limiter.

## 2. What the server accepts

The request body is exactly `{ draft, fuelPolicyVersion, website }`.
- `draft` must contain exactly the form's fields, with the form's types. Any extra key anywhere is rejected: price, status, pricing mode, reference, quote or driver.
- `website` is a hidden honeypot field that must be empty.

Validation reuses the form's own rules (`validateDraft`), plus server-only rules:
- Cities must come from the listed cities, or "other" with a typed name.
- The pickup date must be within 183 days, in the Tbilisi calendar.
- Control and bidirectional-override characters are refused.
- Strings longer than 400 characters are malformed.
- "Now" is the Asia/Tbilisi wall clock.

**Decided on the server, never by the client:**
- `pricing_mode = manual_assessment`, so a booking never needs a quote
- no price
- `consented_at` set to the server time
- the policy IDs and versions
- the test marker
- `terms_version` and `privacy_version` stay **empty**, because no approved version exists yet

The customer must have accepted the current fuel policy version. A stale version answers `policy_changed`.

**Idempotency:** the browser creates one `Idempotency-Key` per submission and reuses it on retries.
- The same key with the same content returns the same reference (`200`, `duplicate: true`).
- The same key with different content gets `409 conflict`.
- The content hash ignores server timestamps.

## 3. Responses

| Status | HTTP | Meaning |
| --- | --- | --- |
| `received` | 201, or 200 for a duplicate | Stored. The form then shows «მოთხოვნა მიღებულია — ეს არ ნიშნავს შეკვეთის დადასტურებას.» and the reference. |
| `invalid` | 422 | Field codes only, the same codes the form shows |
| `policy_changed` / `conflict` | 409 | Nothing new stored |
| `rate_limited` | 429 | With `Retry-After` |
| `unavailable` | 503 | Flag off, misconfigured, database down, or limiter down (it fails closed). Nothing stored. |
| `rejected` | 400 / 403 / 413 / 415 | Malformed, cross-site, oversized or honeypot |

Responses never echo submitted data and are `Cache-Control: no-store`. Server logs carry event names and codes only, such as `[booking] booking.stored {"test":true}`. They never include names, phones, addresses or IPs.

## 4. Form states

- **Prototype mode (default):** unchanged. Nothing is sent, and the approved prototype copy is shown.
- **Test mode:** this is the `mode="test"` prop, set by the server only when the flag is on.
  - **Draft:** the normal form.
  - **Submitting:** the button is disabled and reads «იგზავნება…».
  - **Validation error:** back to the first stage with errors, showing the server's field codes.
  - **Unavailable, rate-limited, conflict, policy changed or rejected:** a red notice on the review step. The draft is kept, and retrying reuses the key.
  - **Received:** shown **only** after the server answers `received`. It displays the reference, the "not a confirmation" text and the test note.

## 5. Tests (`npm test`)

| Area | Where |
| --- | --- |
| Parser: valid input, field codes, unlisted city, date horizon, control characters, injected fields, wrong types, honeypot, policy version, stored parameters, hash identity, defensive response reading | `src/lib/booking/submission.test.ts` |
| Flag: off by default; only `test`; refused in production; needs secret key, hash secret and a valid origin; refuses a secret in a `NEXT_PUBLIC_` variable | `src/lib/booking/submission-settings.test.ts` |
| HTTP and service with fakes: disabled flag never reads the body; origin, type, size, key and JSON checks happen before the service; no PII in responses or logs; duplicate 200 and conflict 409; database errors become a generic 503; rate-limit order; hashed keys only; the limiter failing closed; RPC error mapping | `src/lib/booking/submission-http.test.ts` |
| **Real PostgreSQL** (PGlite + the migrations, as `service_role`): manual booking stored with no quote; contact isolated; outbox pending with zero attempts (nothing sent); retry deduplicated; conflict leaves the original intact; **a failure in the last step rolls back everything**, and the key stays reusable; invalid input stores nothing; persistent per-client and per-phone limits | `supabase/tests/booking-submission.test.ts` |
| Regressions: admin access decisions, database security, lifecycle and pricing | the existing suites |

**Limitations:**
- PGlite isn't Supabase. PostgREST's handling of these calls through the secret key is only checked live (§6).
- The client IP comes from `X-Forwarded-For`, which is trustworthy only behind a proxy that overwrites it (the hosting platform). Locally it may be absent, and then all requests share the bucket `unknown`.
- Limits are fixed windows: 10 per client per hour, 5 per phone per day, 200 overall per day.
- There is no CAPTCHA yet: honeypot, same-origin check, body limits and persistent limits only.

## 6. Next checkpoint: enabling TEST submissions in development

**Checkpoint 1.7C.2-A.** It needs the founder's explicit approval to write fictional test bookings to `driveo-dev-eu`. Each test booking stays in the database permanently (history is append-only) and creates one *pending* notification outbox event. No notification is sent, because no worker exists.

1. In Project Settings → API Keys → Secret keys, create a new secret key named `local-booking-test`. Add it to `.env.local` yourself as `SUPABASE_SECRET_KEY=…`. Never paste it into chat.
2. Generate the hash secret straight into `.env.local`, without displaying it, from the project folder:
   ```bash
   node -e "require('fs').appendFileSync('.env.local','\nBOOKING_HASH_SECRET='+require('crypto').randomBytes(32).toString('hex')+'\n')"
   ```
3. Add `BOOKING_SUBMISSIONS=test` to `.env.local` and restart the dev server.
4. Then verify together:
   - the form shows the **ტესტი** badge
   - a fictional booking is received with a reference
   - a retry is deduplicated
   - the admin dashboard (AAL2) lists the booking with the ტესტი label
   - cookie-less API calls are still denied
5. Afterwards: set `BOOKING_SUBMISSIONS=off` and delete the `local-booking-test` secret key in the dashboard unless more testing is planned.

Before notifications are built, the pending outbox events of test bookings must be closed. Recommended: the admin cancels the test bookings, and the notification worker skips bookings marked `test_submission`.

## 7. Review: `scripts/live-security-check.ts`

This script is not run by `npm test`, and only by the founder, against the development project.

**Credential handling:**
- It refuses to run unless `DRIVEO_LIVE_TARGET=development` is set and `DRIVEO_LIVE_PROJECT_REF` matches the URL.
- Emails are typed visibly. Passwords and the TOTP code are typed at prompts whose echo is suppressed by overriding Node's internal `readline._writeToOutput`. That's an undocumented internal: if a Node upgrade changes it, input could be echoed, so check with a dummy value first.
- Values live only in memory and are never printed or logged.
- The secret key is read from `.env.local` only with `--with-test-booking`.
- Output is PASS/FAIL lines and error codes only.

**Side effects on the development project:**
1. Sign-ins of the non-admin test user and the founder appear in Auth logs and count toward Auth rate limits.
2. The AAL1 enrollment probe creates an unverified TOTP factor, then removes it at once, but only if Supabase allows it (which would itself be a finding). It may trigger a security email.
3. **Verifying the TOTP code signs the founder out of all other sessions** (Supabase behaviour), including any open admin browser tab.
4. **It ends with a global sign-out**, which revokes all of the founder's refresh tokens.
5. The `consume_rate_limit` probes are denied. If a grant were wrong, one counter row (`live.check:…`) would be written.
6. `--with-test-booking` writes **one permanent fictional booking** with contact, status event, audit entry and a pending outbox event, through the secret key directly rather than through `/api/bookings`. It is marked `test_submission`.
7. `--expect-inactive-admin` needs the founder to deactivate and later reactivate their admin row in the SQL Editor.

**Limitations:**
- PostgREST's `PGRST202` counts as a denial.
- The anonymous-sign-in flag may not be reported.
- The API-listing check is a text match.
- Cookie attributes, session expiry timing and JWT lifetime are not tested.
- `/api/bookings` is not exercised.
- "Admin AAL2 can read bookings" also passes with zero rows, so it only proves the read is allowed unless a test booking exists.

## 8. Outstanding blockers before real customer submissions

| Blocker | Status |
| --- | --- |
| Live non-admin access verification | Open: needs a test user |
| Live AAL1 / AAL2 verification | Open: founder runs the live script |
| Live session expiry and sign-out check | Open |
| Persistent rate limits | **Built** for bookings (Postgres). Admin login still uses in-memory limits. |
| Bot protection (CAPTCHA/Turnstile) | Open. Required before production. |
| Approved Terms of Use and Privacy Policy, with consent checkboxes and stored versions | Open. Live mode cannot exist without them. |
| Insurance and liability requirements | Open: founder decision and legal |
| Notification setup (Telegram private chat, email fallback, worker) | Open: not built |
| Founder approval for enabling **test** submissions in development | Pending: checkpoint §6 |
| Production mode for submissions | Not implemented on purpose |
