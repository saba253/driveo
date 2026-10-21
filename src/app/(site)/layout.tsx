import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

/** Public marketing site chrome. The admin area (/admin) has its own layout. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
