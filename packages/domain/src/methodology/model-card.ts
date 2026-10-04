import { COHORT_HEALTH_POLICY } from "../evaluation/cohort-health.js";
import { BACKTEST_POLICY_VERSION } from "../evaluation/backtest.js";
import { ODDS_RATIO_CLV_POLICY_VERSION } from "../evaluation/clv.js";
import { FINANCIAL_RATE_DEFINITION, FLAT_ONE_UNIT_POLICY_VERSION } from "../evaluation/financial.js";
import { currentForecastConfigHash } from "../evaluation/forecast-orchestrator.js";
import { RELIABILITY_POLICY } from "../evaluation/reliability.js";
import { SCORE_FORMULA_HASH, SCORE_FORMULA_VERSION, SCORE_LOG_EPSILON } from "../evaluation/scoring.js";
import { SETTLEMENT_POLICY_VERSION } from "../evaluation/settlement.js";
import { FORECAST_CONFIG } from "../forecast/config.js";
import { VALUE_POLICY } from "../value/decision.js";

export const MODEL_CARD_SECTION_IDS = [
  "inputs",
  "what-is-excluded",
  "confidence",
  "limitations",
  "evaluation",
  "responsible-use",
] as const;

export const MODEL_CARD = Object.freeze({
  version: "model-card-v1.0.0",
  effectiveDate: "2026-09-20",
  currentModel: Object.freeze({
    modelVersion: "poisson-ensemble-v1",
    configVersion: FORECAST_CONFIG.version,
    configHash: currentForecastConfigHash(),
  }),
  policies: Object.freeze({
    value: VALUE_POLICY.version,
    settlement: SETTLEMENT_POLICY_VERSION,
    scoreFormula: SCORE_FORMULA_VERSION,
    scoreFormulaHash: SCORE_FORMULA_HASH,
    reliability: RELIABILITY_POLICY.identity,
    cohortHealth: COHORT_HEALTH_POLICY.identity,
    financial: FLAT_ONE_UNIT_POLICY_VERSION,
    clv: ODDS_RATIO_CLV_POLICY_VERSION,
    backtest: BACKTEST_POLICY_VERSION,
  }),
  forecast: Object.freeze({
    scoreGrid: "Independent Poisson goal counts on a 0–7 by 0–7 score grid, normalized by retained mass.",
    expectedGoals: "lambda = clamp(baselineGoals × signalMultiplier, 0.2, 4.0)",
    minimumSamples: Object.freeze({ ...FORECAST_CONFIG.minimumSamples }),
    tailWarningThreshold: FORECAST_CONFIG.tailWarningThreshold,
    valueFormulas: Object.freeze([
      "edge = modelProbability − noVigProbability",
      "expectedValue = modelProbability × decimalOdds − 1",
    ]),
    valueThresholds: VALUE_POLICY.thresholds,
  }),
  evaluation: Object.freeze({
    brier: "Brier = Σ(probability − oneHotOutcome)²; unscaled categorical sum, range 0–2.",
    logLoss: `Log Loss = −ln(max(chosenProbability, ${SCORE_LOG_EPSILON})); natural logarithm.`,
    financialRate: FINANCIAL_RATE_DEFINITION,
    cohortMinimums: Object.freeze({
      fixtures: COHORT_HEALTH_POLICY.minimumFixtureCount,
      populatedBucketEvents: COHORT_HEALTH_POLICY.minimumBucketCount,
    }),
  }),
  changeHistory: Object.freeze([
    Object.freeze({
      version: "model-card-v1.0.0",
      effectiveDate: "2026-09-20",
      summary: "Published the complete two-layer forecast, value and evaluation methodology.",
      affected: "poisson-ensemble-v1, forecast-config-v1, value-policy-v1 and Phase 4 evaluation policies",
      interpretation: "No forecast receipt was rewritten. This card documents the policies already attached to immutable receipts.",
    }),
    Object.freeze({
      version: "model-card-v0.9.0",
      effectiveDate: "2026-09-10",
      summary: "Added leakage-safe rolling-origin evaluation and exact cohort evidence gates.",
      affected: "rolling-origin-v1, proper-score-v1, reliability-policy-v1 and cohort-health-v1",
      interpretation: "Earlier evaluations remain tied to their original formula and cohort receipts.",
    }),
  ]),
});

export type ModelCard = typeof MODEL_CARD;
