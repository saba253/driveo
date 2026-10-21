import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { ka } from "@/content/ka";
import { cn } from "@/lib/cn";
import type { BookingField } from "@/lib/booking";

/**
 * Booking card — visual shell only (Step 1.3).
 * Not a <form> yet, so nothing can be submitted; validation, the past-date
 * guard and the local confirmation preview arrive in the next step.
 */
const t = ka.booking;
const id = (field: BookingField) => `booking-${field}`;

export function BookingCard({ className }: { className?: string }) {
  return (
    <section
      id="booking"
      aria-labelledby="booking-title"
      className={cn(
        "relative rounded-xl border border-line bg-surface/85 p-5 shadow-card backdrop-blur-xl sm:p-7",
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
      <p className="mt-1.5 text-sm text-fg-muted">{t.subtitle}</p>

      {/* Route: from → to, joined by a rail */}
      <div className="mt-6 grid grid-cols-[0.875rem_minmax(0,1fr)] gap-x-3.5">
        <div className="flex flex-col items-center pt-[0.4rem]" aria-hidden="true">
          <span className="size-3.5 shrink-0 rounded-full border-2 border-fg-muted" />
          <span className="my-1.5 w-px flex-1 bg-linear-to-b from-fg-muted/60 to-accent/70" />
        </div>
        <RouteFieldset legend={t.from} city="pickupCity" address="pickupAddress" section="pickup" className="pb-5" />

        <div className="pt-[0.4rem]" aria-hidden="true">
          <span className="block size-3.5 rounded-full bg-accent shadow-[0_0_12px_rgb(217_246_111/0.6)]" />
        </div>
        <RouteFieldset legend={t.to} city="deliveryCity" address="deliveryAddress" section="delivery" />
      </div>

      <fieldset className="mt-5 min-w-0 border-t border-line pt-5">
        <legend className="sr-only">{t.when}</legend>
        <div className="grid gap-4 min-[420px]:grid-cols-2">
          <Field label={t.date} htmlFor={id("pickupDate")}>
            <Input id={id("pickupDate")} name="pickupDate" type="date" required />
          </Field>
          <Field label={t.time} htmlFor={id("pickupTime")}>
            <Input id={id("pickupTime")} name="pickupTime" type="time" step={900} required />
          </Field>
        </div>
      </fieldset>

      <Button size="lg" className="mt-6 w-full" aria-describedby="booking-note">
        {t.submit}
        <Icon name="arrowRight" size={18} className="transition-transform duration-(--duration-base) group-hover/button:translate-x-0.5" />
      </Button>
      <p id="booking-note" className="mt-3 text-center text-xs leading-relaxed text-fg-subtle">
        {t.prototypeNote}
      </p>
    </section>
  );
}

type RouteFieldsetProps = {
  legend: string;
  city: BookingField;
  address: BookingField;
  /** Autofill section, so browsers keep pickup and delivery addresses apart. */
  section: string;
  className?: string;
};

function RouteFieldset({ legend, city, address, section, className }: RouteFieldsetProps) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-3 text-[0.9375rem] font-semibold text-fg">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Field label={t.city} htmlFor={id(city)}>
          <Select id={id(city)} name={city} defaultValue="" required>
            <option value="" disabled>
              {t.cityPlaceholder}
            </option>
            {t.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.address} htmlFor={id(address)}>
          <Input
            id={id(address)}
            name={address}
            type="text"
            autoComplete={`section-${section} street-address`}
            placeholder={t.addressPlaceholder}
            required
          />
        </Field>
      </div>
    </fieldset>
  );
}
