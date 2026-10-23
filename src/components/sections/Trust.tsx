import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ka } from "@/content/ka";

const t = ka.trust;

export function Trust() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="py-20 sm:py-28 lg:py-32">
      <Container>
        <div className="reveal grid gap-10 rounded-xl border border-line bg-surface p-[20px] shadow-card sm:p-[40px] lg:grid-cols-2 lg:gap-16 lg:p-[56px]">
          <SectionHeading id="trust-title" eyebrow={t.eyebrow} title={t.title} intro={t.intro} className="min-w-0" />

          <ul className="min-w-0 divide-y divide-line">
            {t.points.map((point) => (
              <li key={point.title} className="flex flex-col gap-3 py-6 first:pt-0 last:pb-0 min-[400px]:flex-row min-[400px]:gap-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-md bg-field text-accent" aria-hidden="true">
                  <Icon name={point.icon} size={20} />
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold">{point.title}</h3>
                  <p className="mt-1.5 text-fg-muted">{point.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
