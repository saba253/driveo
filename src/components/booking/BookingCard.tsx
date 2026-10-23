"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { hasDraftData } from "@/lib/booking/draft-storage";
import { HONEYPOT_FIELD } from "@/lib/booking/submission-contract";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ka } from "@/content/ka";
import { STAGE_FIELDS, type FormStage, type ValidationErrors } from "@/lib/booking/validation";
import { cn } from "@/lib/cn";
import { DetailsStage } from "./DetailsStage";
import { PrototypeNotice, ReviewStage } from "./ReviewStage";
import { RouteStage } from "./RouteStage";
import { fieldId, useBookingForm, type Stage } from "./useBookingForm";

/**
 * Booking card.
 * Route & time → vehicle, then contact (two sections of step 2) → review → final screen.
 * mode "prototype" (default): nothing is sent or stored anywhere.
 * mode "test" (server flag, development only): the review step sends the request,
 * and the received screen appears only after the server has stored it.
 */
const t = ka.booking;
const STEP_NUMBER: Record<Exclude<Stage, "done" | "received">, number> = { route: 1, vehicle: 2, contact: 2, review: 3 };
const TOTAL_STEPS = 3;

/** Moves focus to the first invalid control of a stage, in display order. */
function focusFirstInvalid(stage: FormStage, errors: ValidationErrors) {
  const field = STAGE_FIELDS[stage].find((f) => errors[f]);
  if (!field) return;
  const el = document.getElementById(fieldId(field));
  const target = el?.matches("input, select, textarea") ? el : el?.querySelector<HTMLElement>("input, select, textarea");
  target?.focus();
}

export type BookingFormMode = "prototype" | "test";

