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

/** ids for a control's hint and error text, and the matching aria-describedby value. */
export function describe(id: string, opts: { hint?: boolean; error?: boolean }) {
  const ids = [opts.error && `${id}-error`, opts.hint && `${id}-hint`].filter(Boolean).join(" ");
  return ids || undefined;
}

export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${id}-hint`} className="mt-1.5 text-sm leading-relaxed text-fg-subtle">
      {children}
    </p>
  );
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={`${id}-error`} className="mt-1.5 flex gap-1.5 text-sm leading-snug text-danger">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

type FieldProps = {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
};

/** Label + control + optional hint and error. The control must set aria-describedby via describe(). */
export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      <FieldError id={htmlFor}>{error}</FieldError>
      {hint && <FieldHint id={htmlFor}>{hint}</FieldHint>}
    </div>
  );
}

type CheckboxProps = Omit<ComponentPropsWithoutRef<"input">, "type" | "children"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
};

/** Native checkbox with a large hit area: the whole row is the label. */
export function Checkbox({ id, label, hint, error, className, ...props }: CheckboxProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 py-1">
        <span className="relative mt-0.5 grid size-5.5 shrink-0 place-items-center">
          <input
            id={id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={describe(id, { hint: Boolean(hint), error: Boolean(error) })}
            className={cn(
              "peer size-5.5 cursor-pointer appearance-none rounded-sm border border-line-strong bg-field",
              "transition-[background-color,border-color,box-shadow] duration-(--duration-fast)",
              "checked:border-accent checked:bg-accent hover:border-fg-subtle",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              "aria-invalid:border-danger",
            )}
            {...props}
          />
          <Icon
            name="check"
            size={16}
            strokeWidth={2.5}
            className="pointer-events-none absolute text-accent-ink opacity-0 transition-opacity duration-(--duration-fast) peer-checked:opacity-100"
          />
        </span>
        <span className="min-w-0 text-[0.9375rem] leading-snug text-fg">{label}</span>
      </label>
      <div className="pl-8.5">
        <FieldError id={id}>{error}</FieldError>
        {hint && <FieldHint id={id}>{hint}</FieldHint>}
      </div>
    </div>
  );
}

type SegmentedProps<V extends string> = {
  name: string;
  legend: string;
  options: readonly { value: V; label: string }[];
  value: V | "";
  onChange: (value: V) => void;
  error?: string;
  className?: string;
};

/** Radio group styled as segmented buttons; arrow keys move between options natively. */
export function Segmented<V extends string>({ name, legend, options, value, onChange, error, className }: SegmentedProps<V>) {
  const id = `${name}-group`;
  return (
    <fieldset className={cn("min-w-0", className)} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-2 text-sm font-medium text-fg-muted">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "relative flex min-h-13 min-w-0 cursor-pointer items-center justify-center rounded-md border bg-field px-3 py-2 text-center text-[0.9375rem] [overflow-wrap:anywhere]",
              "transition-[border-color,background-color,color] duration-(--duration-fast)",
              "has-checked:border-accent has-checked:bg-accent/10 has-checked:text-fg",
              "has-focus-visible:ring-3 has-focus-visible:ring-accent/40",
              error ? "border-danger text-fg-muted" : "border-line-strong text-fg-muted hover:border-fg-subtle",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      <FieldError id={id}>{error}</FieldError>
    </fieldset>
  );
}
