import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Wordmark } from "@/components/ui/Wordmark";
import { brand } from "@/config/brand";
import { ka } from "@/content/ka";
import { MobileMenu } from "./MobileMenu";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/75 backdrop-blur-lg backdrop-saturate-150">
      <Container className="flex h-16 items-center justify-between gap-4 lg:h-18">
        <a href="#top" className="-mx-1 rounded-sm px-1 py-2" aria-label={`${brand.displayName} — ${ka.a11y.home}`}>
          <Wordmark className="text-lg lg:text-xl" />
        </a>

        <nav aria-label={ka.a11y.primaryNav} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {ka.nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="relative rounded-sm px-3.5 py-2 text-[0.9375rem] text-fg-muted transition-colors duration-(--duration-base) hover:text-fg after:absolute after:inset-x-3.5 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-(--duration-base) after:ease-(--ease-out-soft) hover:after:scale-x-100"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink href="#booking" size="sm" className="whitespace-nowrap max-[359px]:hidden">
            {ka.header.cta}
          </ButtonLink>
          <MobileMenu />
        </div>
      </Container>
    </header>
  );
}
