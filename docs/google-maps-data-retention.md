# Google Maps Platform — route data retention

**Status:** open legal/compliance question. **Must be resolved before quotes are persisted** (Supabase, logs, analytics or backups).

## The issue

DRIVEO plans to use the Google Maps Platform (Places, Geocoding, Routes API) for address resolution and road distance/duration. Google's terms restrict pre-fetching, caching and storing of Google Maps content:

- Place IDs are documented as exempt from caching restrictions and may be stored indefinitely.
- The Service Specific Terms allow latitude/longitude from the Geocoding and Directions APIs to be cached temporarily — 30 consecutive calendar days in the versions reviewed — after which they must be deleted.
- We did **not** find an explicit statement covering how long **Routes API distance and duration** values may be retained, or whether keeping them inside a transactional quote record is permitted.

Therefore we must **not assume** that route distance and duration may be stored indefinitely.

Sources to re-check at implementation time (terms change):

- https://cloud.google.com/maps-platform/terms/maps-service-terms
- https://developers.google.com/maps/documentation/routes/policies
- https://developers.google.com/maps/documentation/geocoding/policies

## How the code is prepared

`priceQuote()` (`src/lib/pricing/quote.ts`) returns a `ServiceQuote` split into:

| Section | Contents | Retention |
|---|---|---|
| `commercial` | Tariff id/version, zones, priced lines (amounts only), totals, rounding, overnight status | Our business record — keep as required for accounting |
| `inputFingerprint` | SHA-256 of our own customer inputs (normalized addresses, localities, place IDs, date/time, extras, overrides) — no coordinates, no route data | Keep |
| `providerDerived` | Provider route (`distanceKm`, `durationMinutes`, provider, timestamp) and the overnight commitment minutes that include provider duration; marked `retention: "provider_restricted"` | **Purge per policy** |

- Commercial lines never contain the provider distance or duration (tests assert this).
- `stripProviderDerived(quote)` removes the provider section without touching the commercial record.
- Coordinates are used only for in-memory sanity checks and are excluded from fingerprints.

Note: the *price* of the distance line is derived from the provider distance. It is our commercial output, not provider content, but this interpretation should be confirmed in the same review.

## Required before persistence (Step 1.7)

1. Confirm with the current Google terms (or Google support/sales) how long Routes API distance/duration may be retained and in what form.
2. Store `providerDerived` in a separate table/column with a `purge_after` timestamp; run a scheduled purge.
3. Until confirmed, set `purge_after` conservatively — e.g. at quote expiry or within the 30-day window used for geocoding coordinates, whichever is earlier (**founder/legal decision**).
4. Exclude `providerDerived` from analytics exports and long-term backups, or purge those too.
5. Publish Terms of Use and a Privacy Policy that reference Google's, as the Routes API policies require.
