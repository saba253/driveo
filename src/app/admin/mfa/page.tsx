import { Suspense } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { MfaChallengeForm, MfaEnrollForm } from "@/components/admin/MfaForms";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { ka } from "@/content/ka";
import { routeAdminPage } from "@/server/admin-auth";

const t = ka.admin;

export default function AdminMfaPage() {
  return (
    <Suspense fallback={<AdminCard title={t.mfa.challengeTitle} lead={t.loading} />}>
      <MfaGate />
    </Suspense>
  );
}

async function MfaGate() {
  const { access } = await routeAdminPage("mfa");
  const enrolling = access.kind === "needs_mfa_enrollment";
  return (
    <div className="grid gap-6">
      <AdminCard title={enrolling ? t.mfa.enrollTitle : t.mfa.challengeTitle} lead={enrolling ? t.mfa.enrollLead : t.mfa.challengeLead}>
        {enrolling ? <MfaEnrollForm /> : <MfaChallengeForm />}
      </AdminCard>
      <div className="mx-auto">
        <SignOutButton />
      </div>
    </div>
  );
}
