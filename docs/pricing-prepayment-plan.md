# DRIVEO — automatic pricing, prepayment and fuel policy: audit and plan (Step 1.8)

Status: **design only.** Nothing in this document is active. Automatic commercial pricing, routing calls, payments and public submissions all remain **off**. No paid service has been enabled.

## 1. Confirmed business model (founder, 2026-10-23)

1. The customer enters pickup, destination, vehicle and the requested date and time.
2. The site gets the road distance and driving time from a **permitted** routing provider.
3. DRIVEO calculates the fee from **founder-approved** tariffs.
4. The customer sees the price **before** submitting.
5. The founder approves availability.
6. The customer **prepays by bank transfer**.
7. The founder verifies the money **in the bank account**.
8. Only then is the driver dispatched. Fuel and charging are never part of the fee.

## 2. Audit of what already exists (reuse, don't rebuild)

| Area | Status | Reuse |
| --- | --- | --- |
| Pricing engine | `src/lib/pricing/quote.ts` `priceQuote()`: tariff × road km, minimum charge, positioning and return travel, rounding **up to whole GEL**, 12 h validity, input fingerprint (SHA-256), supersede/price-change acknowledgement | **Keep as is.** Feed it real routes. |
| Eligibility gate | `evaluateAutomaticPricingEligibility()`: approvals, pilot routes, evidence age, operating limits, schedule planning | **Keep.** It is the switch that stays off until tariffs and areas are approved. |
| Route abstraction | `RouteProvider` / `RouteResult`, `method: "road"` only, explicit error kinds, never straight-line | **Provider-neutral already.** Add adapters; the engine doesn't change. |
| Google Routes adapter | Built and tested, **disabled** (`GOOGLE_ROUTES_ENABLED`), with usage caps | Keep for later. No billing is activated. |
| Mock routes | Development only; refused in production | Never used for real prices. |
| Quote service | `src/lib/quotes/service.ts`, server-side validation, public response mapper | Keep. |
| Quote store | **In-memory only, refused in production** | **Gap:** needs a persistent database table (§7). |
| Booking DB | `pricing_mode`; the database **refuses `automatic_quote`** until quotes can be verified server-side | Relax only together with the persistent quote store. |
| Manual price flow | `price_proposals` + `price_acceptances` (written evidence, 12 h validity, whole GEL) | Keep as the fallback for unsupported routes. |
| Fuel policy | `FUEL_POLICY` v2 (customer provides fuel or charge; extra is reimbursed separately; never in the fee) | Keep. Any wording change bumps the version. |

## 3. Free routing provider comparison (no paid APIs)

Researched 2026-10-23. Terms change, so re-check before use.

| Option | Cost | Limits | Commercial use | Notes for Georgia |
| --- | --- | --- | --- | --- |
| **openrouteservice** public API (HeiGIT), free Standard key | Free | Directions: **2,000/day, 40/min** (sliding window); 403/429 when exceeded | **Not clearly stated** for the Standard key. Forum staff say they don't sell commercial plans and to email for more quota. The main website is **currently offline** ("PHP issues"), though the API still answers. | OSM data, updated about weekly; changes appear in 2–3 weeks. It needs **coordinates**, so a geocoding step is required (ORS geocoding has separate limits). |
| **OSRM demo server** (`router.project-osrm.org`) | Free | about 1 request/second | **Non-commercial only.** It must not be a production dependency. | Same OSM data; no guarantees. |
| **GraphHopper** API, free package | Free | about 500 credits/day | **Non-commercial only.** Paid plans start at about €/$69 per month. | |
| **Self-hosted** OSRM, Valhalla or ORS with the Geofabrik Georgia extract | Software free; **server needed** (a small VPS is a few €/month, which needs approval) | Unlimited (our own) | Allowed: open-source software plus ODbL data, with attribution "© OpenStreetMap contributors" | Best long-term free option. Georgia's extract is small, so a modest server is enough. We control updates. |
| **Google Routes** (adapter already built) | Billable beyond the free monthly credits; needs billing activated | Our own caps | Allowed under Google's terms | Best address and place resolution. Deferred, since you declined billing. |

**Recommendation:**
- **Development and pilot:** openrouteservice with a free Standard key, **only after** HeiGIT confirms in writing (email `enquiry@openrouteservice.org`) that DRIVEO's low-volume commercial use is allowed.
- **Production:** self-hosted OSRM or Valhalla on Georgia OSM data, or Google Routes once you approve billing.
- **Never** the OSRM or GraphHopper free public endpoints for real prices.

