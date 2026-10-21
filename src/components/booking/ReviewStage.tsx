"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { ka } from "@/content/ka";
import { formatPhone, parsePhone } from "@/lib/booking/phone";
import { effectiveCity, type FormStage } from "@/lib/booking/validation";
import type { BookingForm } from "./useBookingForm";

const t = ka.booking;
const r = t.review;

/** "2026-10-25" → "25 ოქტომბერი 2026, კვირა". Built from content, not Intl, so it is Georgian in every browser. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const weekday = new Date(y, m - 1, d).getDay();
  return `${d} ${t.calendar.months[m - 1]} ${y}, ${t.calendar.weekdays[weekday]}`;
}

/** The prototype notice shown on both the review and final screens. */
export function PrototypeNotice({ title, text, id }: { title: string; text: string; id?: string }) {
  return (
    <div id={id} className="flex gap-3 rounded-lg border border-accent/35 bg-accent/10 p-4">
      <Icon name="info" size={20} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="font-semibold text-fg">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{text}</p>
      </div>
    </div>
  );
}

export function ReviewStage({ form, mode = "prototype" }: { form: BookingForm; mode?: "prototype" | "test" }) {
  const { draft } = form;
  const phone = parsePhone(draft.customerPhone);

  return (
    <div className="space-y-5">
      {mode === "test" ? (
        <PrototypeNotice title={t.test.reviewNotice} text={t.test.reviewNoticeText} />
      ) : (
        <PrototypeNotice title={r.notice} text={r.noticeText} />
      )}

      <dl className="divide-y divide-line rounded-lg border border-line">
        <Group title={r.route} stage="route" form={form}>
          <Row label={t.from}>
            {effectiveCity(draft, "pickup")}, {draft.pickupAddress.trim()}
          </Row>
          <Row label={t.to}>
            {effectiveCity(draft, "delivery")}, {draft.deliveryAddress.trim()}
          </Row>
        </Group>
        <Group title={r.schedule} stage="route" form={form}>
          <Row label={t.date}>{formatDate(draft.pickupDate)}</Row>
          <Row label={t.time}>
            {draft.pickupTime} <span className="text-fg-subtle">· {r.timeNote}</span>
          </Row>
        </Group>
        <Group title={r.vehicle} stage="vehicle" form={form}>
          <Row label={r.makeModel}>
            {draft.vehicleMake.trim()} {draft.vehicleModel.trim()}
          </Row>
          <Row label={t.powertrain}>{draft.powertrain && t.powertrains[draft.powertrain]}</Row>
          <Row label={t.transmission}>{draft.transmission && t.transmissions[draft.transmission]}</Row>
          <Row label={r.condition}>{r.drivableYes}</Row>
        </Group>
        <Group title={r.contact} stage="contact" form={form}>
          <Row label={t.name}>{draft.customerName.trim()}</Row>
          <Row label={t.phone}>
            <span dir="ltr">{phone ? formatPhone(phone) : draft.customerPhone}</span>
          </Row>
          <Row label={t.fuelPolicy.title}>{r.fuelAccepted}</Row>
        </Group>
      </dl>

      {/* No price is shown until the server-side pricing engine exists. */}
      <div className="rounded-lg border border-line p-4 text-sm">
        <p className="font-semibold text-fg">{r.price}</p>
        <p className="mt-1 leading-relaxed text-fg-muted">{mode === "test" ? t.test.priceText : r.priceText}</p>
        <p className="mt-2 flex gap-2 text-xs leading-relaxed text-fg-subtle">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent/70" aria-hidden="true" />
          {r.energyNote}
        </p>
      </div>
    </div>
  );
}

function Group({ title, stage, form, children }: { title: string; stage: FormStage; form: BookingForm; children: ReactNode }) {
  return (
    <div className="p-4">
      <dt className="mb-2 flex items-center justify-between gap-3 text-sm font-semibold text-fg">
        <span>{title}</span>
        <button
          type="button"
          onClick={() => form.editStage(stage)}
          aria-label={t.editSection(title)}
          className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
        >
          <Icon name="pencil" size={15} />
          <span className="hidden min-[400px]:inline">{t.edit}</span>
        </button>
      </dt>
      <dd>
        <dl className="space-y-1.5">{children}</dl>
      </dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 text-sm min-[420px]:grid-cols-[8.5rem_minmax(0,1fr)] min-[420px]:gap-3">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
