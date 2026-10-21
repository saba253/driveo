import { brand } from "@/config/brand";
import { cn } from "@/lib/cn";

/** Text wordmark driven entirely by brand config. Size it via className. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-brand font-extrabold tracking-[0.08em] text-fg", className)}>
      {brand.name}
      <span className="text-accent">{brand.mark}</span>
    </span>
  );
}
