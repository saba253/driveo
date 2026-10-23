import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg" | "lgCompact";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover hover:shadow-glow",
  secondary: "border border-line-strong text-fg hover:border-fg-muted hover:bg-fg/5",
  ghost: "text-fg-muted hover:text-fg",
};

/* sm keeps a 44px touch target (header use); md/lg are 48px+.
   Pass layout classes via className, not padding/height — those would clash with the size. */
/* Heights in rem grow with enlarged text (bigger targets); side padding in px does not,
   so long Georgian labels still fit on narrow screens. Values equal the previous rem at 16px. */
const sizes: Record<Size, string> = {
  sm: "min-h-11 px-[16px] text-sm",
  md: "min-h-12 px-[20px] text-[0.9375rem]",
  lg: "min-h-14 px-[28px] text-base",
  /** lg height with tight padding, for icon-led secondary actions beside a full-width button. */
  lgCompact: "min-h-14 min-w-[56px] px-[16px] text-base",
};

type StyleOptions = { variant?: Variant; size?: Size; className?: string };

/** Shared button styling for <button> and <a> elements. */
export function buttonStyles({ variant = "primary", size = "md", className }: StyleOptions = {}) {
  return cn(
    "group/button inline-flex max-w-full select-none items-center justify-center gap-2.5 rounded-md text-center leading-snug font-semibold [overflow-wrap:anywhere]",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-(--duration-base) ease-(--ease-out-soft)",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

export type ButtonProps = ComponentPropsWithoutRef<"button"> & Omit<StyleOptions, "className">;

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonStyles({ variant, size, className })} {...props} />;
}

export type ButtonLinkProps = ComponentPropsWithoutRef<"a"> & Omit<StyleOptions, "className">;

/** In-page or external link styled as a button. */
export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <a className={buttonStyles({ variant, size, className })} {...props} />;
}
