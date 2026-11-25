import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { loadScanner, type ScannerRepository, type ScannerRow } from "../../apps/api/src/modules/value/scanner.service.js";
import { ScannerAvailable } from "../../apps/web/app/scanner/scanner-rows.js";
import { parseScannerResponse, type ScannerItem, type ScannerPayload } from "../../apps/web/app/scanner/scanner-types.js";

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

/* @@scanner-ui-tests-continue@@ */
