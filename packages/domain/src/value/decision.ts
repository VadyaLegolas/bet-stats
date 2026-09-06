import { Decimal } from "decimal.js";

import type { ForecastDraft, ForecastSelection } from "../forecast/model.js";
import type { NormalizedOddsBook } from "../odds/normalize.js";
import type { ValueCommand } from "./contract.js";

export interface ValueInput extends Pick<ValueCommand, "selection"> { readonly forecast: ForecastDraft; readonly odds: NormalizedOddsBook }

export const VALUE_POLICY = Object.freeze({
  version: "value-policy-v1" as const,
  forecastConfigVersion: "forecast-config-v1" as const,
  oddsSchemaVersion: "manual-odds-v1" as const,
  oddsNormalizationVersion: "multiplicative-v1" as const,
  thresholds: Object.freeze({ minimumConfidence: "0.65", minimumEdge: "0.03", minimumExpectedValue: "0.05" }),
});

export function decideValue(input: ValueInput) {
  const policyReasons: string[] = [];
  const canonicalReasons: string[] = input.forecast.limitations.filter((reason) => reason === "UNRESOLVED_CANONICAL_IDENTITY");
  const cutoffReasons: string[] = input.forecast.limitations.filter((reason) => reason.includes("CUTOFF_MISMATCH"));
  const qualityReasons: string[] = input.forecast.limitations.filter((reason) => !canonicalReasons.includes(reason) && !cutoffReasons.includes(reason));
  if (input.forecast.configVersion !== VALUE_POLICY.forecastConfigVersion || input.odds.schemaVersion !== VALUE_POLICY.oddsSchemaVersion || input.odds.normalizationVersion !== VALUE_POLICY.oddsNormalizationVersion) policyReasons.push("POLICY_CONFIG_MISMATCH");
  if (input.forecast.cutoff !== input.odds.capturedAt && !cutoffReasons.includes("CUTOFF_MISMATCH")) cutoffReasons.push("CUTOFF_MISMATCH");
  if (input.forecast.fixtureId !== input.odds.fixtureId) qualityReasons.push("FIXTURE_MISMATCH");
  const event = Object.values(input.forecast.markets).flat().find(({ selection }) => selection === input.selection);
  const odd = input.odds.selections.find(({ selection }) => selection === input.selection);
  if (!event || !odd || !input.forecast.markets[input.odds.market].some(({ selection }) => selection === input.selection)) qualityReasons.push("MARKET_SELECTION_MISMATCH");
  const reasons: string[] = [...policyReasons, ...canonicalReasons, ...cutoffReasons, ...qualityReasons];
  const probability = new Decimal(event?.probability ?? 0);
  const noVig = new Decimal(odd?.noVigProbability ?? 0);
  const decimalOdds = new Decimal(odd?.decimalOdds ?? 1);
  const edge = probability.minus(noVig);
  const expectedValue = probability.times(decimalOdds).minus(1);
  const thresholds = VALUE_POLICY.thresholds;
  const gates = [
    { gate: "POLICY", passed: policyReasons.length === 0 },
    { gate: "CANONICAL", passed: canonicalReasons.length === 0 },
    { gate: "CUTOFF", passed: cutoffReasons.length === 0 },
    { gate: "DATA_QUALITY", passed: qualityReasons.length === 0 },
    { gate: "CONFIDENCE", passed: new Decimal(input.forecast.confidence.score).gte(thresholds.minimumConfidence) },
    { gate: "EDGE", passed: edge.gte(thresholds.minimumEdge) },
    { gate: "EXPECTED_VALUE", passed: expectedValue.gte(thresholds.minimumExpectedValue) },
  ] as const;
  if (!gates[4].passed) reasons.push("CONFIDENCE_BELOW_THRESHOLD");
  if (!gates[5].passed) reasons.push("EDGE_BELOW_THRESHOLD");
  if (!gates[6].passed) reasons.push("EV_BELOW_THRESHOLD");
  const insufficient = gates.slice(0, 5).some(({ passed }) => !passed);
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
      oddsNormalizationVersion: input.odds.normalizationVersion,
      confidenceVersion: input.forecast.confidence.version,
      valuePolicyVersion: VALUE_POLICY.version,
      evidenceBuildIds: input.forecast.evidenceBuildIds,
      sources: input.forecast.sources,
      assumptions: input.forecast.assumptions,
      formulas: ["edge=modelProbability-noVigProbability", "expectedValue=modelProbability*decimalOdds-1"],
      thresholds,
      gates,
    },
  } as const;
}
