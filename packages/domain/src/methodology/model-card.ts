import { CALIBRATION_CONFIG, CALIBRATION_CONFIG_HASH } from "../calibration/config.js";
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
  "calibration",
  "responsible-use",
] as const;

export const MODEL_CARD = Object.freeze({
  version: "model-card-v1.2.0",
  effectiveDate: "2026-11-24",
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
      rhoBounds: "max(−1/λh, −1/λa) < ρ < min(1/(λh·λa), 1)",
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
        "При фиксированных ожидаемых голах λh и λa рынок тотала 2.5 нейтрален по построению: поправка перераспределяет массу внутри низких счётов, а не сдвигает сумму голов.",
        "После коррекции сетка нормализуется по retained mass, поэтому вероятности остаются суммой 1 по учтённой части распределения.",
      ]),
      limitations: Object.freeze([
        "Интеграция гибридная: силы атаки и защиты не переоцениваются, домашний фактор учитывается один раз.",
        "ρ оценивается только по завершённым прогнозам лиги в пределах окна; это не полный DC-refit всей модели.",
        "Если выборки лиги недостаточно, берётся общая оценка по всем лигам; при недостатке истории используется ρ = 0 с явным методом в квитанции.",
        "Если подобранное ρ выходит за допустимые границы конкретного матча, применяется ρ = 0 с методом out-of-band-zero: значение не обрезается и прогноз не отклоняется.",
        "Сравнение с версией V1 выполняет оператор по воспроизводимой процедуре бэктестов; публичного представления сравнения пока нет, а при малой выборке вердикт всегда «неубедительно».",
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
  /**
   * Post-hoc probability calibration (Phase 12, D-07, D-12). Every number comes from the frozen
   * `calibration-config-v1` object: the card publishes the policy, it never restates it.
   */
  calibration: Object.freeze({
    configVersion: CALIBRATION_CONFIG.version,
    configHash: CALIBRATION_CONFIG_HASH,
    markets: CALIBRATION_CONFIG.markets,
    minimumSamples: CALIBRATION_CONFIG.minimumSamples,
    holdoutFraction: CALIBRATION_CONFIG.holdoutFraction,
    materiality: CALIBRATION_CONFIG.materiality,
    rollback: CALIBRATION_CONFIG.rollback,
    probabilityClipEpsilon: CALIBRATION_CONFIG.probabilityClipEpsilon,
    cadence: CALIBRATION_CONFIG.cadence,
    fit: Object.freeze({ kinds: CALIBRATION_CONFIG.fit.kinds, servedKinds: CALIBRATION_CONFIG.fit.servedKinds }),
    effects: Object.freeze([
      "Метод по умолчанию — калибровка Platt: логистическое отображение логита вероятности. Для рынка 1X2 она применяется по схеме «один против всех» к каждому классу, после чего вероятности пересчитываются до суммы 1.",
      `Вторым методом рассматривается изотоническая регрессия, но только при ${CALIBRATION_CONFIG.minimumSamples.isotonic} и более завершённых исходов и выбирается, только если на отложенной выборке опережает Platt не меньше чем на ${CALIBRATION_CONFIG.materiality} по Brier.`,
      "Подбор использует предматчевые прогнозы PRODUCTION и результаты в том виде, какими они были известны на момент подбора; калибратор обучается на более ранней части данных и проверяется на более поздней отложенной выборке, которая в обучении не участвовала.",
      "Калибратор закреплён за точной версией модели и конфигурации прогноза и никогда не применяется к прогнозу другой версии.",
      `Автоматический откат: после ${CALIBRATION_CONFIG.rollback.consecutiveWorse} подряд оценок хуже сырого прогноза не меньше чем на ${CALIBRATION_CONFIG.materiality} по Brier, каждая не меньше ${CALIBRATION_CONFIG.rollback.minimumEvaluationSample} исходов. Одно плохое окно не откатывает калибратор. После отката действует предыдущий калибратор либо остаются только сырые вероятности. Тот же самый калибратор повторно не продвигается, а новый кандидат того же рынка (в том числе пересчитанный на тех же данных с новыми исходами) продвигается только после доказательства: среди исходов, ставших известными после отката, их должно быть не меньше ${CALIBRATION_CONFIG.minimumSamples.holdout} в отложенной выборке кандидата, и на них он должен опережать откатанный калибратор не меньше чем на ${CALIBRATION_CONFIG.materiality} по Brier и при этом не быть хуже сырого прогноза на эту же величину.`,
      "Замороженные снимки и квитанции не меняются: калиброванные вероятности вычисляются при чтении ответа и показываются отдельно от сырых. Расчёт value по-прежнему использует сырые вероятности.",
    ]),
    limitations: Object.freeze([
      `Малые выборки: ниже ${CALIBRATION_CONFIG.minimumSamples.platt} исходов на рынок калибратор не строится, пользователь видит состояние «недостаточно данных».`,
      "Калибровка не обещает более близких к реальности вероятностей: на новых данных она может оказаться хуже сырого прогноза, поэтому действует автоматический откат.",
      `Выбор метода и оценка опираются на одну и ту же отложенную выборку: когда рассматривается изотоническая регрессия (от ${CALIBRATION_CONFIG.minimumSamples.isotonic} исходов), показанный Brier на отложенной выборке — лучший из двух методов на ней же, то есть оценка смещена в благоприятную сторону, а качество на новых данных может быть ниже. Правило продвижения и автоматический откат по новым окнам ограничивают это смещение, но не устраняют его.`,
      "Ограничение вида: первичный прогноз калибровкой не покрывается, показываются только сырые вероятности.",
      "Калибратор подбирается по предматчевым снимкам и показывается также для прогнозов по подтверждённому составу; перенос на такие прогнозы отдельно не проверяется, а доли видов прогноза в обучающей выборке и в показе могут различаться.",
      "Калиброванное состояние вычисляется при чтении на текущий момент: старый прогноз показывается с сегодняшним калибратором и сегодняшним числом доступных исходов, а не с состоянием на момент выпуска.",
      "Калибровка не многоклассовая: рынок 1X2 калибруется по схеме «один против всех» с пересчётом до суммы 1.",
    ]),
  }),
  changeHistory: Object.freeze([
    Object.freeze({
      version: "model-card-v1.2.0",
      effectiveDate: "2026-11-24",
      summary: "Добавлена post-hoc калибровка вероятностей по рынкам с версиями калибраторов и автоматическим откатом.",
      affected: "calibration-config-v1, poisson-ensemble-v1, dixon-coles-ensemble-v1",
      interpretation: "Выданные квитанции и снимки не переписаны: калиброванные вероятности вычисляются при чтении и показываются отдельно от сырых; расчёт value использует сырые вероятности.",
    }),
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
