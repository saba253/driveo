"use client";

import { Checkbox, Field, Input, Segmented, Select, describe } from "@/components/ui/Field";
import { ka } from "@/content/ka";
import { POWERTRAINS, TRANSMISSIONS, type BookingField, type Powertrain } from "@/lib/booking/types";
import { LIMITS } from "@/lib/booking/validation";
import { errorMessage } from "./messages";
import { fieldId, type BookingForm } from "./useBookingForm";

const t = ka.booking;
const transmissionOptions = TRANSMISSIONS.map((value) => ({ value, label: t.transmissions[value] }));

export function DetailsStage({ form }: { form: BookingForm }) {
  const { draft, errors, setField } = form;
  const err = (f: BookingField) => errorMessage(f, errors[f]);
  const a11y = (f: BookingField, hint = false) => ({
    "aria-invalid": errors[f] ? true : undefined,
    "aria-describedby": describe(fieldId(f), { error: Boolean(errors[f]), hint }),
  });

  return (
    <div className="space-y-6">
      <fieldset className="min-w-0 space-y-4">
        <legend className="mb-3 text-[0.9375rem] font-semibold">{t.vehicle}</legend>
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
      </fieldset>

      {/* Divider sits on a wrapper: a fieldset border would run through its legend. */}
      <div className="border-t border-line pt-5">
        <fieldset className="min-w-0">
          <legend className="mb-3 text-[0.9375rem] font-semibold">{t.contact}</legend>
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
          <p id={`${fieldId("customerPhone")}-hint`} className="mt-2 text-xs leading-relaxed text-fg-subtle">
            {t.phoneHint}
          </p>
        </fieldset>
      </div>

      <div className="rounded-lg border border-line bg-canvas/50 p-4">
        <h4 id="fuel-policy-title" className="text-sm font-semibold">
          {t.fuelPolicy.title}
        </h4>
        <p id={`${fieldId("fuelPolicyAccepted")}-hint`} className="mt-1.5 text-xs leading-relaxed text-fg-muted">
          {t.fuelPolicy.text}
        </p>
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
