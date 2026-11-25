import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { selectionsFor } from "../../packages/domain/src/index.js";
import {
  buildOddsSubmission,
  ForecastWorkbench,
  forecastOptionLabel,
  oddsDraftStorageKey,
  selectStableSnapshot,
  validateOddsFields,
  type WorkbenchInitialState,
} from "../../apps/web/app/fixtures/[fixtureId]/forecast-workbench.js";
import { snapshot } from "./forecast-comparison.test.js";

describe("manual odds workbench draft behavior", () => {
  it("scopes versioned local drafts by fixture and market", () => {
    expect(oddsDraftStorageKey("fixture/1", "ONE_X_TWO")).toBe("bet-stats:manual-odds-draft-v1:fixture%2F1:ONE_X_TWO");
  });

  it("requires every market selection and identifies invalid fields", () => {
    expect(validateOddsFields("ONE_X_TWO", { HOME: "2.10", DRAW: "", AWAY: "1" })).toEqual({
      DRAW: "Укажите десятичный коэффициент.",
      AWAY: "Десятичный коэффициент должен быть больше 1.00.",
    });
    expect(validateOddsFields("BTTS", { YES: "1.91", NO: "2.05" })).toEqual({});
  });

  it("builds only a complete server input without client-derived analytics", () => {
    expect(buildOddsSubmission({
      fixtureId: "fixture-1",
      market: "BTTS",
      sourceLabel: "Manual book",
      fields: { YES: "1.91", NO: "2.05" },
      capturedAt: "2026-09-06T03:00:00.000Z",
      oddsSnapshotId: "draft-client-id",
    })).toEqual({
      oddsSnapshotId: "draft-client-id",
      market: "BTTS",
      sourceLabel: "Manual book",
      capturedAt: "2026-09-06T03:00:00.000Z",
      selections: [
        { selection: "YES", decimalOdds: "1.91" },
        { selection: "NO", decimalOdds: "2.05" },
      ],
    });
    expect(() => buildOddsSubmission({ fixtureId: "fixture-1", market: "BTTS", sourceLabel: "", fields: { YES: "1.91", NO: "" }, capturedAt: "now", oddsSnapshotId: "id" })).toThrow("INCOMPLETE_ODDS_BOOK");
  });

  it("keeps an explicit selected snapshot when newer snapshots arrive", () => {
    const original = { id: "forecast-1" };
    expect(selectStableSnapshot("forecast-1", [original, { id: "forecast-2" }])).toBe(original);
    expect(selectStableSnapshot("missing", [original, { id: "forecast-2" }])).toBe(original);
  });

  it("labels discovered snapshots with their exact non-round cutoff", () => {
    expect(forecastOptionLabel({
      id: "forecast-lineup-2",
      kind: "LINEUP_CONFIRMED",
      revision: 2,
      cutoff: "2026-09-06T11:17:23.000Z",
    })).toBe("по подтверждённому составу · ревизия 2 — 2026-09-06T11:17:23.000Z — forecast-lineup-2");
  });

  describe("extended markets in the odds form (D-20)", () => {
    const forecasts = [snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2), snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4)] as never;
    const render = (initialState: WorkbenchInitialState) => renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts, timeZone: "UTC", initialState }));
    const oddsSection = (markup: string) => markup.slice(markup.indexOf('aria-labelledby="odds-heading"'), markup.indexOf('aria-labelledby="comparison-heading"'));

    it("offers five markets in the contract order and keeps the three core field labels", () => {
      const markup = render({});
      const options = [...(/<select id="market"[^>]*>([\s\S]*?)<\/select>/.exec(markup)![1]!).matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((match) => [match[1], match[2]]);
      expect(options).toEqual([["ONE_X_TWO", "1X2"], ["OVER_UNDER_2_5", "Тотал 2.5"], ["BTTS", "Обе забьют"], ["ASIAN_HANDICAP", "Азиатский гандикап"], ["EXACT_SCORE", "Точный счёт"]]);
      expect(markup).toContain("Десятичный коэффициент на хозяев");
      expect(markup).not.toContain('id="ah-line"');
      expect(markup).not.toContain("market-score-fields-set");
    });

    it("shows the line select without an auto-selected line and hides the odds fields until a line is chosen", () => {
      const section = oddsSection(render({ family: "ASIAN_HANDICAP" }));
      expect(section).toContain('<label for="ah-line">Линия гандикапа (с позиции хозяев)</label>');
      expect(section).toContain('<option value="" selected="">Выберите линию</option>');
      expect(section.match(/<option value="[+-]?[0-9.]+"/g)).toHaveLength(21);
      expect(section).toContain("Хозяева −2.5 / Гости +2.5");
      expect(section).toContain("Хозяева 0 / Гости 0");
      expect(section).toContain("Хозяева +2.5 / Гости −2.5");
      expect(section).toContain("Выберите линию: для каждой линии сохраняется отдельная полная книга из двух сторон.");
      expect(section).not.toContain('id="odds-HOME"');
      expect(section).not.toContain('id="odds-AWAY"');
      expect(section).not.toContain('role="alert"');
    });

    it("reports a missing line as a field error tied to the select", () => {
      const section = oddsSection(render({ family: "ASIAN_HANDICAP", lineError: true, message: "Выберите линию гандикапа и заполните оба коэффициента перед отправкой этой неизменяемой книги коэффициентов." }));
      expect(section).toContain('aria-invalid="true"');
      expect(section).toContain('aria-describedby="ah-line-error"');
      expect(section).toContain('<span id="ah-line-error" role="alert"> Выберите линию гандикапа.</span>');
      expect(section).toContain("Выберите линию гандикапа и заполните оба коэффициента перед отправкой этой неизменяемой книги коэффициентов.");
    });

    it("renders two labelled fields for a chosen line and the split note only on quarter lines", () => {
      const quarter = oddsSection(render({ family: "ASIAN_HANDICAP", ahLine: "-0.75" }));
      expect(quarter).toContain("Десятичный коэффициент: Хозяева −0.75");
      expect(quarter).toContain("Десятичный коэффициент: Гости +0.75");
      expect(quarter).toContain("На четвертной линии ставка делится между −0.5 и −1: возможны выигрыш и проигрыш половины ставки.");
      expect(quarter).not.toContain("Выберите линию: для каждой линии");
      const level = oddsSection(render({ family: "ASIAN_HANDICAP", ahLine: "0" }));
      expect(level).toContain("Десятичный коэффициент: Хозяева 0</label>");
      expect(level).toContain("Десятичный коэффициент: Гости 0</label>");
      expect(level).not.toContain("На четвертной линии");
    });

    it("renders all 17 exact score fields with visible labels in registry order", () => {
      const section = oddsSection(render({ family: "EXACT_SCORE" }));
      expect(section).toContain('<fieldset class="market-score-fields-set"><legend>Десятичные коэффициенты на все 17 исходов</legend>');
      expect(section).toContain("Нужны коэффициенты на все 16 счетов и на «Любой другой счёт». Книга сохраняется только целиком.");
      const labels = [...section.matchAll(/<label for="odds-([^"]+)">([^<]*)<\/label>/g)].filter((match) => match[1] !== "HOME").map((match) => [match[1], match[2]]);
      const expected = ["0-0", "0-1", "0-2", "0-3", "1-0", "1-1", "1-2", "1-3", "2-0", "2-1", "2-2", "2-3", "3-0", "3-1", "3-2", "3-3"].map((id) => [id, `Счёт ${id.replace("-", ":")}`]);
      expect(labels).toEqual([...expected, ["OTHER", "Любой другой счёт"]]);
      expect(section.match(/<input id="odds-/g)).toHaveLength(17);
      expect(section.indexOf('id="source-label"')).toBeLessThan(section.indexOf("<fieldset"));
    });

    it("shows the counter status line for an incomplete exact score book", () => {
      const section = oddsSection(render({ family: "EXACT_SCORE", message: "Заполните все выборы перед отправкой этой неизменяемой книги коэффициентов. Не заполнено полей: 17 из 17.", fieldErrors: { "0-0": "Укажите десятичный коэффициент." } }));
      expect(section).toContain("Не заполнено полей: 17 из 17.");
      expect(section).toContain('aria-describedby="odds-0-0-error"');
    });

    it("keys drafts by the canonical market id so each handicap line has its own draft", () => {
      expect(oddsDraftStorageKey("fixture-1", "ASIAN_HANDICAP:-0.75")).toBe("bet-stats:manual-odds-draft-v1:fixture-1:ASIAN_HANDICAP:-0.75");
      expect(oddsDraftStorageKey("fixture-1", "ASIAN_HANDICAP:-0.75")).not.toBe(oddsDraftStorageKey("fixture-1", "ASIAN_HANDICAP:-0.5"));
      expect(oddsDraftStorageKey("fixture-1", "EXACT_SCORE")).toBe("bet-stats:manual-odds-draft-v1:fixture-1:EXACT_SCORE");
    });

    it("validates and builds a complete exact score book and rejects an incomplete one", () => {
      const fields = Object.fromEntries(selectionsFor("EXACT_SCORE")!.map((selection) => [selection, "12.5"]));
      expect(validateOddsFields("EXACT_SCORE", fields)).toEqual({});
      expect(Object.keys(validateOddsFields("EXACT_SCORE", {}))).toHaveLength(17);
      const body = buildOddsSubmission({ fixtureId: "fixture-1", market: "ASIAN_HANDICAP:+0.25", sourceLabel: "Book", fields: { HOME: "1.95", AWAY: "1.95" }, capturedAt: "2026-09-06T03:00:00.000Z", oddsSnapshotId: "id" });
      expect(body.market).toBe("ASIAN_HANDICAP:+0.25");
      expect(body.selections).toEqual([{ selection: "HOME", decimalOdds: "1.95" }, { selection: "AWAY", decimalOdds: "1.95" }]);
      expect(() => buildOddsSubmission({ fixtureId: "fixture-1", market: "ASIAN_HANDICAP:+0.25", sourceLabel: "Book", fields: { HOME: "1.95" }, capturedAt: "x", oddsSnapshotId: "id" })).toThrow("INCOMPLETE_ODDS_BOOK");
      expect(() => buildOddsSubmission({ fixtureId: "fixture-1", market: "ASIAN_HANDICAP", sourceLabel: "Book", fields: {}, capturedAt: "x", oddsSnapshotId: "id" })).toThrow("UNSUPPORTED_ODDS_MARKET");
    });
  });

  it("renders an honest empty state when discovery returns no issued snapshots", () => {
    const markup = renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts: [], timeZone: "Europe/Warsaw" }));
    expect(markup).toContain("Сопоставимая пара прогнозов пока недоступна");
    expect(markup).toContain("Для этого матча нет двух выпущенных снимков прогноза.");
    expect(markup).toContain("Нет первичного снимка: прогноз выпускается за 14 дней до кикоффа, как только матч попадает в горизонт данных.");
    expect(markup).toContain("Нет предматчевого снимка: обновление выпускается за 6 часов до кикоффа.");
    expect(markup).not.toContain("fixture and cutoff");
  });
});
