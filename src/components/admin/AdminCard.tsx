import type { ReactNode } from "react";

/** Narrow centred panel for the sign-in and MFA steps. */
export function AdminCard({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-md rounded-lg border border-line bg-surface p-6 sm:p-8" aria-labelledby="admin-card-title">
      <h1 id="admin-card-title" className="text-h3 font-bold text-fg">
        {title}
      </h1>
      {lead && <p className="mt-2 text-sm leading-relaxed text-fg-muted">{lead}</p>}
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}

export function FormMessage({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}
