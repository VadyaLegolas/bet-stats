import { buildExtendedMarketsView, buildScoreMatrix, unavailableExtendedMarketsView, type ExtendedMarketsView, type ScoreMatrixCell } from "@bet-stats/domain";
import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ForecastWorkbench } from "../../apps/web/app/fixtures/[fixtureId]/forecast-workbench.js";
import { loadExtendedMarkets } from "../../apps/web/app/fixtures/[fixtureId]/extended-markets-loader.js";
import { ExtendedMarketsSections } from "../../apps/web/app/fixtures/[fixtureId]/extended-markets-sections.js";
import type { ExtendedMarketsSlot } from "../../apps/web/app/fixtures/[fixtureId]/extended-markets-model.js";
import { selectionLabelFor } from "../../apps/web/components/enum-labels.js";
import { snapshot } from "./forecast-comparison.test.js";

function gridCells(home: number, away: number): readonly ScoreMatrixCell[] {
  return buildScoreMatrix({ expectedGoals: { home, away } }).scoreMatrix.map((cell) => [cell.homeGoals, cell.awayGoals, cell.probability] as const);
}

function availableView(tail = { retainedMass: 0.99998, tailMass: 0.00002, warning: false }, source: "PERSISTED" | "REDERIVED" = "PERSISTED"): Extract<ExtendedMarketsView, { state: "AVAILABLE" }> {
  const view = buildExtendedMarketsView({ cells: gridCells(2.1, 0.9), source, tail });
  if (view.state !== "AVAILABLE") throw new Error("expected AVAILABLE");
  return view;
}

const render = (slot: ExtendedMarketsSlot | unknown, props: { initialSide?: "HOME" | "AWAY"; initialExpanded?: boolean } = {}) =>
  renderToStaticMarkup(createElement(ExtendedMarketsSections, { slot: slot as ExtendedMarketsSlot, ...props }));
const visibleText = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const between = (markup: string, from: string, to: string) => {
  const start = markup.indexOf(from);
  const end = markup.indexOf(to, start);
  return start === -1 || end === -1 ? "" : markup.slice(start, end);
};

const view = availableView();
const main = view.asianHandicap.mainLine;
const homeLabel = selectionLabelFor(`ASIAN_HANDICAP:${main}`, "HOME");
const awayLabel = selectionLabelFor(`ASIAN_HANDICAP:${main}`, "AWAY");
const AH_ROWS = /<th scope="row" data-evidence-field="line"/g;

