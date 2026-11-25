import { CALIBRATION_CONFIG, CALIBRATION_CONFIG_HASH } from "../calibration/config.js";
import { COHORT_HEALTH_POLICY } from "../evaluation/cohort-health.js";
import { BACKTEST_POLICY_VERSION } from "../evaluation/backtest.js";
import { ODDS_RATIO_CLV_POLICY_VERSION } from "../evaluation/clv.js";
import { NO_VIG_CLV_POLICY_VERSION } from "../evaluation/no-vig-clv.js";
import { FINANCIAL_RATE_DEFINITION, FLAT_ONE_UNIT_POLICY_VERSION, FLAT_ONE_UNIT_V2_POLICY_VERSION } from "../evaluation/financial.js";
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
import { AH_LINES_VERSION } from "../markets/ah-lines.js";
import { AH_SETTLEMENT_VERSION } from "../markets/asian-handicap.js";
import { EXACT_SCORE_BUCKETS_VERSION } from "../markets/exact-score.js";
import { SCORE_MATRIX_REDERIVED_TOLERANCE, SCORE_MATRIX_VERSION } from "../markets/score-matrix.js";
import { EXACT_SCORE_SETTLEMENT_VERSION } from "../markets/settlement.js";
import { MARKET_SELECTIONS } from "../odds/contract.js";
import { VALUE_POLICY } from "../value/decision.js";
import { PUSH_AWARE_EV_POLICY_VERSION } from "../value/extended-decision.js";

export const MODEL_CARD_SECTION_IDS = [
  "inputs",
  "dixon-coles",
  "what-is-excluded",
  "confidence",
  "limitations",
  "evaluation",
  "calibration",
  "extended-markets",
  "clv",
  "responsible-use",
] as const;

