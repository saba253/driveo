/**
 * Maps a bookings row (as the admin reads it under RLS) to what the dashboard
 * shows. Pure, so the display rules are unit-tested: the pickup date and time
 * always come from requested_date/requested_time, never from submitted_at.
 */
import type { BookingStatus } from "./lifecycle.ts";
import { formatInstantInTbilisi, formatRequestedPickup, type FormattedPickup } from "./schedule-format.ts";

export const ADMIN_BOOKING_COLUMNS = "reference, status, pickup_city, delivery_city, requested_date, requested_time, submitted_at, is_test" as const;

export type AdminBookingRow = {
  reference: string;
  status: BookingStatus;
  pickup_city: string;
  delivery_city: string;
  requested_date: string | null;
  requested_time: string | null;
  submitted_at: string | null;
  is_test: boolean;
};

export type AdminBookingItem = {
  reference: string;
  status: BookingStatus;
  route: string;
  pickup: FormattedPickup;
  /** When the request arrived (Asia/Tbilisi); null if unknown. Never the pickup time. */
  submittedAt: string | null;
  isTest: boolean;
};

export function toAdminBookingItem(row: AdminBookingRow): AdminBookingItem {
  return {
    reference: row.reference,
    status: row.status,
    route: `${row.pickup_city} → ${row.delivery_city}`,
    pickup: formatRequestedPickup(row.requested_date, row.requested_time),
    submittedAt: formatInstantInTbilisi(row.submitted_at),
    isTest: row.is_test === true,
  };
}