describe("populated: Asian handicap section", () => {
  const markup = render(view);

  it("renders five rows by default and 21 when expanded, with exactly one current row", () => {
    expect(count(markup, AH_ROWS)).toBe(5);
    expect(count(render(view, { initialExpanded: true }), AH_ROWS)).toBe(21);
    expect(count(markup, /<tr[^>]*aria-current="true"/g)).toBe(1);
    expect(count(render(view, { initialExpanded: true }), /<tr[^>]*aria-current="true"/g)).toBe(1);
    expect(count(markup, /<article[^>]*aria-current="true"/g)).toBe(1);
  });

  it("marks the current row with the visible chip text, not colour alone", () => {
    const currentRow = /<tr[^>]*aria-current="true"[^>]*>[\s\S]*?<\/tr>/.exec(markup)?.[0] ?? "";
    expect(visibleText(currentRow)).toContain("Главная линия");
    expect(currentRow).toContain(homeLabel);
  });

  it("renders both headings as labelled sections that are siblings with deep-link ids", () => {
    expect(markup).toContain('<section id="asian-handicap" aria-labelledby="asian-handicap-heading" class="panel workbench-card">');
    expect(markup).toContain('<section id="exact-score" aria-labelledby="exact-score-heading" class="panel workbench-card">');
    expect(markup).toContain('<h3 id="asian-handicap-heading">Азиатский гандикап</h3>');
    expect(markup).toContain('<h3 id="exact-score-heading">Точный счёт</h3>');
    expect(markup.indexOf('id="asian-handicap"')).toBeLessThan(markup.indexOf('id="exact-score"'));
    expect(between(markup, 'id="asian-handicap"', 'id="exact-score"')).not.toContain('id="exact-score"');
  });

  it("shows the five outcome columns, the effective probability and fair odds headers", () => {
    const headers = [...between(markup, "<thead>", "</thead>").matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((match) => match[1]);
    expect(headers.slice(0, 8)).toEqual(["Линия", "Выигрыш", "Выигрыш половины ставки", "Возврат ставки", "Проигрыш половины ставки", "Проигрыш", "Эффективная вероятность выигрыша", "Справедливый коэффициент"]);
  });

  it("wires the toolbar: a named side group with aria-pressed and an expander with aria-expanded and aria-controls", () => {
    expect(markup).toContain('role="group" aria-label="Сторона гандикапа"');
    expect(markup).toMatch(/<button type="button" class="filter-chip" aria-pressed="true">Хозяева<\/button>/);
    expect(markup).toMatch(/<button type="button" class="filter-chip" aria-pressed="false">Гости<\/button>/);
    expect(markup).toMatch(/<button type="button" class="btn-secondary btn-compact" aria-expanded="false" aria-controls="ah-lines">Показать все 21 линию<\/button>/);
    expect(markup).toContain('id="ah-lines"');
    expect(markup).toContain("Показаны 5 линий из 21 вокруг главной.");
    const expanded = render(view, { initialExpanded: true });
    expect(expanded).toMatch(/aria-expanded="true" aria-controls="ah-lines">Показать только 5 линий вокруг главной<\/button>/);
    expect(expanded).toContain("Показаны все 21 линия.");
    expect(expanded).toContain('<p class="sr-only" role="status">Показаны все 21 линия;');
  });

  it("shows provenance, rules, the three summary tiles and the legend", () => {
    expect(visibleText(markup)).toContain("Матрица счёта: сохранена при выпуске прогноза. Правила: ah-lines-v1");
    expect(visibleText(render(availableView(undefined, "REDERIVED")))).toContain("воспроизведена по сохранённым параметрам и сверена с рынками прогноза");
    const tiles = between(markup, '<dl class="market-summary">', "</dl>");
    expect(tiles).toContain(`<dt>Главная линия</dt><dd>${homeLabel} / ${awayLabel}</dd>`);
    expect(tiles).toContain("<dt>Справедливый коэффициент на хозяев</dt>");
    expect(tiles).toContain("<dt>Справедливый коэффициент на гостей</dt>");
    expect(visibleText(markup)).toContain("Прочерк — такого исхода на этой линии не бывает. Проценты округлены: сумма может отличаться от 100%.");
    expect(markup).toContain("<summary>Как читать таблицу</summary>");
    expect(markup).toContain("<code>ah-settlement-v1</code>");
  });

  it("labels the view as uncalibrated and carries the extendedMarkets warning", () => {
    expect(markup).toContain("Без калибровки");
    expect(markup).toContain('data-methodology-context="extendedMarkets"');
    expect(markup).toContain("Вероятности азиатского гандикапа и точного счёта — оценки модели без калибровки, а не гарантии.");
    expect(markup).toContain('href="/methodology#extended-markets"');
  });
});

describe("side toggle", () => {
  it("shows the away side's own lines with the home line as a sub-line, and keeps the same main-line row", () => {
    const home = render(view);
    const away = render(view, { initialSide: "AWAY" });
    expect(visibleText(away)).toContain(`${awayLabel}`);
    expect(away).toContain(`(${homeLabel})`);
    expect(home).not.toContain(`(${homeLabel})`);
    expect(away).toMatch(/<button type="button" class="filter-chip" aria-pressed="true">Гости<\/button>/);
    const currentRow = /<tr[^>]*aria-current="true"[^>]*>[\s\S]*?<\/tr>/.exec(away)?.[0] ?? "";
    expect(currentRow).toContain(awayLabel);
    expect(count(away, AH_ROWS)).toBe(5);
  });
});

describe("populated: exact score section", () => {
  const markup = render(view);
  const exact = markup.slice(markup.indexOf('id="exact-score"'));

  it("renders 16 cells plus the OTHER cell, each with a probability and fair odds as text", () => {
    expect(count(exact, /<td/g)).toBe(17);
    expect(count(exact, /<span class="market-cell-p">/g)).toBe(17);
    expect(count(exact, /<span class="market-cell-o">/g)).toBe(17);
    expect(count(exact, /<span aria-hidden="true">коэф\. <\/span>\d+\.\d{2}/g) + count(exact, /Недоступно/g)).toBe(17);
  });

  it("has a two-level header with colspan 4 and four column headers, a labelled scroll region and the OTHER row", () => {
    expect(exact).toMatch(/<th rowSpan="2" scope="col">Голы хозяев<\/th>|<th rowspan="2" scope="col">Голы хозяев<\/th>/i);
    expect(exact).toMatch(/colspan="4" scope="colgroup">Голы гостей/i);
    const secondHeader = between(exact, "</tr><tr>", "</thead>");
    expect(count(secondHeader, /<th scope="col">/g)).toBe(4);
    expect(exact).toContain('role="region" aria-label="Точный счёт — таблица вероятностей" tabindex="0"');
    expect(between(exact, "<tfoot>", "</tfoot>")).toContain("Любой другой счёт");
    expect(exact).toContain("Счёт 2:1. ");
    expect(exact).toContain("Справедливый коэффициент: ");
  });

  it("keeps the markup the grid layout rules select: scroll-region classes, caption first, corner and colgroup headers, tfoot row label", () => {
    expect(exact).toMatch(/<div class="evidence-table-scroll market-grid-scroll" role="region"/);
    const table = between(exact, '<table class="market-table market-grid">', "</table>");
    expect(table).toMatch(/^<table class="market-table market-grid"><caption>[^<]+<\/caption><thead>/);
    const head = between(table, "<thead>", "</thead>");
    expect(head).toMatch(/^<thead><tr><th rowspan="2" scope="col">Голы хозяев<\/th><th colspan="4" scope="colgroup">Голы гостей<\/th><\/tr>/i);
    expect(between(table, "<tfoot>", "</tfoot>")).toMatch(/^<tfoot><tr><th scope="row">Любой другой счёт<\/th><td colspan="4">/i);
  });

  it("uses the corrected tail wording and shows the elevated-tail chip only when the warning is set", () => {
    expect(visibleText(exact)).toContain("Хвост матрицы вне 0–7 голов: 0.0% — уже учтён нормировкой на сохранённую массу и распределён по всем счетам.");
    expect(exact).not.toContain("Хвост повышен");
    expect(visibleText(exact)).not.toContain("входит в строку");
    const elevated = render(availableView({ retainedMass: 0.97, tailMass: 0.03, warning: true }));
    expect(elevated).toContain("Хвост повышен");
    expect(visibleText(elevated)).toContain("Хвост матрицы вне 0–7 голов: 3.0%");
  });

  it("carries the deck and the uncalibrated note", () => {
    expect(visibleText(exact)).toContain("Вероятности 16 явных счетов от 0:0 до 3:3 и всех остальных исходов вместе. Семнадцать вероятностей в сумме дают 100%.");
    expect(exact).toContain('<p class="note-strip">Вероятности точного счёта — оценки модели без калибровки, а не гарантии.</p>');
  });
});

describe("empty: legacy snapshot", () => {
  const markup = render(unavailableExtendedMarketsView());
  const SENTENCE = "Для этого прогноза расширенные рынки недоступны: матрица счёта не была сохранена.";

  it("keeps both headings and shows the neutral D-19 notice in each section without a table or a retry control", () => {
    expect(markup).toContain('<h3 id="asian-handicap-heading">Азиатский гандикап</h3>');
    expect(markup).toContain('<h3 id="exact-score-heading">Точный счёт</h3>');
    expect(count(markup, new RegExp(SENTENCE, "g"))).toBe(2);
    expect(count(markup, /class="state-notice tone-neutral" role="status" data-extended-state="UNAVAILABLE"/g)).toBe(2);
    expect(count(markup, /Недоступно<\/span>/g)).toBe(2);
    expect(count(visibleText(markup), /Три основных рынка этого прогноза \(1X2, тотал 2\.5, обе забьют\) не затронуты\./g)).toBe(2);
    expect(count(markup, /href="\/methodology#extended-markets">Почему так — в методологии/g)).toBe(2);
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("role=\"alert\"");
    expect(markup).not.toContain("Повторить");
    expect(markup).not.toContain("aria-current");
  });
});

describe("error: fail-closed classification", () => {
  const GENERIC = "Расширенные рынки для этого прогноза недоступны.";

  it("closes an unknown reason code to the generic notice and never draws the AVAILABLE layout", () => {
    const markup = render({ version: "extended-markets-view-v1", state: "UNAVAILABLE", reason: "SOMETHING_NEW" });
    expect(count(markup, new RegExp(GENERIC.replaceAll(".", "\\."), "g"))).toBe(2);
    expect(markup).not.toContain("матрица счёта не была сохранена");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("SOMETHING_NEW");
  });

  it("closes an unrecognised view shape to the generic notice", () => {
    const corrupted = JSON.parse(JSON.stringify(view));
    corrupted.asianHandicap.lines.pop();
    for (const value of [corrupted, { state: "AVAILABLE" }, null, "AVAILABLE", { state: "UNAVAILABLE", reason: "UNRECOGNISED" }]) {
      const markup = render(value);
      expect(markup).toContain(GENERIC);
      expect(markup).not.toContain("<table");
      expect(markup).not.toContain("aria-current");
    }
  });

  it("shows a read failure as an alert with a refresh link, distinct from the legacy notice", () => {
    const markup = render({ state: "READ_FAILED" });
    expect(count(markup, /role="alert"/g)).toBe(2);
    expect(count(markup, /Не удалось загрузить расширенные рынки\. Остальные данные страницы не изменились\. Повторите попытку\./g)).toBe(2);
    expect(count(markup, /Обновить страницу<\/a>/g)).toBe(2);
    expect(markup).toContain('<h3 id="asian-handicap-heading">Азиатский гандикап</h3>');
    expect(markup).not.toContain("Недоступно");
    expect(markup).not.toContain("<table");
  });
});

describe("copy: no raw codes and no prohibited wording in visible text", () => {
  const RAW_CODES = /HALF_WIN|HALF_LOSS|SCORE_MATRIX_UNAVAILABLE|ASIAN_HANDICAP|EXACT_SCORE|NO_WIN_PROBABILITY|ZERO_PROBABILITY|PERSISTED|REDERIVED/;
  const PROHIBITED = /верняк|беспроигрыш|выигрышная ставка|уверенно|гарантированн|без риска|ставьте|прибыль/iu;
  const slots: ReadonlyArray<readonly [string, unknown]> = [
    ["available", view],
    ["available, away, expanded", view],
    ["legacy", unavailableExtendedMarketsView()],
    ["unrecognised", { state: "UNAVAILABLE", reason: "UNRECOGNISED" }],
    ["read failed", { state: "READ_FAILED" }],
  ];

  it.each(slots)("%s", (name, slot) => {
    const markup = name.includes("expanded") ? render(slot, { initialSide: "AWAY", initialExpanded: true }) : render(slot);
    const text = visibleText(markup);
    expect(text).not.toMatch(RAW_CODES);
    expect(text).not.toMatch(PROHIBITED);
    expect(text).not.toMatch(/\b(?:Infinity|NaN|undefined|null)\b/);
  });
});

describe("workbench placement", () => {
  const forecasts = [snapshot("forecast-a", "INITIAL", 0.45, [], 0.6, 1.2), snapshot("forecast-b", "PRE_MATCH", 0.5, [], 0.6, 1.3)];
  const render2 = (extendedMarkets?: Record<string, ExtendedMarketsSlot>) =>
    renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts: forecasts as never, timeZone: "UTC", ...(extendedMarkets ? { extendedMarkets } : {}) }));

  it("renders the sections between the forecast panel and the odds duo, following the selected snapshot", () => {
    const markup = render2({ "forecast-a": view, "forecast-b": unavailableExtendedMarketsView() });
    const forecastPanel = markup.indexOf('id="forecast-heading"');
    const asianHandicap = markup.indexOf('id="asian-handicap"');
    const exactScore = markup.indexOf('id="exact-score"');
    const duo = markup.indexOf('class="workbench-duo"');
    expect(forecastPanel).toBeGreaterThan(-1);
    expect(forecastPanel).toBeLessThan(asianHandicap);
    expect(asianHandicap).toBeLessThan(exactScore);
    expect(exactScore).toBeLessThan(duo);
    expect(markup).toContain("Азиатский гандикап");
    expect(count(markup, /id="asian-handicap"/g)).toBe(1);
    expect(markup).not.toContain('data-extended-state="UNAVAILABLE"');
  });

  it("follows the first listed snapshot and shows the legacy notice for it when its view is unavailable", () => {
    const markup = render2({ "forecast-a": unavailableExtendedMarketsView(), "forecast-b": view });
    expect(count(markup, /data-extended-state="UNAVAILABLE"/g)).toBe(2);
  });

  it("shows a read failure for a snapshot whose slot is missing, and nothing when the page passes no slot map at all", () => {
    expect(count(render2({}), /data-extended-state="READ_FAILED"/g)).toBe(2);
    expect(render2()).not.toContain('id="asian-handicap"');
  });

  it("keeps the persistent responsible-gambling disclosure text in the workbench header", () => {
    expect(render2({ "forecast-a": view })).toContain("Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.");
  });
});