export function BookingCard({ className, mode = "prototype" }: { className?: string; mode?: BookingFormMode }) {
  const form = useBookingForm();
  const honeypotRef = useRef<HTMLInputElement>(null);
  const { stage, editingFromReview } = form;
  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  // After a stage change made by the customer, bring the card into view and focus the
  // open section's heading (step 2) or the step heading.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const card = cardRef.current;
    if (card && card.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
    const target = card?.querySelector<HTMLElement>("[data-focus-target]") ?? headingRef.current;
    target?.focus({ preventScroll: true });
  }, [stage]);

  const go = (fn: () => void) => {
    moved.current = true;
    setAnnouncement("");
    fn();
  };

  const onSubmitStage = (s: FormStage) => (e: FormEvent) => {
    e.preventDefault();
    const errors = form.submitStage(s);
    if (errors) {
      setAnnouncement(t.errors.summary(Object.keys(errors).length));
      focusFirstInvalid(s, errors);
    } else {
      moved.current = true;
      setAnnouncement("");
    }
  };

  const onConfirm = () => {
    const errors = form.confirm();
    moved.current = true;
    setAnnouncement(errors ? t.errors.summary(Object.keys(errors).length) : "");
  };

  const onSend = async () => {
    setAnnouncement(t.submission.submitting);
    const errors = await form.send(honeypotRef.current?.value ?? "");
    moved.current = true;
    setAnnouncement(errors ? t.errors.summary(Object.keys(errors).length) : "");
  };

  const submitting = form.submission.kind === "submitting";
  const failure =
    form.submission.kind === "idle" || form.submission.kind === "submitting" || form.submission.kind === "received"
      ? null
      : t.submission[form.submission.kind];

  const stepNumber = stage === "done" || stage === "received" ? null : STEP_NUMBER[stage];
  const primaryLabel = editingFromReview ? t.backToReview : stage === "contact" ? t.toReview : t.next;
  const showBack = (stage === "vehicle" || stage === "contact") && !editingFromReview;
  const showRestart = stepNumber !== null && !submitting && hasDraftData(form.draft);

  const onRestart = () => {
    const wasFirstStage = stage === "route";
    go(form.restart);
    // Already on the first stage, so the stage-change effect will not move focus.
    if (wasFirstStage) headingRef.current?.focus();
  };

  return (
    <section
      ref={cardRef}
      id="booking"
      aria-labelledby="booking-title"
      className={cn(
        "relative scroll-mt-24 rounded-xl border border-line bg-surface/85 p-[20px] shadow-card backdrop-blur-xl sm:p-[28px]",
        className,
      )}
    >
      {/* Top edge highlight */}
      <div className="absolute inset-x-8 -top-px h-px bg-linear-to-r from-transparent via-accent/50 to-transparent" aria-hidden="true" />

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 id="booking-title" className="min-w-0 text-h3 font-bold">
          {t.title}
        </h2>
        <Badge className="mt-1 shrink-0">{mode === "test" ? t.test.badge : ka.prototype.badge}</Badge>
      </div>

      {/* Progress */}
      <div className="mt-4">
        {stepNumber && (
          <div className="mb-2 flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-(--duration-slow)",
                  i < stepNumber ? "bg-accent" : "bg-field",
                )}
              />
            ))}
          </div>
        )}
        <h3 ref={headingRef} tabIndex={-1} className="text-[0.9375rem] font-semibold outline-none">
          {stepNumber && <span className="text-sm font-medium text-fg-subtle">{`${t.progress(stepNumber, TOTAL_STEPS)} · `}</span>}
          {t.stages[stage]}
        </h3>
        {/* Present from the first render, so the restore message is announced when it appears. */}
        <div role="status">
          {form.restored && (
            <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-fg-muted">
              <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0">{t.draft.restored}</span>
            </p>
          )}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Keyed by step, so moving between the two sections of step 2 does not replay the entrance. */}
      <div key={stepNumber ?? stage} className="mt-5 animate-rise" style={{ animationDuration: "380ms" }}>
        {(stage === "route" || stage === "vehicle" || stage === "contact") && (
          <form noValidate onSubmit={onSubmitStage(stage)} aria-labelledby="booking-title">
            {stage === "route" ? <RouteStage form={form} /> : <DetailsStage form={form} section={stage} onEditVehicle={() => go(() => form.goBack("contact"))} />}

            {/* Side by side normally; with enlarged text the main button wraps onto its own row
                (its 10rem minimum grows with the text) instead of squeezing its label. */}
            <div className="mt-6 flex flex-wrap gap-3">
              {showBack && (
                <Button variant="secondary" size="lgCompact" className="shrink-0" onClick={() => go(() => form.goBack(stage))}>
                  <Icon name="arrowLeft" size={18} />
                  <span className="sr-only min-[400px]:not-sr-only">{t.back}</span>
                </Button>
              )}
              <Button type="submit" size="lg" className="min-w-[min(100%,10rem)] flex-1">
                {primaryLabel}
                <Icon name="arrowRight" size={18} className="transition-transform duration-(--duration-base) group-hover/button:translate-x-0.5" />
              </Button>
            </div>
          </form>
        )}

        {stage === "review" && (
          <>
            <ReviewStage mode={mode} form={{ ...form, editStage: (s) => go(() => form.editStage(s)) }} />
            {mode === "test" ? (
              <>
                {/* Honeypot: invisible to people and assistive technology; bots that fill it are rejected. */}
                <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                  <label>
                    Website
                    <input ref={honeypotRef} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
                  </label>
                </div>
                {failure && (
                  <div role="alert" className="mt-6">
                    <StatusNotice tone="danger" title={failure.title} text={failure.text} />
                  </div>
                )}
                <Button size="lg" className="mt-6 w-full" onClick={onSend} disabled={submitting} aria-busy={submitting}>
                  {submitting ? t.submission.submitting : failure && form.submission.kind !== "conflict" ? t.submission.retry : t.test.submit}
                  {!submitting && <Icon name="arrowRight" size={18} />}
                </Button>
                {form.submission.kind === "conflict" && (
                  <Button variant="secondary" size="lg" className="mt-3 w-full" onClick={() => go(form.restart)}>
                    {t.restart}
                  </Button>
                )}
              </>
            ) : (
              <Button size="lg" className="mt-6 w-full" onClick={onConfirm}>
                {t.confirm}
                <Icon name="check" size={18} />
              </Button>
            )}
          </>
        )}

        {showRestart && <RestartDraft onConfirm={onRestart} />}

        {stage === "received" && form.submission.kind === "received" && (
          <div className="space-y-5">
            <StatusNotice tone="accent" title={t.received.title} text={ka.requestStatus.submitted} />
            <div className="rounded-lg border border-line p-4">
              <p className="text-sm text-fg-subtle">{t.received.referenceLabel}</p>
              <p className="mt-1 font-mono text-lg font-semibold text-fg" dir="ltr">
                {form.submission.reference}
              </p>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-fg-muted">{t.received.next}</p>
              {mode === "test" && <p className="mt-2 text-sm text-fg-subtle">{t.received.testNote}</p>}
            </div>
            <Button size="lg" className="w-full" onClick={() => go(form.restart)}>
              {t.restart}
            </Button>
          </div>
        )}

        {stage === "done" && (
          <div className="space-y-5">
            <PrototypeNotice title={t.done.title} text={t.done.text} />
            <div className="grid gap-3">
              <Button size="lg" className="w-full" onClick={() => go(form.restart)}>
                {t.restart}
              </Button>
              <Button variant="secondary" size="lg" className="w-full" onClick={() => go(form.returnToReview)}>
                {t.backToReview}
              </Button>
            </div>
          </div>
        )}
      </div>

      {stage !== "done" && stage !== "received" && (
        <p className="mt-3 text-center text-sm leading-relaxed text-fg-subtle">{mode === "test" ? t.test.note : t.prototypeNote}</p>
      )}
    </section>
  );
}

