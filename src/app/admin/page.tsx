import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { ka } from "@/content/ka";
import { BookingList } from "@/components/admin/BookingList";
import { ADMIN_BOOKING_COLUMNS, toAdminBookingItem, type AdminBookingRow } from "@/lib/booking/admin-list";
import { routeAdminPage } from "@/server/admin-auth";

const t = ka.admin;

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<p className="text-fg-muted">{t.loading}</p>}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  // Redirects unless the user is an active admin at AAL2; RLS enforces the same in the database.
  const { supabase } = await routeAdminPage("dashboard");
  const { data, error } = await supabase!.from("bookings").select(ADMIN_BOOKING_COLUMNS).order("submitted_at", { ascending: false }).limit(50);
  const items = ((data ?? []) as AdminBookingRow[]).map(toAdminBookingItem);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-fg">{t.dashboard.title}</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">{t.dashboard.lead}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/telegram" className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline">
            {t.telegram.link}
          </Link>
          <Link href="/admin/security" className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline">
            {t.security.link}
          </Link>
          <SignOutButton />
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-danger">
          {t.dashboard.loadFailed}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-fg-muted">{t.dashboard.empty}</p>
      ) : (
        <BookingList items={items} />
      )}
    </div>
  );
}
