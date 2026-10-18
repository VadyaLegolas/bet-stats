import { describe, expect, it } from "vitest";

import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  nextTheme,
  normalizeTheme,
  resolveTheme,
} from "./theme";

type WindowStub = { localStorage: { getItem: (key: string) => string | null }; matchMedia: () => { matches: boolean } };

function withWindow(stored: string | null, systemDark: boolean, run: () => void): void {
  const scope = globalThis as { window?: unknown };
  const original = scope.window;
  const stub: WindowStub = {
    localStorage: { getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null) },
    matchMedia: () => ({ matches: systemDark }),
  };
  scope.window = stub;
  try {
    run();
  } finally {
    if (original === undefined) delete scope.window;
    else scope.window = original;
  }
}

describe("theme state", () => {
  it("flips between the two themes and rejects anything else", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("blue")).toBeNull();
    expect(normalizeTheme(null)).toBeNull();
    expect(normalizeTheme(undefined)).toBeNull();
  });

  it("resolves stored choice over system preference over the light default", () => {
    expect(resolveTheme()).toBe("light"); // no window (SSR/node)
    withWindow("dark", false, () => expect(resolveTheme()).toBe("dark"));
    withWindow("light", true, () => expect(resolveTheme()).toBe("light"));
    withWindow(null, true, () => expect(resolveTheme()).toBe("dark"));
    withWindow(null, false, () => expect(resolveTheme()).toBe("light"));
    withWindow("sepia", false, () => expect(resolveTheme()).toBe("light"));
  });

  it("bootstraps data-theme in <head> before paint with the same decision order", () => {
    const script = THEME_BOOTSTRAP_SCRIPT;
    expect(script).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(script).toContain('localStorage.getItem');
    expect(script).toContain("prefers-color-scheme: dark");
    expect(script).toContain('document.documentElement.setAttribute("data-theme"');
    // stored value is consulted before the system preference, like resolveTheme()
    expect(script.indexOf("localStorage.getItem")).toBeLessThan(script.indexOf("matchMedia("));
    // the whole decision is guarded so a blocked localStorage never leaves the page unthemed
    expect(script.startsWith("(function(){try{")).toBe(true);
    expect(script.trimEnd().endsWith("})();")).toBe(true);
  });
});