/**
 * "Start over" for an unfinished draft. Asks first, inline: focus moves to the safe
 * "cancel" choice, Escape cancels, and cancelling returns focus to the trigger.
 */
function RestartDraft({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const id = useId();

  useEffect(() => {
    if (confirming) {
      opened.current = true;
      cancelRef.current?.focus();
    } else if (opened.current) {
      triggerRef.current?.focus();
    }
  }, [confirming]);

  if (!confirming) {
    return (
      <div className="mt-4 text-center">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
        >
          {t.draft.restart}
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onKeyDown={(e) => {
        if (e.key === "Escape") setConfirming(false);
      }}
      className="mt-4 rounded-lg border border-line-strong bg-canvas/50 p-4"
    >
      <p id={`${id}-title`} className="font-semibold text-fg">
        {t.draft.confirmTitle}
      </p>
      <p id={`${id}-text`} className="mt-1 text-[0.9375rem] leading-relaxed text-fg-muted">
        {t.draft.confirmText}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button ref={cancelRef} type="button" onClick={() => setConfirming(false)} className={buttonStyles({ variant: "secondary", className: "min-w-[min(100%,8rem)] flex-1" })}>
          {t.draft.confirmNo}
        </button>
        <button type="button" onClick={onConfirm} className={buttonStyles({ variant: "secondary", className: "min-w-[min(100%,8rem)] flex-1" })}>
          {t.draft.confirmYes}
        </button>
      </div>
    </div>
  );
}

function StatusNotice({ tone, title, text }: { tone: "accent" | "danger"; title: string; text: string }) {
  return (
    <div className={cn("flex gap-3 rounded-lg border p-4", tone === "accent" ? "border-accent/35 bg-accent/10" : "border-danger/40 bg-danger/10")}>
      <Icon name={tone === "accent" ? "check" : "alert"} size={20} className={cn("mt-0.5 shrink-0", tone === "accent" ? "text-accent" : "text-danger")} />
      <div className="min-w-0">
        <p className="font-semibold text-fg">{title}</p>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-fg-muted">{text}</p>
      </div>
    </div>
  );
}
