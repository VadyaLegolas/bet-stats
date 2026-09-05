import Decimal from "decimal.js";

import type { ForecastDraft, ForecastSelection } from "../forecast/model.js";
import type { NormalizedOddsBook } from "../odds/normalize.js";

export interface ValueInput { readonly forecast: ForecastDraft; readonly odds: NormalizedOddsBook; readonly selection: ForecastSelection }

export function decideValue(input: ValueInput) {
  const reasons: string[] = [...input.forecast.limitations];
  if (input.forecast.fixtureId !== input.odds.fixtureId) reasons.push("FIXTURE_MISMATCH");
  const event = Object.values(input.forecast.markets).flat().find(({ selection }) => selection === input.selection);
  const odd = input.odds.selections.find(({ selection }) => selection === input.selection);
  if (!event || !odd || !input.forecast.markets[input.odds.market].some(({ selection }) => selection === input.selection)) reasons.push("MARKET_SELECTION_MISMATCH");
  const probability = new Decimal(event?.probability ?? 0);
  const noVig = new Decimal(odd?.noVigProbability ?? 0);
  const decimalOdds = new Decimal(odd?.decimalOdds ?? 1);
  const edge = probability.minus(noVig);
  const expectedValue = probability.times(decimalOdds).minus(1);
  const thresholds = { minimumConfidence: "0.65", minimumEdge: "0.03", minimumExpectedValue: "0.05" } as const;
  const gates = [
    { gate: "DATA_QUALITY", passed: reasons.length === 0 },
    { gate: "CONFIDENCE", passed: new Decimal(input.forecast.confidence.score).gte(thresholds.minimumConfidence) },
    { gate: "EDGE", passed: edge.gte(thresholds.minimumEdge) },
    { gate: "EXPECTED_VALUE", passed: expectedValue.gte(thresholds.minimumExpectedValue) },
  ] as const;
  if (!gates[1].passed) reasons.push("CONFIDENCE_BELOW_THRESHOLD");
  if (!gates[2].passed) reasons.push("EDGE_BELOW_THRESHOLD");
  if (!gates[3].passed) reasons.push("EV_BELOW_THRESHOLD");
  const insufficient = !gates[0].passed || !gates[1].passed;
  const outcome = insufficient ? "INSUFFICIENT_EVIDENCE" : gates.every(({ passed }) => passed) ? "VALUE_CANDIDATE" : "NO_VALUE";
  return {
    outcome,
    reasons,
    edge: edge.toString(),
    expectedValue: expectedValue.toString(),
    receipt: {
      fixtureId: input.forecast.fixtureId,
      forecastSnapshotId: input.forecast.forecastSnapshotId,
      oddsSnapshotId: input.odds.oddsSnapshotId,
      cutoff: input.forecast.cutoff,
      modelVersion: input.forecast.modelVersion,
      configVersion: input.forecast.configVersion,
      configHash: input.forecast.configHash,
      inputHash: input.forecast.inputHash,
      oddsSchemaVersion: input.odds.schemaVersion,
      confidenceVersion: input.forecast.confidence.version,
      valuePolicyVersion: "value-policy-v1",
      evidenceBuildIds: input.forecast.evidenceBuildIds,
      sources: input.forecast.sources,
      assumptions: input.forecast.assumptions,
      formulas: ["edge=modelProbability-noVigProbability", "expectedValue=modelProbability*decimalOdds-1"],
      thresholds,
      gates,
    },
  } as const;
}
