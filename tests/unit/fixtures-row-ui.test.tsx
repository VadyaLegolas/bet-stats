import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FixtureRow, FixtureForecastLine } from "../../apps/web/app/fixtures/page.js";
import { ProbBar } from "../../apps/web/components/prob-bar.js";
import HomePage from "../../apps/web/app/page.js";

const RETURN_TO = "/fixtures?from=2026-10-17&competition=Premier League";

const baseFixture = {
  id: "fx-1",
  competition: { id: "c-1", name: "Premier League", season: "2026" },
  teams: { home: { id: "t-1", name: "Arsenal" }, away: { id: "t-2", name: "Chelsea" } },
  kickoff: "2026-10-17T13:00:00.000Z",
  status: "SCHEDULED",
  dataState: { state: "LIMITED" as const, reason: "PROVIDER_COVERAGE_LIMITED", provider: "api-football", capturedAt: "2026-10-17T10:00:00.000Z", sourceUpdatedAt: null, freshnessThresholdMs: 3_600_000, value: null },
  providerState: { state: "PRIMARY" as const, provider: "api-football", reason: "PRIMARY_AVAILABLE", capturedAt: null, lastValidAt: null, retryAllowed: false, receipt: null },
  forecast: { kind: "ONE_X_TWO", cutoff: "2026-10-17T12:00:00.000Z", probabilities: { home: 0.52, draw: 0.26, away: 0.22 } } as { kind?: string; cutoff?: string; probabilities?: { home?: unknown; draw?: unknown; away?: unknown } } | null,
};

type FixtureProp = Parameters<typeof FixtureRow>[0]["fixture"];
const render = (overrides: Partial<FixtureProp> = {}) =>
  renderToStaticMarkup(createElement(FixtureRow, { fixture: { ...baseFixture, ...overrides } as FixtureProp, returnTo: RETURN_TO, timeZone: "Europe/Warsaw" }));
const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");

describe("ProbBar", () => {
  it("renders the exact markup of the homepage bar", () => {
    expect(renderToStaticMarkup(createElement(ProbBar, { probs: [58, 22, 20] }))).toBe(
      '<div class="prob-bar" aria-hidden="true"><span class="prob-bar-home" style="width:58%"></span><span class="prob-bar-draw" style="width:22%"></span><span class="prob-bar-away" style="width:20%"></span></div>',
    );
    expect(renderToStaticMarkup(createElement(ProbBar, { probs: [58, 22, 20], small: true }))).toBe(
      '<div class="prob-bar prob-bar--sm" aria-hidden="true"><span class="prob-bar-home" style="width:58%"></span><span class="prob-bar-draw" style="width:22%"></span><span class="prob-bar-away" style="width:20%"></span></div>',
    );
  });
});

describe("homepage characterization (shared ProbBar must not change the output)", () => {
  const markup = renderToStaticMarkup(createElement(HomePage));
  const large = '<div class="prob-bar" aria-hidden="true"><span class="prob-bar-home" style="width:58%"></span><span class="prob-bar-draw" style="width:22%"></span><span class="prob-bar-away" style="width:20%"></span></div>';
  const small = '<div class="prob-bar prob-bar--sm" aria-hidden="true"><span class="prob-bar-home" style="width:58%"></span><span class="prob-bar-draw" style="width:22%"></span><span class="prob-bar-away" style="width:20%"></span></div>';

  it("keeps the hero bar and the first sample row bar", () => {
    expect(markup).toContain(large);
    expect(markup).toContain(`<div class="sample-row-probs">${small}<p class="sample-row-numbers">`);
  });

  it("keeps the sample numbers with their screen-reader labels", () => {
    expect(markup).toContain(
      '<p class="sample-row-numbers"><span><span class="sr-only">победа хозяев </span>58%</span><span><span class="sr-only">ничья </span>22%</span><span><span class="sr-only">победа гостей </span>20%</span></p>',
    );
  });

  it("keeps four sample rows with both pill kinds", () => {
    expect(markup.match(/<li class="sample-row">/g)?.length).toBe(4);
    expect(markup).toContain('<span class="pill-value">Есть value</span>');
    expect(markup).toContain('<span class="pill-novalue">Без value</span>');
  });
});

