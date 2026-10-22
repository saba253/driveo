/**
 * Booking submission service: abuse limits → strict parsing → one atomic
 * database call. Server-side only (uses node:crypto); dependencies are injected
 * so it is tested against fakes and against real PostgreSQL (PGlite).
 *
 * Persistence is a single call to public.submit_booking_request, which in ONE
 * transaction creates the booking, the separate contact row, the first status
 * event, the notification outbox event and an audit entry — or nothing at all.
 * Nothing is sent from here: Telegram and email delivery do not exist yet, and
 * the outbox event only exists once the transaction has committed.
 */
import { createHash, createHmac } from "node:crypto";
import type { BookingSubmissionResponse } from "./submission-contract.ts";
import { canonicalSubmissionContent, parseBookingSubmission, toStoredSubmission } from "./submission.ts";
import type { LocalNow } from "./validation.ts";

/* ------------------------------------------------------------------ ports */

export type RpcError = { code?: string; message?: string } | null;
/** The shape of supabase-js `client.rpc`, so the real client can be passed directly. */
export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;

export type StoreResult =
  | { kind: "stored"; reference: string; duplicate: boolean }
  | { kind: "conflict" }
  | { kind: "rejected_by_database"; code: string }
  | { kind: "failed"; code: string };

export interface BookingStore {
  submit(input: {
    submissionId: string;
    submissionHash: string;
    booking: Record<string, unknown>;
    contact: Record<string, unknown>;
    ipHash: string | null;
    /** Fictional TEST booking: its notification event is suppressed by the database. */
    isTest: boolean;
  }): Promise<StoreResult>;
}

export interface RateLimiter {
  /** true = allowed. Throws if the counter store is unreachable (callers fail closed). */
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

/** Event names and codes only — never names, phones, addresses or raw IPs. */
export type SubmissionLog = (event: string, detail?: Record<string, string | number | boolean>) => void;

/* ------------------------------------------------------ supabase adapters */

const INPUT_REJECTION_CODES = new Set(["DV001", "23502", "23514", "22P02", "22007", "22008", "22001"]);

export function createRpcBookingStore(rpc: Rpc): BookingStore {
  return {
    async submit({ submissionId, submissionHash, booking, contact, ipHash, isTest }) {
      // p_is_test is always sent: a database without test isolation (migration
      // 20261022000100) has no such parameter, so the call fails and nothing is stored.
      const { data, error } = await rpc("submit_booking_request", {
        p_submission_id: submissionId,
        p_submission_hash: submissionHash,
        p_booking: booking,
        p_contact: contact,
        p_ip_hash: ipHash,
        p_is_test: isTest,
      });
      if (error) {
        const code = error.code ?? "unknown";
        if (code === "DV002") return { kind: "conflict" };
        if (INPUT_REJECTION_CODES.has(code)) return { kind: "rejected_by_database", code };
        return { kind: "failed", code };
      }
      const r = data as { reference?: unknown; duplicate?: unknown } | null;
      if (!r || typeof r.reference !== "string") return { kind: "failed", code: "unexpected_response" };
      return { kind: "stored", reference: r.reference, duplicate: r.duplicate === true };
    },
  };
}

export function createRpcRateLimiter(rpc: Rpc): RateLimiter {
  return {
    async consume(key, limit, windowSeconds) {
      const { data, error } = await rpc("consume_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
      if (error) throw new Error(`rate_limit_unavailable:${error.code ?? "unknown"}`);
      return data === true;
    },
  };
}

/* ---------------------------------------------------------------- service */

/** Persistent limits (fixed windows). Duplicate retries count too, so keep them generous. */
export const SUBMISSION_RATE_LIMITS = {
  perClient: { limit: 10, windowSeconds: 3600 },
  perPhone: { limit: 5, windowSeconds: 86_400 },
  overall: { limit: 200, windowSeconds: 86_400 },
} as const;

export type SubmissionOutcome = BookingSubmissionResponse;

export type BookingSubmissionService = {
  submit(payload: unknown, ctx: { clientIp: string; idempotencyKey: string }): Promise<SubmissionOutcome>;
};

export function createBookingSubmissionService(deps: {
  store: BookingStore;
  limiter: RateLimiter;
  hashSecret: string;
  allowedCities: readonly string[];
  /** Tbilisi wall clock for validation; real time for consent. */
  tbilisiNow: () => LocalNow;
  clock: () => Date;
  test: boolean;
  log: SubmissionLog;
}): BookingSubmissionService {
  const hmac = (scope: string, value: string) => createHmac("sha256", deps.hashSecret).update(`${scope}\u0000${value}`).digest("hex");

  async function withinLimit(key: string, rule: { limit: number; windowSeconds: number }) {
    return deps.limiter.consume(key, rule.limit, rule.windowSeconds);
  }

  return {
    async submit(payload, { clientIp, idempotencyKey }) {
      try {
        const ipKey = hmac("ip", clientIp);
        if (!(await withinLimit(`booking.ip:${ipKey}`, SUBMISSION_RATE_LIMITS.perClient))) {
          deps.log("booking.rate_limited", { scope: "client" });
          return { status: "rate_limited", retryAfterSeconds: SUBMISSION_RATE_LIMITS.perClient.windowSeconds };
        }

        const parsed = parseBookingSubmission(payload, { now: deps.tbilisiNow(), allowedCities: deps.allowedCities });
        if (parsed.kind === "rejected") {
          deps.log("booking.rejected", { reason: parsed.reason });
          return { status: "rejected" };
        }
        if (parsed.kind === "policy_changed") return { status: "policy_changed" };
        if (parsed.kind === "invalid") {
          deps.log("booking.invalid", { fields: Object.keys(parsed.errors).length });
          return { status: "invalid", errors: parsed.errors };
        }

        const { request } = parsed;
        if (!(await withinLimit(`booking.phone:${hmac("phone", request.contact.phone)}`, SUBMISSION_RATE_LIMITS.perPhone))) {
          deps.log("booking.rate_limited", { scope: "phone" });
          return { status: "rate_limited", retryAfterSeconds: 3600 };
        }
        if (!(await withinLimit(`booking.all:${hmac("all", "all")}`, SUBMISSION_RATE_LIMITS.overall))) {
          deps.log("booking.rate_limited", { scope: "overall" });
          return { status: "rate_limited", retryAfterSeconds: 3600 };
        }

        const stored = toStoredSubmission(request, { consentedAt: deps.clock(), test: deps.test });
        const submissionHash = `sha256:${createHash("sha256").update(canonicalSubmissionContent(request, deps.test)).digest("hex")}`;
        const result = await deps.store.submit({
          submissionId: idempotencyKey,
          submissionHash,
          booking: stored.booking,
          contact: stored.contact,
          ipHash: ipKey,
          isTest: stored.isTest,
        });

        switch (result.kind) {
          case "stored":
            deps.log(result.duplicate ? "booking.duplicate" : "booking.stored", { test: deps.test });
            return { status: "received", reference: result.reference, duplicate: result.duplicate };
          case "conflict":
            deps.log("booking.conflict");
            return { status: "conflict" };
          case "rejected_by_database":
            // Validation above should make this impossible; treat as a bug, not as customer error.
            deps.log("booking.database_rejected", { code: result.code });
            return { status: "unavailable" };
          case "failed":
            deps.log("booking.store_failed", { code: result.code });
            return { status: "unavailable" };
        }
      } catch (e) {
        deps.log("booking.error", { code: e instanceof Error ? e.message.slice(0, 60).replace(/[^a-z0-9_.:-]/gi, "_") : "unknown" });
        return { status: "unavailable" };
      }
    },
  };
}
