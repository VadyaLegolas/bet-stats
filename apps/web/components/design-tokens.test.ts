import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "app");
const css = readFileSync(join(appDir, "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const fontsSource = readFileSync(join(appDir, "fonts.ts"), "utf8");

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1]!, match[2]!.trim());
  }
  return map;
}

function blockBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const light = declarations(blockBody(":root"));
const dark = new Map([...light, ...declarations(blockBody(':root[data-theme="dark"]'))]);
const darkOwn = declarations(blockBody(':root[data-theme="dark"]'));

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const approvedLight: Record<string, string> = {
  "--color-page": "#F6F7F4",
  "--color-surface": "#FFFFFF",
  "--color-surface-2": "#EEF1EC",
  "--color-text": "#10161A",
  "--color-muted": "#55616B",
  "--color-border": "#E1E5DF",
  "--color-border-strong": "#C3CBC4",
  "--color-accent": "#0B7A5A",
  "--color-on-accent": "#FFFFFF",
  "--color-accent-soft": "#DDF1E8",
  "--color-accent-text": "#075A42",
  "--color-neutral-bar": "#B8C1BA",
  "--color-warm": "#C9701D",
  "--shadow-card": "0 24px 48px -24px rgba(16,22,26,0.18)",
};

const approvedDark: Record<string, string> = {
  "--color-page": "#0B100F",
  "--color-surface": "#131A18",
  "--color-surface-2": "#0F1514",
  "--color-text": "#EDF2EF",
  "--color-muted": "#9DABA5",
  "--color-border": "#22302B",
  "--color-border-strong": "#34463F",
  "--color-accent": "#3DDC97",
  "--color-on-accent": "#04140C",
  "--color-accent-soft": "#12301F",
  "--color-accent-text": "#6BE9B1",
  "--color-neutral-bar": "#4A5953",
  "--color-warm": "#F0A24A",
  "--shadow-card": "0 24px 48px -24px rgba(0,0,0,0.6)",
};

function normalise(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toLowerCase();
}

describe("design tokens: approved palette", () => {
  it.each(Object.entries(approvedLight))("light %s", (name, value) => {
    expect(normalise(light.get(name))).toBe(normalise(value));
  });

  it.each(Object.entries(approvedDark))("dark %s", (name, value) => {
    expect(normalise(darkOwn.get(name))).toBe(normalise(value));
  });

  it("every colour token of the light theme is redefined in dark", () => {
    const missing = [...light.keys()].filter((name) => name.startsWith("--color-") && !darkOwn.has(name));
    expect(missing).toEqual([]);
  });
});

