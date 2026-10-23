# DRIVEO: final Georgian copy, booking draft persistence and restart

Status: implemented, checked and approved by the founder (the four confirmation strings and the commit). Committed on `main` on top of `9c91525`.

## Repository state before the work

- Branch `main`, HEAD `9c91525` (the Apple Design UI/UX commit), up to date with `origin/main`.
- The only uncommitted file was `src/content/ka.ts`, holding the approved booking CTA copy and the Process step 3 text. Both were kept.

## 1. Georgian copy (`src/content/ka.ts`)

| Where | Final text |
|---|---|
| Service: „ქირავნობა და ავტოსალონები“ (heading kept) | ავტომობილების გადაადგილება იქ, სადაც თქვენს საქმიანობას სჭირდება. |
| Service: „ქალაქებს შორის“ (heading kept) | ჩვენი მძღოლი თქვენს ავტომობილს სასურველ ქალაქში მიიყვანს, წინასწარ შეთანხმებულ დროსა და ადგილზე. |
| Process step 3: „გადაყვანა“ | ჩვენი მძღოლი ავტომობილს შეთანხმებულ დროს გადაიბარებს და დანიშნულების ადგილზე მიიყვანს. |
| Header, mobile menu, hero and final CTA | დაჯავშნა |
| Booking form heading | მძღოლის დაჯავშნა |
| Next / back / final submission | გაგრძელება / უკან / მოთხოვნის გაგზავნა (unchanged) |
| Restore message | თქვენი დაუსრულებელი მოთხოვნა აღდგენილია. |
| Restart action | თავიდან დაწყება |

**Strings I wrote, approved by the founder** (the restart confirmation):
- question: „დავიწყოთ თავიდან?“
- text: „შეყვანილი მონაცემები წაიშლება.“
- buttons: „გაუქმება“ / „მონაცემების წაშლა“

The rejected phrases („გადაყვანის დაგეგმვა“, „დაგეგმეთ გადაყვანა“, „დაიწყე შეკვეთა“) and the old descriptions no longer appear anywhere in `src` or on the rendered page.

## 2. Logo

Unchanged. It is still `#top` on the same page, so the form is never reset; verified in the browser.

## 3. Draft persistence

New module `src/lib/booking/draft-storage.ts`, wired into `useBookingForm.ts`.

**Storage**
- Kept in `sessionStorage` under the key `driveo:booking-draft:v1`.
- Holds `{ v, policyVersion, draft, stage, savedAt, pendingSubmissionId }`.
- Expires after 24 hours; a `savedAt` more than 5 minutes in the future is rejected.

**Restoring**
- Restoring runs only after hydration, so the server markup always matches.
- Anything malformed, expired, from another version, empty, or at a final stage is ignored, and its entry is removed.
- Fields of the wrong type, unknown fields and text over 300 characters are dropped.
- Unknown powertrain or transmission values are reset to empty.
- If the fuel terms' version changed, they have to be accepted again.
- Stages before the saved one are validated again. The first one that's no longer valid (for example, a pickup date that has passed) reopens with its errors shown; otherwise the saved stage resumes.
- The final screens are never restored, and a restored draft is never sent automatically.

**Never stored:** validation errors, the honeypot field, submission state or the reference number.

**Cleared:**
- on restart
- on the prototype's final screen
- on "received", which is only set after the server confirms it stored the request
- when the form is empty

A started or failed request does not clear it.

**Storage errors:** if storage is blocked or full, every read and write fails silently and the form simply works without a saved draft.

## 4. Restart

- „თავიდან დაწყება“ appears below the actions on steps 1–3 and the review, only when something has been entered and no request is in flight.
- It asks inside the card first:
  - focus moves to „გაუქმება“
  - Escape or „გაუქმება“ closes it, returns focus to the trigger and keeps all data
  - „მონაცემების წაშლა“ clears the saved draft, the form and any pending key, then focuses the step 1 heading
