import Link from "next/link";
import { Suspense } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { TelegramPanel } from "@/components/admin/TelegramPanel";
import { ka } from "@/content/ka";
import { routeAdminPage } from "@/server/admin-auth";
import { telegramServiceForAdmin, telegramSettings } from "@/server/telegram";

const t = ka.admin;

export default function AdminTelegramPage() {
  return (
    <Suspense fallback={<AdminCard title={t.telegram.title} lead={t.loading} />}>
      <TelegramGate />
    </Suspense>
  );
}

async function TelegramGate() {
  // Same gate as the dashboard: an active admin at AAL2 only.
  await routeAdminPage("dashboard");
  const settings = telegramSettings();
  const svc = settings.ok ? await telegramServiceForAdmin() : null;
  const status = svc ? await svc.status() : null;

  return (
    <div className="grid gap-6">
      <AdminCard title={t.telegram.title} lead={t.telegram.lead}>
        {!settings.ok || !status ? (
          <p className="text-sm leading-relaxed text-fg-muted">{t.telegram.notConfigured}</p>
        ) : (
          <TelegramPanel status={status} testSendAllowed={settings.testSendAllowed} />
        )}
      </AdminCard>
      <Link href="/admin" className="mx-auto text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline">
        {t.security.back}
      </Link>
    </div>
  );
}
