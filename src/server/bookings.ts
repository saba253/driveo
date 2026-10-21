import "server-only";

import { createClient } from "@supabase/supabase-js";
import { ka } from "@/content/ka";
import { readBookingSubmissionSettings } from "@/lib/booking/submission-settings";
import {
  createBookingSubmissionService,
  createRpcBookingStore,
  createRpcRateLimiter,
  type BookingSubmissionService,
  type Rpc,
  type SubmissionLog,
} from "@/lib/booking/submission-service";
import { tbilisiNow } from "@/lib/quotes/input";

/**
 * Server wiring for booking submissions (Step 1.7C.1). Everything stays OFF
 * unless BOOKING_SUBMISSIONS=test in a non-production environment with all
 * required server-only settings present (see .env.example).
 *
 * The secret key client is created only when enabled, never leaves this
 * module, and can only call the functions granted to service_role.
 */

/** Codes and counts only. Never pass personal data here. */
const log: SubmissionLog = (event, detail) => {
  console.warn(`[booking] ${event}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
};

/** What the public form should do: behave as the prototype, or send TEST submissions. */
export function bookingFormMode(): "prototype" | "test" {
  return readBookingSubmissionSettings(process.env).mode === "test" ? "test" : "prototype";
}

let cached: { service: BookingSubmissionService | null; allowedOrigin: string | null } | null = null;

export function bookingSubmission(): { service: BookingSubmissionService | null; allowedOrigin: string | null; log: SubmissionLog } {
  if (!cached) {
    const settings = readBookingSubmissionSettings(process.env);
    if (settings.mode !== "test") {
      if (settings.reason !== "off") log("booking.disabled", { reason: settings.reason });
      cached = { service: null, allowedOrigin: null };
    } else {
      const client = createClient(settings.supabaseUrl, settings.secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const rpc: Rpc = (fn, args) => client.rpc(fn, args);
      cached = {
        service: createBookingSubmissionService({
          store: createRpcBookingStore(rpc),
          limiter: createRpcRateLimiter(rpc),
          hashSecret: settings.hashSecret,
          allowedCities: ka.booking.cities,
          tbilisiNow: () => tbilisiNow(new Date()),
          clock: () => new Date(),
          test: true,
          log,
        }),
        allowedOrigin: settings.allowedOrigin,
      };
    }
  }
  return { ...cached, log };
}
