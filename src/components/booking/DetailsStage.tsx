"use client";

import type { ReactNode } from "react";
import { Checkbox, Field, Input, Segmented, Select, describe } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { ka } from "@/content/ka";
import { POWERTRAINS, TRANSMISSIONS, type BookingField, type Powertrain } from "@/lib/booking/types";
import { LIMITS } from "@/lib/booking/validation";
import { cn } from "@/lib/cn";
import { errorMessage } from "./messages";
import { fieldId, type BookingForm } from "./useBookingForm";

const t = ka.booking;
const transmissionOptions = TRANSMISSIONS.map((value) => ({ value, label: t.transmissions[value] }));

/**
 * Step 2 as two progressive sections: the active one is open, a finished one
 * collapses to a one-line summary with a "change" button, and the upcoming one
 * is shown as a muted heading so the customer sees what is left.
 */
type DetailsStageProps = {
  form: BookingForm;
  section: "vehicle" | "contact";
  /** Reopens the vehicle section; supplied by the card so focus moves with it. */
  onEditVehicle?: () => void;
};

export function DetailsStage({ form, section, onEditVehicle }: DetailsStageProps) {
  const { draft } = form;
  const vehicleSummary = [
    `${draft.vehicleMake.trim()} ${draft.vehicleModel.trim()}`.trim(),
    draft.powertrain && t.powertrains[draft.powertrain],
    draft.transmission && t.transmissions[draft.transmission],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-3">
      {section === "vehicle" ? (
        <OpenSection index={1} title={t.sections.vehicle}>
          <VehicleFields form={form} />
        </OpenSection>
      ) : (
        <DoneSection
          index={1}
          title={t.sections.vehicle}
          summary={vehicleSummary}
          onChange={form.editingFromReview ? undefined : onEditVehicle}
        />
      )}

      {section === "contact" ? (
        <OpenSection index={2} title={t.sections.contact}>
          <ContactFields form={form} />
        </OpenSection>
      ) : (
        !form.editingFromReview && <UpcomingSection index={2} title={t.sections.contact} />
      )}
    </div>
  );
}

function SectionBadge({ index, done, className }: { index: number; done?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full font-brand text-xs font-bold",
        done ? "bg-accent text-accent-ink" : "border border-line-strong text-fg-muted",
        className,
      )}
    >
      {done ? <Icon name="check" size={14} strokeWidth={2.5} /> : index}
    </span>
  );
}

function OpenSection({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`booking-section-${index}`}>
      <h4
        id={`booking-section-${index}`}
        data-focus-target
        tabIndex={-1}
        className="mb-4 flex items-center gap-2.5 text-[0.9375rem] font-semibold outline-none"
      >
        <SectionBadge index={index} />
        <span className="min-w-0">{title}</span>
      </h4>
      {children}
    </section>
  );
}

function DoneSection({ index, title, summary, onChange }: { index: number; title: string; summary: string; onChange?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas/40 py-3 pr-1.5 pl-3 min-[360px]:gap-3 min-[360px]:px-3.5">
      {/* Decorative; dropped on the narrowest phones so the title fits beside the change button. */}
      <SectionBadge index={index} done className="max-[359px]:hidden" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="truncate text-sm text-fg-muted">{summary}</p>
      </div>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          aria-label={t.sections.changeSection(title)}
          className="-my-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
        >
          <Icon name="pencil" size={15} />
          <span className="hidden min-[400px]:inline">{t.sections.change}</span>
        </button>
      )}
    </div>
  );
}

function UpcomingSection({ index, title }: { index: number; title: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-dashed border-line px-3.5 py-3 text-sm text-fg-subtle">
      <SectionBadge index={index} />
      <span className="min-w-0 font-semibold">{title}</span>
      <span className="ml-auto text-[0.8125rem]">{t.sections.upNext}</span>
    </div>
  );
}

function fieldProps(form: BookingForm) {
  const { errors } = form;
  return {
    err: (f: BookingField) => errorMessage(f, errors[f]),
    a11y: (f: BookingField, hint = false) => ({
      "aria-invalid": errors[f] ? true : undefined,
      "aria-describedby": describe(fieldId(f), { error: Boolean(errors[f]), hint }),
    }),
  };
}

