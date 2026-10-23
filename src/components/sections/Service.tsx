import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ka } from "@/content/ka";

const t = ka.service;

export function Service() {
  return (
    <section id="service" aria-labelledby="service-title" className="py-20 sm:py-28 lg:py-32">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <div className="reveal min-w-0">
          <SectionHeading id="service-title" eyebrow={t.eyebrow} title={t.title} titleAccent={t.titleAccent} intro={t.intro} />

          {/* Not a tow truck — the core distinction of the service. */}
          <aside className="mt-8 flex gap-4 rounded-lg border border-line bg-surface/60 p-[20px] sm:p-[24px]" aria-labelledby="service-note-title">
            <Icon name="info" size={22} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <h3 id="service-note-title" className="font-semibold">
                {t.note.title}
              </h3>
              <p className="mt-1.5 text-[0.9375rem] text-fg-muted">{t.note.text}</p>
            </div>
          </aside>
        </div>

        <div className="min-w-0 lg:pt-11">
          <h3 className="reveal text-sm font-medium text-fg-subtle">{t.useCasesLabel}</h3>
          <ul className="mt-4">
            {t.useCases.map((item) => (
              <li
                key={item.title}
                className="reveal grid grid-cols-[20px_minmax(0,1fr)] gap-x-[16px] border-t border-line py-7 last:border-b sm:grid-cols-[32px_minmax(0,1fr)] sm:py-8"
              >
                {/* A plain marker: these are independent use cases, not steps, so no 01 / 02 / 03.
                    Column, gap and marker in px, so enlarged text keeps the width for words. */}
                <span className="mt-2.5 block h-px w-[20px] bg-accent sm:w-[24px]" aria-hidden="true" />
                <div className="min-w-0">
                  <h4 className="text-h3 font-semibold">{item.title}</h4>
                  <p className="mt-2 text-fg-muted">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