describe("design tokens: contrast (>= 4.5:1)", () => {
  const themes: Array<[string, Map<string, string>]> = [
    ["light", light],
    ["dark", dark],
  ];

  function colour(theme: Map<string, string>, name: string): string {
    const value = theme.get(name);
    if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a 6-digit hex: ${value}`);
    return value;
  }

  for (const [themeName, theme] of themes) {
    describe(themeName, () => {
      const backgrounds = ["--color-page", "--color-surface", "--color-surface-2"];
      const pairs: Array<[string, string]> = [];
      for (const fg of ["--color-text", "--color-text-secondary", "--color-muted"]) {
        for (const bg of backgrounds) pairs.push([fg, bg]);
      }
      for (const bg of ["--color-page", "--color-surface"]) pairs.push(["--color-accent", bg]);
      pairs.push(["--color-accent-text", "--color-accent-soft"], ["--color-accent-text", "--color-page"]);
      for (const bg of ["--color-accent-fill", "--color-accent-fill-hover", "--color-deep"]) {
        pairs.push(["--color-on-accent", bg]);
      }
      for (const fg of ["--color-warning", "--color-danger", "--color-info"]) {
        for (const bg of ["--color-surface", "--color-page"]) pairs.push([fg, bg]);
      }

      pairs.push(["--color-on-danger", "--color-danger"]);

      // Строка главной линии азиатского гандикапа (Phase 14) кладёт основной, вторичный и приглушённый текст на accent-soft.
      for (const fg of ["--color-text", "--color-text-secondary", "--color-muted"]) pairs.push([fg, "--color-accent-soft"]);

      it.each(pairs)("%s on %s", (fg, bg) => {
        expect(contrast(colour(theme, fg), colour(theme, bg))).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});

describe("design tokens: extended markets block", () => {
  const start = css.indexOf(".market-head");
  const block = css.slice(start);

  it("is appended at the end of globals.css", () => {
    expect(start).toBeGreaterThan(0);
    expect(block).toContain(".market-score-fields");
    expect(block).toContain('.evidence-card[data-current="true"]');
  });

  it("introduces no hex colour values", () => {
    expect(block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it("makes table cells the containing block of the absolutely positioned screen-reader text", () => {
    // Без этого .sr-only в ячейках у правого края прокручиваемой таблицы растягивает страницу вбок (найдено сквозной проверкой на 320 px).
    expect(block).toMatch(/\.market-table td\s*\{\s*position:\s*relative;\s*\}/);
  });

  describe("exact-score grid layout contract", () => {
    // Плотный охранный набор: каждое правило закрывает отдельную причину дефекта UAT 14 (тест 7).
    const rule = (selectorPattern: string) => new RegExp(`(?:^|\\})\\s*${selectorPattern}\\s*\\{([^}]*)\\}`, "m").exec(block)?.[1] ?? "";

    it("resets the inherited overflow-wrap on grid headers so axis labels do not stack one letter per line", () => {
      expect(rule("\\.market-grid th")).toMatch(/overflow-wrap:\s*normal\s*;/);
    });

    it("starts the column-axis header at the left edge of its column group", () => {
      expect(rule('\\.market-grid thead th\\[scope="colgroup"\\]')).toMatch(/text-align:\s*start\s*;/);
    });

    it("makes the scroll region a size container and sizes the caption to its visible width, aligned to the start", () => {
      expect(rule("\\.market-grid-scroll")).toMatch(/container-type:\s*inline-size\s*;/);
      const caption = rule("\\.market-grid caption");
      expect(caption).toMatch(/width:\s*100cqw\s*;/);
      expect(caption).toMatch(/text-align:\s*start\s*;/);
    });

    it("pins the corner cell and the tfoot label above the cell text", () => {
      const sticky = rule("\\.market-grid thead tr:first-child > th:first-child,\\s*\\.market-grid tfoot th");
      expect(sticky).toMatch(/position:\s*sticky\s*;/);
      expect(sticky).toMatch(/inset-inline-start:\s*0\s*;/);
      expect(sticky).toMatch(/z-index:\s*1\s*;/);
      expect(rule("\\.market-grid tbody th")).toMatch(/z-index:\s*1\s*;/);
    });

    it("does not touch the shared scroll-region rule", () => {
      expect(block).not.toMatch(/\.evidence-table-scroll\s*\{/);
    });
  });

  it("declares no new custom properties and adds no animation", () => {
    expect(block.match(/(^|[;{\s])--[\w-]+\s*:/g) ?? []).toEqual([]);
    expect(block).not.toMatch(/(?:^|[^-\w])(?:transition|animation|@keyframes)\b/);
  });
});

describe("design tokens: shape", () => {
  it.each([
    ["--radius-control", "12px"],
    ["--radius-panel", "20px"],
    ["--radius-card", "24px"],
    ["--radius-pill", "999px"],
  ])("%s is %s", (name, value) => {
    expect(light.get(name)).toBe(value);
  });
});

describe("fonts", () => {
  it("declares three local font instances with the expected CSS variables", () => {
    expect(fontsSource.match(/localFont\(/g)?.length).toBe(3);
    for (const variable of ["--font-space-grotesk", "--font-inter", "--font-inter-cyrillic"]) {
      expect(fontsSource).toContain(`"${variable}"`);
    }
  });

  it("references only existing woff2 files with a valid signature", () => {
    const paths = [...fontsSource.matchAll(/"\.\/fonts\/([\w.-]+\.woff2)"/g)].map((m) => m[1]!);
    expect(paths.length).toBe(3);
    for (const file of paths) {
      const full = join(appDir, "fonts", file);
      expect(existsSync(full), file).toBe(true);
      const bytes = readFileSync(full);
      expect(bytes.subarray(0, 4).toString("ascii"), file).toBe("wOF2");
      expect(bytes.length, file).toBeGreaterThan(10 * 1024);
      expect(bytes.length, file).toBeLessThan(200 * 1024);
    }
  });

  it("wires heading and body stacks to the font variables", () => {
    const heading = light.get("--font-heading") ?? "";
    const body = light.get("--font-body") ?? "";
    expect(heading.indexOf("--font-space-grotesk")).toBeGreaterThanOrEqual(0);
    expect(heading.indexOf("--font-space-grotesk")).toBeLessThan(heading.indexOf("--font-inter"));
    expect(body).toContain("--font-inter");
    expect(blockBody("html")).toContain("var(--font-body)");
  });
});
