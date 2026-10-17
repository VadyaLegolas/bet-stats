import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { forecastPercentages, FixtureForecastLine } from "../../apps/web/app/fixtures/page.js";

describe("forecastPercentages", () => {
  it("converts exact probabilities to the matching integer percentages", () => {
    expect(forecastPercentages({ home: 0.52, draw: 0.26, away: 0.22 })).toEqual({ home: 52, draw: 26, away: 22 });
    expect(forecastPercentages({ home: 0.5, draw: 0.3, away: 0.2 })).toEqual({ home: 50, draw: 30, away: 20 });
  });

  it("assigns the largest-remainder shortfall to the biggest fractional remainder", () => {
    expect(forecastPercentages({ home: 0.3333, draw: 0.3333, away: 0.3334 })).toEqual({ home: 33, draw: 33, away: 34 });
  });

  it("breaks equal-remainder ties deterministically home first", () => {
    expect(forecastPercentages({ home: 0.335, draw: 0.335, away: 0.33 })).toEqual({ home: 34, draw: 33, away: 33 });
  });

  it("normalizes a within-tolerance sum and still lands on exactly 100", () => {
    expect(forecastPercentages({ home: 0.52, draw: 0.26, away: 0.23 })).toEqual({ home: 51, draw: 26, away: 23 });
  });

  it("always produces integers summing to exactly 100", () => {
    for (const probabilities of [
      { home: 0.52, draw: 0.26, away: 0.22 },
      { home: 0.3333, draw: 0.3333, away: 0.3334 },
      { home: 0.5, draw: 0.3, away: 0.2 },
      { home: 0.335, draw: 0.335, away: 0.33 },
      { home: 0.52, draw: 0.26, away: 0.23 },
      { home: 0.9, draw: 0, away: 0 },
    ]) {
      const percentages = forecastPercentages(probabilities);
      expect(percentages).not.toBeNull();
      expect(percentages!.home + percentages!.draw + percentages!.away).toBe(100);
    }
  });

  it("returns null for missing or non-finite or negative probabilities", () => {
    expect(forecastPercentages(undefined)).toBeNull();
    expect(forecastPercentages(null)).toBeNull();
    expect(forecastPercentages({ home: Number.NaN, draw: 0.3, away: 0.2 })).toBeNull();
    expect(forecastPercentages({ home: Number.POSITIVE_INFINITY, draw: 0.3, away: 0.2 })).toBeNull();
    expect(forecastPercentages({ home: -0.1, draw: 0.3, away: 0.2 })).toBeNull();
    expect(forecastPercentages({ home: 1.2, draw: 0.3, away: 0.2 })).toBeNull();
  });

  it("returns null outside the [0.9, 1.1] sum tolerance window", () => {
    expect(forecastPercentages({ home: 0.2, draw: 0.15, away: 0.15 })).toBeNull();
    expect(forecastPercentages({ home: 0.7, draw: 0.4, away: 0.3 })).toBeNull();
  });
});

describe("FixtureForecastLine", () => {
  const valid = { kind: "ONE_X_TWO", cutoff: "2026-10-17T12:00:00.000Z", probabilities: { home: 0.52, draw: 0.26, away: 0.22 } };

  it("renders the exact Russian percentage line for a valid forecast", () => {
    const markup = renderToStaticMarkup(createElement(FixtureForecastLine, { forecast: valid }));
    expect(markup).toBe("<div class=\"fixture-forecast\">Прогноз: П1 52% · Х 26% · П2 22%</div>");
  });

  it("renders the pending fallback for a missing forecast", () => {
    for (const props of [{ forecast: null }, {}]) {
      const markup = renderToStaticMarkup(createElement(FixtureForecastLine, props));
      expect(markup).toContain("Прогноз пока не выпущен");
      expect(markup).toContain("fixture-forecast--pending");
    }
  });

  it("renders the pending fallback for invalid probabilities", () => {
    for (const probabilities of [{ home: "52%", draw: 0.26, away: 0.22 }, { home: Number.NaN, draw: 0.26, away: 0.22 }]) {
      const markup = renderToStaticMarkup(createElement(FixtureForecastLine, { forecast: { probabilities } }));
      expect(markup).toContain("Прогноз пока не выпущен");
      expect(markup).toContain("fixture-forecast--pending");
    }
  });

  it("never leaks raw selection or kind codes into the rendered markup", () => {
    const validMarkup = renderToStaticMarkup(createElement(FixtureForecastLine, { forecast: valid }));
    const fallbackMarkup = renderToStaticMarkup(createElement(FixtureForecastLine, { forecast: { kind: "PRE_MATCH", probabilities: { home: "HOME", draw: null, away: undefined } } }));
    for (const markup of [validMarkup, fallbackMarkup]) {
      expect(markup).not.toContain("HOME");
      expect(markup).not.toContain("DRAW");
      expect(markup).not.toContain("AWAY");
      expect(markup).not.toContain("ONE_X_TWO");
      expect(markup).not.toContain("PRE_MATCH");
    }
  });
});
