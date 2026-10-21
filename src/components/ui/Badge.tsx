import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/** Small status label, e.g. the prototype marker. */
export function Badge({ className, children, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent",
        className,
      )}
      {...props}
    >
      <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
      {children}
    </span>
  );
}
