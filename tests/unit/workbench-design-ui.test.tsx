import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ForecastWorkbench, type ValueResult } from "../../apps/web/app/fixtures/[fixtureId]/forecast-workbench.js";
import { ValueOutcomeSection } from "../../apps/web/app/fixtures/[fixtureId]/value-outcome-section.js";
import { snapshot } from "./forecast-comparison.test.js";

const result = (outcome: ValueResult["outcome"]): ValueResult => ({
  id: "receipt-1", fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-1",
  market: "ONE_X_TWO", selection: "HOME", outcome,
  reasons: ["CONFIDENCE_BELOW_THRESHOLD", "EDGE_BELOW_THRESHOLD"],
  modelProbability: "0.381", noVigProbability: "0.55", fairOdds: "2.62", edge: "-0.169", expectedValue: "-0.352",
  receipt: { modelVersion: "model-v1", cutoff: "2026-10-17T16:00:00.000Z", sources: [], evidenceBuildIds: [], assumptions: [], formulas: [], thresholds: {}, gates: [] },
  createdAt: "2026-10-17T16:00:01.000Z",
});
const renderOutcome = (outcome: ValueResult["outcome"]) =>
  renderToStaticMarkup(createElement(ValueOutcomeSection, { result: result(outcome), canonicalReceipt: "{}", copyMessage: "", copyReceipt: () => {} }));

describe("ValueOutcomeSection design markup", () => {
  it("renders the NO_VALUE verdict as a card of bordered rows with a neutral chip", () => {
    const markup = renderOutcome("NO_VALUE");
    expect(markup).toMatch(/<section aria-labelledby="outcome-heading" role="status" class="panel workbench-card outcome-card"|<section class="panel workbench-card outcome-card" aria-labelledby="outcome-heading" role="status"/);
    expect(markup).toContain('<h3 id="outcome-heading">Нет value-сигнала</h3>');
    expect(markup).toContain('<dl class="ev-rows">');
    const dts = [...markup.matchAll(/<dt>(Модельная вероятность|Вероятность без перекрытия|Преимущество|Ожидаемое value)<\/dt>/g)].map((match) => match[1]);
    expect(dts).toEqual(["Модельная вероятность", "Вероятность без перекрытия", "Преимущество", "Ожидаемое value"]);
    expect(markup).toContain('<div><dt>Модельная вероятность</dt><dd>38.1%</dd></div>');
    expect(markup).toContain('<div><dt>Ожидаемое value</dt><dd class="value-chip">-35.2%</dd></div>');
    expect(markup).not.toContain("value-chip--positive");
    expect(markup).toContain("<li>уверенность ниже порога</li>");
    expect(markup).toContain("<li>преимущество ниже порога</li>");
  });

  it("marks only the expected-value cell of a VALUE_CANDIDATE with the positive chip", () => {
    const markup = renderOutcome("VALUE_CANDIDATE");
    expect(markup).toContain('<dd class="value-chip value-chip--positive">-35.2%</dd>');
    expect(markup.match(/value-chip--positive/g)?.length).toBe(1);
  });

  it("uses the alert role and the neutral chip for INSUFFICIENT_EVIDENCE", () => {
    const markup = renderOutcome("INSUFFICIENT_EVIDENCE");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('<dd class="value-chip">');
    expect(markup).not.toContain("value-chip--positive");
  });

  it("styles the receipts disclosure and actions without touching the details text", () => {
    const markup = renderOutcome("NO_VALUE");
    expect(markup).toContain('<details class="well"><summary>Точная неизменяемая квитанция решения</summary>');
    expect(markup).toContain('<p class="cluster"><button type="button" class="btn-secondary">Скопировать JSON точной квитанции</button> <a class="link-touch" href=');
  });
});

