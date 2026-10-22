# DRIVEO — automatic Telegram booking notifications (Step 1.7E.2)

Status: **built and tested locally. Disabled.** No booking notification has ever been sent. Nothing schedules the worker.

## 1. What it does

When a **real** booking is committed, `submit_booking_request` writes one outbox event in the same transaction. Its payload is allowlisted:
- reference
- cities
- vehicle
- submission time
- requested pickup date and time

There is no name, phone or address. The worker reads such events and sends the founder one Telegram message, in plain text:

```
🚗 DRIVEO — ახალი შეკვეთა
🆔 შეკვეთა: DRV-2026-000123
📍 მარშრუტი: თბილისი → რუსთავი
📅 გაყვანის თარიღი: 29 ოქტომბერი, 2026
🕐 გაყვანის დრო: 10:00
📋 სტატუსი: მიღებული
🔗 დეტალები: Admin Dashboard — https://<DRIVEO_APP_URL>/admin
```

- **Pickup time:** the date and time are the customer's requested Asia/Tbilisi values from the payload, never the submission or send time. If they're missing, the message says «… მითითებული არ არის».
- **Admin link:** included only when `DRIVEO_APP_URL` is a clean `https` origin (or `http://localhost`). The dashboard still requires password + TOTP (AAL2).

## 2. Components

| Piece | Where |
| --- | --- |
| Settings / flag | `src/lib/notifications/worker-settings.ts` |
| Worker logic | `src/lib/notifications/booking-worker.ts` |
| Trigger endpoint logic | `src/lib/notifications/worker-http.ts`; route `src/app/api/internal/notifications/run/route.ts` |
| Server wiring (secret key, bot token) | `src/server/notifications.ts` (server-only) |
| Message template | `src/lib/telegram/booking-message.ts` |
| Database support | migration `20261023000200_booking_notification_worker.sql`: **local only, not applied** |

It reuses the existing outbox, attempt history, `record_notification_attempt`, `complete_notification_event`, `admin_retry_notification`, the verified recipient table and the Telegram client. There is no second notification system.

## 3. Safety rules (all tested)

- **Recipient:**
  - The worker sends only if exactly **one** active, verified private recipient exists. That is the founder's chat from pairing, with `chat_id > 0` enforced by the database.
  - It refuses if Telegram reports the chat is not `private`, or if the bot can join groups. In those cases nothing is claimed.
- **Real bookings only:**
  - `claim_booking_notifications` takes only fresh `pending` `booking.submitted` events where both the event and the booking have `is_test = false`.
  - Test events are already `suppressed_test`, and a database CHECK forbids them from ever becoming deliverable.
- **No duplicates:**
  - Claiming uses row locks (`FOR UPDATE SKIP LOCKED`), so concurrent or repeated runs never take the same event.
  - A stale `processing` event (a worker stopped mid-send) is **not** re-claimed automatically, because Telegram has no idempotency key and resending could duplicate the message.
- **Failures:**
  - `429`: retried with backoff of 60 s, then 120 s, then 240 s, up to 3 attempts in total.
  - Other `4xx`: `failed_all`, with no retry.
  - Timeout, network error or `5xx`: **uncertain**. The event is marked `failed_all` and **not** retried automatically. The founder checks Telegram and, if needed, re-queues it with `admin_retry_notification`.
  - Every attempt is recorded with a short code. Telegram calls time out after 10 s.
- **No leaks:**
  - Logs are `[notify] <event> {codes}` only.
  - The secret key, bot token and worker secret are server-only and never in client bundles.
  - Messages contain no personal data.

## 4. Activation (later, separately approved; nothing is active now)

1. Founder approval to apply migration `20261023000200` to `driveo-dev-eu`, with a dry run first.
2. Set these in `.env.local`, entered by the founder; never paste them anywhere:
   ```
   BOOKING_NOTIFICATIONS=telegram
   NOTIFICATIONS_WORKER_SECRET=<32+ random chars>   (generate without displaying it)
   DRIVEO_APP_URL=http://localhost:3000            (optional)
   ```
   `TELEGRAM_BOT_TOKEN`, `SUPABASE_SECRET_KEY` and `SUPABASE_URL` are already set.
3. A controlled live test, separately approved:
   1. Create **one real (non-test) booking**. Test bookings are never delivered, by design.
   2. Trigger one run: `POST /api/internal/notifications/run` with `Authorization: Bearer <worker secret>`.
   3. Check Telegram.
4. Then `BOOKING_NOTIFICATIONS=off` again until a schedule is approved. A schedule would use a hosting cron or a Supabase scheduled function, which may cost money. Production stays refused by the code until it is explicitly enabled.
