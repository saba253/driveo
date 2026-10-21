"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ka } from "@/content/ka";
import { STAGE_FIELDS, type FormStage, type ValidationErrors } from "@/lib/booking/validation";
import { cn } from "@/lib/cn";
import { DetailsStage } from "./DetailsStage";
import { PrototypeNotice, ReviewStage } from "./ReviewStage";
import { RouteStage } from "./RouteStage";
import { fieldId, useBookingForm, type Stage } from "./useBookingForm";

/**
 * Booking card — functional client-side prototype (Step 1.5).
 * Route & time → vehicle & contact → review → prototype confirmation.
 * No request is sent or stored anywhere.
 */
const t = ka.booking;
const STEP_NUMBER: Record<Exclude<Stage, "done">, number> = { route: 1, details: 2, review: 3 };
const TOTAL_STEPS = 3;

/** Moves focus to the first invalid control of a stage, in display order. */
function focusFirstInvalid(stage: FormStage, errors: ValidationErrors) {
  const field = STAGE_FIELDS[stage].find((f) => errors[f]);
  if (!field) return;
  const el = document.getElementById(fieldId(field));
  const target = el?.matches("input, select, textarea") ? el : el?.querySelector<HTMLElement>("input, select, textarea");
  target?.focus();
}

export function BookingCard({ className }: { className?: string }) {
  const form = useBookingForm();
  const { stage, editingFromReview } = form;
  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  // After a stage change made by the customer, bring the card into view and focus its heading.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const card = cardRef.current;
    if (card && card.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
    headingRef.current?.focus({ preventScroll: true });
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

  const stepNumber = stage === "done" ? null : STEP_NUMBER[stage];
  const primaryLabel = editingFromReview ? t.backToReview : stage === "route" ? t.next : t.toReview;

  return (
    <section
      ref={cardRef}
      id="booking"
      aria-labelledby="booking-title"
      className={cn(
        "relative scroll-mt-24 rounded-xl border border-line bg-surface/85 p-5 shadow-card backdrop-blur-xl sm:p-7",
        className,
      )}
    >
      {/* Top edge highlight */}
      <div className="absolute inset-x-8 -top-px h-px bg-linear-to-r from-transparent via-accent/50 to-transparent" aria-hidden="true" />

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 id="booking-title" className="text-h3 font-bold">
          {t.title}
        </h2>
        <Badge className="mt-1 shrink-0">{ka.prototype.badge}</Badge>
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
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div key={stage} className="mt-5 animate-rise" style={{ animationDuration: "380ms" }}>
        {(stage === "route" || stage === "details") && (
          <form noValidate onSubmit={onSubmitStage(stage)} aria-labelledby="booking-title">
            {stage === "route" ? <RouteStage form={form} /> : <DetailsStage form={form} />}

            <div className={cn("mt-6 grid gap-3", stage === "details" && !editingFromReview && "grid-cols-[auto_minmax(0,1fr)]")}>
              {stage === "details" && !editingFromReview && (
                <Button variant="secondary" size="lg" onClick={() => go(form.goBack)}>
                  <Icon name="arrowLeft" size={18} />
                  <span className="sr-only min-[400px]:not-sr-only">{t.back}</span>
                </Button>
              )}
              <Button type="submit" size="lg" className="w-full">
                {primaryLabel}
                <Icon name="arrowRight" size={18} className="transition-transform duration-(--duration-base) group-hover/button:translate-x-0.5" />
              </Button>
            </div>
          </form>
        )}

        {stage === "review" && (
          <>
            <ReviewStage form={{ ...form, editStage: (s) => go(() => form.editStage(s)) }} />
            <Button size="lg" className="mt-6 w-full" onClick={onConfirm}>
              {t.confirm}
              <Icon name="check" size={18} />
            </Button>
          </>
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

      {stage !== "done" && <p className="mt-3 text-center text-xs leading-relaxed text-fg-subtle">{t.prototypeNote}</p>}
    </section>
  );
}
