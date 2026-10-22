/**
 * Formatting of booking times for the admin (and future notifications).
 *
 * Two different moments, never mixed up:
 *  - the REQUESTED PICKUP: a local wall-clock date and time the customer chose,
 *    stored as `requested_date` + `requested_time` with timezone Asia/Tbilisi.
 *    It is shown exactly as stored — no conversion, and never replaced by
 *    another timestamp when missing;
 *  - the SUBMISSION time: an instant (`submitted_at`, timestamptz), converted
 *    to Asia/Tbilisi for display.
 */
import { ka } from "../../content/ka.ts";

export const BOOKING_TIME_ZONE = "Asia/Tbilisi";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

export type FormattedPickup = {
  /** "29 ოქტომბერი, 2026" or the explicit "not specified" text. */
  date: string;
  /** "10:00" (24-hour) or the explicit "not specified" text. */
  time: string;
  /** "29 ოქტომბერი, 2026 — 10:00" */
  combined: string;
  dateKnown: boolean;
  timeKnown: boolean;
};

/** "2026-10-29" → "29 ოქტომბერი, 2026"; null for anything that is not a real calendar date. */
export function formatCalendarDate(iso: string | null | undefined): string | null {
  const m = ISO_DATE.exec(iso ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return `${d} ${ka.booking.calendar.months[mo - 1]}, ${y}`;
}

/** "10:00:00" or "10:00" → "10:00"; null for anything that is not a valid 24-hour time. */
export function formatClockTime(value: string | null | undefined): string | null {
  const m = TIME.exec(value ?? "");
  return m ? `${m[1]}:${m[2]}` : null;
}

/** The customer-requested pickup, exactly as stored (Asia/Tbilisi wall clock). */
export function formatRequestedPickup(requestedDate: string | null | undefined, requestedTime: string | null | undefined): FormattedPickup {
  const t = ka.admin.schedule;
  const date = formatCalendarDate(requestedDate);
  const time = formatClockTime(requestedTime);
  return {
    date: date ?? t.dateMissing,
    time: time ?? t.timeMissing,
    combined: `${date ?? t.dateMissing} — ${time ?? t.timeMissing}`,
    dateKnown: date !== null,
    timeKnown: time !== null,
  };
}

/** An instant (e.g. submitted_at) shown in Asia/Tbilisi: "23 ოქტომბერი, 2026 — 00:01". */
export function formatInstantInTbilisi(instant: string | Date | null | undefined): string | null {
  if (!instant) return null;
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: BOOKING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const date = formatCalendarDate(`${parts.year}-${parts.month}-${parts.day}`);
  return date ? `${date} — ${parts.hour}:${parts.minute}` : null;
}
