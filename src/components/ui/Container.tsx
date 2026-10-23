import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/** Horizontally centred page column with responsive gutters. */
export function Container({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      // Gutters in px (20/32/40, as before): they must not grow with enlarged text and squeeze narrow screens.
      className={cn("mx-auto w-full max-w-(--container-page) px-[20px] sm:px-[32px] lg:px-[40px]", className)}
      {...props}
    />
  );
}
