# DRIVEO — UI/UX improvements from the Apple Design audit

Status: implemented, **not committed yet** (waiting for founder approval). Base commit `3f8a10c`.

## What changed

1. **Overflow at 320px with 200% text**
   - Fixed in the header, mobile menu, booking buttons, service note, the step 2 sections, the checkbox and segmented labels, the fuel policy list and the review rows.
   - Gutters and padding are now fixed px, with the same values at default size.
   - Flex text can shrink (`min-w-0`) and long words wrap.
   - The step buttons wrap onto their own rows.
   - On phones the header CTA moved into the mobile menu as a full-width button.
2. **Pricing copy**
   - Process step 2, the trust "price" card and the FAQ answer now say the service price and availability are confirmed after the request.
   - The old automatic-pricing sentences are kept as comments in `ka.ts`.
   - No pricing code was changed.
3. **Readability**
   - 12px notes and hints are now 14px; badge and "up next" text are 13px; short card copy is 15px. Hierarchy is unchanged.
4. **Labels**
   - Header CTA and booking title are now "გადაყვანის დაგეგმვა".
   - Step buttons and the final submit keep their own labels.
5. **Footer:** all links and the back-to-top button are at least 44×44.
6. **Cursor:** buttons, summaries and `label[for]` show a pointer.
7. **Contrast:** added `@media (prefers-contrast: more)`.
   - Brighter muted and subtle text (7.8–11.2:1) and stronger lines and borders.
   - 3px focus ring. Brand colours unchanged.
8. **Service list:** use cases are a `ul` with a lime dash marker; process steps keep 01/02/03.

The desktop active-section indicator was not implemented, as instructed.

## Files changed (15)

- `src/app/globals.css`
- `src/content/ka.ts`
- `src/components/ui/`: `Button.tsx`, `Container.tsx`, `Field.tsx`, `Badge.tsx`
- `src/components/layout/`: `Header.tsx`, `MobileMenu.tsx`, `Footer.tsx`
- `src/components/booking/`: `BookingCard.tsx`, `DetailsStage.tsx`, `ReviewStage.tsx`, `RouteStage.tsx`
- `src/components/sections/`: `Service.tsx`, `Trust.tsx`

## Checks actually run

- `npx tsc --noEmit`: pass
- `npm run lint`: pass
- `npm test`: 361/361 pass
- `npx next build`: pass
- Browser, dev server:
  - **320px at 100%, 150% and 200% text:** page width 320, no horizontal scroll, zero overflowing elements. Covers the whole page and the open mobile menu.
  - **Booking card at 200%:** steps 1, 2 (vehicle and contact) and 3 (review) checked. The review "edit" buttons extend 16px into the card padding through a negative margin; that's by design and stays inside the card.
  - **375px at 100% and 200%:** no overflow.
  - **1280px:** no page overflow. The process connector line reaching into the gap is decorative and unchanged.
  - **On every width:** no visible text under 13px; all footer targets at least 44px; all buttons `cursor: pointer`; the service list has no numbers while the process `ol` has 3 steps.
  - **Keyboard:** 12 real Tab presses moved focus in a logical order. Every focused element had a visible outline or ring.
  - **Validation:** submitting the empty vehicle section showed 5 errors, `aria-invalid` on the fields, focus on the first invalid field, and the live message "შეასწორეთ 5 ველი.".

## Not fully verifiable here

- **Reduced motion:** the browser pane can't emulate `prefers-reduced-motion`. I confirmed the reduce rule is in the served CSS and that JS scrolling checks the media query, but didn't see it take effect.
- **Increased contrast:** same limitation. The `prefers-contrast: more` rule is in the served CSS but wasn't seen in effect.

## Remaining notes

- At 200% on 320px, long Georgian words in the narrow fuel list break mid-word. It's legible, with no overflow.
