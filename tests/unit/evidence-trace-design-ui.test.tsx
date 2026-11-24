import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { EvidenceProjectionDto, EvidenceSourceRef } from "../../packages/domain/src/index.js";

import { EvidenceTraceSection, EvidenceTraceTable } from "../../apps/web/app/teams/[teamId]/evidence/page.js";

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");

const ref = (fixtureId: string): EvidenceSourceRef => ({ fixtureId, effectiveAt: "2026-08-22T16:00:00.000Z", observedAt: "2026-08-22T18:00:00.000Z", sourceUpdatedAt: null, payloadHash: "sha-256:feedstock", payloadBytes: 512 });

const components: EvidenceProjectionDto["components"] = {
  form5: { kind: "form5", value: 1.8, unit: "points-per-match", sampleSize: 5, limitation: null, sourceRefs: [ref("fx-201")] },
  elo: { kind: "elo", value: 1520.5, unit: "rating-points", sampleSize: 10, limitation: null, sourceRefs: [ref("fx-201"), ref("fx-202")] },
};

const fullRow = { fixtureId: "fx-201", effectiveAt: "2026-08-22T16:00:00.000Z", observedAt: "2026-08-22T18:00:00.000Z", venue: "HOME" as const, outcome: "WIN" as const, score: { home: 2, away: 1 }, source: "data-feed-7" };

const section = (rows: Parameters<typeof EvidenceTraceTable>[0]["rows"], fixtureLabels: Record<string, string> = {}) =>
  renderToStaticMarkup(createElement(EvidenceTraceSection, { rows, fixtureLabels, components, timeZone: "Europe/Warsaw" }));
const table = (rows: Parameters<typeof EvidenceTraceTable>[0]["rows"], fixtureLabels: Record<string, string> = {}) =>
  renderToStaticMarkup(createElement(EvidenceTraceTable, { rows, fixtureLabels, components, timeZone: "Europe/Warsaw" }));

const css = readFileSync(resolve(__dirname, "../../apps/web/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1]!.trim(), body: match[2]! }));
const bodiesOf = (selectorPart: RegExp) => rules.filter((rule) => selectorPart.test(rule.selector)).map((rule) => rule.body).join("\n");

describe("EvidenceTraceSection (card and empty state)", () => {
  it("renders a panel card whose first child is the unchanged heading", () => {
    const markup = section([fullRow]);
    expect(markup.startsWith('<section aria-labelledby="trace-heading" class="panel evidence-trace"><h2 id="trace-heading">Трассировка подходящих матчей</h2>')).toBe(true);
  });

  it("shows the unchanged sentence in a neutral well and neither strip nor table without matches", () => {
    const markup = section([]);
    expect(markup).toContain('Трассировка подходящих матчей</h2><p class="evidence-trace-empty">Нет матчей, подходящих под отсчёт по времени действия и времени захвата.</p>');
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("evidence-trace-scroll");
    expect(markup).not.toContain("evidence-trace-stats");
  });
});

describe("EvidenceTraceTable (region, columns, unknown cells)", () => {
  it("keeps the region role and label and becomes a focusable scroll container with a scoped table", () => {
    const markup = table([fullRow]);
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Подходящие матчи"');
    expect(markup).toMatch(/class="scroll-x evidence-trace-scroll"/);
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('<table class="evidence-trace-table">');
    expect(markup).toContain("Матчи, включённые в сборку исторических доказательств");
  });

  it("keeps the eight headers in the original order", () => {
    const headers = [...table([fullRow]).matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) => stripTags(match[1]!));
    expect(headers).toEqual(["Матч", "Место", "Исход", "Счёт", "Время действия", "Время наблюдения", "Источник", "Компоненты"]);
  });

  it("keeps the first cell label-only and the effective time in the fifth cell", () => {
    const labelled = table([fullRow], { "fx-201": "Арсенал против Челси" });
    const cells = [...labelled.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]!);
    expect(cells).toHaveLength(8);
    expect(stripTags(cells[0]!)).toBe("Арсенал против Челси");
    expect(cells[0]).toBe("Арсенал против Челси");
    expect(cells[4]).toContain('<time dateTime="2026-08-22T16:00:00.000Z" title="2026-08-22T16:00:00.000Z">22 августа 2026 г. в 18:00</time>');
    const bare = table([{ fixtureId: "past-1" }]);
    expect([...bare.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)][0]![1]).toBe("past-1");
  });

  it("renders every unknown cell as a muted Неизвестно, once per cell", () => {
    const markup = table([{ fixtureId: "fx-404" }]);
    expect((markup.match(/Неизвестно/g) ?? []).length).toBe(7);
    expect((markup.match(/<span class="evidence-trace-unknown">Неизвестно<\/span>/g) ?? []).length).toBe(7);
  });

  it("renders a label with markup characters escaped (T-rl4-01)", () => {
    const markup = section([fullRow], { "fx-201": "<script>alert(1)</script>" });
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).not.toContain("<script");
  });
});

describe("evidence-trace stylesheet contract", () => {
  const markup = section([fullRow, { fixtureId: "fx-404" }]) + table([fullRow]);
  const classes = [...new Set([...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1]!.split(/\s+/)).filter((token) => token.startsWith("evidence-trace")))];

  it("defines a selector for every evidence-trace class in the markup", () => {
    expect(classes.length).toBeGreaterThan(5);
    for (const token of classes) {
      expect(rules.some((rule) => new RegExp(`\\.${token}(?![\\w-])`).test(rule.selector)), `missing .${token}`).toBe(true);
    }
  });

  it("uses tokens only in every evidence-trace rule", () => {
    const evidenceRules = rules.filter((rule) => rule.selector.includes(".evidence-trace"));
    expect(evidenceRules.length).toBeGreaterThan(10);
    for (const rule of evidenceRules) {
      expect(rule.body, rule.selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule.body, rule.selector).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
    }
  });

  it("scrolls horizontally inside the region and gives the table a minimum width", () => {
    expect(bodiesOf(/^\.evidence-trace-scroll$/)).toMatch(/overflow-x:\s*auto/);
    expect(bodiesOf(/^\.evidence-trace-table$/)).toMatch(/min-width:/);
  });

  it("never targets bare table, th or td: every selector of the block starts with .evidence-trace", () => {
    for (const rule of rules.filter((candidate) => candidate.selector.includes(".evidence-trace"))) {
      for (const part of rule.selector.split(",")) expect(part.trim(), rule.selector).toMatch(/^\.evidence-trace/);
    }
  });

  it("covers the new surfaces in forced-colors mode", () => {
    for (const token of ["evidence-trace-scroll", "evidence-trace-empty"]) {
      expect(rules.some((rule) => new RegExp(`\\.${token}(?![\\w-])`).test(rule.selector) && /CanvasText/.test(rule.body)), token).toBe(true);
    }
  });
});