describe("FixtureRow", () => {
  it("renders the sample-style anatomy for a scheduled fixture with a forecast", () => {
    const markup = render();
    expect(markup.startsWith('<li class="fixture-row">')).toBe(true);
    expect(markup).toContain('<div class="fixture-row-when"><span>Premier League</span><span class="fixture-time">15:00</span></div>');
    expect(markup).toContain('<h3 class="fixture-row-teams">');
    expect(markup).toContain(`href="/fixtures/fx-1?returnTo=${encodeURIComponent(RETURN_TO).replace(/&/g, "&amp;")}"`);
    const link = markup.match(/<h3 class="fixture-row-teams"><a [^>]*>(.*?)<\/a><\/h3>/);
    expect(link).not.toBeNull();
    expect(stripTags(link![1]!)).toBe("Arsenal против Chelsea");
    expect(markup).toContain('<div class="prob-bar prob-bar--sm" aria-hidden="true"><span class="prob-bar-home" style="width:52%"></span><span class="prob-bar-draw" style="width:26%"></span><span class="prob-bar-away" style="width:22%"></span></div>');
    expect(markup).toContain('<p class="fixture-row-numbers"><span><span class="sr-only">победа хозяев </span>52%</span><span><span class="sr-only">ничья </span>26%</span><span><span class="sr-only">победа гостей </span>22%</span></p>');
    expect(markup).toContain('<div class="fixture-row-side">');
    expect(markup).toContain("запланирован");
    expect(markup).toContain("Основной источник");
    expect(markup).toContain("Неполные данные");
    expect(markup).not.toContain("fixture-live-badge");
    expect(markup).not.toContain("LIVE");
  });

  it("shows the LIVE badge and the status label for a match in play", () => {
    const markup = render({ status: "IN_PLAY" });
    expect(markup).toContain('<span class="fixture-live-badge">LIVE</span>');
    expect(markup).toContain("в игре");
  });

  it("shows the honest pending text and no bar without a usable forecast", () => {
    for (const forecast of [null, { probabilities: { home: "52%", draw: 0.26, away: 0.22 } }]) {
      const markup = render({ forecast });
      expect(markup).toContain("Прогноз пока не выпущен");
      expect(markup).toContain("fixture-forecast--pending");
      expect(markup).not.toContain("prob-bar");
    }
  });

  it("never renders a value pill, value text or legacy card markup", () => {
    for (const markup of [render(), render({ forecast: null }), render({ status: "LIVE" })]) {
      for (const forbidden of ["pill-value", "pill-novalue", "Есть value", "Без value", "fixture-card", "fixture-header", "fixture-meta"]) {
        expect(markup).not.toContain(forbidden);
      }
    }
  });

  it("renders each compact chip exactly once", () => {
    const markup = render();
    expect(markup.match(/class="state-chip /g)?.length).toBe(2);
    // Visible text only: the aria-label attributes repeat the labels by design.
    const visible = stripTags(markup);
    expect(visible.match(/Неполные данные/g)?.length).toBe(1);
    expect(visible.match(/Основной источник/g)?.length).toBe(1);
  });

  it("escapes untrusted names as text", () => {
    const markup = render({ teams: { home: { id: "t-1", name: "<img src=x>" }, away: { id: "t-2", name: "Chelsea" } } });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img src=x&gt;");
  });
});

describe("FixtureForecastLine block", () => {
  it("uses the probability-slot classes for both states", () => {
    const valid = renderToStaticMarkup(createElement(FixtureForecastLine, { forecast: baseFixture.forecast }));
    expect(valid.startsWith('<div class="fixture-forecast fixture-row-probs"><span class="sr-only">Прогноз: </span>')).toBe(true);
    expect(valid).toContain("fixture-row-numbers");
    const pending = renderToStaticMarkup(createElement(FixtureForecastLine, { forecast: null }));
    expect(pending).toBe('<div class="fixture-forecast fixture-forecast--pending fixture-row-probs">Прогноз пока не выпущен</div>');
  });
});

describe("fixtures list stylesheet contract", () => {
  const raw = readFileSync(resolve(import.meta.dirname, "../../apps/web/app/globals.css"), "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const liveMarkup = render({ status: "IN_PLAY" });

  it("has a selector for every fixture- class the row emits", () => {
    const classes = new Set<string>();
    for (const match of liveMarkup.matchAll(/class="([^"]*)"/g)) {
      for (const token of match[1]!.split(/\s+/)) if (token.startsWith("fixture-")) classes.add(token);
    }
    expect(classes.size).toBeGreaterThan(5);
    for (const token of classes) expect(css, `missing .${token}`).toMatch(new RegExp(`\\.${token}(?![\\w-])`));
  });

  it("keeps the title link at least 44px tall", () => {
    const rule = css.match(/\.fixture-row-teams a\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/min-height:\s*44px/);
  });

  it("uses only design tokens for colour in the list rules", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => /fixture-list|fixture-row|fixture-badges/.test(selector!));
    expect(rules.length).toBeGreaterThan(5);
    for (const [, selector, body] of rules) {
      expect(body, selector!.trim()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, selector!.trim()).not.toMatch(/rgba?\(/);
    }
  });

  it("drops the legacy card selector and lists the new container for forced colors", () => {
    expect(css).not.toMatch(/\.fixture-card/);
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*\.fixture-list/);
  });
});
