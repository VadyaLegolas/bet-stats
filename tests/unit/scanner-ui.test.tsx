import { readFileSync } from "node:fs";

import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadScanner, type ScannerRepository, type ScannerRow } from "../../apps/api/src/modules/value/scanner.service.js";
import { PERSISTENT_RISK_DISCLOSURE } from "../../apps/web/components/risk-disclosure.js";
import { readScanner } from "../../apps/web/app/scanner/scanner-data.js";
import { SCANNER_TOP_LINE } from "../../apps/web/app/scanner/scanner-labels.js";
import { ScannerAvailable } from "../../apps/web/app/scanner/scanner-rows.js";
import { parseScannerResponse, type ScannerItem, type ScannerPayload } from "../../apps/web/app/scanner/scanner-types.js";
import { ScannerView } from "../../apps/web/app/scanner/scanner-view.js";

/* ------------------------------------------------------------------ builders */

const EDGE = "0.0432109876543210987654321";
const EV = "1.2e-7";
const PROBABILITY = "0.1000";
const ODDS = "1.2345678901234567890123456789012345678901";

export function item(overrides: Partial<ScannerItem> = {}): ScannerItem {
  return {
    receiptId: "receipt-1",
    fixtureId: "fixture-1",
    forecastSnapshotId: "snapshot-1",
    oddsSnapshotId: "odds-1",
    market: "ONE_X_TWO",
    selection: "HOME",
    kickoffAt: "2026-11-28T17:00:00.000Z",
    homeTeam: "Арсенал",
    awayTeam: "Челси",
    competition: "Премьер-лига",
    oddsSource: "Pinnacle",
    oddsSubmittedAt: "2026-11-25T13:05:00.000Z",
    oddsCapturedAt: "2026-11-25T13:00:00.000Z",
    oddsAgeSeconds: 7200,
    freshness: "FRESH",
    forecastNewerAvailable: false,
    edge: EDGE,
    expectedValue: EV,
    modelProbability: PROBABILITY,
    noVigProbability: "0.4800",
    fairOdds: "2.0833",
    decimalOdds: ODDS,
    valuePolicyVersion: "value-policy-v1",
    edgeDefinition: null,
    evPolicyVersion: null,
    ...overrides,
  };
}

export function response(items: readonly ScannerItem[], overrides: Partial<ScannerPayload> = {}): ScannerPayload {
  return {
    state: items.length > 0 ? "AVAILABLE" : "EMPTY",
    generatedAt: "2026-11-25T14:05:00.000Z",
    window: { from: "2026-11-25T14:05:00.000Z", to: "2026-12-02T14:05:00.000Z" },
    limit: 200,
    truncated: false,
    freshnessPolicy: { version: "scanner-freshness-v1", freshMaxHours: 6, agingMaxHours: 24 },
    checkedCount: items.length,
    outcomeCounts: items.length > 0 ? { VALUE_CANDIDATE: items.length } : {},
    totalCandidates: items.length,
    allPolicyConfigMismatch: false,
    items,
    ...overrides,
  };
}

const row = (overrides: Partial<ScannerRow> = {}): ScannerRow => ({
  checked: 1,
  outcomeCounts: { VALUE_CANDIDATE: 1 },
  allPolicyMismatch: false,
  ord: 1,
  receiptId: "receipt-1",
  fixtureId: "fixture-1",
  forecastSnapshotId: "snapshot-1",
  oddsSnapshotId: "odds-1",
  market: "ONE_X_TWO",
  selection: "HOME",
  edge: EDGE,
  expectedValue: EV,
  modelProbability: PROBABILITY,
  noVigProbability: "0.4800",
  fairOdds: "2.0833",
  decimalOdds: ODDS,
  valuePolicyVersion: "value-policy-v1",
  edgeDefinition: null,
  evPolicyVersion: null,
  kickoffAt: new Date("2026-11-28T17:00:00.000Z"),
  homeTeam: "Арсенал",
  awayTeam: "Челси",
  competition: "Премьер-лига",
  oddsSource: "Pinnacle",
  oddsSubmittedAt: new Date("2026-11-25T13:05:00.000Z"),
  oddsCapturedAt: "2026-11-25T13:00:00.000Z",
  forecastNewerAvailable: false,
  ...overrides,
});

