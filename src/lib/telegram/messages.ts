/**
 * The only texts DRIVEO sends to Telegram in this step. No customer data, no
 * booking data. The test message wording was specified by the founder.
 */

export const TELEGRAM_TEST_MESSAGE = [
  "🚗 DRIVEO — TEST",
  "✅ Telegram connection successful.",
  "This is a test notification.",
  "No real booking has been created.",
].join("\n");

export function pairingCodeMessage(code: string): string {
  return [
    `DRIVEO — დაკავშირების კოდი: ${code}`,
    "შეიყვანეთ ეს კოდი ადმინისტრირების გვერდზე, იმავე ბრაუზერში. კოდი მოქმედებს 10 წუთის განმავლობაში.",
    "თუ დაკავშირება თქვენ არ დაგიწყიათ, უბრალოდ უგულებელყავით ეს შეტყობინება.",
  ].join("\n");
}
