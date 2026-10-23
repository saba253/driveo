"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { ka } from "@/content/ka";
import { cn } from "@/lib/cn";

/** Disclosure-pattern menu for viewports below `lg`. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const desktop = window.matchMedia("(min-width: 64rem)");
    const onResize = () => desktop.matches && setOpen(false);

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    desktop.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      desktop.removeEventListener("change", onResize);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? ka.header.menuClose : ka.header.menuOpen}
        onClick={() => setOpen((v) => !v)}
        className="grid size-[48px] shrink-0 place-items-center rounded-md text-fg transition-colors duration-(--duration-base) hover:bg-fg/5"
      >
        <Icon name={open ? "close" : "menu"} size={22} />
      </button>

      <nav
        id={panelId}
        aria-label={ka.a11y.primaryNav}
        hidden={!open}
        className={cn("absolute inset-x-0 top-full border-b border-line bg-canvas/95 backdrop-blur-lg", open && "animate-rise [--delay:0ms]")}
        style={{ animationDuration: "320ms" }}
      >
        <Container>
          <ul className="flex flex-col py-3">
            {ka.nav.map((item) => (
              <li key={item.href} className="border-b border-line/60 last:border-0">
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-14 min-w-0 items-center justify-between gap-3 text-lg text-fg [overflow-wrap:anywhere]"
                >
                  {item.label}
                  <Icon name="arrowRight" size={18} className="shrink-0 text-fg-subtle" />
                </a>
              </li>
            ))}
          </ul>
          <div className="pb-5 sm:hidden">
            <ButtonLink href="#booking" size="lg" className="w-full" onClick={() => setOpen(false)}>
              {ka.header.cta}
            </ButtonLink>
          </div>
        </Container>
      </nav>
    </div>
  );
}
