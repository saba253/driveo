import { BookingCard } from "@/components/booking/BookingCard";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { ka } from "@/content/ka";
import { bookingFormMode } from "@/server/bookings";
import { HeroVisual } from "./HeroVisual";

const t = ka.hero;

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <HeroVisual />

      <Container className="grid gap-10 pt-12 pb-16 sm:pt-20 sm:pb-20 lg:min-h-[min(calc(100svh-4.5rem),60rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center lg:gap-14 lg:py-14 xl:grid-cols-[minmax(0,1fr)_30rem] xl:gap-20">
        <div className="min-w-0 max-w-2xl">
          <p className="flex animate-rise items-center gap-3 text-sm font-medium text-fg-muted">
            <span className="h-px w-8 bg-accent" aria-hidden="true" />
            {t.eyebrow}
          </p>

          <h1 id="hero-title" className="mt-5 animate-rise text-display font-bold [--delay:80ms]">
            <span className="block">{t.titleLead}</span>
            <span className="block text-accent">{t.titleAccent}</span>
          </h1>

          <p className="mt-6 max-w-xl animate-rise text-lead text-fg-muted [--delay:160ms]">{t.lead}</p>

          <div className="mt-8 flex animate-rise flex-col gap-3 [--delay:240ms] min-[420px]:flex-row min-[420px]:flex-wrap">
            {/* On desktop the booking card is already beside the copy. */}
            <ButtonLink href="#booking" size="lg" className="lg:hidden">
              {t.primaryCta}
              <Icon name="arrowDown" size={18} />
            </ButtonLink>
            <ButtonLink href="#process" variant="secondary" size="lg">
              {t.secondaryCta}
            </ButtonLink>
          </div>
        </div>

        {/* "prototype" unless the server-side flag enables development TEST submissions. */}
        <BookingCard mode={bookingFormMode()} className="min-w-0 animate-rise [--delay:200ms]" />
      </Container>
    </section>
  );
}
