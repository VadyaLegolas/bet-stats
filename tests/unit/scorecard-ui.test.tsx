import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { ScorecardDashboard, canonicalScorecardQuery, type ScorecardViewModel } from "../../apps/web/app/scorecards/scorecard-dashboard.js";

const model: ScorecardViewModel = {
  cohortIdentity: { modelVersion: "model-v1", competitionId: "premier-league", market: "ONE_X_TWO", from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" },
  health: { state: "LIMITED", reasons: ["COHORT_BELOW_MINIMUM"], performanceClaim: null },
  denominators: { fixtureCount: 8, forecastCount: 8, eventCount: 24, valueCount: 1 },
  metrics: { meanBrierScore: 0.44, meanLogLoss: 0.67 },
  reliability: { policyId: "sha256:reliability", buckets: [{ index: 0, lowerBound: 0, upperBound: 0.1, upperBoundInclusive: false, meanForecast: 0.06, observedFrequency: 0.1, count: 10, gap: 0.04, direction: "UNDER_CONFIDENT", evidenceState: "INSUFFICIENT" }] },
  financial: { count: 1, totalStakedUnits: "1", totalProfitUnits: "0.5", roi: "0.5", yield: "0.5", policyId: "flat-one-unit-v1" },
  clv: { status: "UNAVAILABLE", reason: "NO_COMPARABLE_CLOSE", comparableCount: 0 },
  receipts: { formulaId: "sha256:formula", cohortPolicyId: "sha256:cohort" },
};

describe("scorecard dashboard", () => {
  it("renders cohort health and denominators before metrics with an accessible reliability table", () => {
    const markup = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: model, candidates: { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } } }));
    expect(markup.indexOf("Limited evidence")).toBeLessThan(markup.indexOf("Brier score"));
    expect(markup).toContain("8 fixtures");
    expect(markup).toContain("Reliability evidence table");
    expect(markup).toContain("Closing-line evidence is unavailable");
    expect(markup).toContain("NO_COMPARABLE_CLOSE");
    expect(markup).toContain("Formula and policy receipts");
    expect(markup).not.toMatch(/stake recommendation|guaranteed return/i);
  });

  it("keeps exact filters in deterministic URL identity without silent substitution", () => {
    expect(canonicalScorecardQuery(model.cohortIdentity)).toBe("modelVersion=model-v1&competitionId=premier-league&market=ONE_X_TWO&from=2026-01-01T00%3A00%3A00.000Z&to=2026-02-01T00%3A00%3A00.000Z");
    const unavailable = { ...model, health: { state: "UNAVAILABLE" as const, reasons: ["NO_SCOREABLE_FIXTURES"], performanceClaim: null }, metrics: null };
    const markup = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: unavailable, candidates: { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } } }));
    expect(markup).toContain("No scoreable evidence is available for this exact cohort");
    expect(markup).toContain("model-v1");
    expect(markup).toContain("premier-league");
  });
});
