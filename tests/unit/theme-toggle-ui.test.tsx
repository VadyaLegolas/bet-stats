import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ThemeToggle } from "../../apps/web/components/theme-toggle.js";

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
    expect(layout).toContain("THEME_BOOTSTRAP_SCRIPT");
    expect(layout).toContain("<ThemeToggle />");
  });
});
