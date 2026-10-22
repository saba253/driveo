/**
 * POST /api/internal/notifications/run — triggers ONE worker run.
 * Not public: requires `Authorization: Bearer <NOTIFICATIONS_WORKER_SECRET>`
 * (compared in constant time). With the flag off it answers 404 and does
 * nothing, so the route's existence reveals nothing useful. Nothing schedules it.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { WorkerRunResult } from "./booking-worker.ts";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

export async function handleWorkerRun(
  request: Request,
  deps: { secret: string | null; run: (() => Promise<WorkerRunResult>) | null },
): Promise<Response> {
  if (!deps.secret || !deps.run) return json({ status: "not_found" }, 404);
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !sameSecret(token, deps.secret)) return json({ status: "unauthorized" }, 401);
  return json(await deps.run(), 200);
}
