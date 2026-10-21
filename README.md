# DRIVEO. — Vehicle Delivery Service (MVP)

A Georgian-first website for a driveaway service: a professional driver relocates a customer's own vehicle between addresses in Georgia.

> **DRIVEO.** is a temporary brand name. All branding lives in `src/config/brand.ts`.

## Stack
Next.js (App Router) · TypeScript · Tailwind CSS v4 · `next/font` (Manrope + Noto Sans Georgian)

## Structure
```
src/
  app/            routes, root layout, fonts, global CSS + design tokens
  config/         brand.ts — name, wordmark, contacts (single source of truth)
  content/        ka.ts — all Georgian UI copy
  components/
    ui/           primitives (Button, Container, Wordmark, …)
    layout/       header, footer
    booking/      booking prototype UI
    sections/     homepage sections
  lib/            framework-free domain logic (relative `.ts` imports, runs in Node tests)
    booking/      types, validation, phone parsing, versioned policies
    pricing/      money (integer tetri), tariff/quote types, pure price calculation
    fuel/         energy-estimate model, kept separate from the service price
    routing/      RouteProvider contract, Google Routes adapter (mock-tested), settings, usage guard
    quotes/       quote orchestration: strict input validation, service, store, customer-safe responses
  server/         server-only entry points (routing; quote service in mock/disabled mode; live Google calls OFF)
docs/             Google Cloud setup, Google data retention/attribution, production-readiness blockers
public/images/    licensed, optimized imagery only
```

## Status
Prototype. The booking form validates and previews locally only — nothing is sent or stored.
No backend, payments or authentication yet. No live prices are shown; pricing functions are
exercised only by tests with labelled fixture values.

## Scripts
```bash
npm run dev     # http://localhost:3000
npm run lint
npm run build
npm test        # Node built-in test runner, src/**/*.test.ts
```