export const MODEL_CARD = Object.freeze({
  version: "model-card-v1.4.0",
  effectiveDate: "2026-11-25",
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
    financialV2: FLAT_ONE_UNIT_V2_POLICY_VERSION,
    clv: ODDS_RATIO_CLV_POLICY_VERSION,
    noVigClv: NO_VIG_CLV_POLICY_VERSION,
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
  /**
   * Asian handicap and exact score (Phase 14, D-21). Versions and the re-derivation tolerance come from the domain constants;
   * the card publishes the method, it never restates a number it does not own.
   */
  extendedMarkets: Object.freeze({
    versions: Object.freeze({
      scoreMatrix: SCORE_MATRIX_VERSION,
      ahLines: AH_LINES_VERSION,
      ahSettlement: AH_SETTLEMENT_VERSION,
      exactScoreBuckets: EXACT_SCORE_BUCKETS_VERSION,
      exactScoreSettlement: EXACT_SCORE_SETTLEMENT_VERSION,
      pushAwareEv: PUSH_AWARE_EV_POLICY_VERSION,
      flatOneUnitV2: FLAT_ONE_UNIT_V2_POLICY_VERSION,
    }),
    derivation: "Эти рынки не требуют новых данных: вероятности считаются из той же замороженной матрицы счёта, на которой построены 1X2, тотал 2.5 и «обе забьют». Матрица сохраняется вместе с каждым новым прогнозом и не меняется задним числом.",
    method: Object.freeze([
      "Азиатский гандикап: для каждой линии от −2.5 до +2.5 с шагом 0.25 показаны пять исходов — выигрыш, выигрыш половины ставки, возврат, проигрыш половины ставки и проигрыш. Полулинии (например, −0.5) не имеют возврата, на целых линиях возможен возврат ставки, а на четвертных (например, −0.75) ставка делится поровну между двумя соседними линиями.",
      "Главная линия — та, на которой по модели шансы сторон ближе всего к равным.",
      "Справедливый коэффициент подбирается так, чтобы ожидаемый результат ставки по модели был равен нулю с учётом возврата и половинных исходов. Ожидаемое value при коэффициенте букмекера считается по тем же пяти исходам. Это оценка модели, а не обещание прибыли.",
      "Точный счёт: 16 явных счетов от 0:0 до 3:3 и строка «Любой другой счёт» — все счета, не вошедшие в 16 явных, в том числе с четырьмя и более голами; хвост матрицы за пределами сетки 0–7 уже учтён нормировкой на сохранённую массу. Семнадцать вероятностей в сумме дают 100%.",
      "Эти вероятности не калибруются и не входят в оценку Брайера и сравнение моделей: калибровка применяется только к трём основным рынкам. Показываются сырые значения модели.",
    ]),
    formulas: Object.freeze([
      "fairOdds = 1 + (LOSS + HALF_LOSS/2) / (WIN + HALF_WIN/2)",
      "EV = WIN·(k−1) + HALF_WIN·(k−1)/2 − HALF_LOSS/2 − LOSS",
      "P(OTHER) = 1 − Σ(16 явных счетов)",
    ]),
    legacyTolerance: String(SCORE_MATRIX_REDERIVED_TOLERANCE),
    limitations: Object.freeze([
      "Матрица счёта — распределение самой модели, а не рыночное: оно может расходиться с линиями букмекеров, и расхождение само по себе не доказывает ошибку рынка.",
      "Выборки по завершённым матчам малы: по азиатскому гандикапу и точному счёту пока нельзя делать выводы о качестве модели.",
      "Для прогнозов, выпущенных до появления этой функции, матрица не сохранена. Если её не удаётся воспроизвести с точной сверкой по трём основным рынкам, расширенные рынки для такого прогноза недоступны.",
      "Вероятности без вига для азиатского гандикапа считаются пропорциональным приближением, которое не учитывает возврат ставки; оно служит только для оценки маржи и сравнения с закрытием линии и не участвует в расчёте ожидаемого value.",
      "Коэффициенты на эти рынки вводятся вручную полным набором; автоматической загрузки коэффициентов нет.",
      "Расчёт идёт по хранимому итоговому счёту матча. Для матчей с дополнительным временем или серией пенальти результат по азиатскому гандикапу и точному счёту может расходиться с правилами букмекера.",
    ]),
  }),
  /**
   * Closing line value (Phase 13, D-04, D-05, D-07). Policy versions and market set sizes come from the domain constants;
   * the card publishes the method, it never restates a number it does not own.
   */
  clv: Object.freeze({
    policyVersion: NO_VIG_CLV_POLICY_VERSION,
    frozenPolicyVersion: ODDS_RATIO_CLV_POLICY_VERSION,
    definition: "CLV (closing line value) сравнивает справедливую вероятность выбора по коэффициенту, который был у кандидата value, со справедливой вероятностью по последним коэффициентам закрытия того же рынка. Положительное значение означает, что к закрытию рынок сместился в сторону выбора.",
    formula: "clv = pClose_fair / pCandidate_fair − 1",
    method: Object.freeze([
      "Справедливые вероятности получаются делением обратных коэффициентов на их сумму (пропорциональное удаление маржи) по полному набору выборов одного рынка и одного источника: сторона кандидата берётся из его снимка ручных коэффициентов, сторона закрытия — из набора одного момента наблюдения.",
      `Прежнее значение ${ODDS_RATIO_CLV_POLICY_VERSION} (коэффициент кандидата, делённый на коэффициент закрытия, минус 1, на сырых коэффициентах с маржой) остаётся в замороженных квитанциях без изменений и показывается отдельно со своей подписью.`,
      "Если закрытия нет, набор неполный, источники различаются или нарушен порядок времени, значение недоступно с типизированной причиной; цену не достраивают и не интерполируют.",
    ]),
    evaluationOnly: Object.freeze([
      "CLV вычисляется при чтении, нигде не сохраняется и используется только для оценки качества: он не входит в отбор кандидатов value, их порядок, сканер и журнал решений. Границу проверяют автоматический тест на графе импортов и тест неизменности списка кандидатов при появлении закрытий.",
      "CLV не является прогнозом и не обещает прибыли: положительное значение говорит о движении рынка, а не о результате ставки.",
    ]),
    recording: Object.freeze([
      `Закрытие записывает оператор: полный набор выборов одного рынка одного матча за один момент наблюдения (${(Object.keys(MARKET_SELECTIONS) as (keyof typeof MARKET_SELECTIONS)[]).map((market) => `${market} — ${MARKET_SELECTIONS[market].length}`).join(", ")}) одной транзакцией.`,
      "Записи append-only: исправление — новое наблюдение с более поздним моментом, побеждает последнее до начала матча.",
      "Поздние записи отклоняются, а не сохраняются с пометкой: закрытие нельзя записать после начала матча или после расчёта матча, а момент наблюдения должен быть до начала матча и не в будущем. Так закрытие не может быть подогнано под результат.",
    ]),
    limitations: Object.freeze([
      "Один источник: сторона кандидата и сторона закрытия сравниваются только внутри одного источника; закрытие другого источника не подменяет отсутствующее.",
      "Закрытие вводится вручную оператором из одного источника и не является консенсусом рынка; ошибка ввода или неверный момент наблюдения меняют значение.",
      "Малые выборки: значение по отдельному кандидату шумное, а сводные доказательства по закрытию линии остаются описательными при малом числе сопоставимых кандидатов.",
      "Пропорциональное удаление маржи — упрощение: оно не учитывает, что маржа может распределяться между исходами неравномерно.",
      "CLV не заменяет вероятностные меры качества (Brier, Log Loss, надёжность): он не показывает, что вероятности модели верны.",
    ]),
  }),
  changeHistory: Object.freeze([
    Object.freeze({
      version: "model-card-v1.4.0",
      effectiveDate: "2026-11-25",
      summary: "Добавлены азиатский гандикап и точный счёт: расчёт при чтении из замороженной матрицы счёта, возврат и половинные исходы, ожидаемое value с учётом возврата.",
      affected: [AH_LINES_VERSION, AH_SETTLEMENT_VERSION, EXACT_SCORE_BUCKETS_VERSION, PUSH_AWARE_EV_POLICY_VERSION, SCORE_MATRIX_VERSION, FLAT_ONE_UNIT_V2_POLICY_VERSION].join(", "),
      interpretation: "Выданные снимки не переписаны. Три основных рынка, их калибровка и оценка не изменены. Для прогнозов без сохранённой матрицы расширенные рынки недоступны, если воспроизведение матрицы не прошло точную сверку.",
    }),
    Object.freeze({
      version: "model-card-v1.3.0",
      effectiveDate: "2026-11-24",
      summary: "Добавлен CLV без маржи: сравнение справедливых вероятностей кандидата и закрытия линии как оценочный вид, отдельный от прогноза и отбора.",
      affected: `${NO_VIG_CLV_POLICY_VERSION}, ${ODDS_RATIO_CLV_POLICY_VERSION}`,
      interpretation: "Выданные квитанции и снимки не переписаны: CLV без маржи вычисляется при чтении и показывается рядом с замороженным значением; на отбор и порядок кандидатов value он не влияет.",
    }),
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
