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
  lib/            utilities and domain types (booking.ts is UI-independent)
public/images/    licensed, optimized imagery only
```

## Status
Prototype. No backend, booking submission, payments or authentication yet.

## Scripts
```bash
npm run dev     # http://localhost:3000
npm run lint
npm run build
```
