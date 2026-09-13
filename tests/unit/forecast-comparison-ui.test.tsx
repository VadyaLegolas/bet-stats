import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { availabilityReasonCopy, ForecastComparisonPanel, ForecastWorkbench, initializeComparisonPair, swapComparisonPair } from "../../apps/web/app/fixtures/[fixtureId]/forecast-workbench.js";
import { compareForecastPair } from "../../packages/domain/src/forecast/comparison.js";
import { snapshot } from "./forecast-comparison.test.js";

describe("forecast revision comparison UI", () => {
  it("initializes missing URL IDs once and never substitutes selected snapshots on refresh", () => {
    const forecasts = [snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2), snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4)];
    expect(initializeComparisonPair(new URLSearchParams(), forecasts)).toEqual({ leftId: "left", rightId: "right", initialized: true });
    expect(initializeComparisonPair(new URLSearchParams("left=kept-left&right=kept-right"), [...forecasts, snapshot("newest", "LINEUP_CONFIRMED", 0.55, [], 0.8, 1.5)])).toEqual({ leftId: "kept-left", rightId: "kept-right", initialized: false });
    expect(swapComparisonPair({ leftId: "left", rightId: "right" })).toEqual({ leftId: "right", rightId: "left" });
  });
  it.each([["CAPABILITY_DENIED", "Provider capability is denied."], ["BUDGET_PROTECTED", "Provider budget is protected."], ["PROVIDER_UNAVAILABLE", "Provider is unavailable."], ["NO_CONFIRMED_LINEUP", "No official confirmed lineup was available before the cutoff."], ["INSUFFICIENT_EVIDENCE", "Evidence is insufficient for this snapshot."]])("renders server reason %s exactly", (reason, copy) => expect(availabilityReasonCopy(reason)).toBe(copy));

  it("renders server semantic deltas with written direction and exact receipt IDs", () => {
    const comparison = compareForecastPair(snapshot("left", "INITIAL", 0.45, ["OLD"], 0.6, 1.2), snapshot("right", "PRE_MATCH", 0.5, ["NEW"], 0.7, 1.4));
    const markup = renderToStaticMarkup(createElement(ForecastComparisonPanel, { comparison }));
    expect(markup).toContain("Material evidence, model, and limitation changes");
    expect(markup).toContain("increased by");
    expect(markup).toContain("+5.0%");
    expect(markup).toContain("left");
    expect(markup).toContain("right");
    expect(markup).toContain("Probabilities are estimates, not guarantees. You can lose money when betting.");
  });

  it("renders documented one-snapshot and absent-lineup states with persistent risk disclosure", () => {
    const markup = renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts: [snapshot("only", "INITIAL", 0.45, [], 0.6, 1.2)] }));
    expect(markup).toContain("No comparable forecast pair yet");
    expect(markup).toContain("No LINEUP_CONFIRMED snapshot: no official confirmed lineup receipt was available before the cutoff.");
    expect(markup).toContain("Probabilities are estimates, not guarantees. You can lose money when betting.");
  });
});
