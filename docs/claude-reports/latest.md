# DRIVEO — Claude Code development report

DRIVEO — Claude Code development report. Please review the completed work, identify any issues, update the progress tracker, and prepare the next safe development step.

- **Step:** 1.7E.1, private Telegram test notification setup (code only; nothing sent)
- **Date:** 2026-10-22
- **Previous:** `2e96b94`

## Implemented

**Founder-only Telegram flow at `/admin/telegram`**
- Access: active admin at AAL2, rechecked by the server on every action.
- Gate: shows "not configured" until the founder sets a server-only `TELEGRAM_BOT_TOKEN`.

**Pairing**
- It reuses the existing pairing challenges: session-bound, 10-minute expiry, single use, locked after 5 wrong codes.
- **Step 1:** the founder opens a deep link `t.me/<bot>?start=<challenge>` and presses Start.
- **Step 2:** the server polls `getUpdates` only when the founder presses "check". It needs no webhook.
- **What matches:** only `/start <challenge>` sent from a private chat by a person (`from.id === chat.id`, not a bot, not forwarded), after the challenge started.
- **Step 3:** the server sends a one-time code to that chat. The founder types it into the same admin session.
- **What is stored:** only after the code matches does the database store the verified private chat as the admin's single active recipient. The browser never supplies a chat id.

**Guards**
- The bot must have `can_join_groups=false` (BotFather → Allow Groups off).
- A database CHECK `chat_id > 0`: group and channel ids are negative, so they can never be stored.

**One-time test message:** the exact approved text.
- Requires the server flag `TELEGRAM_TEST_SEND=once`, the confirmation checkbox, and Telegram's `getChat` confirming `type=private`.
- It is claimed in the database before sending, then sent once with no automatic retry.
- Outcomes: `sent`, `failed` (a 4xx: may be retried manually) or `unknown` (timeout or 5xx). `unknown` blocks re-sending to avoid duplicates.
- It creates no booking and no outbox event.

**Telegram client:** the official Bot API (`getMe`, `getUpdates`, `getChat`, `sendMessage`), with a 10 s timeout and short error codes only. The token and URLs never appear in errors or logs.

**Founder guide:** in Georgian, in `docs/telegram-setup.md`.

## Database migration (local only, NOT applied)

`supabase/migrations/20261022000200_telegram_recipient.sql`:
- `driveo_private.telegram_recipients` and `telegram_test_sends`, with RLS and no grants
- a `chat_id` column on pairing challenges
- admin-session functions for attach, status, send target, revoke, claim and complete test send
- an updated `admin_verify_telegram_pairing` that records the recipient
- drops the unused secret-key `attach_telegram_pairing_code`

**Founder approval is required before applying it to `driveo-dev-eu`.** Until then `/admin/telegram` shows "not configured", so it fails safe.

## Tests

- TypeScript: pass. Lint: pass. Production build: pass.
- Tests: **331/331 pass**, up from 313.
  - Telegram API mocked: exact message text, token never in errors, timeout/network behaviour, private-chat-only matching (groups, channels, bots, forwarded messages and wrong tokens rejected), keyed hashes.
  - PGlite flow with a fake Telegram:
    - pairing succeeds only from the same session
    - a bot that may join groups is refused
    - non-admin and AAL1 sessions are refused
    - negative chat ids are rejected by the database
    - the private tables are unreadable by API roles
    - the test send happens exactly once
    - `unknown` blocks a re-send, while `failed` allows a manual retry
    - a non-private chat is refused before claiming
    - revoking the recipient stops sends
    - no bookings or outbox events are created
- Leak scan: no token-shaped strings or Supabase keys in client bundles or tracked files. The only bundle match is the variable *name* in the Georgian help text.

## Remote

No changes. Nothing was sent to Telegram, no remote database writes were made, and no ChatGPT or Chrome automation was used.

## Feature flags

- `BOOKING_SUBMISSIONS`: off
- `TELEGRAM_TEST_SEND`: off
- Telegram is not configured (no token)
- Booking notification worker: not built. Email: not built.

## Dashboard check

NOT VERIFIED. It needs the founder's sign-in.
- Manual check: run `npm run dev`, then open `http://localhost:3000/admin` and sign in. The empty bookings list should load with no error message.

## Remaining blockers

- Before the Telegram test:
  - approval to apply migration `20261022000200`
  - the founder creates the bot (Allow Groups off) and sets the token locally
  - approval for pairing, which sends one code message
  - approval for the single test message
- Still open from before: the first fictional booking test (approval b).
- Before real customers:
  - live access checks
  - persistent admin-login limits
  - CAPTCHA
  - approved Terms of Use and Privacy Policy
  - insurance and liability
  - booking notification worker
  - production setup

## Progress estimate (rough)

- Development MVP: about 75%
- Production readiness: about 42%