const repositoryOf = (rows: readonly ScannerRow[]): ScannerRepository => ({ loadWindow: async () => rows });
const NOW = new Date("2026-11-25T14:05:00.000Z");

/* ------------------------------------------------------------------ parser */

describe("parseScannerResponse", () => {
  it("accepts the real loadScanner output for AVAILABLE and EMPTY, which pins the page key lists to the API contract", async () => {
    const available = await loadScanner({ now: NOW }, repositoryOf([row()]));
    const parsedAvailable = parseScannerResponse(JSON.parse(JSON.stringify(available)));
    expect(parsedAvailable?.state).toBe("AVAILABLE");
    expect(parsedAvailable?.items).toHaveLength(1);

    const empty = await loadScanner({ now: NOW }, repositoryOf([row({ receiptId: null, ord: null, checked: 3, outcomeCounts: { NO_VALUE: 3 }, allPolicyMismatch: true })]));
    const parsedEmpty = parseScannerResponse(JSON.parse(JSON.stringify(empty)));
    expect(parsedEmpty?.state).toBe("EMPTY");
    expect(parsedEmpty?.allPolicyConfigMismatch).toBe(true);
  });

  it("keeps a held-out edge string byte for byte", () => {
    const parsed = parseScannerResponse(JSON.parse(JSON.stringify(response([item()]))));
    expect(parsed?.items[0]?.edge).toBe(EDGE);
    expect(parsed?.items[0]?.expectedValue).toBe(EV);
  });

  it("accepts null stored values", () => {
    const parsed = parseScannerResponse(response([item({ edge: null, fairOdds: null, oddsSource: null })]));
    expect(parsed).not.toBeNull();
  });

  const valid = () => JSON.parse(JSON.stringify(response([item()]))) as Record<string, unknown>;
  const validItem = (body: Record<string, unknown>) => (body.items as Record<string, unknown>[])[0]!;

  it.each<[string, (body: Record<string, unknown>) => unknown]>([
    ["a missing top-level key", (body) => { delete body.checkedCount; return body; }],
    ["an extra top-level key", (body) => ({ ...body, extra: 1 })],
    ["a wrong state", (body) => ({ ...body, state: "UNAVAILABLE" })],
    ["AVAILABLE with zero items", (body) => ({ ...body, items: [] })],
    ["EMPTY with items", (body) => ({ ...body, state: "EMPTY" })],
    ["a numeric edge", (body) => { validItem(body).edge = 0.05; return body; }],
    ["a string age", (body) => { validItem(body).oddsAgeSeconds = "7200"; return body; }],
    ["a fractional age", (body) => { validItem(body).oddsAgeSeconds = 1.5; return body; }],
    ["an unknown freshness", (body) => { validItem(body).freshness = "FRESHISH"; return body; }],
    ["a missing item key", (body) => { delete validItem(body).selection; return body; }],
    ["an extra item key", (body) => { validItem(body).extra = "x"; return body; }],
    ["a non-boolean flag", (body) => { validItem(body).forecastNewerAvailable = "false"; return body; }],
    ["a non-boolean truncated", (body) => ({ ...body, truncated: 0 })],
    ["a non-integer outcome count", (body) => ({ ...body, outcomeCounts: { NO_VALUE: "3" } })],
    ["a policy without a version", (body) => ({ ...body, freshnessPolicy: { freshMaxHours: 6, agingMaxHours: 24 } })],
    ["an array instead of an object", () => []],
    ["null", () => null],
    ["a string", () => "AVAILABLE"],
  ])("returns null for %s", (_name, mutate) => {
    expect(parseScannerResponse(mutate(valid()))).toBeNull();
  });
});

/* ------------------------------------------------------------------ rows and groups */

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const renderAvailable = (data: ScannerPayload) => renderToStaticMarkup(createElement(ScannerAvailable, { data }));
const receiptOrder = (markup: string) => [...markup.matchAll(/<li class="scanner-row" id="receipt-([^"]+)"/g)].map((match) => match[1]);
const rowSegments = (markup: string) => markup.split('<li class="scanner-row"').slice(1);

