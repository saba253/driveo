import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ka } from "@/content/ka";

const t = ka.faq;

/* Native <details> accordion: keyboard and screen-reader support without JS. */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="pb-20 sm:pb-28 lg:pb-32">
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <SectionHeading id="faq-title" eyebrow={t.eyebrow} title={t.title} className="reveal min-w-0" />

        <div className="reveal min-w-0 border-y border-line">
          {t.items.map((item) => (
            <details key={item.q} className="faq-item group border-b border-line last:border-b-0">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-5 rounded-sm py-5 text-[1.0625rem] font-semibold transition-colors duration-(--duration-base) hover:text-accent [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">{item.q}</span>
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong text-fg-muted transition-[transform,border-color,color] duration-(--duration-base) ease-(--ease-out-soft) group-open:rotate-45 group-open:border-accent group-open:text-accent"
                  aria-hidden="true"
                >
                  <Icon name="plus" size={16} />
                </span>
              </summary>
              <p className="pr-2 pb-6 text-fg-muted sm:pr-14">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
