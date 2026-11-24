import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { EvidenceProjectionDto, EvidenceSourceRef } from "../../packages/domain/src/index.js";

import { EvidenceTraceSection, EvidenceTraceTable, traceOutcomeCounts } from "../../apps/web/app/teams/[teamId]/evidence/page.js";

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

const mixedRows = [
  { ...fullRow, fixtureId: "fx-1", outcome: "WIN" as const },
  { ...fullRow, fixtureId: "fx-2", outcome: "WIN" as const },
  { ...fullRow, fixtureId: "fx-3", outcome: "DRAW" as const },
  { ...fullRow, fixtureId: "fx-4", outcome: "LOSS" as const },
  { fixtureId: "fx-5" },
];

describe("traceOutcomeCounts", () => {
  it("counts rows per outcome; rows without outcome count only toward total", () => {
    expect(traceOutcomeCounts(mixedRows)).toEqual({ total: 5, win: 2, draw: 1, loss: 1 });
    expect(traceOutcomeCounts([])).toEqual({ total: 0, win: 0, draw: 0, loss: 0 });
    expect(traceOutcomeCounts([{ fixtureId: "a" }, { fixtureId: "b", outcome: null }])).toEqual({ total: 2, win: 0, draw: 0, loss: 0 });
  });
});

describe("outcome chips", () => {
  const chip = (outcome: "WIN" | "DRAW" | "LOSS", word: string, tone: string) => {
    const markup = table([{ ...fullRow, outcome }]);
    expect(markup).toContain(`<span class="state-chip state-chip--md ${tone}"><span class="state-dot" aria-hidden="true"></span>${word}</span>`);
  };

  it("renders win, draw and loss as state chips with existing tones", () => {
    chip("WIN", "победа", "tone-positive");
    chip("DRAW", "ничья", "tone-neutral");
    chip("LOSS", "поражение", "tone-danger");
  });

  it("keeps venue and score as plain text and renders no chip for an unknown outcome", () => {
    const markup = table([{ fixtureId: "fx-404", venue: "HOME", score: { home: 2, away: 1 } }]);
    expect(markup).not.toContain("state-chip");
    const cells = [...markup.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]!);
    expect(cells[1]).toBe("дома");
    expect(cells[2]).toBe('<span class="evidence-trace-unknown">Неизвестно</span>');
    expect(cells[3]).toBe("2:1");
  });

  it("keeps the first cell label-only with chips present", () => {
    const markup = table([fullRow], { "fx-201": "Арсенал против Челси" });
    expect([...markup.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)][0]![1]).toBe("Арсенал против Челси");
  });
});

describe("summary strip", () => {
  it("renders a stats list before the table region with total and non-zero outcome tiles", () => {
    const markup = section(mixedRows);
    const stats = markup.indexOf('<dl class="evidence-trace-stats">');
    expect(stats).toBeGreaterThan(-1);
    expect(stats).toBeLessThan(markup.indexOf('role="region"'));
    const strip = markup.slice(stats, markup.indexOf("</dl>", stats));
    expect(strip).toContain('<div class="evidence-trace-stat"><dt>Подходящих матчей</dt><dd>5</dd></div>');
    expect(strip).toContain('<div class="evidence-trace-stat tone-positive"><dt><span class="state-dot" aria-hidden="true"></span>Победы</dt><dd>2</dd></div>');
    expect(strip).toContain('<div class="evidence-trace-stat tone-neutral"><dt><span class="state-dot" aria-hidden="true"></span>Ничьи</dt><dd>1</dd></div>');
    expect(strip).toContain('<div class="evidence-trace-stat tone-danger"><dt><span class="state-dot" aria-hidden="true"></span>Поражения</dt><dd>1</dd></div>');
    expect(strip.indexOf("Победы")).toBeLessThan(strip.indexOf("Ничьи"));
    expect(strip.indexOf("Ничьи")).toBeLessThan(strip.indexOf("Поражения"));
  });

  it("never renders a zero-count tile or a standalone 0", () => {
    const markup = section([{ fixtureId: "fx-1" }, { fixtureId: "fx-2", outcome: "WIN" }]);
    expect(markup).toContain("Победы");
    expect(markup).not.toContain("Ничьи");
    expect(markup).not.toContain("Поражения");
    expect((markup.match(/evidence-trace-stat"|evidence-trace-stat /g) ?? []).length).toBe(2);
    const noOutcome = section([{ fixtureId: "fx-1" }]);
    expect((noOutcome.match(/<div class="evidence-trace-stat/g) ?? []).length).toBe(1);
    expect(noOutcome).not.toMatch(/>0</);
  });

  it("never renders the strip when empty or inside the table component", () => {
    expect(section([])).not.toContain("evidence-trace-stat");
    expect(table(mixedRows)).not.toContain("evidence-trace-stat");
  });
});

describe("evidence-trace stylesheet contract (tiles and chips)", () => {
  it("defines selectors for the strip, keeps them token-only and scoped, and covers the tile in forced-colors", () => {
    for (const token of ["evidence-trace-stats", "evidence-trace-stat"]) {
      expect(rules.some((rule) => new RegExp(`\\.${token}(?![\\w-])`).test(rule.selector)), `missing .${token}`).toBe(true);
    }
    for (const rule of rules.filter((candidate) => candidate.selector.includes(".evidence-trace-stat"))) {
      expect(rule.body, rule.selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(rule.body, rule.selector).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
    }
    expect(bodiesOf(/^\.evidence-trace-table \.state-chip$/)).toMatch(/white-space:\s*nowrap/);
    expect(rules.some((rule) => /\.evidence-trace-stat(?![\w-])/.test(rule.selector) && /CanvasText/.test(rule.body))).toBe(true);
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
