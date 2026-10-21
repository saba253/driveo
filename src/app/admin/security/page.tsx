import Link from "next/link";
import { Suspense } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { MfaEnrollForm } from "@/components/admin/MfaForms";
import { ka } from "@/content/ka";
import { canAddBackupFactor, MAX_TOTP_FACTORS } from "@/lib/auth/admin-access";
import { routeAdminPage } from "@/server/admin-auth";

const t = ka.admin;

export default function AdminSecurityPage() {
  return (
    <Suspense fallback={<AdminCard title={t.security.title} lead={t.loading} />}>
      <Security />
    </Suspense>
  );
}

async function Security() {
  // Same gate as the dashboard: active admin at AAL2 only.
  const { access, verifiedTotpFactors } = await routeAdminPage("dashboard");
  const canAdd = canAddBackupFactor(access, verifiedTotpFactors);
  return (
    <div className="grid gap-6">
      <AdminCard title={t.security.title} lead={`${t.security.factors}: ${verifiedTotpFactors} / ${MAX_TOTP_FACTORS}`} />
      <AdminCard title={t.security.backupTitle} lead={canAdd ? t.security.backupLead : t.security.backupDone}>
        {canAdd && <MfaEnrollForm backup />}
      </AdminCard>
      <Link href="/admin" className="mx-auto text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline">
        {t.security.back}
      </Link>
    </div>
  );
}