**Accuracy risks in Georgia:** OSM coverage is good on main roads and weaker for rural addresses and new streets. Geocoding of Georgian street addresses is the weakest link. So:
- the customer confirms a pin or suggestion
- the system refuses a price when the geocoder's confidence is low
- the eligibility gate's plausibility checks stay on (km/h range, ratio of road distance to straight-line distance)

## 4. Automatic pricing: requirements before it can be switched on

1. **Routing:** a permitted provider adapter, `openrouteservice` or self-hosted. It must fail closed: on any error, timeout or low geocoding confidence, the customer sees «ფასი დროებით მიუწვდომელია», never a guessed or mock price, and never straight-line distance.
2. **Founder approvals, recorded with date and version:**
   - the tariff formula (base, per km, minimum charge)
   - driver positioning and return-travel rules (home base Tbilisi)
   - supported service areas and pilot routes
   - operating limits
   - evidence for public-transport return fares
3. **A persistent quote store:** the server stores the quote, the customer sees it, and at submission the server re-checks the quote ID, fingerprint and 12 h validity. The client never sends a price.
4. **Display:** the quote shows the service fee and, as its own line: **«საწვავი / დატენვა — არ შედის მომსახურების საფასურში»**.
5. **Enable gradually:** per pilot route via the eligibility gate; everything else stays manual assessment.

## 5. Prepayment workflow (manual bank transfer)

**Separate state machines.** Booking approval and payment never share a status.

```
Booking:  submitted → approved (availability confirmed) → dispatched → in_progress → completed
          ↘ declined / cancelled (until dispatched)
Payment:  not_due → awaiting_transfer → verified
                        ↘ expired (deadline passed, not paid)  · refunded (manual, founder only)
Rule:     booking → dispatched is IMPOSSIBLE unless payment = verified (enforced in the database).
```

- **Order status page** `/order/<token>`:
  - **Token:** 32 random bytes in base64url. Only a SHA-256 of it is stored. It is shown to the customer once, right after submission.
  - **What it shows:** reference, route, requested pickup date and time, booking status and payment status. It shows payment instructions **only** once the booking is approved, the founder has configured **and approved** the bank details, and payment is `awaiting_transfer`.
  - **Protections:** no name, phone or address on the page; `noindex` and `no-store`; `Referrer-Policy: no-referrer`; rate-limited lookups; same response for unknown and expired tokens; the token expires 30 days after completion.
- **Bank details:**
  - stored by the founder in an admin-only settings table at AAL2, with a version and an approval timestamp, and **never hardcoded**
  - the payment purpose is the booking reference (`DRV-2026-000123`)
- **Verification:**
  - The founder records the bank transaction reference, the amount received, which must equal the quoted fee, and the date received, from the **bank statement**.
  - A customer screenshot or uploaded receipt is **not** proof.
  - Recording happens through one audited function. It refuses amount mismatches, a second verification, and changes after dispatch.
- **Deadline:** the payment deadline is set when the booking is approved; the default proposal is the earlier of 24 h after approval and 12 h before pickup, pending your decision. When it passes, the status becomes `expired` and the slot is released.
- **Audit:** every transition writes `booking_status_events`, a new append-only `payment_events` table and `admin_audit_log`.

## 6. Fuel and EV charging policy and UI copy (draft)

**Quote line (fixed):** «საწვავი / დატენვა — არ შედის მომსახურების საფასურში»

| Vehicle | Draft Georgian copy |
| --- | --- |
| Petrol / diesel / LPG / CNG | «ავტომობილი გადმოგვეცით მარშრუტისთვის საკმარისი საწვავით. საწვავის ხარჯი მომსახურების საფასურში არ შედის.» |
| Electric | «ავტომობილი გადმოგვეცით მარშრუტისთვის საკმარისად დატენილი. დატენვის ხარჯი მომსახურების საფასურში არ შედის. გზაში დატენვა მგზავრობის დროს გაზრდის.» |
| Hybrid / plug-in hybrid | «ავტომობილი გადმოგვეცით საკმარისი საწვავით (დატენვადი ჰიბრიდი — სასურველია, დატენილიც). საწვავისა და დატენვის ხარჯი მომსახურების საფასურში არ შედის.» |
| Unavoidable top-up | «თუ გზაში დამატებითი ჩასხმა ან დატენვა გარდაუვალი გახდება, ჯერ წერილობით (SMS/WhatsApp) მოგწერთ და მხოლოდ თქვენი თანხმობის შემდეგ შევასრულებთ. ხარჯი დადასტურდება ქვითრით და ანაზღაურდება ცალკე — ის მომსახურების საფასურის ნაწილი არ არის.» |

