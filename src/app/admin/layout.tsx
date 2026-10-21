import type { Metadata } from "next";
import { Wordmark } from "@/components/ui/Wordmark";
import { Container } from "@/components/ui/Container";
import { ka } from "@/content/ka";

export const metadata: Metadata = {
  title: ka.admin.area,
  robots: { index: false, follow: false, nocache: true },
};

/** Founder-only area: no public navigation, no footer, never indexed. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <Container className="flex h-16 items-center gap-3">
          <Wordmark className="text-lg" />
          <span className="text-sm text-fg-subtle">{ka.admin.area}</span>
        </Container>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 py-10 outline-none sm:py-14">
        <Container>{children}</Container>
      </main>
    </div>
  );
}
