/**
 * Telegram text for a NEW booking — prepared for the future notification
 * worker, which is NOT built or enabled. Nothing here sends anything.
 *
 * Safety:
 *  - Built only from the outbox payload, which the database restricts to
 *    reference, cities, vehicle, submission time and requested pickup date/time
 *    (no name, phone, street address or notes).
 *  - Sent as PLAIN TEXT (no parse_mode), so nothing in it can be interpreted as
 *    Markdown or HTML; control and bidi characters are removed and lengths capped.
 *  - The pickup date/time is the customer's requested wall-clock time
 *    (Asia/Tbilisi), never the notification or submission time.
 *  - The admin link is only included when DRIVEO_APP_URL is a valid, credential-free
 *    origin; it points at the dashboard, which still requires sign-in + TOTP.
 */
import { ka } from "../../content/ka.ts";
import { formatCalendarDate, formatClockTime } from "../booking/schedule-format.ts";

export type BookingNotification = {
  reference: string;
  pickupCity: string;
  deliveryCity: string;
  requestedDate: string | null;
  requestedTime: string | null;
};

const REFERENCE = /^DRV-\d{4}-\d{6}$/;
const UNSAFE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** Removes control/format/bidi characters, collapses whitespace, caps the length. */
export function cleanText(value: string, max = 60): string {
  const cleaned = value.replace(UNSAFE, "").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Reads an outbox payload defensively; null if it is not a booking notification. */
export function readBookingNotificationPayload(payload: unknown): BookingNotification | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  const reference = str("reference");
  const pickupCity = str("pickup_city");
  const deliveryCity = str("delivery_city");
  if (!reference || !REFERENCE.test(reference) || !pickupCity || !deliveryCity) return null;
  return { reference, pickupCity, deliveryCity, requestedDate: str("requested_date"), requestedTime: str("requested_time") };
}

/** "https://driveo.ge/admin" from a configured origin; null unless it is a clean https origin (or localhost in development). */
export function adminDashboardUrl(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  let u: URL;
  try {
    u = new URL(appUrl.trim());
  } catch {
    return null;
  }
  const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (!(u.protocol === "https:" || local)) return null;
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
  return `${u.origin}/admin`;
}

export function bookingNotificationMessage(b: BookingNotification, opts: { adminUrl: string | null }): string {
  const t = ka.admin;
  const date = formatCalendarDate(b.requestedDate) ?? t.schedule.dateMissing;
  const time = formatClockTime(b.requestedTime) ?? t.schedule.timeMissing;
  return [
    "🚗 DRIVEO — ახალი შეკვეთა",
    `🆔 შეკვეთა: ${b.reference}`,
    `📍 მარშრუტი: ${cleanText(b.pickupCity)} → ${cleanText(b.deliveryCity)}`,
    `📅 გაყვანის თარიღი: ${date}`,
    `🕐 გაყვანის დრო: ${time}`,
    `📋 სტატუსი: ${t.statuses.submitted}`,
    `🔗 დეტალები: ${opts.adminUrl ? `Admin Dashboard — ${opts.adminUrl}` : "Admin Dashboard"}`,
  ].join("\n");
}
