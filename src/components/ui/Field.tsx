import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

/*
 * Form primitives. Controls are 52px tall with 16px text, so iOS does not
 * zoom on focus and touch targets stay comfortable.
 */
const control = cn(
  "peer block h-13 w-full min-w-0 rounded-md border border-line-strong bg-field px-4 text-base text-fg",
  "placeholder:text-fg-subtle",
  "transition-[border-color,box-shadow,background-color] duration-(--duration-base) ease-(--ease-out-soft)",
  "hover:border-fg-subtle",
  "focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-3 focus:ring-accent/25",
  "aria-invalid:border-danger aria-invalid:focus:ring-danger/25",
);

export function Label({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return <label className={cn("mb-2 block text-sm font-medium text-fg-muted", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentPropsWithoutRef<"select">) {
  return (
    <div className="relative">
      <select className={cn(control, "cursor-pointer appearance-none pr-11 invalid:text-fg-subtle [&>option]:bg-field [&>option]:text-fg", className)} {...props}>
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={18}
        className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-fg-subtle transition-colors peer-focus:text-accent"
      />
    </div>
  );
}

/** Label + control wrapper. */
export function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
