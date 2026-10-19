import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ThemeToggle } from "../../apps/web/components/theme-toggle.js";
import { ThemeBootstrapScript } from "../../apps/web/components/theme-bootstrap.js";

describe("theme toggle", () => {
  it("renders an accessible switch with both crossfade icons at the light default", () => {
    const markup = renderToStaticMarkup(createElement(ThemeToggle));
    expect(markup).toContain('class="theme-toggle"');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('aria-label="Тёмная тема"');
    expect(markup).toContain("theme-toggle-icons");
    expect(markup).toContain("theme-icon-moon");
    expect(markup).toContain("theme-icon-sun");
    expect(markup).toContain("<svg");
    /* The visible icon is chosen purely by CSS off data-theme, so the static
       markup must carry both icons — no icon may depend on client state. */
    expect(markup.indexOf("theme-icon-sun")).toBeLessThan(markup.indexOf("theme-icon-moon"));
  });

  it("wires the no-flash bootstrap and the switch into the root layout", () => {
    const layout = readFileSync(resolve(import.meta.dirname, "../../apps/web/app/layout.tsx"), "utf8");
    expect(layout).toContain('data-theme="light"');
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toContain("<ThemeBootstrapScript />");
    expect(layout).toContain("<ThemeToggle />");
  });

  it("emits the bootstrap script from the server render and nothing from the client", () => {
    /* SSR path: type="text/javascript" so the browser runs it while the HTML
       parses (before first paint); the script body is the shared constant. */
    const markup = renderToStaticMarkup(createElement(ThemeBootstrapScript));
    expect(markup).toContain('type="text/javascript"');
    expect(markup).toContain("matchday-theme");
    /* Client path: the component returns null, so hydration never expects the
       <script> node — a missing or extra <head> script (browser extension)
       cannot fail hydration, and client renders never recreate the element. */
    const source = readFileSync(resolve(import.meta.dirname, "../../apps/web/components/theme-bootstrap.tsx"), "utf8");
    expect(source).toContain('"use client"');
    expect(source).toContain('typeof window !== "undefined"');
    expect(source).toContain("return null");
  });
});
