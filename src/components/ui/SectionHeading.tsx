import { cn } from "@/lib/cn";

type SectionHeadingProps = {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
  className?: string;
};

/** Eyebrow + h2 + optional intro, shared by homepage sections. `id` labels the section. */
export function SectionHeading({ id, eyebrow, title, intro, className }: SectionHeadingProps) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <p className="flex items-center gap-3 text-sm font-medium text-fg-muted">
        <span className="h-px w-8 bg-accent" aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 id={id} className="mt-4 text-h2 font-bold">
        {title}
      </h2>
      {intro && <p className="mt-4 text-lead text-fg-muted">{intro}</p>}
    </div>
  );
}