- It's built from the existing button styles; no new dependencies.

## 5. Duplicate submissions

- **Server, unchanged and sufficient:**
  - the database stores the client's key in a unique `submission_id` column, with a content hash
  - the same key with the same content returns the existing booking
  - the same key with different content gives `conflict`
  - per-IP, per-phone and overall rate limits still apply
- **Gap that was fixed:** the key lived only in memory, so a refresh while an outcome was unknown would have produced a new key on resend. It's now saved with the draft as `pendingSubmissionId` and reused after a refresh. It's cleared when the server answers `received`, or `invalid` (nothing was stored).
- **Double clicks:** an extra in-flight guard was added on top of the disabled button, and the key is always reused.
- No backend, API or schema change was needed.

## 6. Layout (needed for the new copy)

- `Process.tsx` and `Service.tsx`: the marker columns, gaps and markers went from rem to the same values in px. At the default size nothing changes.
- With 200% text the description column at 320px grows from 144px to 212px (Process) and from 208px to 244px (Service).

## 7. Files changed

- `src/content/ka.ts`
- `src/components/booking/useBookingForm.ts`
- `src/components/booking/BookingCard.tsx`
- `src/components/sections/Process.tsx`
- `src/components/sections/Service.tsx`
- `src/lib/booking/draft-storage.ts` (new)
- `src/lib/booking/draft-storage.test.ts` (new)
- `docs/claude-reports/latest.md`

## 8. Checks actually run

- **Code checks:**
  - `npx tsc --noEmit`: pass
  - `npm run lint`: pass
  - `npm test`: **376/376** pass (361 existing plus 15 new draft-storage tests)
  - `npx next build`: pass
- **Browser, local dev server in prototype mode (`BOOKING_SUBMISSIONS=off`):**
  - **Copy:** all three descriptions, every CTA and the heading render correctly at 320px (100% and 200%), 375px (100% and 200%) and 1280px. No rejected wording appears, and there's no horizontal overflow.
  - **Mid-word breaks:** none at 100% on any width. At 200% on 320px, each word that still breaks is wider than its column; for example, „ავტომობილების“ is 279px in a 244px column.
  - **Logo:** clicking it on step 2 kept the step and its values, and the draft was saved.
  - **Refresh:** restored step 2 with its values and the restore message, inside a live region.
  - **Console:** no hydration errors; the only errors were the dev server's hot-reload connection.
  - **Injected drafts:**
    - expired: discarded and removed
    - malformed: no crash, discarded and removed
    - past date at review: reopened step 1 with only the date error, and the data was kept
    - review with a pending key: review restored, key kept, and zero requests to `/api/bookings`
  - **Restart:**
    - opening it moves focus to „გაუქმება“
    - cancelling kept the data and returned focus
    - a real Escape key press kept the data
    - real Tab and Enter on „მონაცემების წაშლა“ cleared both the storage and the form
  - **Prototype final screen:** clears storage, and a refresh shows an empty form.
  - **200% on 320px:** the card with the restore message and the restart panel has no overflow.

## 9. Not verified in the browser

- **Server "received" path, real errors and timeouts:** these only exist in test mode, which writes to the remote dev database. I didn't change `BOOKING_SUBMISSIONS`. These paths were checked by code review: "received" clears the draft, and the other outcomes keep it and the key. The storage logic itself is covered by unit tests.
- **Reduced motion and increased contrast:** the browser pane can't switch on these system settings. No CSS for them was changed.

## 10. Privacy and security notes

- The name and phone are now kept in this tab's `sessionStorage` until the tab closes, for at most 24 hours. Before, they were only in memory.
- Any script running on the site can read that storage, and the site has no Content-Security-Policy yet. Adding one is recommended as a separate step.
- Nothing is stored in `localStorage`, cookies or on the server before submission.

## 11. Approvals

- The four confirmation strings: approved exactly as implemented.
- Commit and push to `main`: approved.
