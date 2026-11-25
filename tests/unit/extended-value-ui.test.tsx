import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { buildExtendedMarketsView, buildScoreMatrix, type ExtendedMarketsView, type ScoreMatrixCell } from "../../packages/domain/src/index.js";
import { ForecastWorkbench, type OddsSnapshot, type ValueResult } from "../../apps/web/app/fixtures/[fixtureId]/forecast-workbench.js";
import { ValueOutcomeSection } from "../../apps/web/app/fixtures/[fixtureId]/value-outcome-section.js";
import { snapshot } from "./forecast-comparison.test.js";

const cells: readonly ScoreMatrixCell[] = buildScoreMatrix({ expectedGoals: { home: 1.4, away: 1.2 } }).scoreMatrix.map((cell) => [cell.homeGoals, cell.awayGoals, cell.probability] as const);
const available: ExtendedMarketsView = buildExtendedMarketsView({ cells, source: "PERSISTED", tail: { retainedMass: 0.99998, tailMass: 0.00002, warning: false } });
const unavailable: ExtendedMarketsView = { version: "extended-markets-view-v1", state: "UNAVAILABLE", reason: "SCORE_MATRIX_UNAVAILABLE" };

const forecasts = [snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2), snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4)] as never;
const ahBook: OddsSnapshot = { oddsSnapshotId: "odds-ah", fixtureId: "fixture-1", market: "ASIAN_HANDICAP:-0.75", sourceLabel: "Book", capturedAt: "2026-09-06T03:00:00.000Z", schemaVersion: "manual-odds-v1", normalizationVersion: "n1", overround: "0.0256", selections: [{ selection: "HOME", decimalOdds: "1.95", impliedProbability: "0.5128", noVigProbability: "0.5" }, { selection: "AWAY", decimalOdds: "1.95", impliedProbability: "0.5128", noVigProbability: "0.5" }] };
const exactSelections = ["0-0", "0-1", "0-2", "0-3", "1-0", "1-1", "1-2", "1-3", "2-0", "2-1", "2-2", "2-3", "3-0", "3-1", "3-2", "3-3", "OTHER"];
const exactBook: OddsSnapshot = { ...ahBook, oddsSnapshotId: "odds-ex", market: "EXACT_SCORE", selections: exactSelections.map((selection) => ({ selection, decimalOdds: "12.5", impliedProbability: "0.08", noVigProbability: "0.0625" })) };

const renderWorkbench = (slot: ExtendedMarketsView, initialState: Parameters<typeof ForecastWorkbench>[0]["initialState"]) => {
  const markup = renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts, timeZone: "UTC", extendedMarkets: { left: slot, right: slot }, initialState: { forecastId: "left", ...initialState } }));
  return markup.slice(markup.indexOf('aria-labelledby="comparison-heading"'));
};

