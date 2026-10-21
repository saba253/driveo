# Pricing & quotes — production readiness

State after Step 1.6C.2: the server quote orchestration works end to end with
**mock routing** and **fixture data** in tests. In the application wiring
(`src/server/quotes.ts`) there is no tariff or configuration, routing is
disabled or mock-only, prices are never published, and nothing calls the
service yet. **Every item below blocks production use of automatic prices.**

## 1. Persistent rate limits and usage caps (blocker)

- `createRateLimiter` and `createUsageGuard` are **in-memory, per process**. On
  serverless or multi-instance hosting each instance has its own counters and
  they reset on cold starts — they are **not sufficient for production**.
- Required: a shared atomic counter store (e.g. Postgres/Supabase with row
  locking or an atomic increment, or a managed Redis) for
  per-client limits and daily/monthly provider-call caps.
- Add bot protection (e.g. Cloudflare Turnstile) on the quote endpoint after a
  threshold, and log rejected requests.
- Client keys: `x-forwarded-for` is trustworthy only behind a proxy that
  overwrites it — confirm on the chosen hosting platform.

## 2. Google Cloud quotas and cost protection (blocker)

- Billing account, budget alerts and **per-API daily quotas** in Google Cloud
  (see `docs/google-cloud-setup.md`), set just above our own caps.
- Keep the adapter's cost settings: `TRAFFIC_UNAWARE`, no waypoints, minimal
  field mask, place IDs only. Re-check the price list before enabling.
- Proposed internal caps (pending approval): 100 provider calls/day,
  2,000/month, 5 quote requests per client per minute.

## 3. API key restrictions on the hosting platform (blocker)

- Decide the hosting platform. If it offers static egress IPs, add an IP
  restriction to the server key; otherwise rely on API restrictions (Routes API
  only), quotas and our usage guard, and document the residual risk.
- Key only in the platform's secret store as `GOOGLE_MAPS_SERVER_API_KEY`;
  separate dev/prod keys; rotation procedure.
- The app refuses to route if a Google key appears in a `NEXT_PUBLIC_` variable.

## 4. Google attribution (blocker before customers see Google-derived values)

- Address autocomplete and any value derived from Google routing need the
  "Google Maps" attribution per the policies (logo preferred, styled text
  otherwise, not translated). Proposed placement: under the address search and
  under the price card. Needs founder/legal confirmation.

## 5. Routes API data-retention compliance (blocker before persistence)

- See `docs/google-maps-data-retention.md`. No explicit retention rule was
  found for Routes distance/duration; treat them as restricted.
- Quotes already keep provider data in `providerDerived`, separate from the
  commercial record; `stripProviderDerived()` removes it. Persistence must store
  it separately with a `purge_after` and a scheduled purge.

## 6. Privacy Policy and Terms of Use (blocker)

- Required by the Routes API policies (must reference Google's terms) and for
  collecting names and phone numbers. Must cover: data collected, purpose,
  retention, processors (hosting, Google, Supabase, Telegram), contact.

## 7. Authoritative quote persistence (blocker)

- The in-memory quote store refuses to run in production; the production
  wiring uses `unavailableQuoteStore`.
- Required: a database table for quotes (commercial record + fingerprint +
  status/version chain), a separate purgeable table for provider data, and an
  audit log for admin overrides. `checkQuoteForBooking()` must run against the
  persisted quote before any booking request is accepted.
- Booking confirmation stays manual (admin availability review).

## 8. Real tariff and travel-rule configuration (blocker)

- Real tariff values (base fee, per-km, minimum, travel-time rate) — none exist.
- Zones and travel rules with real fares/minutes to and from the Tbilisi base.
- Overnight policy: a configured same-day limit or an explicit, attributed
  waiver (unconfigured blocks automatic pricing).
- Plausibility limits and extras catalogue. Approved: quote validity 12 h,
  final price rounded up to the next whole GEL.
- An admin workflow to edit them, with versioning (a change invalidates
  outstanding quotes via fingerprints).

## 9. Exposure

- No route handler or UI uses the quote service yet. Publishing prices
  (`PUBLISH_PRICES` in `src/server/quotes.ts`) stays `false` until all blockers
  above are cleared and the founder approves.

## 10. Automatic-pricing eligibility gate (Step 1.6D)

`src/lib/pricing/eligibility.ts` decides whether a request MAY receive an
automatic price; `src/lib/quotes/service.ts` returns a quote only when it is
eligible. The shipped policy (`DEFAULT_AUTOMATIC_PRICING_POLICY`,
`src/lib/pricing/pilot.ts`) has the master switch and every pilot route
(Tbilisi local, Tbilisi → Rustavi, Rustavi → Tbilisi) **disabled and
unapproved**, so every request goes to manual assessment.

Before any route can be priced automatically, all of these need an approval
record (who and when): the master switch, the pilot route, the tariff version,
the configuration version, an operating policy (day/driving/break/handover
limits) and the evidence-age rule. Every travel rule used must carry evidence
(source, date, verifier) for its own direction and transport availability
(frequent service with first/last departure, or a timetable valid for the
travel date). Unknown departures, stale evidence, overrides, extras, overnight
or over-limit days all fail safe to manual assessment.

The 13-hour day and 20 % margin from the research are recorded only as
proposals (`PROPOSED_OPERATING_POLICY`, `MODERATE_RESEARCH_SCENARIO`) and are
rejected by the gate.

## 11. Database and admin access (Step 1.7B.1)

The schema, RLS, privileged functions and the admin sign-in with TOTP flow are prepared but **not connected**. See [database-and-auth.md](database-and-auth.md). Blockers before any real booking is stored:

- Apply the migrations to a real Supabase project, with sign-ups disabled and `driveo_private` not exposed.
- Create the founder account and enroll TOTP immediately.
- Repeat the negative-access checks against the live project (database-and-auth.md §9). PGlite tests are not a substitute.
- Booking submission, the notification worker and Telegram pairing remain disabled until their own steps.

## 12. Booking submissions (Step 1.7C.1)

`POST /api/bookings` and the form's submission states exist but are **off**: `BOOKING_SUBMISSIONS` defaults to `off`, and its only other value, `test`, is refused in production. See [booking-submissions.md](booking-submissions.md) §8 for the blockers before real customers can submit: approved Terms and Privacy Policy, bot protection, notifications, the live access checks, and insurance and liability.
