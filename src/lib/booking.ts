/**
 * Booking domain types, kept independent of UI components so the same shape
 * can later be persisted (Supabase) and forwarded (Telegram) unchanged.
 * Validation is added together with the booking form in Step 1.3.
 */
export type BookingRequest = {
  pickupCity: string;
  deliveryCity: string;
  pickupAddress: string;
  deliveryAddress: string;
  /** ISO date, YYYY-MM-DD. */
  pickupDate: string;
  /** 24h time, HH:MM. */
  pickupTime: string;
};

export type BookingField = keyof BookingRequest;

export type BookingErrors = Partial<Record<BookingField, string>>;
