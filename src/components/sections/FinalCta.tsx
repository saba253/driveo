import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { ka } from "@/content/ka";

const t = ka.finalCta;

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="pb-20 sm:pb-28">
      <Container>
        <div className="reveal relative isolate overflow-hidden rounded-xl border border-line bg-surface px-5 py-14 text-center sm:px-12 lg:py-20">
          {/* Headlight glow rising from the bottom edge */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 -bottom-1/2 -z-10 mx-auto h-full max-w-3xl rounded-full bg-[radial-gradient(closest-side,rgb(217_246_111/0.18),transparent)]"
          />
          <div aria-hidden="true" className="absolute inset-x-12 top-0 h-px bg-linear-to-r from-transparent via-accent/50 to-transparent" />

          <p className="text-sm font-medium text-accent">{t.eyebrow}</p>
          <h2 id="cta-title" className="mx-auto mt-4 max-w-2xl text-h1 font-bold">
            {t.title}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lead text-fg-muted">{t.text}</p>
          <ButtonLink href="#booking" size="lg" className="mt-8 w-full max-[359px]:whitespace-normal sm:w-auto">
            {t.button}
            <Icon name="arrowUp" size={18} />
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
