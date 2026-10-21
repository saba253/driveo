import { Suspense } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { LoginForm } from "@/components/admin/LoginForm";
import { SignOutButton } from "@/components/admin/SignOutButton";
import { ka } from "@/content/ka";
import { routeAdminPage } from "@/server/admin-auth";

const t = ka.admin;

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<AdminCard title={t.login.title} lead={t.loading} />}>
      <LoginGate />
    </Suspense>
  );
}

async function LoginGate() {
  const { access } = await routeAdminPage("login");
  if (access.kind === "not_configured") return <AdminCard title={t.notConfigured.title} lead={t.notConfigured.body} />;
  if (access.kind === "not_admin") {
    return (
      <AdminCard title={t.login.title} lead={t.login.denied}>
        <SignOutButton />
      </AdminCard>
    );
  }
  return (
    <AdminCard title={t.login.title} lead={t.login.lead}>
      <LoginForm />
    </AdminCard>
  );
}
