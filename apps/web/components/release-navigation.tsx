"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const DESTINATIONS = [
  { label: "Матчи", href: "/fixtures", current: (pathname: string) => pathname === "/fixtures" },
  { label: "Анализ", href: "/fixtures#match-analysis", current: (pathname: string) => pathname.startsWith("/fixtures/") },
  { label: "Результаты", href: "/scorecards", current: (pathname: string) => pathname.startsWith("/scorecards") },
  { label: "Методология", href: "/methodology", current: (pathname: string) => pathname.startsWith("/methodology") },
  { label: "FAQ", href: "/faq", current: (pathname: string) => pathname.startsWith("/faq") },
  { label: "Операции", href: "/internal/operations/gateway", current: (pathname: string) => pathname.startsWith("/internal/operations"), external: true },
] as const;

export function ReleaseNavigation({ homeOrigin }: { homeOrigin?: string | null } = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const close = () => setOpen(false);
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset: close the mobile menu whenever the route changes
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      queueMicrotask(() => trigger.current?.focus());
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className="release-navigation">
      <button
        ref={trigger}
        className="release-menu-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="release-primary-links"
        onClick={() => setOpen((value) => !value)}
      >
        Меню
      </button>
      <nav aria-label="Основная навигация" id="release-primary-links" data-open={open ? "true" : "false"}>
        {DESTINATIONS.map((destination) => (
          "external" in destination && destination.external ? (
            <a
              key={destination.label}
              href={destination.href}
              aria-current={destination.current(pathname) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {destination.label}
            </a>
          ) : homeOrigin ? (
            // Reached through the operator gateway: a full cross-origin page
            // navigation back to the app origin is the point here.
            <a
              key={destination.label}
              href={`${homeOrigin}${destination.href}`}
              aria-current={destination.current(pathname) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {destination.label}
            </a>
          ) : (
            <Link
              key={destination.label}
              href={destination.href}
              aria-current={destination.current(pathname) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {destination.label}
            </Link>
          )
        ))}
      </nav>
    </div>
  );
}
