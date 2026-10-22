# DRIVEO — Telegram: პირადი ჩატის დაკავშირება და სატესტო შეტყობინება (Step 1.7E.1)

> **სტატუსი:** კოდი მზადაა. ბოტი არ შექმნილა, Telegram-ზე არაფერი გაგზავნილა.
> - ჯავშნების შეტყობინებები, შეტყობინებების worker-ი და ელფოსტა გამორთულია.
> - `BOOKING_SUBMISSIONS=off`

**უსაფრთხოების წესები.** ბოტის ტოკენი, დაკავშირების კოდი ან ჩატის ნომერი არასდროს ჩასვათ Claude-ში, ChatGPT-ში, სქრინშოტში ან Git-ში.
- ტოკენი იწერება მხოლოდ ფაილში `C:\Users\sabaa\dev\driver\.env.local`, რომელიც Git-ში არ ხვდება.
- თუ ტოკენი შემთხვევით სადმე გამოჩნდა, მაშინვე გააუქმეთ: @BotFather → `/mybots` → თქვენი ბოტი → **API Token** → **Revoke current token**.

---

## 1. ბოტის შექმნა @BotFather-ით

1. გახსენით Telegram და მოძებნეთ **@BotFather**. აირჩიეთ ოფიციალური ანგარიში ლურჯი ნიშნით (✓).
2. დააჭირეთ **Start**-ს, შემდეგ გაგზავნეთ ბრძანება `/newbot`.

## 2. სახელი და username

1. **სახელი (name)**, რომელსაც ჩატში დაინახავთ. მაგალითად: `DRIVEO შეტყობინებები`
2. **username** უნიკალური უნდა იყოს და უნდა მთავრდებოდეს `bot`-ით. მაგალითად: `driveo_founder_alerts_bot`. თუ დაკავებულია, დაამატეთ რიცხვი: `driveo_founder_alerts_2_bot`.
3. BotFather გამოგიგზავნით **ტოკენს** (ასე გამოიყურება: `123456789:AA…`). ის ჯერ არსად ჩასვათ, მე-3 ნაბიჯამდე.
4. **ჯგუფებში დამატების გამორთვა (სავალდებულოა):** @BotFather → `/mybots` → თქვენი ბოტი → **Bot Settings** → **Allow Groups?** → **Turn groups off**.
   - DRIVEO უარს იტყვის მუშაობაზე, თუ ბოტს ჯგუფებში დამატება შეუძლია.

## 3. ტოკენის უსაფრთხოდ ჩაწერა

1. Windows-ის File Explorer-ში გახსენით საქაღალდე `C:\Users\sabaa\dev\driver`. თუ ფაილი არ ჩანს, ჩართეთ View → Show → Hidden items.
2. ფაილი `.env.local` გახსენით Notepad-ით და ბოლოში დაამატეთ ახალი ხაზი:
   ```
   TELEGRAM_BOT_TOKEN=
   ```
   ტოლობის ნიშნის შემდეგ ჩასვით BotFather-ის ტოკენი, ბრჭყალებისა და ჰარის გარეშე.
3. შეინახეთ. ფაილის სახელი ზუსტად `.env.local` უნდა დარჩეს და არა `.env.local.txt`.
4. **არასდროს** გამოიყენოთ სახელი, რომელიც `NEXT_PUBLIC_`-ით იწყება. ასეთ შემთხვევაში DRIVEO Telegram-ს საერთოდ გამორთავს.
5. გადატვირთეთ სერვერი: ტერმინალში დააჭირეთ Ctrl+C, შემდეგ:
   ```bash
   npm run dev
   ```

## 4. ბოტის პირადი ჩატის გახსნა

1. Telegram-ში მოძებნეთ თქვენი ბოტის username, გახსენით **პირადი** ჩატი და დააჭირეთ **Start**-ს.
2. ბოტი ამ ეტაპზე არაფერს უპასუხებს, ეს ნორმალურია.
3. ბოტი **არცერთ ჯგუფში ან არხში** არ დაამატოთ.

## 5. დაკავშირება მხოლოდ თქვენთვის

> ამ ნაბიჯზე DRIVEO **ერთ შეტყობინებას** გამოგიგზავნით: დაკავშირების კოდს თქვენს პირად ჩატში. შეასრულეთ მხოლოდ მაშინ, როცა ამის ნებართვას გასცემთ.

