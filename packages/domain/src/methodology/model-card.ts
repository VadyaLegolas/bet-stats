import { COHORT_HEALTH_POLICY } from "../evaluation/cohort-health.js";
import { BACKTEST_POLICY_VERSION } from "../evaluation/backtest.js";
import { ODDS_RATIO_CLV_POLICY_VERSION } from "../evaluation/clv.js";
import { FINANCIAL_RATE_DEFINITION, FLAT_ONE_UNIT_POLICY_VERSION } from "../evaluation/financial.js";
import { RELIABILITY_POLICY } from "../evaluation/reliability.js";
import { SCORE_FORMULA_HASH, SCORE_FORMULA_VERSION, SCORE_LOG_EPSILON } from "../evaluation/scoring.js";
import { SETTLEMENT_POLICY_VERSION } from "../evaluation/settlement.js";
import {
  DIXON_COLES_CONFIG,
  FORECAST_CONFIG,
  FORECAST_CONFIG_VERSION_BY_MODEL,
  forecastConfigHashFor,
} from "../forecast/config.js";
import { DIXON_COLES_CONVENTION } from "../forecast/dixon-coles.js";
import { DEFAULT_FORECAST_MODEL_VERSION } from "../forecast/model-version.js";
import { VALUE_POLICY } from "../value/decision.js";

export const MODEL_CARD_SECTION_IDS = [
  "inputs",
  "dixon-coles",
  "what-is-excluded",
  "confidence",
  "limitations",
  "evaluation",
  "responsible-use",
] as const;

export const MODEL_CARD = Object.freeze({
  version: "model-card-v1.1.0",
  effectiveDate: "2026-11-21",
  currentModel: Object.freeze({
    modelVersion: DEFAULT_FORECAST_MODEL_VERSION,
    configVersion: FORECAST_CONFIG_VERSION_BY_MODEL[DEFAULT_FORECAST_MODEL_VERSION],
    configHash: forecastConfigHashFor(DEFAULT_FORECAST_MODEL_VERSION),
  }),
  alternatives: Object.freeze([
    Object.freeze({
      modelVersion: "poisson-ensemble-v1" as const,
      configVersion: FORECAST_CONFIG.version,
      configHash: forecastConfigHashFor("poisson-ensemble-v1"),
      role: "ROLLBACK_AND_COMPARISON" as const,
    }),
  ]),
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
    /**
     * Honest description of the default model (D-05, D-14): the low-score
     * correction is applied on top of the existing Elo/form Poisson grid, so the
     * card must not call the whole thing "the Dixon-Coles model".
     */
    dixonColes: Object.freeze({
      integration: "hybrid-elo-form-poisson-with-tau",
      convention: DIXON_COLES_CONVENTION,
      tau: "τ(0,0)=1−λh·λa·ρ; τ(1,0)=1+λa·ρ; τ(0,1)=1+λh·ρ; τ(1,1)=1−ρ",
      rhoBounds: "max(−1/(λh·λa), −1/λh, −1/λa) < ρ < min(1/(λh·λa), 1)",
      rhoPolicy: Object.freeze({
        method: DIXON_COLES_CONFIG.dixonColes.estimation.method,
        windowDays: DIXON_COLES_CONFIG.dixonColes.estimation.windowDays,
        minLeagueMatches: DIXON_COLES_CONFIG.dixonColes.estimation.minLeagueMatches,
        minPooledMatches: DIXON_COLES_CONFIG.dixonColes.estimation.minPooledMatches,
        fallback: DIXON_COLES_CONFIG.dixonColes.estimation.fallback,
      }),
      effects: Object.freeze([
        "При ρ < 0 ничьи и счета 1-1/0-0 становятся вероятнее, а 1-0/0-1 — менее вероятны.",
        "Коррекция затрагивает только четыре низких счёта (0-0, 1-0, 0-1, 1-1); остальные клетки сетки не меняются.",
        "При фиксированных λ и μ рынок тотала 2.5 нейтрален по построению: поправка перераспределяет массу внутри низких счётов, а не сдвигает сумму голов.",
        "После коррекции сетка нормализуется по retained mass, поэтому вероятности остаются суммой 1 по учтённой части распределения.",
      ]),
      limitations: Object.freeze([
        "Интеграция гибридная: силы атаки и защиты не переоцениваются, домашний фактор учитывается один раз.",
        "ρ оценивается только по завершённым прогнозам лиги в пределах окна; это не полный DC-refit всей модели.",
        "При недостатке истории используется ρ = 0 с явным методом в квитанции.",
        "Dixon-Coles — не гарантия лучших вероятностей: сравнение публикуется через бэктест на одинаковых окнах.",
      ]),
    }),
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
      version: "model-card-v1.1.0",
      effectiveDate: "2026-11-21",
      summary: "Добавлена гибридная low-score коррекция Диксона-Колза как новая версия модели; V1 сохранена.",
      affected: "dixon-coles-ensemble-v1, poisson-ensemble-v1, forecast-config-v2, rolling-origin-v1",
      interpretation: "Выданные квитанции не переписаны; V1 остаётся выбираемой и сравнимой.",
    }),
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