describe("ForecastWorkbench two-card layout", () => {
  const forecasts = [snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2), snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4)];
  const markup = renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts: forecasts as never, timeZone: "UTC" }));

  it("keeps the odds and comparison sections as the only two children of one workbench-duo", () => {
    expect(markup.match(/<div class="workbench-duo">/g)?.length).toBe(1);
    const start = markup.indexOf('<div class="workbench-duo">') + '<div class="workbench-duo">'.length;
    // Inner markup of the wrapper: walk div depth until the wrapper closes.
    let depth = 1;
    let cursor = start;
    for (const tag of markup.slice(start).matchAll(/<(\/?)div(?![\w-])/g)) {
      depth += tag[1] ? -1 : 1;
      cursor = start + tag.index!;
      if (depth === 0) break;
    }
    const inner = markup.slice(start, cursor);
    // Top-level children: walk section depth and record the heading of each depth-0 section.
    const children: string[] = [];
    let sectionDepth = 0;
    for (const tag of inner.matchAll(/<(\/?)section(?![\w-])[^>]*>/g)) {
      if (tag[1]) { sectionDepth -= 1; continue; }
      if (sectionDepth === 0) children.push(/aria-labelledby="([^"]+)"/.exec(tag[0])![1]!);
      sectionDepth += 1;
    }
    expect(children).toEqual(["odds-heading", "comparison-heading"]);
    expect(inner.startsWith("<section")).toBe(true);
    expect(inner.endsWith("</section>")).toBe(true);
  });

  it("renders the four cards and the frozen forecast as a facts grid with four groups", () => {
    for (const heading of ["revision-comparison-heading", "forecast-heading", "odds-heading", "comparison-heading"]) {
      expect(markup).toMatch(new RegExp(`<section[^>]*class="panel workbench-card"[^>]*aria-labelledby="${heading}"|<section[^>]*aria-labelledby="${heading}"[^>]*class="panel workbench-card"`));
    }
    const facts = markup.match(/<dl class="facts-grid">([\s\S]*?)<\/dl>/);
    expect(facts).not.toBeNull();
    expect(facts![1]!.match(/<div><dt>/g)?.length).toBe(4);
    for (const label of ["Вид снимка", "Отсечка", "Модель", "Хвост вне 0–7 голов"]) expect(facts![1]).toContain(`<dt>${label}</dt>`);
  });

  it("keeps every input id with its original label pairing", () => {
    for (const id of ["source-label", "market", "forecast-snapshot", "odds-snapshot", "left-snapshot", "right-snapshot", "odds-HOME", "odds-DRAW", "odds-AWAY"]) {
      expect(markup, `label for ${id}`).toContain(`for="${id}"`);
      expect(markup, `control ${id}`).toMatch(new RegExp(`<(input|select)[^>]*id="${id}"`));
    }
    expect(markup).toContain('<p class="field field--odds"><label for="odds-HOME">');
    expect(markup).toContain('<p class="field"><label for="source-label">');
  });

  it("keeps the comparison heading and the forecast id paragraph as direct siblings", () => {
    const start = markup.indexOf('<h3 id="comparison-heading">');
    const end = markup.indexOf("Идентификатор снимка прогноза");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(markup.slice(start, end)).not.toContain("<div");
  });

  it("keeps the swap button name, the receipts class and the responsible-use sentence", () => {
    expect(markup).toContain('class="btn-secondary">Поменять снимки местами</button>');
    expect(markup).toContain("Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.");
    expect(markup).toContain('<details class="well"><summary>Доказательства, модель и ограничения</summary>');
    expect(markup).toContain('<details class="well"><summary>Компоненты уверенности');
    expect(markup).toContain('class="status-line"');
  });
});

describe("workbench stylesheet contract", () => {
  const raw = readFileSync(resolve(import.meta.dirname, "../../apps/web/app/globals.css"), "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const forecasts = [snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2), snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4)];
  const markup = renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts: forecasts as never, timeZone: "UTC" })) + renderOutcome("VALUE_CANDIDATE");

  it("has a selector for every workbench-, outcome-, ev-, value-, field--, note-strip and status-line class emitted", () => {
    const classes = new Set<string>();
    for (const match of markup.matchAll(/class="([^"]*)"/g)) {
      for (const token of match[1]!.split(/\s+/)) if (/^(workbench-|outcome-|ev-|value-|field|note-strip|status-line)/.test(token)) classes.add(token);
    }
    expect(classes.size).toBeGreaterThan(5);
    for (const token of classes) expect(css, `missing .${token}`).toMatch(new RegExp(`\\.${token}(?![\\w-])`));
  });

  it("uses only design tokens for colour in the workbench rules", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => /\.(workbench-|outcome-|ev-rows|value-chip|field|note-strip|status-line)/.test(selector!));
    expect(rules.length).toBeGreaterThan(12);
    for (const [, selector, body] of rules) {
      expect(body, selector!.trim()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, selector!.trim()).not.toMatch(/rgba?\(/);
    }
  });

  it("stacks the duo to one column on narrow viewports and keeps odds inputs tall", () => {
    const duo = css.match(/\.workbench-duo\s*\{[^}]*\}/);
    expect(duo).not.toBeNull();
    expect(duo![0]).toMatch(/minmax\(min\(100%,/);
    const input = css.match(/\.field--odds input\s*\{[^}]*\}/);
    expect(input).not.toBeNull();
    expect(input![0]).toMatch(/min-height:\s*52px/);
  });

  it("replaces the arrow glyph with a chevron summary rule", () => {
    expect(css).not.toMatch(/summary::before/);
    expect(css).not.toMatch(/content:\s*"[▸▾]"/);
    expect(css).toMatch(/summary::after\s*\{[^}]*rotate\(45deg\)/);
    expect(css).toMatch(/details\[open\] > summary::after\s*\{[^}]*rotate\(-135deg\)/);
  });
});