describe("comparison of extended markets (D-20)", () => {
  const ahState = { family: "ASIAN_HANDICAP" as const, ahLine: "-0.75", oddsSnapshots: [ahBook], oddsId: "odds-ah" };

  it("builds the Asian handicap table from the view with the approximate no-vig wording", () => {
    const section = renderWorkbench(available, ahState);
    for (const column of ["Выбор", "Эффективная вероятность выигрыша", "Возврат ставки", "Справедливый коэффициент", "Коэффициент букмекера", "Подразумеваемая", "Без вига (приближённо)"]) expect(section).toContain(`>${column}</th>`);
    expect(section).toContain("Хозяева −0.75");
    expect(section).toContain("Гости +0.75");
    expect(section).toContain("Перекрытие (приближённо): 2.6%");
    expect(section).toContain("Для азиатского гандикапа вероятности без вига считаются пропорциональным приближением и не учитывают возврат ставки. Они нужны только для оценки маржи букмекера; ожидаемое value их не использует.");
    expect(section).toMatch(/<button type="button"(?![^>]*disabled)[^>]*>Сравнить точные снимки<\/button>/);
    expect(section).not.toContain("Сравнение недоступно");
    expect(section).toContain("Выбор для оценки");
    expect(section).toContain("<option value=\"HOME\" selected=\"\">Хозяева −0.75</option>");
    expect(section).toContain("<option value=\"AWAY\">Гости +0.75</option>");
  });

  it("builds 17 exact score rows with the unchanged six columns", () => {
    const section = renderWorkbench(available, { family: "EXACT_SCORE", oddsSnapshots: [exactBook], oddsId: "odds-ex" });
    const desktop = section.slice(section.indexOf("<table"), section.indexOf("</table>"));
    expect(desktop.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr>/g)).toHaveLength(17);
    for (const column of ["Выбор", "Модельная вероятность", "Справедливый коэффициент", "Коэффициент букмекера", "Подразумеваемая", "Без вига"]) expect(desktop).toContain(`>${column}</th>`);
    expect(desktop).not.toContain("Возврат ставки");
    expect(section).not.toContain("пропорциональным приближением");
    expect(section).toContain("Счёт 2:1");
    expect(section).toContain("Любой другой счёт");
  });

  it.each([["unavailable view", unavailable], ["unrecognised view", { version: "extended-markets-view-v1", state: "AVAILABLE" } as never]])("replaces the table and disables the compare button for an %s", (_name, slot) => {
    const section = renderWorkbench(slot, ahState);
    expect(section).not.toContain("<table");
    expect(section).toMatch(/Для этого прогноза расширенные рынки недоступны: матрица счёта не была сохранена\.|Расширенные рынки для этого прогноза недоступны\./);
    expect(section).toMatch(/<button type="button" [^>]*disabled=""[^>]*>Сравнить точные снимки<\/button>/);
    expect(section).toContain("Сравнение недоступно: для этого прогноза расширенные рынки недоступны. Выберите другой снимок прогноза.");
    expect(section).toContain('aria-describedby="compare-blocked"');
    const exact = renderWorkbench(slot, { family: "EXACT_SCORE", oddsSnapshots: [exactBook], oddsId: "odds-ex" });
    expect(exact).not.toContain("<table");
    expect(exact).toContain("Сравнение недоступно");
  });

  it("keeps the core markets comparison and button unchanged without an extended view", () => {
    const section = renderWorkbench(unavailable, {});
    expect(section).not.toContain("Сравнение недоступно");
    expect(section).toMatch(/<button type="button" [^>]*disabled=""[^>]*>Сравнить точные снимки<\/button>/);
  });
});

const evOutcomes = [
  { result: "WIN", probability: "0.3", returnPerUnit: "0.95", contribution: "0.285" },
  { result: "HALF_WIN", probability: "0.1", returnPerUnit: "0.475", contribution: "0.0475" },
  { result: "PUSH", probability: "0.2", returnPerUnit: "0", contribution: "0" },
  { result: "HALF_LOSS", probability: "0.1", returnPerUnit: "-0.5", contribution: "-0.05" },
  { result: "LOSS", probability: "0.3", returnPerUnit: "-1", contribution: "-0.3" },
];
const ahResult = (receiptExtras: Record<string, unknown>, outcome: ValueResult["outcome"] = "VALUE_CANDIDATE"): ValueResult => ({
  id: "receipt-ah", fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-ah",
  market: "ASIAN_HANDICAP:-0.75", selection: "HOME", outcome, reasons: [],
  modelProbability: "0.35", noVigProbability: "0.5", fairOdds: "2.1", edge: "0.04", expectedValue: "-0.0175",
  receipt: { modelVersion: "model-v1", valuePolicyVersion: "value-policy-v1", cutoff: "2026-10-17T16:00:00.000Z", sources: [], evidenceBuildIds: [], assumptions: [], formulas: [], thresholds: {}, gates: [], ...receiptExtras },
  createdAt: "2026-10-17T16:00:01.000Z",
});
const withBreakdown = { extended: { kind: "ASIAN_HANDICAP", evPolicyVersion: "push-aware-ev-v1", evOutcomes } };
const renderValue = (result: ValueResult) => renderToStaticMarkup(createElement(ValueOutcomeSection, { result, canonicalReceipt: JSON.stringify(result.receipt), copyMessage: "", copyReceipt: () => {} }));
const visible = (markup: string) => markup.replace(/<details[\s\S]*?<\/details>/g, "");

