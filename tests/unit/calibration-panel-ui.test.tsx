import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { CalibrationPanel } from "../../apps/web/app/fixtures/[fixtureId]/calibration-panel.js";
import { CALIBRATION_REASON_CODES, type MarketCalibrationView } from "../../packages/domain/src/calibration/view.js";

const calibrated: MarketCalibrationView = {
  rawProbabilities: [0.5, 0.25, 0.25],
  calibration: { state: "CALIBRATED", calibratedProbabilities: [0.44, 0.28, 0.28], calibratorVersion: 3, method: "PLATT", sampleSize: 120, holdoutBrierRaw: 0.6, holdoutBrierCalibrated: 0.5812345 },
};
const insufficient: MarketCalibrationView = {
  rawProbabilities: [0.5, 0.25, 0.25],
  calibration: { state: "INSUFFICIENT_DATA", sampleSize: 20, requiredSample: 300, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" },
};
const unavailable = (reasonCode: string): MarketCalibrationView => ({ rawProbabilities: [0.5, 0.25, 0.25], calibration: { state: "UNAVAILABLE", reasonCode } as never });

const render = (market: "ONE_X_TWO" | "OVER_UNDER_2_5" | "BTTS", view: MarketCalibrationView | undefined): string => renderToStaticMarkup(createElement(CalibrationPanel, { market, view }));
const text = (markup: string): string => markup.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Wording that would claim an improvement, superiority, reliability or a guarantee. */
const FORBIDDEN = [/точнее/iu, /улучш/iu, /лучше/iu, /надёжнее/iu, /гарант/iu, /уверенн/iu];
/** The one approved sentence that names the word in a negation. */
const APPROVED_DISCLAIMER = "Калиброванные вероятности — тоже оценки, а не гарантии.";
const scannable = (markup: string): string => text(markup).replaceAll(APPROVED_DISCLAIMER, "");

describe("calibration panel: CALIBRATED", () => {
  const markup = render("ONE_X_TWO", calibrated);
  const plain = text(markup);

  it("shows the version label, the method and the holdout sample size", () => {
    expect(plain).toContain("Калибровка v3");
    expect(plain).toContain("Platt");
    expect(plain).toContain("Отложенная выборка: 120 исходов");
  });

  it("puts raw and calibrated probabilities side by side per selection with the shared percent format", () => {
    expect(plain).toContain("Сырая вероятность");
    expect(plain).toContain("Калиброванная вероятность");
    for (const value of ["50.0%", "25.0%", "44.0%", "28.0%"]) expect(plain).toContain(value);
    expect(plain).toContain("Хозяева");
    expect(plain).toContain("Ничья");
    expect(plain).toContain("Гости");
  });

  it("states the holdout Brier numbers neutrally with three decimals", () => {
    expect(plain).toContain("Brier на отложенной выборке: сырые 0.600, калиброванные 0.581");
  });

  it("carries the disclaimers: estimates not guarantees, value on raw probabilities", () => {
    expect(plain).toContain(APPROVED_DISCLAIMER);
    expect(plain).toContain("Расчёт value по-прежнему использует сырые вероятности.");
  });

  it("names the isotonic method in words", () => {
    const isotonic = render("BTTS", { rawProbabilities: [0.45, 0.55], calibration: { ...calibrated.calibration, method: "ISOTONIC", calibratedProbabilities: [0.5, 0.5] } });
    expect(text(isotonic)).toContain("изотоническая регрессия");
  });

  it("has one projection per market with a market-specific table label and an id that is not a forecast projection", () => {
    expect(markup).toContain('data-evidence-projection="calibration-one-x-two"');
    expect(markup).toContain('aria-label="1X2 — сырые и калиброванные вероятности"');
    expect(render("BTTS", { rawProbabilities: [0.45, 0.55], calibration: { ...calibrated.calibration, calibratedProbabilities: [0.5, 0.5] } })).toContain('aria-label="Обе забьют — сырые и калиброванные вероятности"');
    expect(markup).not.toContain("data-evidence-projection=\"forecast-");
  });
});

describe("calibration panel: INSUFFICIENT_DATA", () => {
  const markup = render("OVER_UNDER_2_5", insufficient);
  const plain = text(markup);

  it("uses the exact sentence with the numbers from the response", () => {
    expect(plain).toContain("Недостаточно данных для калибровки: нужно не меньше 300 исходов, сейчас 20");
    expect(text(render("BTTS", { rawProbabilities: [0.5, 0.5], calibration: { state: "INSUFFICIENT_DATA", sampleSize: 0, requiredSample: 300, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" } }))).toContain("сейчас 0");
    expect(text(render("BTTS", { rawProbabilities: [0.5, 0.5], calibration: { state: "INSUFFICIENT_DATA", sampleSize: 299, requiredSample: 300, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" } }))).toContain("нужно не меньше 300 исходов, сейчас 299");
  });

  it("shows neither a version label nor a calibrated table", () => {
    expect(plain).not.toMatch(/Калибровка v/);
    expect(plain).not.toContain("Калиброванная вероятность");
    expect(markup).not.toContain("data-evidence-projection");
  });
});

describe("calibration panel: UNAVAILABLE", () => {
  it.each([
    ["KIND_NOT_COVERED", "Калибровка не применяется к первичному прогнозу."],
    ["NO_PROMOTED_CALIBRATOR", "Калибратор для этой версии модели ещё не утверждён."],
    ["CALIBRATOR_MODEL_MISMATCH", "Калибратор не соответствует версии модели этого прогноза."],
    ["CALIBRATOR_MARKET_MISMATCH", "Калибратор не соответствует версии модели этого прогноза."],
    ["CALIBRATOR_INVALID", "Калибратор не соответствует версии модели этого прогноза."],
    ["CALIBRATION_READ_FAILED", "Калибровка временно недоступна."],
    ["SOMETHING_NEW", "Калибровка недоступна."],
  ])("explains %s by its code and shows raw probabilities only", (code, sentence) => {
    const markup = render("ONE_X_TWO", unavailable(code));
    const plain = text(markup);
    expect(plain).toContain(sentence);
    expect(plain).toContain("Показаны только сырые вероятности.");
    expect(plain).not.toMatch(/Калибровка v/);
    expect(plain).not.toContain("Калиброванная вероятность");
    expect(plain).not.toContain("Недостаточно данных для калибровки");
  });

  it("a response without marketCalibration is unavailable, never calibrated", () => {
    const plain = text(render("ONE_X_TWO", undefined));
    expect(plain).toContain("Калибровка недоступна.");
    expect(plain).not.toMatch(/Калибровка v/);
    expect(plain).not.toContain("Калиброванная вероятность");
  });

  it("a malformed CALIBRATED block (missing numbers) is unavailable as well", () => {
    const plain = text(render("ONE_X_TWO", { rawProbabilities: [0.5, 0.25, 0.25], calibration: { state: "CALIBRATED" } }));
    expect(plain).toContain("Калибровка недоступна.");
    expect(plain).not.toMatch(/Калибровка v/);
    const mismatched = text(render("ONE_X_TWO", { rawProbabilities: [0.5, 0.25, 0.25], calibration: { ...calibrated.calibration, calibratedProbabilities: [0.5, 0.5] } }));
    expect(mismatched).toContain("Калибровка недоступна.");
  });
});

describe("calibration panel: wording and structure", () => {
  const states: Array<[string, MarketCalibrationView | undefined]> = [
    ["calibrated", calibrated],
    ["insufficient", insufficient],
    ["missing", undefined],
    ...[...CALIBRATION_REASON_CODES, "SOMETHING_NEW"].map((code): [string, MarketCalibrationView] => [`unavailable ${code}`, unavailable(code)]),
  ];

  it.each(states)("%s: no claim of improvement, superiority, reliability or a guarantee", (_name, view) => {
    const markup = render("ONE_X_TWO", view);
    for (const pattern of FORBIDDEN) expect(scannable(markup), String(pattern)).not.toMatch(pattern);
  });

  it.each(states)("%s: one link to the methodology, no other interactive element, heading level 5", (_name, view) => {
    const markup = render("ONE_X_TWO", view);
    expect(markup.match(/<a[ >]/g)).toHaveLength(1);
    expect(markup).toContain('href="/methodology#calibration"');
    expect(text(markup)).toContain("Как устроена калибровка");
    expect(markup).not.toMatch(/<(button|input|select|textarea)[ >]/);
    expect(markup).not.toContain("dangerouslySetInnerHTML");
    expect(markup).toMatch(/<h5[ >]/);
  });

  it("outputs response strings as text: markup in an unknown reason code is escaped", () => {
    const markup = render("ONE_X_TWO", unavailable("<img src=x onerror=alert(1)>"));
    expect(markup).not.toContain("<img");
  });
});
