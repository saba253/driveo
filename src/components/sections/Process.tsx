import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ka } from "@/content/ka";
import { cn } from "@/lib/cn";

const t = ka.process;

/* Steps on a rail: vertical on mobile, horizontal from md. */
export function Process() {
  return (
    <section
      id="process"
      aria-labelledby="process-title"
      className="border-y border-line bg-linear-to-b from-canvas via-surface/45 to-canvas py-20 sm:py-28 lg:py-32"
    >
      <Container>
        <SectionHeading id="process-title" eyebrow={t.eyebrow} title={t.title} className="reveal" />

        <ol className="mt-12 grid gap-0 md:mt-16 md:grid-cols-3 md:gap-8 lg:gap-12">
          {t.steps.map((step, i) => {
            const last = i === t.steps.length - 1;
            return (
              <li
                key={step.title}
                className="reveal relative grid grid-cols-[3rem_minmax(0,1fr)] gap-x-5 pb-10 last:pb-0 md:block md:pb-0"
              >
                {/* Connector to the next step */}
                {!last && (
                  <span
                    aria-hidden="true"
                    className="absolute top-14 bottom-2 left-6 w-px bg-linear-to-b from-line-strong to-line md:top-6 md:-right-6 md:bottom-auto md:left-16 lg:-right-10 md:h-px md:w-auto md:bg-linear-to-r"
                  />
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative grid size-12 place-items-center rounded-full font-brand text-sm font-bold tabular-nums",
                    last ? "bg-accent text-accent-ink shadow-glow" : "border border-line-strong bg-canvas text-fg",
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="pt-2.5 md:mt-6 md:pt-0">
                  <h3 className="text-h3 font-semibold">{step.title}</h3>
                  <p className="mt-2 max-w-sm text-fg-muted">{step.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}
