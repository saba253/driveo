# Google Maps Platform — data retention, caching and attribution

**Status:** open legal/compliance questions. **Resolve before quotes are persisted** (database, logs, analytics or backups) **and before customers see any Google-derived value.** Reviewed 2026-10-21; terms change — re-check at implementation time.

Sources:

- Service Specific Terms: https://cloud.google.com/maps-platform/terms/maps-service-terms
- Routes API policies: https://developers.google.com/maps/documentation/routes/policies
- Geocoding API policies: https://developers.google.com/maps/documentation/geocoding/policies
- Places Autocomplete (New) session pricing: https://developers.google.com/maps/documentation/places/web-service/session-pricing

## What the terms say (as reviewed)

| Topic | Finding | Confidence |
|---|---|---|
| Caching in general | Pre-fetching, caching or storing Google Maps content is generally restricted. | Stated in the API policy pages |
| Place IDs | Exempt from caching restrictions; may be stored indefinitely. | Stated |
| Latitude/longitude | May be cached temporarily — 30 consecutive calendar days in the Service Specific Terms versions reviewed (Geocoding, Directions), then deleted. | Stated for those APIs; **not confirmed for Routes** |
| Routes API distance/duration | **No explicit retention rule found.** | ⚠️ Open |
| Display on a map | Routes results shown on a map must use a Google Map. | Stated |
| Attribution without a map | Required: Google Maps logo (preferred) or the text "Google Maps" with prescribed styling, near the content, not translated. | Stated |
| Policy pages | We must publish Terms of Use and a Privacy Policy that reference Google's terms. | Stated |

## Decisions needed from the founder / legal review

1. **Retention of Routes distance/duration** — may they be kept inside a quote record, and for how long? Ask Google (support/sales) or counsel. Until answered, treat them as restricted.
2. **Is a price derived from Google distance "Google content"?** Our position in code: the price is DRIVEO's commercial output; the distance it was computed from is provider content. Needs confirmation.
3. **Attribution placement** — when the price card shows a quote based on Google routing (no map), where does the "Google Maps" attribution appear? Proposed: small attribution under the price card and the address search field.
4. **Purge window** for provider data — proposed: at quote expiry (24 h default) or within 30 days, whichever is earlier.
5. **Terms of Use and Privacy Policy** — must exist and reference Google's terms before any Google-backed feature is public.

## How the code is prepared

`priceQuote()` (`src/lib/pricing/quote.ts`) returns a `ServiceQuote` split into:

| Section | Contents | Retention |
|---|---|---|
| `commercial` | Tariff id/version, config version, driver, zones, priced lines (amounts only), totals, rounding, overnight status | Our business record |
| `inputFingerprint` | SHA-256 over our own inputs and pricing context — no coordinates, no route data | Keep |
| `providerDerived` | Provider route (distance, duration, provider, timestamp) and the overnight commitment minutes that include provider duration; `retention: "provider_restricted"` | **Purge per decision 4** |

- Commercial lines never contain provider distance or duration (tests assert this).
- `stripProviderDerived(quote)` removes provider data without touching the commercial record.
- Coordinates are used only for in-memory sanity checks and are excluded from fingerprints.
- The routing adapter requests only distance and duration (minimal field mask) and only for resolved place IDs or coordinates.
- Provider error messages are never stored or returned — only normalized kinds and enum-like statuses.

## Required before persistence (Step 1.7)

1. Resolve decisions 1, 2 and 4.
2. Store `providerDerived` in a separate table/column with a `purge_after` timestamp; run a scheduled purge.
3. Exclude `providerDerived` from analytics exports and long-term backups, or purge those too.
4. Publish Terms of Use and Privacy Policy (decision 5) and implement attribution (decision 3).
