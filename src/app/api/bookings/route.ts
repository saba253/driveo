import { handleBookingPost } from "@/lib/booking/submission-http";
import { bookingSubmission } from "@/server/bookings";

/**
 * POST /api/bookings — booking requests. Disabled unless the server-side flag
 * BOOKING_SUBMISSIONS=test is set (development only); otherwise every request
 * gets 503 and nothing is read or stored. Other methods get 405 from Next.js.
 */
export async function POST(request: Request): Promise<Response> {
  return handleBookingPost(request, bookingSubmission());
}