const three = [
  item({ receiptId: "r-1", fixtureId: "f-1", market: "ONE_X_TWO", selection: "HOME", edge: "0.0900000000000000000000001" }),
  item({ receiptId: "r-2", fixtureId: "f-1", market: "BTTS", selection: "YES", edge: "0.0100000000000000000000002" }),
  item({ receiptId: "r-3", fixtureId: "f-2", homeTeam: "Ливерпуль", awayTeam: "Эвертон", edge: "0.0500000000000000000000003" }),
];

describe("ScannerAvailable rows", () => {
  it("renders one li.scanner-row per candidate in input order, grouped by consecutive fixture", () => {
    const markup = renderAvailable(response(three));
    expect(receiptOrder(markup)).toEqual(["r-1", "r-2", "r-3"]);
    expect(count(markup, '<li class="panel scanner-match"')).toBe(2);
    expect(count(markup, '<ol class="scanner-groups"')).toBe(1);
    expect(markup).toContain("Кандидатов: 3, матчей: 2. Данные на ");
    expect(markup).toContain("Арсенал — Челси</a>");
    expect(markup).toContain("Премьер-лига · <time dateTime=\"2026-11-28T17:00:00.000Z\">сб, 28 ноября, 18:00</time>");
  });

  it("keeps the same DOM order whether the stored edges descend or ascend", () => {
    const withEdges = (edges: readonly string[]) => response(three.map((entry, index) => ({ ...entry, edge: edges[index]! })));
    const descending = renderAvailable(withEdges(["0.30", "0.20", "0.10"]));
    const ascending = renderAvailable(withEdges(["0.10", "0.20", "0.30"]));
    expect(receiptOrder(descending)).toEqual(["r-1", "r-2", "r-3"]);
    expect(receiptOrder(ascending)).toEqual(receiptOrder(descending));
  });

  it("has no table, header cell, sort marker or control", () => {
    const markup = renderAvailable(response(three));
    for (const forbidden of ["<table", "<th", "aria-sort", "<button", "<select", "<input", "<script", "dangerouslySetInnerHTML"]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it("renders held-out stored strings verbatim, once per row, as the only text of their dd", () => {
    const longOdds = "3".repeat(40);
    const markup = renderAvailable(response([item({ edge: EDGE, expectedValue: EV, modelProbability: PROBABILITY, decimalOdds: longOdds, noVigProbability: "0.4800000000000000000007" })]));
    for (const value of [EDGE, EV, PROBABILITY, longOdds, "0.4800000000000000000007"]) {
      expect(count(markup, `>${value}<`)).toBe(1);
      expect(count(markup, value)).toBe(1);
    }
    expect(markup).toContain(`<dd class="scanner-key">${EDGE}</dd>`);
    expect(markup).toContain(`<dd class="scanner-key">${EV}</dd>`);
  });

  it("renders every stored string once in each of several rows", () => {
    const markup = renderAvailable(response([item({ receiptId: "a", edge: "0.0111111111111111111111111" }), item({ receiptId: "b", edge: "0.0222222222222222222222222" })]));
    const [first, second] = rowSegments(markup);
    expect(count(first!, ">0.0111111111111111111111111<")).toBe(1);
    expect(count(first!, "0.0222222222222222222222222")).toBe(0);
    expect(count(second!, ">0.0222222222222222222222222<")).toBe(1);
    for (const segment of [first!, second!]) {
      expect(count(segment, `>${EV}<`)).toBe(1);
      expect(count(segment, `>${PROBABILITY}<`)).toBe(1);
      expect(count(segment, `>${ODDS}<`)).toBe(1);
    }
  });

  it("labels each freshness level and keeps AGING in the main list with the age line", () => {
    const markup = renderAvailable(response([
      item({ receiptId: "fresh", freshness: "FRESH", oddsAgeSeconds: 3600 }),
      item({ receiptId: "aging", freshness: "AGING", oddsAgeSeconds: 25_200 }),
      item({ receiptId: "stale", freshness: "STALE", oddsAgeSeconds: 100_000 }),
    ]));
    expect(markup).toContain('state-chip state-chip--md tone-neutral"><span class="state-dot"></span>Свежие коэффициенты');
    expect(markup).toContain('state-chip state-chip--md tone-warning"><span class="state-dot"></span>Коэффициенты стареют');
    expect(markup).toContain('state-chip state-chip--md tone-warning"><span class="state-dot"></span>Коэффициенты устарели');
    expect(markup).toContain("7 ч назад");
    const staleStart = markup.indexOf('<details class="scanner-stale"');
    expect(markup.slice(0, staleStart)).toContain('id="receipt-aging"');
    expect(markup.slice(0, staleStart)).not.toContain('id="receipt-stale"');
    expect(markup.slice(staleStart)).toContain('id="receipt-stale"');
  });

  it("shows the forecast-updated chip and note only with the flag, without moving the row", () => {
    const flagged = renderAvailable(response([item({ receiptId: "x", forecastNewerAvailable: true }), item({ receiptId: "y" })]));
    expect(receiptOrder(flagged)).toEqual(["x", "y"]);
    expect(count(flagged, "Прогноз обновлён")).toBe(1);
    expect(count(flagged, "После этой квитанции вышел более новый снимок прогноза.")).toBe(1);
    const plain = renderAvailable(response([item()]));
    expect(plain).not.toContain("Прогноз обновлён");
    expect(plain).not.toContain("более новый снимок");
  });

  it("puts STALE rows only in details.scanner-stale, open only when the main list is empty", () => {
    const mixed = renderAvailable(response([item({ receiptId: "main" }), item({ receiptId: "old", freshness: "STALE", oddsAgeSeconds: 100_000 })]));
    expect(mixed).toMatch(/<details class="scanner-stale">/);
    expect(mixed).not.toMatch(/<details class="scanner-stale" open/);
    expect(mixed).not.toContain("Кандидатов со свежими или стареющими коэффициентами нет");
    expect(mixed).toContain("Устаревшие коэффициенты (1)");
    expect(mixed).toContain("Показать устаревшие строки: 1");
    expect(mixed).toContain("введены более 24 часов назад");

    const allStale = renderAvailable(response([item({ receiptId: "old", freshness: "STALE", oddsAgeSeconds: 100_000 })]));
    expect(allStale).toMatch(/<details class="scanner-stale" open="">/);
    expect(allStale).toContain("Кандидатов со свежими или стареющими коэффициентами нет. Все кандидаты — в блоке «Устаревшие коэффициенты» ниже.");
    expect(allStale.slice(0, allStale.indexOf('<details class="scanner-stale"'))).not.toContain('id="receipt-old"');

    const noStale = renderAvailable(response([item()]));
    expect(noStale).not.toContain("scanner-stale");
    expect(noStale).not.toContain("Устаревшие коэффициенты");
  });

  it("renders stale rows with the same edge and EV strings as fresh rows", () => {
    const markup = renderAvailable(response([item({ receiptId: "a" }), item({ receiptId: "b", freshness: "STALE", oddsAgeSeconds: 100_000 })]));
    expect(count(markup, `>${EDGE}<`)).toBe(2);
    expect(count(markup, `>${EV}<`)).toBe(2);
  });

  it("shows the truncation notice with the payload numbers only when truncated", () => {
    const truncated = renderAvailable(response(three, { truncated: true, totalCandidates: 250, limit: 200 }));
    expect(truncated).toContain("Показана часть списка");
    expect(truncated).toContain("Показаны кандидаты первых по времени матчей: 3 из 250 (лимит списка — 200). Более поздние матчи в список не вошли.");
    const complete = renderAvailable(response(three));
    expect(complete).not.toContain("Показана часть списка");
    expect(complete).not.toContain("лимит списка");
  });

  it("escapes manual labels and names and never produces a script element", () => {
    const markup = renderAvailable(response([item({ oddsSource: "<script>alert(1)</script>", homeTeam: "A & <B>", awayTeam: '"C"', competition: "<i>Лига</i>" })]));
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<i>");
    expect(markup).toContain("Источник: &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).toContain("A &amp; &lt;B&gt; — &quot;C&quot;");
    expect(markup).toContain("&lt;i&gt;Лига&lt;/i&gt; · ");
  });

  it("renders missing values as fixed words, never 0, NaN or blank", () => {
    const markup = renderAvailable(response([item({ edge: null, oddsSource: null, fairOdds: null, noVigProbability: null, valuePolicyVersion: null })]));
    expect(markup).toContain('<dd class="scanner-key">Не записано</dd>');
    expect(markup).toContain("Источник не указан");
    expect(markup).toContain("<dd>Недоступно</dd>");
    expect(count(markup, "<dd>Не записано</dd>") + count(markup, "<dd>Не записано<")).toBeGreaterThanOrEqual(1);
    expect(markup).not.toMatch(/NaN|null|undefined/);
  });

  it("shows the Asian handicap note only for the known definition and the raw id for a foreign one", () => {
    const known = renderAvailable(response([item({ market: "ASIAN_HANDICAP:-0.75", selection: "HOME", edgeDefinition: "conditional-win-probability-minus-no-vig", evPolicyVersion: "push-aware-ev-v1" })]));
    expect(known).toContain("Преимущество — условная вероятность выигрыша (без учёта возврата ставки) минус вероятность без вига.");
    expect(known).toContain("Эффективная вероятность выигрыша");
    expect(known).toContain("Азиатский гандикап −0.75");
    expect(known).toContain("Хозяева −0.75");
    expect(known).toContain("<code>push-aware-ev-v1</code>");
    expect(known).not.toContain("Определение преимущества");

    const foreign = renderAvailable(response([item({ market: "ASIAN_HANDICAP:-0.75", edgeDefinition: "some-other-definition" })]));
    expect(foreign).not.toContain("условная вероятность выигрыша");
    expect(foreign).toContain("Определение преимущества");
    expect(foreign).toContain("<code>some-other-definition</code>");

    const plain = renderAvailable(response([item()]));
    expect(plain).not.toContain("условная вероятность выигрыша");
    expect(plain).not.toContain("Определение преимущества");
    expect(plain).not.toContain("Эффективная вероятность выигрыша");
    expect(plain).toContain("Вероятность модели");
  });

  it("lists evPolicyVersion in the details only when present", () => {
    expect(renderAvailable(response([item()]))).not.toContain("push-aware-ev-v1");
    expect(renderAvailable(response([item({ evPolicyVersion: "push-aware-ev-v1" })]))).toContain("<code>value-policy-v1</code> <code>push-aware-ev-v1</code>");
  });

  it("links to the match and to the receipt JSON with safe target attributes and stable ids", () => {
    const markup = renderAvailable(response([item({ receiptId: "r-9", fixtureId: "f-9" })]));
    expect(markup).toContain('<h3><a href="/fixtures/f-9">Арсенал — Челси</a></h3>');
    expect(markup).toContain('<a href="/fixtures/f-9">Страница матча<span class="sr-only"> Арсенал — Челси, 1X2, Хозяева</span></a>');
    expect(markup).toContain('<a href="/internal-api/value/r-9" target="_blank" rel="noopener noreferrer">Квитанция (JSON)<span class="sr-only"> 1X2, Хозяева; откроется в новой вкладке</span></a>');
    expect(markup).toContain('id="receipt-r-9"');
    expect(markup).toContain('data-freshness="FRESH"');
  });

  it("renders a single candidate as one panel with one row", () => {
    const markup = renderAvailable(response([item()]));
    expect(count(markup, 'class="scanner-row"')).toBe(1);
    expect(count(markup, 'class="panel scanner-match"')).toBe(1);
    expect(markup).toContain("Кандидатов: 1, матчей: 1.");
  });

  it("renders no heading inside a row", () => {
    for (const segment of rowSegments(renderAvailable(response(three)))) {
      // A row contains no nested li, so the first closing tag ends it.
      expect(segment.split("</li>")[0]).not.toMatch(/<h[1-6]/);
    }
  });
});

/* ------------------------------------------------------------------ page states */

const renderView = (data: ScannerPayload | null) => renderToStaticMarkup(createElement(ScannerView, { data }));
const AVAILABLE_VIEW = () => response([item()]);
const EMPTY_VIEW = (overrides: Partial<ScannerPayload> = {}) => response([], overrides);

describe("ScannerView states", () => {
  it("renders AVAILABLE with the list heading and no empty or unavailable markers", () => {
    const markup = renderView(AVAILABLE_VIEW());
    expect(markup).toContain("Кандидаты value на ближайшие 7 суток");
    expect(markup).not.toContain("Кандидатов value на ближайшие 7 суток нет");
    expect(markup).not.toContain("Сканер value сейчас недоступен");
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("Это не сбой данных");
  });

  it("renders EMPTY with the zero-receipt copy, the count 0, no tiles and no alert", () => {
    const markup = renderView(EMPTY_VIEW({ checkedCount: 0, outcomeCounts: {} }));
    expect(markup).toContain('<h2 id="scanner-empty-heading">Кандидатов value на ближайшие 7 суток нет</h2>');
    expect(markup).toContain("></span>Пусто</span>");
    expect(markup).toContain("Это не сбой данных");
    expect(markup).toContain("<dt>Проверено квитанций в окне</dt><dd>0</dd>");
    expect(markup).toContain("Для матчей этого окна сохранённых квитанций value пока нет.");
    expect(markup).toContain('<a href="/fixtures">Открыть матчи</a>');
    expect(count(markup, "<dt>")).toBe(1);
    expect(markup).not.toContain("Квитанции с этими исходами в список кандидатов не попадают.");
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("Ограничение версии политики value");
  });

  it("renders EMPTY with receipts: fixed tile order, raw unknown code, legend", () => {
    const markup = renderView(EMPTY_VIEW({ checkedCount: 20, outcomeCounts: { ZED_UNKNOWN: 1, NO_VALUE: 12, INSUFFICIENT_EVIDENCE: 5, ALPHA_UNKNOWN: 2 } }));
    expect(markup).toContain("<dt>Проверено квитанций в окне</dt><dd>20</dd>");
    const order = ["недостаточно доказательств", "не прошло пороги политики", "ALPHA_UNKNOWN", "ZED_UNKNOWN"].map((label) => markup.indexOf(`<dt>${label}</dt>`));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).toContain("<dt>не прошло пороги политики</dt><dd>12</dd>");
    expect(markup).toContain("<dt>ZED_UNKNOWN</dt><dd>1</dd>");
    expect(markup).toContain("Квитанции с этими исходами в список кандидатов не попадают.");
    expect(markup).not.toContain("Открыть матчи");
    expect(markup).not.toContain("Для матчей этого окна сохранённых квитанций value пока нет.");
  });

  it("shows the policy plaque only with the flag, inside EMPTY, without replacing heading or counts", () => {
    const withPlaque = renderView(EMPTY_VIEW({ checkedCount: 4, outcomeCounts: { NO_VALUE: 4 }, allPolicyConfigMismatch: true }));
    expect(withPlaque).toContain('aria-label="Ограничение версии политики value" class="state-notice tone-info"');
    expect(withPlaque).toContain('<a href="/methodology#limitations">Методология и ограничения</a>');
    expect(withPlaque).toContain("Кандидатов value на ближайшие 7 суток нет");
    expect(withPlaque).toContain("<dt>Проверено квитанций в окне</dt><dd>4</dd>");
    expect(withPlaque).not.toContain('role="alert"');
    const without = renderView(EMPTY_VIEW({ checkedCount: 4, outcomeCounts: { NO_VALUE: 4 } }));
    expect(without).not.toContain("Ограничение версии политики value");
    expect(without).not.toContain("/methodology#limitations");
    expect(renderView(AVAILABLE_VIEW())).not.toContain("Ограничение версии политики value");
  });

  it("renders UNAVAILABLE for null with an alert, the plain refresh link and no data-bound blocks", () => {
    const markup = renderView(null);
    expect(markup).toContain('<div class="state-notice tone-warning" role="alert">');
    expect(markup).toContain('<h2 id="scanner-unavailable-heading">Сканер value сейчас недоступен</h2>');
    expect(markup).toContain("></span>Недоступно</span>");
    expect(markup).toContain("Не удалось получить список кандидатов. Это не значит, что кандидатов нет.");
    expect(markup).toContain("Обновите страницу или вернитесь позже.");
    expect(markup).toContain('<a class="btn-secondary btn-compact" href="/scanner">Обновить страницу</a>');
    expect(markup).not.toContain("onClick");
    expect(markup).not.toContain("Список не ранжирован");
    expect(markup).not.toContain("Как читать значения");
    expect(markup).not.toContain("Это не сбой данных");
    expect(markup).not.toContain("Проверено квитанций в окне");
    expect(markup).not.toContain("Пусто");
  });

  it("shows the ordering notice and the closed how-to-read block in AVAILABLE and EMPTY", () => {
    for (const markup of [renderView(AVAILABLE_VIEW()), renderView(EMPTY_VIEW())]) {
      expect(markup).toContain("Список не ранжирован: матчи идут по времени начала");
      expect(markup).toContain('<details class="well"><summary>Как читать значения</summary>');
      expect(count(markup.slice(markup.indexOf('<details class="well">')).split("</details>")[0]!, "<li>")).toBe(6);
    }
  });

  it("keeps the disclaimer and the exact top line in all three states", () => {
    for (const markup of [renderView(AVAILABLE_VIEW()), renderView(EMPTY_VIEW()), renderView(null)]) {
      expect(markup).toContain(PERSISTENT_RISK_DISCLOSURE);
      expect(markup).toContain(`<p class="page-deck">${SCANNER_TOP_LINE}</p>`);
      expect(markup).toContain("Кандидаты value — это оценка модели, а не рекомендация и не обещание прибыли.");
      expect(markup).toContain('<h1 class="page-title">Сканер value</h1>');
      expect(markup).toContain("Время указано по Europe/Warsaw.");
    }
  });

  it("builds the how-to-read numbers and policy version from the payload, never from constants", () => {
    const markup = renderView(response([item()], { freshnessPolicy: { version: "custom-freshness-v9", freshMaxHours: 3, agingMaxHours: 12 } }));
    expect(markup).toContain("до 3 ч — свежие, от 3 до 12 ч — стареют, больше 12 ч — устарели (версия правил <code>custom-freshness-v9</code>)");
    expect(markup).not.toContain("до 6 ч — свежие");
    const stale = renderView(response([item({ freshness: "STALE", oddsAgeSeconds: 100_000 })], { freshnessPolicy: { version: "scanner-freshness-v1", freshMaxHours: 3, agingMaxHours: 12 } }));
    expect(stale).toContain("введены более 12 часов назад");
  });

  it("uses plain anchors and no client script in every state", () => {
    for (const markup of [renderView(AVAILABLE_VIEW()), renderView(EMPTY_VIEW({ allPolicyConfigMismatch: true })), renderView(null)]) {
      expect(markup).not.toMatch(/<script|<button|<table|data-nextjs|onclick/i);
    }
  });
});

/* ------------------------------------------------------------------ server read */

describe("readScanner", () => {
  afterEach(() => vi.unstubAllEnvs());

  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const stub = (answer: () => Promise<Response>) => vi.fn<typeof fetch>(async () => answer());

  it("returns data for valid AVAILABLE and EMPTY payloads", async () => {
    const available = JSON.parse(JSON.stringify(response([item()])));
    const empty = JSON.parse(JSON.stringify(response([], { checkedCount: 2, outcomeCounts: { NO_VALUE: 2 } })));
    expect((await readScanner(stub(async () => jsonResponse(available))))?.state).toBe("AVAILABLE");
    expect((await readScanner(stub(async () => jsonResponse(empty))))?.state).toBe("EMPTY");
  });

  it("keeps stored strings byte for byte through fetch and parse", async () => {
    const data = await readScanner(stub(async () => jsonResponse(response([item()]))));
    expect(data?.items[0]?.edge).toBe(EDGE);
    expect(data?.items[0]?.expectedValue).toBe(EV);
  });

  it("returns null for a server error, a redirect, a thrown error, a timeout and a non-JSON body", async () => {
    expect(await readScanner(stub(async () => jsonResponse({ code: "SCANNER_READ_FAILED" }, 500)))).toBeNull();
    expect(await readScanner(stub(async () => new Response(null, { status: 308, headers: { location: "/elsewhere" } })))).toBeNull();
    expect(await readScanner(stub(async () => { throw new TypeError("fetch failed"); }))).toBeNull();
    expect(await readScanner(stub(async () => { throw new DOMException("The operation timed out", "TimeoutError"); }))).toBeNull();
    expect(await readScanner(stub(async () => new Response("<html>not json</html>", { status: 200 })))).toBeNull();
  });

  it("returns null for contradictory, extended and incomplete payloads", async () => {
    const valid = JSON.parse(JSON.stringify(response([item()])));
    const { checkedCount: _omitted, ...missing } = valid;
    expect(await readScanner(stub(async () => jsonResponse({ ...valid, items: [] })))).toBeNull();
    expect(await readScanner(stub(async () => jsonResponse({ state: "AVAILABLE", items: [] })))).toBeNull();
    expect(await readScanner(stub(async () => jsonResponse({ ...valid, extra: true })))).toBeNull();
    expect(await readScanner(stub(async () => jsonResponse(missing)))).toBeNull();
    expect(await readScanner(stub(async () => jsonResponse({ ...valid, state: "UNAVAILABLE" })))).toBeNull();
  });

  it("requests /value/scanner without caching and with the eligibility headers read at call time", async () => {
    vi.stubEnv("API_ORIGIN", "http://api.test:9");
    vi.stubEnv("ELIGIBILITY_REGION", "PL");
    vi.stubEnv("ELIGIBILITY_AGE_ACKNOWLEDGED", "true");
    vi.stubEnv("ELIGIBILITY_CHECKED_AT", "2026-11-25T00:00:00.000Z");
    const fetchImpl = stub(async () => jsonResponse(response([item()])));
    await readScanner(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://api.test:9/value/scanner");
    expect(String(url).endsWith("/value/scanner")).toBe(true);
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toMatchObject({
      accept: "application/json",
      "x-eligibility-region": "PL",
      "x-age-acknowledged": "true",
      "x-eligibility-checked-at": "2026-11-25T00:00:00.000Z",
    });
  });
});

/* ------------------------------------------------------------------ static guards */

describe("scanner module guards", () => {
  const read = (name: string) => readFileSync(new URL(`../../apps/web/app/scanner/${name}`, import.meta.url), "utf8");
  const files = ["page.tsx", "scanner-data.ts", "scanner-labels.ts", "scanner-rows.tsx", "scanner-types.ts", "scanner-view.tsx"];

  it("page.tsx is a dynamic server page with a metadata title and only the allowed exports", () => {
    const page = read("page.tsx");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toMatch(/export const metadata[^=]*= \{ title: "Сканер value" \}/);
    expect(page).toContain("export default async function");
    expect(page).not.toMatch(/["']use client["']/);
    expect([...page.matchAll(/^export (?!default)(?:const|function|async function) (\w+)/gm)].map((match) => match[1]).sort()).toEqual(["dynamic", "metadata"]);
  });

  it("no scanner module is a client module, uses next/link or injects markup", () => {
    for (const name of files) {
      const text = read(name);
      expect(text, name).not.toMatch(/["']use client["']/);
      expect(text, name).not.toContain("next/link");
      expect(text, name).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("the row and view modules never sort or rank", () => {
    for (const name of ["scanner-rows.tsx", "scanner-view.tsx"]) {
      expect(read(name), name).not.toMatch(/\.sort\(|\.toSorted\(|\.reverse\(|localeCompare/);
    }
  });

  it("no scanner module imports the domain barrel at runtime", () => {
    for (const name of files) {
      const lines = read(name).split("\n").filter((line) => /from "@bet-stats\/domain"/.test(line));
      for (const line of lines) expect(line, name).toMatch(/^import type /);
    }
  });
});