- **No prices or estimates in the total:** there are no invented fuel prices, consumption figures or charging costs.
- **Optional energy estimate:** only if the customer enters their own consumption figure. It would be labelled «სავარაუდო, არ არის გარანტირებული» and kept out of the total.
- **Top-up records:** a `fuel_topups` table with the booking, amount, litres or kWh (optional), receipt reference, the customer's written authorization (time, channel, reference) and who recorded it. Settlement is separate from the fee.
- **Driver financing:** whether the driver ever advances money is a founder decision. The copy doesn't promise it.
- **Version bump:** publishing this wording changes `FUEL_POLICY` to v3.

## 7. Required database changes (one future migration each, each separately approved)

1. **`quotes`:** a persistent, server-issued table holding the fingerprint, amount, breakdown, route provider, km, minutes, `valid_until` (12 h) and status (issued, used, expired).
   - service-role `issue_quote` and `use_quote`
   - `submit_booking_request` accepts `automatic_quote` only with a valid, unused quote whose fingerprint matches
2. **Booking states:** `approved`, `dispatched` and `in_progress`, plus a **dispatch gate** that requires a verified payment.
3. **`booking_payments` + `payment_events`:** append-only, admin functions only (open, verify, expire, refund), with an amount-equality check.
4. **`business_settings`:** bank details, admin-only at AAL2, versioned, with an approval flag.
5. **`booking_access_tokens`:** a hashed token, plus a service-role function that returns only the minimal status view.
6. **`fuel_topups`:** authorization evidence and receipt reference.

RLS stays deny-by-default; new private tables go in `driveo_private`; nothing is exposed to `anon`.

## 8. Risks and open founder decisions

- **Risks:**
  - openrouteservice's terms for commercial use are unclear and its website availability is shaky
  - Georgian address geocoding accuracy
  - customers mistyping the payment reference or amount
  - leakage of the order-status token, mitigated by hashing, no-referrer, expiry and not showing personal data
  - payment-deadline disputes
  - bank details shown before they're verified, mitigated by the approval flag
  - VAT, invoicing and accounting obligations, to be confirmed with an accountant
- **Your decisions:**
  - the tariff formula, minimum charge, and positioning and return rules
  - supported areas
  - the routing provider
  - the payment deadline
  - the cancellation and refund policy
  - the bank account
  - top-up authorization and any cap
  - whether drivers advance money
  - Terms of Use and Privacy Policy
  - insurance and liability

## 9. Recommended order of implementation

1. Persistent quote store and verification (database plus service), still with pricing **disabled**.
2. A routing adapter for the chosen permitted provider, behind a flag and failing closed, with a geocoding confidence gate.
3. The founder tariff and area approval records, fed into the existing eligibility gate.
4. Booking approval, payment states and the dispatch gate (database first).
5. The order status page (read-only), then payment instructions once bank details are approved.
6. Fuel top-up records and the `FUEL_POLICY` v3 wording.
7. Pilot: enable automatic pricing on one approved route (for example Tbilisi → Rustavi).

## 10. Future homepage CTA (NOT published; for when automatic pricing is live)

- Eyebrow: «თქვენი დრო მნიშვნელოვანია.»
- Title: «დანიშნულების ადგილამდე —» / «მარტივად.» (the second line in lime)
- Text: «მიუთითეთ მარშრუტი, ავტომობილი და სასურველი დრო — ფასს მოთხოვნის გაგზავნამდე ნახავთ. ხელმისაწვდომობის დადასტურების შემდეგ მიიღებთ გადახდის ინსტრუქციას.»
- Button: «გადაყვანის დაგეგმვა»

Sources:
- [openrouteservice plans](https://openrouteservice.org/plans/)
- [openrouteservice FAQ: quotas](https://giscience.github.io/openrouteservice/frequently-asked-questions)
- [ORS forum: commercial use](https://ask.openrouteservice.org/t/price-for-commercial-use-of-ops/409)
- [OSRM demo server policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server)
- [GraphHopper pricing](https://www.graphhopper.com/pricing/)