describe("loadExtendedMarkets (server-side, closed classification)", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const input = (fetchImpl: typeof fetch) => ({ apiOrigin: "http://api.test", fixtureId: "fixture 1", forecastIds: ["f1", "f2", "f3", "f4", "f5"], headers: { "x-eligibility-region": "XX" }, fetchImpl });

  it("requests every snapshot in parallel with the eligibility headers and classifies each result", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const bodies: Record<string, () => Response | Promise<Response>> = {
      f1: () => json(view),
      f2: () => json(unavailableExtendedMarketsView()),
      f3: () => json({ version: "extended-markets-view-v1", state: "UNAVAILABLE", reason: "SOMETHING_NEW" }),
      f4: () => json({ error: "boom" }, 500),
      f5: () => { throw new Error("network down"); },
    };
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const id = /forecasts\/(f\d)\//.exec(url)![1]!;
      return bodies[id]!();
    }) as unknown as typeof fetch;
    const slots = await loadExtendedMarkets(input(fetchImpl));
    expect(calls.map((call) => call.url).sort()).toEqual(["f1", "f2", "f3", "f4", "f5"].map((id) => `http://api.test/fixtures/fixture%201/forecasts/${id}/extended-markets`));
    for (const call of calls) {
      expect(call.init?.cache).toBe("no-store");
      expect(call.init?.headers).toMatchObject({ accept: "application/json", "x-eligibility-region": "XX" });
    }
    expect(slots.f1).toEqual(JSON.parse(JSON.stringify(view)));
    expect(slots.f2).toEqual(unavailableExtendedMarketsView());
    expect(slots.f3).toEqual({ state: "UNAVAILABLE", reason: "UNRECOGNISED" });
    expect(slots.f4).toEqual({ state: "READ_FAILED" });
    expect(slots.f5).toEqual({ state: "READ_FAILED" });
  });

  it("classifies a 2xx body that is not JSON as unrecognised rather than available", async () => {
    const fetchImpl = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    const slots = await loadExtendedMarkets({ ...input(fetchImpl), forecastIds: ["f1"] });
    expect(slots.f1).toEqual({ state: "UNAVAILABLE", reason: "UNRECOGNISED" });
  });
});

describe("module graph (T-10-06)", () => {
  const dir = "apps/web/app/fixtures/[fixtureId]";
  const read = (file: string) => readFileSync(resolve(dir, file), "utf8");

  it("keeps the new modules free of imports back from the workbench and out of next/dynamic", () => {
    for (const file of ["extended-markets-model.ts", "extended-markets-loader.ts", "extended-markets-sections.tsx"]) expect(read(file)).not.toMatch(/from\s+["'][^"']*forecast-workbench/);
    const workbench = read("forecast-workbench.tsx");
    expect(workbench).toMatch(/import \{ ExtendedMarketsSections \} from "\.\/extended-markets-sections"/);
    expect(workbench).not.toMatch(/dynamic\([^)]*extended-markets/s);
    expect(read("extended-markets-loader.ts")).not.toMatch(/["']use client["']/);
    expect(read("extended-markets-sections.tsx").startsWith('"use client"')).toBe(true);
  });

  it("does not touch the persistent responsible-gambling disclosure component", () => {
    expect(readFileSync(resolve("apps/web/components/risk-disclosure.tsx"), "utf8")).toContain("Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.");
  });
});
