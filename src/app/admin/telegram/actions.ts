"use server";

import { createRateLimiter } from "@/lib/routing/usage";
import type { CheckResult, StartResult, TelegramAdminService, TestSendResult, VerifyResult } from "@/lib/telegram/service";
import { telegramServiceForAdmin } from "@/server/telegram";

/*
 * Founder-only Telegram actions. Each re-checks the admin (AAL2 + active admin)
 * on the server, and each Telegram call happens only because the founder pressed
 * a button. Limits are in memory (single founder, development).
 */

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NotReady = { status: "not_configured" | "rate_limited" };

async function service(): Promise<{ svc: TelegramAdminService } | { notReady: NotReady }> {
  if (!limiter.check("telegram").allowed) return { notReady: { status: "rate_limited" } };
  const svc = await telegramServiceForAdmin();
  return svc ? { svc } : { notReady: { status: "not_configured" } };
}

export async function startPairingAction(): Promise<StartResult | NotReady> {
  const s = await service();
  return "notReady" in s ? s.notReady : s.svc.startPairing();
}

export async function checkPairingAction(challengeId: string, startedAt: string): Promise<CheckResult | NotReady> {
  const started = new Date(startedAt);
  if (!UUID.test(challengeId) || Number.isNaN(started.getTime())) return { status: "failed" };
  const s = await service();
  return "notReady" in s ? s.notReady : s.svc.checkPairing(challengeId, started);
}

export async function verifyPairingAction(challengeId: string, code: string): Promise<VerifyResult | NotReady> {
  if (!UUID.test(challengeId)) return { status: "failed" };
  const s = await service();
  return "notReady" in s ? s.notReady : s.svc.verifyPairing(challengeId, String(code).replace(/\s+/g, ""));
}

export async function revokeTelegramAction(): Promise<{ ok: boolean }> {
  const s = await service();
  return "notReady" in s ? { ok: false } : { ok: await s.svc.revoke() };
}

/** Requires the explicit confirmation checkbox AND the server flag TELEGRAM_TEST_SEND=once. */
export async function sendTestMessageAction(confirmed: boolean): Promise<TestSendResult | NotReady | { status: "not_confirmed" }> {
  if (confirmed !== true) return { status: "not_confirmed" };
  const s = await service();
  return "notReady" in s ? s.notReady : s.svc.sendTestMessage();
}
