import { Badge } from "@/components/ui/Badge";
import { ka } from "@/content/ka";
import type { AdminBookingItem } from "@/lib/booking/admin-list";

const t = ka.admin;

/**
 * Admin bookings list: cards on phones, a table from md up. The pickup date and
 * time are the customer's requested values (Asia/Tbilisi wall clock); the
 * submission time is shown separately and labelled as such.
 */
export function BookingList({ items }: { items: AdminBookingItem[] }) {
  return (
    <div className="grid gap-3">
      {/* Phones and small tablets: one card per booking. */}
      <ul className="grid gap-3 md:hidden">
        {items.map((b) => (
          <li key={b.reference} className="rounded-lg border border-line bg-surface p-4">
            <BookingCardMobile b={b} />
          </li>
        ))}
      </ul>

      {/* Desktop: a table. */}
      <div className="hidden overflow-hidden rounded-lg border border-line md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-fg-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">{t.dashboard.reference}</th>
              <th className="px-4 py-3 font-medium">{t.dashboard.route}</th>
              <th className="px-4 py-3 font-medium">{t.dashboard.pickupDate}</th>
              <th className="px-4 py-3 font-medium">{t.dashboard.pickupTime}</th>
              <th className="px-4 py-3 font-medium">{t.dashboard.status}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.reference} className="border-t border-line align-top">
                <td className="px-4 py-3">
                  <span className="font-mono text-fg">{b.reference}</span>
                  {b.isTest && <Badge className="ml-2 align-middle">{ka.booking.test.badge}</Badge>}
                  {b.submittedAt && (
                    <p className="mt-1 text-xs text-fg-subtle">
                      {t.dashboard.submittedAt}: {b.submittedAt}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-fg-muted">{b.route}</td>
                <td className={b.pickup.dateKnown ? "px-4 py-3 font-semibold text-fg" : "px-4 py-3 text-fg-subtle italic"}>{b.pickup.date}</td>
                <td className={b.pickup.timeKnown ? "px-4 py-3 font-semibold text-accent tabular-nums" : "px-4 py-3 text-fg-subtle italic"}>
                  {b.pickup.time}
                </td>
                <td className="px-4 py-3 text-fg">{t.statuses[b.status] ?? b.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-fg-subtle">{t.dashboard.timeZoneNote}</p>
    </div>
  );
}

function BookingCardMobile({ b }: { b: AdminBookingItem }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-fg">{b.reference}</span>
          {b.isTest && <Badge>{ka.booking.test.badge}</Badge>}
        </span>
        <span className="text-sm text-fg">{t.statuses[b.status] ?? b.status}</span>
      </div>
      <p className="text-sm text-fg-muted">{b.route}</p>
      <dl className="grid grid-cols-2 gap-3 rounded-md bg-field/60 p-3">
        <div>
          <dt className="text-xs text-fg-subtle">{t.dashboard.pickupDate}</dt>
          <dd className={b.pickup.dateKnown ? "mt-0.5 font-semibold text-fg" : "mt-0.5 text-sm text-fg-subtle italic"}>{b.pickup.date}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">{t.dashboard.pickupTime}</dt>
          <dd className={b.pickup.timeKnown ? "mt-0.5 font-semibold text-accent tabular-nums" : "mt-0.5 text-sm text-fg-subtle italic"}>{b.pickup.time}</dd>
        </div>
      </dl>
      {b.submittedAt && (
        <p className="text-xs text-fg-subtle">
          {t.dashboard.submittedAt}: {b.submittedAt}
        </p>
      )}
    </div>
  );
}