1. გახსენით `http://localhost:3000/admin` (`127.0.0.1` არ გამოიყენოთ).
2. შედით პაროლითა და ავთენტიფიკატორის კოდით, შემდეგ დააჭირეთ **Telegram**-ს.
3. დააჭირეთ **„დაკავშირების დაწყება“**, შემდეგ **„გახსენით ბოტი Telegram-ში“**.
4. Telegram-ში დააჭირეთ **Start**-ს. ბმული მოქმედებს 10 წუთის განმავლობაში.
5. დაბრუნდით იმავე ბრაუზერის ჩანართში და დააჭირეთ **„Start დავაჭირე — კოდის მიღება“**.
6. Telegram-ში მიიღებთ 6-ნიშნა კოდს. შეიყვანეთ ის გვერდზე და დააჭირეთ **„დადასტურება“**.
7. გამოჩნდება **„პირადი ჩატი დადასტურებულია“**.

დაცვა:
- კოდი მუშაობს მხოლოდ იმავე შესულ სესიაში, ერთხელ და 10 წუთის განმავლობაში.
- 5 არასწორი მცდელობის შემდეგ დაკავშირება იბლოკება.
- ჯგუფიდან, არხიდან, სხვა ბოტიდან ან გადაგზავნილი (forwarded) შეტყობინებიდან დაკავშირება შეუძლებელია.
- ჩატის ნომერი ბრაუზერიდან არასდროს მიიღება.

## 6. ერთი სატესტო შეტყობინების ნებართვა

1. `.env.local`-ში დაამატეთ ხაზი:
   ```
   TELEGRAM_TEST_SEND=once
   ```
   შემდეგ გადატვირთეთ სერვერი.
2. გვერდზე **Telegram → „სატესტო შეტყობინება“** მონიშნეთ დადასტურების ველი და დააჭირეთ **„სატესტო შეტყობინების გაგზავნა“**.
3. გაიგზავნება **ზუსტად ერთი** შეტყობინება. ავტომატური ხელახალი ცდა არ ხდება.
   - თუ Telegram დროულად არ უპასუხებს, განმეორებითი გაგზავნა იბლოკება, რომ შეტყობინება ორჯერ არ მოგივიდეთ.

## 7. მიწოდების შემოწმება

1. თქვენს პირად ჩატში ბოტისგან უნდა მოვიდეს ზუსტად ეს ტექსტი:
   ```
   🚗 DRIVEO — TEST
   ✅ Telegram connection successful.
   This is a test notification.
   No real booking has been created.
   ```
2. ადმინისტრირების გვერდზე გამოჩნდება **„სატესტო შეტყობინება გაიგზავნა“**.
3. ამის შემდეგ `.env.local`-დან წაშალეთ ხაზი `TELEGRAM_TEST_SEND=once` და გადატვირთეთ სერვერი.

---

## Technical notes (English)

- **Code:**
  - `src/lib/telegram/{config,api,pairing,messages,service}.ts`
  - `src/server/telegram.ts` (server-only)
  - `src/app/admin/telegram/*`
  - `src/components/admin/TelegramPanel.tsx`
- **Migration:** `20261022000200_telegram_recipient.sql`. **It is not applied to `driveo-dev-eu` and needs founder approval.**
  - Recipients (`telegram_recipients`) and one-time test sends (`telegram_test_sends`), both in `driveo_private` with no grants.
  - A `chat_id > 0` CHECK: private chats only, since group and channel ids are negative.
  - One active recipient per admin. At most one non-failed test send per recipient.
  - Admin-session pairing functions.
  - Drops the unused secret-key `attach_telegram_pairing_code`.
- **Pairing:**
  - The admin's server polls `getUpdates` only when the founder presses a button. It needs no webhook or public URL.
  - It matches `/start <challenge>` only in a private chat, typed by a person (`from.id === chat.id`, not a bot), not forwarded or via a bot, and sent after the challenge started.
  - It sends a one-time code to that chat. The founder types it into the same Supabase session; the binding is an HMAC of the JWT `session_id`, keyed with the bot token.
  - Stored references are HMACs keyed with the bot token.
- **Test send:**
  - Requires the server flag `TELEGRAM_TEST_SEND=once`, the confirmation checkbox, a bot with `can_join_groups=false`, and Telegram's `getChat` confirming `type=private`.
  - It is claimed in the database before sending, then sent once.
  - The result is recorded as `sent`, `failed` (a 4xx: definitely not delivered) or `unknown` (timeout, network or 5xx). Both `sent` and `unknown` block another test send.
- **Logs:** event names and short codes only. No token, chat id or message text.
- **Not built:** the booking notification worker, email, and webhooks.
