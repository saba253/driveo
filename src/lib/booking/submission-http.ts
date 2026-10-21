/**
 * HTTP layer of POST /api/bookings, written against the standard Request /
 * Response API so it is tested without Next.js. The route file only wires it up.
 *
 * Checks in order, each before any database work:
 *   flag off → 503 (body never read) · cross-site Origin → 403 ·
 *   not JSON → 415 · too large → 413 · missing/invalid Idempotency-Key → 400 ·
 *   unparsable JSON → 400 · then the service (limits, validation, one transaction).
 */
import { IDEMPOTENCY_HEADER, type BookingSubmissionResponse } from "./submission-contract.ts";
import { SUBMISSION_LIMITS } from "./submission.ts";
import type { BookingSubmissionService, SubmissionLog } from "./submission-service.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HTTP_STATUS: Record<BookingSubmissionResponse["status"], number> = {
  received: 201,
  invalid: 422,
  policy_changed: 409,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  rejected: 400,
};

export function json(body: BookingSubmissionResponse, status?: number): Response {
  let code = status ?? HTTP_STATUS[body.status];
  if (body.status === "received" && body.duplicate) code = 200;
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (body.status === "rate_limited") headers.set("Retry-After", String(body.retryAfterSeconds));
  return new Response(JSON.stringify(body), { status: code, headers });
}

/** First address in X-Forwarded-For (set by the hosting proxy), else X-Real-IP. */
export function clientIpOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function handleBookingPost(
  request: Request,
  deps: { service: BookingSubmissionService | null; allowedOrigin: string | null; log: SubmissionLog },
): Promise<Response> {
  if (!deps.service || !deps.allowedOrigin) return json({ status: "unavailable" });

  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== deps.allowedOrigin || (fetchSite !== null && fetchSite !== "same-origin")) {
    deps.log("booking.rejected", { reason: "origin" });
    return json({ status: "rejected" }, 403);
  }

  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ status: "rejected" }, 415);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > SUBMISSION_LIMITS.maxBodyBytes) return json({ status: "rejected" }, 413);

  const key = request.headers.get(IDEMPOTENCY_HEADER) ?? "";
  if (!UUID.test(key)) return json({ status: "rejected" });

  let body: string;
  try {
    body = await readLimited(request, SUBMISSION_LIMITS.maxBodyBytes);
  } catch (e) {
    return json({ status: "rejected" }, e instanceof Error && e.message === "too_large" ? 413 : 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ status: "rejected" });
  }

  return json(await deps.service.submit(payload, { clientIp: clientIpOf(request), idempotencyKey: key.toLowerCase() }));
}

/** Reads the body as text, refusing more than `max` bytes even if Content-Length lied. */
async function readLimited(request: Request, max: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error("too_large");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
