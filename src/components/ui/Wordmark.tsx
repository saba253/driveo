import { brand } from "@/config/brand";
import { cn } from "@/lib/cn";

/** Text wordmark driven entirely by brand config. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("font-brand text-xl font-extrabold tracking-[0.08em] text-fg", className)}
      aria-label={brand.displayName}
    >
      <span aria-hidden="true">
        {brand.name}
        <span className="text-accent">{brand.mark}</span>
      </span>
    </span>
  );
}