function VehicleFields({ form }: { form: BookingForm }) {
  const { draft, setField } = form;
  const { err, a11y } = fieldProps(form);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 min-[340px]:grid-cols-2">
        <Field label={t.make} htmlFor={fieldId("vehicleMake")} error={err("vehicleMake")}>
          <Input
            id={fieldId("vehicleMake")}
            name="vehicleMake"
            autoComplete="off"
            placeholder={t.makePlaceholder}
            maxLength={LIMITS.vehicleMax}
            required
            value={draft.vehicleMake}
            onChange={(e) => setField("vehicleMake", e.target.value)}
            {...a11y("vehicleMake")}
          />
        </Field>
        <Field label={t.model} htmlFor={fieldId("vehicleModel")} error={err("vehicleModel")}>
          <Input
            id={fieldId("vehicleModel")}
            name="vehicleModel"
            autoComplete="off"
            placeholder={t.modelPlaceholder}
            maxLength={LIMITS.vehicleMax}
            required
            value={draft.vehicleModel}
            onChange={(e) => setField("vehicleModel", e.target.value)}
            {...a11y("vehicleModel")}
          />
        </Field>
      </div>

      <Field label={t.powertrain} htmlFor={fieldId("powertrain")} error={err("powertrain")}>
        <Select
          id={fieldId("powertrain")}
          name="powertrain"
          required
          value={draft.powertrain}
          onChange={(e) => setField("powertrain", e.target.value as Powertrain)}
          {...a11y("powertrain")}
        >
          <option value="" disabled>
            {t.powertrainPlaceholder}
          </option>
          {POWERTRAINS.map((p) => (
            <option key={p} value={p}>
              {t.powertrains[p]}
            </option>
          ))}
        </Select>
      </Field>

      {/* id lets the card move focus to the first option when the group is invalid */}
      <div id={fieldId("transmission")}>
        <Segmented
          name="transmission"
          legend={t.transmission}
          options={transmissionOptions}
          value={draft.transmission}
          onChange={(v) => setField("transmission", v)}
          error={err("transmission")}
        />
      </div>

      <Checkbox
        id={fieldId("vehicleDrivable")}
        name="vehicleDrivable"
        label={t.drivable}
        hint={t.drivableHint}
        error={err("vehicleDrivable")}
        checked={draft.vehicleDrivable}
        onChange={(e) => setField("vehicleDrivable", e.target.checked)}
      />
    </div>
  );
}

function ContactFields({ form }: { form: BookingForm }) {
  const { draft, errors, setField } = form;
  const { err, a11y } = fieldProps(form);
  const policyId = `${fieldId("fuelPolicyAccepted")}-hint`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 min-[420px]:grid-cols-2">
        <Field label={t.name} htmlFor={fieldId("customerName")} error={err("customerName")}>
          <Input
            id={fieldId("customerName")}
            name="customerName"
            autoComplete="name"
            placeholder={t.namePlaceholder}
            maxLength={LIMITS.nameMax}
            required
            value={draft.customerName}
            onChange={(e) => setField("customerName", e.target.value)}
            {...a11y("customerName")}
          />
        </Field>
        <Field label={t.phone} htmlFor={fieldId("customerPhone")} error={err("customerPhone")}>
          <Input
            id={fieldId("customerPhone")}
            name="customerPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t.phonePlaceholder}
            maxLength={24}
            required
            value={draft.customerPhone}
            onChange={(e) => setField("customerPhone", e.target.value)}
            {...a11y("customerPhone", true)}
          />
        </Field>
      </div>
      <p id={`${fieldId("customerPhone")}-hint`} className="-mt-1 text-sm leading-relaxed text-fg-subtle">
        {t.phoneHint}
      </p>

      <div className="rounded-lg border border-line bg-canvas/50 p-4">
        <h5 className="text-sm font-semibold">{t.fuelPolicy.title}</h5>
        <ul id={policyId} className="mt-2 space-y-1.5 text-sm leading-relaxed text-fg-muted">
          {t.fuelPolicy.points.map((point) => (
            <li key={point} className="flex gap-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent/70" aria-hidden="true" />
              <span className="min-w-0">{point}</span>
            </li>
          ))}
        </ul>
        <Checkbox
          id={fieldId("fuelPolicyAccepted")}
          name="fuelPolicyAccepted"
          className="mt-3"
          label={t.fuelPolicy.accept}
          error={err("fuelPolicyAccepted")}
          checked={draft.fuelPolicyAccepted}
          onChange={(e) => setField("fuelPolicyAccepted", e.target.checked)}
          aria-describedby={describe(fieldId("fuelPolicyAccepted"), { hint: true, error: Boolean(errors.fuelPolicyAccepted) })}
        />
      </div>
    </div>
  );
}
