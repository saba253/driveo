import type { Metadata, Viewport } from "next";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { brand } from "@/config/brand";
import { ka } from "@/content/ka";
import { cn } from "@/lib/cn";
import { manrope, notoGeorgian } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: {
    default: `${brand.displayName} — ${ka.meta.title}`,
    template: `%s — ${brand.displayName}`,
  },
  description: ka.meta.description,
  applicationName: brand.displayName,
  openGraph: {
    siteName: brand.displayName,
    locale: brand.locale,
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#101318",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ka" className={cn(manrope.variable, notoGeorgian.variable)}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-3 focus:font-semibold focus:text-accent-ink"
        >
          {ka.a11y.skipToContent}
        </a>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
