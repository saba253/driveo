"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  checkPairingAction,
  revokeTelegramAction,
  sendTestMessageAction,
  startPairingAction,
  verifyPairingAction,
} from "@/app/admin/telegram/actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { ka } from "@/content/ka";
import type { TelegramStatus } from "@/lib/telegram/service";
import { FormMessage } from "./AdminCard";

const t = ka.admin.telegram;

/** Maps any action status to founder-facing Georgian. */
const MESSAGES: Record<string, string> = {
  waiting: t.waiting,
  expired: t.expired,
  invalid: t.invalid,
  bot_allows_groups: t.botAllowsGroups,
  bot_unavailable: t.botUnavailable,
  telegram_error: t.telegramError,
  rate_limited: t.rateLimited,
  not_configured: t.notConfigured,
  not_authorized: t.failed,
  failed: t.failed,
  sent: t.test.sent,
  already_sent: t.test.already,
  unknown: t.test.unknown,
  not_private: t.test.notPrivate,
  not_paired: t.test.notPaired,
  not_authorized_by_flag: t.test.notAllowed,
  not_confirmed: t.test.confirm,
};

type Pairing = { challengeId: string; deepLink: string; startedAt: string; codeSent: boolean };

export function TelegramPanel({ status, testSendAllowed }: { status: TelegramStatus; testSendAllowed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const run = (fn: () => Promise<void>) => startTransition(fn);

  if (!status.paired) {
    return (
      <div className="grid gap-5">
        <p className="text-sm text-fg-muted">{t.notPaired}</p>
        {message && <FormMessage>{message}</FormMessage>}

        {!pairing && (
          <Button
            size="lg"
            disabled={pending}
            onClick={() =>
              run(async () => {
                setMessage(null);
                const r = await startPairingAction();
                if (r.status === "started") setPairing({ challengeId: r.challengeId, deepLink: r.deepLink, startedAt: r.startedAt, codeSent: false });
                else setMessage(MESSAGES[r.status] ?? t.failed);
              })
            }
          >
            {t.start}
          </Button>
        )}

        {pairing && !pairing.codeSent && (
          <>
            <p className="text-sm leading-relaxed text-fg-muted">{t.linkHint}</p>
            <ButtonLink href={pairing.deepLink} target="_blank" rel="noopener noreferrer" variant="secondary" size="lg">
              {t.openBot}
            </ButtonLink>
            <Button
              size="lg"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  setMessage(null);
                  const r = await checkPairingAction(pairing.challengeId, pairing.startedAt);
                  if (r.status === "code_sent") setPairing({ ...pairing, codeSent: true });
                  else {
                    setMessage(MESSAGES[r.status] ?? t.failed);
                    if (r.status === "expired") setPairing(null);
                  }
                })
              }
            >
              {t.check}
            </Button>
          </>
        )}

        {pairing?.codeSent && (
          <form
            className="grid gap-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                setMessage(null);
                const r = await verifyPairingAction(pairing.challengeId, code);
                if (r.status === "paired") {
                  setPairing(null);
                  router.refresh();
                } else setMessage(MESSAGES[r.status] ?? t.failed);
              });
            }}
          >
            <p className="text-sm leading-relaxed text-fg-muted">{t.codeSent}</p>
            <Field label={t.codeLabel} htmlFor="telegram-code">
              <Input
                id="telegram-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="tracking-[0.3em]"
              />
            </Field>
            <Button type="submit" size="lg" disabled={pending}>
              {t.verify}
            </Button>
          </form>
        )}
      </div>
    );
  }

  const verifiedAt = new Date(status.verifiedAt).toISOString().slice(0, 16).replace("T", " ");
  const testDone = status.testSend === "sent" || status.testSend === "unknown" || status.testSend === "claimed";

  return (
    <div className="grid gap-6">
      <div className="rounded-lg border border-accent/35 bg-accent/10 p-4">
        <p className="font-semibold text-fg">{t.paired}</p>
        <p className="mt-1 text-sm text-fg-muted">{t.pairedAt(`${verifiedAt} UTC`)}</p>
      </div>

      <section className="grid gap-4" aria-labelledby="telegram-test-title">
        <h2 id="telegram-test-title" className="font-semibold text-fg">
          {t.test.title}
        </h2>
        {message && (
          <p role="status" className="rounded-md border border-line bg-field px-3 py-2 text-sm text-fg">
            {message}
          </p>
        )}
        {!testSendAllowed ? (
          <p className="text-sm leading-relaxed text-fg-muted">{t.test.notAllowed}</p>
        ) : testDone ? (
          <p className="text-sm leading-relaxed text-fg-muted">{status.testSend === "unknown" ? t.test.unknown : t.test.already}</p>
        ) : (
          <>
            <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} label={t.test.confirm} id="telegram-confirm" />
            <Button
              size="lg"
              disabled={pending || !confirmed}
              onClick={() =>
                run(async () => {
                  setMessage(null);
                  const r = await sendTestMessageAction(confirmed);
                  setMessage(MESSAGES[r.status] ?? t.failed);
                  setConfirmed(false);
                  router.refresh();
                })
              }
            >
              {pending ? t.test.sending : t.test.send}
            </Button>
          </>
        )}
      </section>

      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(async () => {
            await revokeTelegramAction();
            router.refresh();
          })
        }
      >
        {t.revoke}
      </Button>
    </div>
  );
}
