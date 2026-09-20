"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const DESTINATIONS = [
  { label: "Fixtures", href: "/fixtures", current: (pathname: string) => pathname === "/fixtures" },
  { label: "Analysis", href: "/fixtures#match-analysis", current: (pathname: string) => pathname.startsWith("/fixtures/") },
  { label: "Results", href: "/scorecards", current: (pathname: string) => pathname.startsWith("/scorecards") },
  { label: "Methodology", href: "/methodology", current: (pathname: string) => pathname.startsWith("/methodology") },
] as const;

export function ReleaseNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const close = () => setOpen(false);
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);

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
        Menu
      </button>
      <nav aria-label="Primary navigation" id="release-primary-links" data-open={open ? "true" : "false"}>
        {DESTINATIONS.map((destination) => (
          <Link
            key={destination.label}
            href={destination.href}
            aria-current={destination.current(pathname) ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            {destination.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
