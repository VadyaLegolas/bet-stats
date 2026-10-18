"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import { nextTheme, persistTheme, resolveTheme, setThemeAttribute, type Theme } from "./theme";

/* Hydration-safe: the server render uses useEffect (a no-op there, and it keeps
   react-dom/server quiet), the browser bundle gets the pre-paint useLayoutEffect. */
const useThemeLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function SunIcon() {
  return (
    <svg className="theme-icon theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="theme-icon theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ThemeToggle() {
  /* SSR default; the layout effect snaps it to the attribute the bootstrap script stamped. */
  const [theme, setTheme] = useState<Theme>("light");

  useThemeLayoutEffect(() => {
    const current = resolveTheme();
    setThemeAttribute(current);
    setTheme(current);
  }, []);

  const toggle = () => {
    const next = nextTheme(theme);
    setThemeAttribute(next);
    persistTheme(next);
    setTheme(next);
  };

  return (
    <button type="button" className="theme-toggle" role="switch" aria-checked={theme === "dark"} aria-label="Тёмная тема" title="Тёмная тема — переключить" onClick={toggle}>
      <span className="theme-toggle-icons" aria-hidden="true">
        <SunIcon />
        <MoonIcon />
      </span>
    </button>
  );
}
