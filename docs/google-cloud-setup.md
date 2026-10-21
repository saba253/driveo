# Google Cloud setup — prerequisites for live routing

Live Google requests are **off**. Nothing below has been done; it is the
checklist for enabling them in a later step, after founder approval.

## 1. Account and billing (founder)

1. Create a Google Cloud project for DRIVEO (e.g. `driveo-prod`), and a separate one for development/testing.
2. Create a billing account and link it to the project. Google Maps Platform requires billing even within the free monthly usage.
3. Re-check current prices and free monthly caps on the official price list before enabling — they change:
   https://developers.google.com/maps/billing-and-pricing/pricing
4. Set **budget alerts** (e.g. 50 % / 90 % / 100 % of a small monthly budget) in Billing → Budgets & alerts.

## 2. APIs

Enable only what is needed:

| API | Used for | Step |
|---|---|---|
| Routes API | Road distance and duration (`computeRoutes`) | 1.6C.2 |
| Places API (New) | Address autocomplete and place details | 1.6D |

Do not enable the legacy Directions/Distance Matrix APIs.

## 3. Quotas (Google Cloud console → APIs & Services → each API → Quotas)

Set request-per-day caps on each enabled API, slightly above our own guard
(`GOOGLE_ROUTES_DAILY_LIMIT`, default 100/day). Two independent caps protect
against bugs, abuse and unexpected bills.

## 4. API key

1. Create **one server key** for routing.
2. **API restrictions:** restrict it to *Routes API* only (add Places API (New) later if the same server key is used for place details).
3. **Application restrictions:** IP-address restriction if the hosting provides static egress IPs; otherwise rely on API restrictions + quotas + our usage guard.
4. Store it only as a server environment variable `GOOGLE_MAPS_SERVER_API_KEY` in the hosting provider's secret settings. Never in the repository, never in a `NEXT_PUBLIC_` variable (the app refuses to route if one exists).
5. Rotate the key if it is ever exposed; keep separate keys for development and production.

## 5. Request settings used by the adapter (cost control)

`src/lib/routing/google-routes.ts` requests only:

- `travelMode: DRIVE`, `routingPreference: TRAFFIC_UNAWARE` (no live traffic, no departure time) — documented as the Essentials tier; traffic-aware options are billed at a higher tier.
- No intermediate waypoints, no alternatives.
- Field mask `routes.distanceMeters,routes.duration` only (a field mask is mandatory; wildcard masks cost more).
- Locations as **place IDs or coordinates only** — free-text addresses are refused instead of letting Google guess.
- Per-attempt timeout (default 5 s) and at most 1 retry by default (capped at 3), only for 408/429/5xx/network/timeout.

## 6. Legal and policy pages (before customers see Google-derived data)

The Routes API policies require publicly accessible Terms of Use and a Privacy
Policy that reference Google's terms, plus attribution rules — see
`docs/google-maps-data-retention.md`.

## 7. Enabling (later, explicitly approved step)

```
GOOGLE_ROUTES_ENABLED=true
GOOGLE_MAPS_SERVER_API_KEY=<server key>
```

`src/server/routing.ts` then returns the Google provider wrapped in the usage
guard. Until then it returns the disabled provider and every quote falls back
to manual pricing.

Note: the in-memory usage guard and rate limiter protect a single server
instance only. Before production on serverless/multi-instance hosting, move
them to a shared store (planned with persistence in Step 1.7).
