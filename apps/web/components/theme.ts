/* Theme state for the «Матчдей» shell: one source of truth shared by the
   no-flash bootstrap <script> in the root layout and the header switch.

   Flow: the inline script in <head> runs during HTML parsing and stamps
   data-theme on <html> before the first paint; ThemeToggle re-applies it in a
   layout effect (React Strict Mode remounts reset <html> to JSX attributes in
   development) and persists an explicit click to localStorage. Until the user
   clicks, the system preference decides and keeps being followed. */

export const THEME_STORAGE_KEY = "matchday-theme";

export type Theme = "light" | "dark";

export const nextTheme = (theme: Theme): Theme => (theme === "light" ? "dark" : "light");

export function normalizeTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** OS preference; null when there is no window (SSR) or no matchMedia. */
export function systemTheme(): Theme | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return null;
  }
}

/** Explicit user choice from localStorage; null when absent/unreadable/invalid. */
export function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Stored choice → system preference → light (the server-rendered default). */
export function resolveTheme(): Theme {
  return readStoredTheme() ?? systemTheme() ?? "light";
}

/** Stamp the attribute that drives every themed token in globals.css. */
export function setThemeAttribute(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Persist an explicit click; never called during mount so the OS preference keeps winning. */
export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode: the attribute still switches this visit */
  }
}

/* Runs synchronously in <head> while the HTML parses — before first paint.
   Keeps the exact same decision order as resolveTheme() (stored → system →
   light) so the attribute is already correct when React hydrates. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(t!=="light"&&t!=="dark"){t=(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;
