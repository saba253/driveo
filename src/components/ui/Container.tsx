import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

/** Horizontally centred page column with responsive gutters. */
export function Container({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("mx-auto w-full max-w-(--container-page) px-5 sm:px-8 lg:px-10", className)}
      {...props}
    />
  );
}
