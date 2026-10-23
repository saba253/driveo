"use client";

import { useSyncExternalStore } from "react";
import { Field, Input, Select, describe } from "@/components/ui/Field";
import { ka } from "@/content/ka";
import { OTHER_CITY, type BookingField } from "@/lib/booking/types";
import { LIMITS, localNow } from "@/lib/booking/validation";
import { cn } from "@/lib/cn";
import { errorMessage } from "./messages";
import { fieldId, type BookingForm } from "./useBookingForm";

const t = ka.booking;

/* Today's local date for the date picker's `min`. Read on the client only, so the server render stays static. */
const noop = () => () => {};
const useToday = () =>
  useSyncExternalStore(
    noop,
    () => localNow().date,
    () => undefined,
  );

export function RouteStage({ form }: { form: BookingForm }) {
  const today = useToday();
  const { draft, errors, setField } = form;
  const err = (f: BookingField) => errorMessage(f, errors[f]);

  return (
    <>
      {/* Route: from → to, joined by a rail */}
      <div className="grid grid-cols-[0.875rem_minmax(0,1fr)] gap-x-3.5">
        <div className="flex flex-col items-center pt-[0.4rem]" aria-hidden="true">
          <span className="size-3.5 shrink-0 rounded-full border-2 border-fg-muted" />
          <span className="my-1.5 w-px flex-1 bg-linear-to-b from-fg-muted/60 to-accent/70" />
        </div>
        <RouteFieldset
          form={form}
          legend={t.from}
          city="pickupCity"
          cityOther="pickupCityOther"
          address="pickupAddress"
          section="pickup"
          className="pb-5"
        />

        <div className="pt-[0.4rem]" aria-hidden="true">
          <span className="block size-3.5 rounded-full bg-accent shadow-[0_0_12px_rgb(217_246_111/0.6)]" />
        </div>
        <RouteFieldset
          form={form}
          legend={t.to}
          city="deliveryCity"
          cityOther="deliveryCityOther"
          address="deliveryAddress"
          section="delivery"
        />
      </div>

      <fieldset className="mt-5 min-w-0 border-t border-line pt-5">
        <legend className="sr-only">{t.when}</legend>
        <div className="grid gap-4 min-[420px]:grid-cols-2">
          <Field label={t.date} htmlFor={fieldId("pickupDate")} error={err("pickupDate")}>
            <Input
              id={fieldId("pickupDate")}
              name="pickupDate"
              type="date"
              min={today}
              required
              value={draft.pickupDate}
              onChange={(e) => setField("pickupDate", e.target.value)}
              aria-invalid={errors.pickupDate ? true : undefined}
              aria-describedby={describe(fieldId("pickupDate"), { error: Boolean(errors.pickupDate) })}
            />
          </Field>
          <Field label={t.time} htmlFor={fieldId("pickupTime")} error={err("pickupTime")}>
            <Input
              id={fieldId("pickupTime")}
              name="pickupTime"
              type="time"
              step={900}
              required
              value={draft.pickupTime}
              onChange={(e) => setField("pickupTime", e.target.value)}
              aria-invalid={errors.pickupTime ? true : undefined}
              aria-describedby={describe(fieldId("pickupTime"), { error: Boolean(errors.pickupTime), hint: true })}
            />
          </Field>
        </div>
        {/* Shared hint, referenced by the time field: the time is a request, not confirmed availability. */}
        <p id={`${fieldId("pickupTime")}-hint`} className="mt-3 flex gap-2 text-sm leading-relaxed text-fg-subtle">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent/70" aria-hidden="true" />
          <span className="min-w-0">{t.timeHint}</span>
        </p>
      </fieldset>
    </>
  );
}

type RouteFieldsetProps = {
  form: BookingForm;
  legend: string;
  city: "pickupCity" | "deliveryCity";
  /** Free-text city shown when "other city" is selected. */
  cityOther: "pickupCityOther" | "deliveryCityOther";
  address: "pickupAddress" | "deliveryAddress";
  /** Autofill section, so browsers keep pickup and delivery addresses apart. */
  section: string;
  className?: string;
};

function RouteFieldset({ form, legend, city, cityOther, address, section, className }: RouteFieldsetProps) {
  const { draft, errors, setField } = form;
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-3 text-[0.9375rem] font-semibold text-fg">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Field label={t.city} htmlFor={fieldId(city)} error={errorMessage(city, errors[city])}>
          <Select
            id={fieldId(city)}
            name={city}
            required
            value={draft[city]}
            onChange={(e) => setField(city, e.target.value)}
            aria-invalid={errors[city] ? true : undefined}
            aria-describedby={describe(fieldId(city), { error: Boolean(errors[city]) })}
          >
            <option value="" disabled>
              {t.cityPlaceholder}
            </option>
            {t.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={OTHER_CITY}>{t.otherCity}</option>
          </Select>
        </Field>
        <Field label={t.address} htmlFor={fieldId(address)} error={errorMessage(address, errors[address])}>
          <Input
            id={fieldId(address)}
            name={address}
            type="text"
            autoComplete={`section-${section} street-address`}
            placeholder={t.addressPlaceholder}
            maxLength={200}
            required
            value={draft[address]}
            onChange={(e) => setField(address, e.target.value)}
            aria-invalid={errors[address] ? true : undefined}
            aria-describedby={describe(fieldId(address), { error: Boolean(errors[address]) })}
          />
        </Field>

        {/* Typed value is kept in state even if a listed city is chosen again. */}
        {draft[city] === OTHER_CITY && (
          <Field
            label={t.otherCityLabel}
            htmlFor={fieldId(cityOther)}
            error={errorMessage(cityOther, errors[cityOther])}
            className="sm:col-span-2"
          >
            <Input
              id={fieldId(cityOther)}
              name={cityOther}
              autoComplete={`section-${section} address-level2`}
              placeholder={t.otherCityPlaceholder}
              maxLength={LIMITS.cityMax}
              required
              value={draft[cityOther]}
              onChange={(e) => setField(cityOther, e.target.value)}
              aria-invalid={errors[cityOther] ? true : undefined}
              aria-describedby={describe(fieldId(cityOther), { error: Boolean(errors[cityOther]) })}
            />
          </Field>
        )}
      </div>
    </fieldset>
  );
}
