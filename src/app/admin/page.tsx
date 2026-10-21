import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { Badge } from "@/components/ui/Badge";
import { ka } from "@/content/ka";
import type { BookingStatus } from "@/lib/booking/lifecycle";
import { routeAdminPage } from "@/server/admin-auth";

const t = ka.admin;

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<p className="text-fg-muted">{t.loading}</p>}>
      <Dashboard />
    </Suspense>
  );
}

type BookingRow = {
  reference: string;
  status: BookingStatus;
  pickup_city: string;
  delivery_city: string;
  requested_date: string;
  eligibility_reasons: string[];
};

async function Dashboard() {
  // Redirects unless the user is an active admin at AAL2; RLS enforces the same in the database.
  const { supabase } = await routeAdminPage("dashboard");
  const { data, error } = await supabase!
    .from("bookings")
    .select("reference, status, pickup_city, delivery_city, requested_date, eligibility_reasons")
    .order("submitted_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as BookingRow[];

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-bold text-fg">{t.dashboard.title}</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">{t.dashboard.lead}</p>
        </div>
        <div className="flex items-center gap-3">
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
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-fg-muted">{t.dashboard.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-surface text-fg-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">{t.dashboard.reference}</th>
                <th className="px-4 py-3 font-medium">{t.dashboard.route}</th>
                <th className="px-4 py-3 font-medium">{t.dashboard.date}</th>
                <th className="px-4 py-3 font-medium">{t.dashboard.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reference} className="border-t border-line">
                  <td className="px-4 py-3 font-mono text-fg">
                    {r.reference}
                    {r.eligibility_reasons?.includes("test_submission") && <Badge className="ml-2 align-middle font-sans">{ka.booking.test.badge}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {r.pickup_city} → {r.delivery_city}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{r.requested_date}</td>
                  <td className="px-4 py-3 text-fg">{t.statuses[r.status] ?? r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
