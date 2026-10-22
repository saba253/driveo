# DRIVEO — Claude Code development report

DRIVEO — Claude Code development report. Please review the completed work, identify any issues, update the progress tracker, and prepare the next safe development step.

- **Step:** 1.8, final pricing, prepayment and fuel policy (audit and plan) + homepage final CTA
- **Date:** 2026-10-23
- **Base:** `0b62bfb`. The commit hash for this step is in the push summary of this session; this file is part of that commit.
- **Detailed plan:** [docs/pricing-prepayment-plan.md](../pricing-prepayment-plan.md)

## 1. Homepage final CTA: implemented

- **Copy:**
  - Eyebrow «თქვენი დრო მნიშვნელოვანია.»
  - Title «დანიშნულების ადგილამდე —», with «მარტივად.» in lime (#D9F66F)
  - The new description and the button «გადაყვანის დაგეგმვა»
  - The button still scrolls to `#booking`
- **Layout:** the heading container was widened one step (`max-w-2xl` → `max-w-3xl`) so the first line fits on one line on desktop (verified at 1280 px). On a phone (375 px) it wraps once at a word boundary. There's no overflow. The design, centring, glow and animations are unchanged.
- **No promises:** the copy doesn't mention live pricing or online payment. A future variant for when automatic pricing is live is in the plan, §10, and is **not published**.

## 2. Pricing engine reuse

Keep `priceQuote` (whole-GEL rounding, 12 h validity, fingerprint), the eligibility gate, the provider-neutral `RouteProvider` and the quote service. There are two gaps:
- a **persistent quote store**, since the current one is in-memory and refused in production
- a **permitted routing adapter with geocoding**

The database still refuses `automatic_quote` bookings until quotes can be verified server-side.

## 3. Free routing comparison (summary)

- **openrouteservice** free Standard key: 2,000 directions/day, 40/min. Commercial use isn't clearly stated, so get written confirmation from HeiGIT first. Its website is currently offline. It needs geocoding.
- **OSRM demo** and **GraphHopper free**: non-commercial only. Not allowed for real prices.
- **Self-hosted** OSRM/Valhalla/ORS on the Georgia OSM extract: best long-term free option. It needs a small server, which costs money and needs approval. It requires ODbL attribution.
- **Google Routes**: adapter ready, deferred because there's no billing.

## 4. Automatic pricing requirements

1. A permitted provider that fails closed: never mock or straight-line distance, and «ფასი დროებით მიუწვდომელია» on any error.
2. Founder-approved tariff formula, minimum charge, positioning and return rules, and service areas.
3. A persistent, server-verified quote.
4. A separate quote line: «საწვავი / დატენვა — არ შედის მომსახურების საფასურში».
5. Per-route activation via the eligibility gate.

## 5. Prepayment workflow (design)

- **Separate states:**
  - booking: submitted → approved → dispatched → in_progress → completed
  - payment: not_due → awaiting_transfer → verified / expired / refunded
- **Dispatch gate:** the database blocks dispatch until the payment is verified.
- **Verification:** only from the bank statement (reference, amount equal to the quote, date). A customer screenshot is not proof.
- **Order status page** `/order/<token>`: the token is random and stored only as a hash. It shows no personal data, and payment instructions appear only after approval **and** founder-approved bank details. Bank details are never hardcoded.

## 6. Fuel and charging (draft copy in the plan, §6)

- **Wording:** separate texts for petrol/diesel, electric and hybrid vehicles.
- **Top-ups:** need written customer authorization first, receipt evidence, and settlement separate from the fee.
- **No estimates in the total:** no invented fuel or charging costs. An optional estimate only from the customer's own consumption data.
- **Version:** publishing this wording means `FUEL_POLICY` v3.

## 7. Required database changes (future, each separately approved)

- `quotes`
- booking states plus the dispatch gate
- `booking_payments` + `payment_events`
- `business_settings` (bank details)
- `booking_access_tokens`
- `fuel_topups`

## 8. Risks and open founder decisions

- **Risks:** routing terms and availability; Georgian geocoding accuracy; payment reference and amount mistakes; token leakage (mitigated); VAT and invoicing.
- **Decisions:** tariffs; areas; routing provider; payment deadline; cancellation and refund policy; bank account; top-up authorization and cap; whether drivers advance money; Terms of Use and Privacy Policy; insurance.

## 9. State checks

- Migration `20261023000200` is **already applied** (approved in Step 1.7E.2-B). The remote is up to date with 7 migrations.
- No remote changes were made in this step.
- No paid service was enabled.
- Booking submissions, automatic pricing, payments and notifications all remain **off**.
- Test booking DRV-2026-000001 is untouched.

## 10. Tests

- TypeScript: pass. Lint: pass. Production build: pass.
- **361/361 tests pass.**
- Client-bundle secret scan: clean.

## 11. Progress (rough)

- Technical MVP: about **84%**. The booking, admin, notification and Telegram foundations are done; automatic pricing and prepayment remain.
- Production / commercial readiness: about **42%**. The new prepayment and pricing scope adds work, plus the legal and launch blockers.

## 12. Remaining tasks and next step

**Next recommended step:** implement the persistent quote store and verification (plan §9, step 1), still with pricing disabled. In parallel, the founder:
- emails HeiGIT about commercial use of openrouteservice
- decides the tariff formula and pilot route

**Still open from earlier:**
- the dashboard pickup-time check, which needs the founder's sign-in
- the notification drill design, which needs approval
- closing the two GitHub alerts as "Used in tests"
- legal and production blockers