describe("value outcome of an Asian handicap result (D-13, D-20)", () => {
  const markup = renderValue(ahResult(withBreakdown));

  it("relabels the evidence rows and keeps the positive chip", () => {
    const dts = [...markup.matchAll(/<dt>(Эффективная вероятность выигрыша|Вероятность без вига \(приближённо\)|Преимущество|Ожидаемое value)<\/dt>/g)].map((match) => match[1]);
    expect(dts).toEqual(["Эффективная вероятность выигрыша", "Вероятность без вига (приближённо)", "Преимущество", "Ожидаемое value"]);
    expect(markup).toContain('<dd class="value-chip value-chip--positive">-1.8%</dd>');
    expect(markup).not.toContain("Модельная вероятность");
    expect(markup).toContain("Рынок: Азиатский гандикап −0.75 · выбор: Хозяева −0.75");
  });

  it("renders the five-way breakdown in the fixed order with the recorded values and the receipt total", () => {
    expect(markup).toContain("<h4>Разбор ожидаемого value по пяти исходам</h4>");
    expect(markup).toContain("<caption>Ожидаемое value на 1 единицу ставки · политика push-aware-ev-v1</caption>");
    expect(markup).toContain('<table class="market-table">');
    const labels = [...markup.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][0]![1]!.match(/<th scope="row">([^<]+)<\/th>/g)!.map((cell) => cell.replace(/<[^>]+>/g, ""));
    expect(labels).toEqual(["Выигрыш", "Выигрыш половины ставки", "Возврат ставки", "Проигрыш половины ставки", "Проигрыш"]);
    expect(markup).toContain("<th scope=\"row\" colSpan=\"3\">Итого — ожидаемое value</th><td>−1.75%</td>".replace(' colSpan="3"', ' colSpan="3"'));
    expect(markup).toContain("Значения округлены; итог рассчитан по точным числам.");
  });

  it("signs the values: U+2212 for negatives, plus for positives, a bare zero", () => {
    expect(markup).toContain("<td>+0.950</td>");
    expect(markup).toContain("<td>+0.475</td>");
    expect(markup).toContain("<td>0.000</td>");
    expect(markup).toContain("<td>−0.500</td>");
    expect(markup).toContain("<td>−1.000</td>");
    expect(markup).toContain("<td>+28.50%</td>");
    expect(markup).toContain("<td>−30.00%</td>");
  });

  it("keeps the push sentence visible outside any details", () => {
    const sentence = "При азиатском гандикапе ставка может быть возвращена (пуш), а на четвертных линиях она делится пополам, поэтому исходом может быть выигрыш или проигрыш половины ставки.";
    expect(visible(markup)).toContain(sentence);
    expect(markup.indexOf(sentence)).toBeLessThan(markup.indexOf("<details"));
    expect(markup.indexOf(sentence)).toBeGreaterThan(markup.indexOf("</table>"));
  });

  it("shows the EV policy label as its own receipt row", () => {
    const receipt = markup.slice(markup.indexOf("<details"));
    expect(receipt).toContain("<div><dt>Политика ожидаемого value</dt><dd>push-aware-ev-v1</dd></div>");
  });

  it.each([
    ["no extended block", {}],
    ["no outcomes", { extended: { kind: "ASIAN_HANDICAP", evPolicyVersion: "push-aware-ev-v1" } }],
    ["no policy label", { extended: { kind: "ASIAN_HANDICAP", evOutcomes } }],
    ["a malformed outcome", { extended: { kind: "ASIAN_HANDICAP", evPolicyVersion: "push-aware-ev-v1", evOutcomes: evOutcomes.map((row, index) => (index === 2 ? { ...row, probability: "oops" } : row)) } }],
  ])("falls back to the notice and invents nothing for a receipt with %s", (_name, extras) => {
    const fallback = renderValue(ahResult(extras));
    expect(fallback).toContain('<p class="note-strip">Разбор по пяти исходам недоступен для этой квитанции.</p>');
    expect(fallback).not.toContain("<table");
    expect(fallback).not.toContain("Итого — ожидаемое value");
    expect(fallback).not.toContain("Политика ожидаемого value");
    expect(fallback).toContain('<dd class="value-chip value-chip--positive">-1.8%</dd>');
    expect(fallback).toContain("При азиатском гандикапе ставка может быть возвращена (пуш)");
  });

  it("keeps the exact score layout with market-aware selection labels and no breakdown table", () => {
    const exact: ValueResult = { ...ahResult({}), market: "EXACT_SCORE", selection: "2-1" };
    const exactMarkup = renderValue(exact);
    expect(exactMarkup).toContain("Рынок: Точный счёт · выбор: Счёт 2:1");
    expect(exactMarkup).toContain("<dt>Модельная вероятность</dt>");
    expect(exactMarkup).not.toContain("<table");
    expect(exactMarkup).not.toContain("При азиатском гандикапе");
  });

  it("shows no raw codes or prohibited wording in the visible text", () => {
    const text = visible(markup);
    for (const raw of ["HALF_WIN", "HALF_LOSS", "ASIAN_HANDICAP", "EXACT_SCORE", "WIN", "LOSS", "PUSH"]) expect(text).not.toContain(raw);
    expect(text).not.toMatch(/гарантир|верняк|беспроигрыш|выигрышная ставка|(?<![\p{L}])уверенно(?![\p{L}])|прибыль/iu);
  });
});
