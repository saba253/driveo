import { handleWorkerRun } from "@/lib/notifications/worker-http";
import { notificationWorker } from "@/server/notifications";

/**
 * POST /api/internal/notifications/run — one booking-notification worker run.
 * 404 unless BOOKING_NOTIFICATIONS=telegram; 401 without the worker secret.
 * Not scheduled anywhere. Other methods get 405 from Next.js.
 */
export async function POST(request: Request): Promise<Response> {
  return handleWorkerRun(request, notificationWorker());
}
