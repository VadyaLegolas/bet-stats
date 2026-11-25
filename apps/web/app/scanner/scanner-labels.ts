/**
 * Russian copy of the /scanner page (15-UI-SPEC.md Copywriting Contract). Pure strings and small pure builders: no
 * runtime import from the domain barrel, so the page copy stays free of server-only modules.
 *
 * Wording rules: candidates are model estimates, never advice; no ranking, certainty or urgency vocabulary. The only
 * sentence that may mention profit is the approved top line below, which negates it.
 */

/** Freshness policy as returned by the API; the copy never hard-codes the thresholds. */
export interface ScannerFreshnessPolicyView {
  readonly version: string;
  readonly freshMaxHours: number;
  readonly agingMaxHours: number;
}

export const SCANNER_TITLE = "Сканер value";
export const SCANNER_TOP_LINE = "Кандидаты value — это оценка модели, а не рекомендация и не обещание прибыли.";
export const SCANNER_SCOPE_LINE =
  "Сводный список по матчам ближайших 7 суток и всем рынкам: 1X2, тотал 2.5, обе забьют, азиатский гандикап, точный счёт. Значения взяты из сохранённых квитанций и не пересчитываются. Время указано по Europe/Warsaw.";
export const SCANNER_ORDERING_NOTICE =
  "Список не ранжирован: матчи идут по времени начала, внутри матча — по рынку и выбору. Порядок не показывает ни размер преимущества, ни качество кандидата.";

/* How to read the values */
export const HOW_TO_READ_SUMMARY = "Как читать значения";
export type HowToReadBullet = string | { readonly before: string; readonly code: string; readonly after: string };
export function howToReadBullets(policy: ScannerFreshnessPolicyView): readonly HowToReadBullet[] {
  const { freshMaxHours: fresh, agingMaxHours: aging } = policy;
  return [
    "Преимущество и ожидаемое value показаны ровно так, как записаны в квитанции: без округления и пересчёта. Преимущество — доля вероятности (0.05 означает 5 процентных пунктов), ожидаемое value — результат на 1 единицу ставки. На странице матча те же числа могут быть показаны в процентах.",
    "Коэффициенты вводятся вручную. Источник — метка, указанная при вводе, и время ввода коэффициентов.",
    {
      before: `Свежесть считается от времени ввода коэффициентов: до ${fresh} ч — свежие, от ${fresh} до ${aging} ч — стареют, больше ${aging} ч — устарели (версия правил `,
      code: policy.version,
      after: "). Устаревшие строки вынесены в отдельный блок внизу, их значения не менялись.",
    },
    "Пометка «Прогноз обновлён» значит, что после этой квитанции вышел более новый снимок прогноза. Значения в строке относятся к прежнему снимку.",
    "Для азиатского гандикапа показана эффективная вероятность выигрыша, а преимущество — это условная вероятность выигрыша (без учёта возврата ставки) минус вероятность без вига.",
    "Квитанции других исходов — недостаточно доказательств или пороги политики не пройдены — в список не попадают.",
  ];
}

/* State A: list */
export const LIST_HEADING = "Кандидаты value на ближайшие 7 суток";
/** Text before the generation time element; the page appends the time and a full stop. */
export function summaryCountsText(candidates: number, matches: number): string {
  return `Кандидатов: ${candidates}, матчей: ${matches}. Данные на `;
}
export const TRUNCATION_CHIP = "Показана часть списка";
/** Amended truncation wording (Plan 15-02): the cut happens on a fixture boundary, so the shown count can be below the limit. */
export function truncationText(shown: number, total: number, limit: number): string {
  return `Показаны кандидаты первых по времени матчей: ${shown} из ${total} (лимит списка — ${limit}). Более поздние матчи в список не вошли.`;
}
export const ALL_STALE_LINE =
  "Кандидатов со свежими или стареющими коэффициентами нет. Все кандидаты — в блоке «Устаревшие коэффициенты» ниже.";
export function staleHeading(count: number): string {
  return `Устаревшие коэффициенты (${count})`;
}
export function staleLead(agingMaxHours: number): string {
  return `Коэффициенты в этих строках введены более ${agingMaxHours} часов назад, рынок мог измениться с тех пор. Значения не менялись и показаны как в квитанции.`;
}
export function staleSummary(count: number): string {
  return `Показать устаревшие строки: ${count}`;
}

/* Row */
export const FACT_LABELS = {
  edge: "Преимущество (edge)",
  expectedValue: "Ожидаемое value",
  decimalOdds: "Коэффициент букмекера",
  modelProbability: "Вероятность модели",
  modelProbabilityAsianHandicap: "Эффективная вероятность выигрыша",
  noVigProbability: "Вероятность без вига",
  fairOdds: "Справедливый коэффициент",
  receipt: "Квитанция",
  forecastSnapshot: "Снимок прогноза",
  policyVersion: "Правила квитанции",
  edgeDefinition: "Определение преимущества",
} as const;
export const FACT_UNITS = {
  edge: "доля вероятности, как в квитанции",
  expectedValue: "на 1 единицу ставки",
  modelProbability: "доля, как в квитанции",
} as const;
export const ODDS_ENTERED_PREFIX = "Введены ";
export const MISSING_SOURCE = "Источник не указан";
export const MISSING_VALUE = "Не записано";
export const FAIR_ODDS_UNAVAILABLE = "Недоступно";
export function sourceLine(source: string | null): string {
  return source === null || source.trim() === "" ? MISSING_SOURCE : `Источник: ${source}`;
}

export const FRESHNESS_LABELS: Readonly<Record<"FRESH" | "AGING" | "STALE", string>> = {
  FRESH: "Свежие коэффициенты",
  AGING: "Коэффициенты стареют",
  STALE: "Коэффициенты устарели",
};
export const FORECAST_UPDATED_CHIP = "Прогноз обновлён";
export const FORECAST_UPDATED_NOTE = "После этой квитанции вышел более новый снимок прогноза. Значения в строке относятся к прежнему снимку.";
export const DETAIL_SUMMARY = "Подробности квитанции";
export const ASIAN_HANDICAP_EDGE_DEFINITION_ID = "conditional-win-probability-minus-no-vig";
export const ASIAN_HANDICAP_EDGE_NOTE = "Преимущество — условная вероятность выигрыша (без учёта возврата ставки) минус вероятность без вига.";

/** Plain prefix test: the market id of an Asian handicap starts with the family code. */
export function isAsianHandicapMarket(market: string): boolean {
  return market.startsWith("ASIAN_HANDICAP");
}

/* Links and their screen-reader suffixes (visible text stays a prefix of the accessible name) */
export const MATCH_LINK_TEXT = "Страница матча";
export const RECEIPT_LINK_TEXT = "Квитанция (JSON)";
export function matchLinkSuffix(home: string, away: string, marketLabel: string, selectionLabel: string): string {
  return ` ${home} — ${away}, ${marketLabel}, ${selectionLabel}`;
}
export function receiptLinkSuffix(marketLabel: string, selectionLabel: string): string {
  return ` ${marketLabel}, ${selectionLabel}; откроется в новой вкладке`;
}

/* State B: empty */
export const EMPTY_HEADING = "Кандидатов value на ближайшие 7 суток нет";
export const EMPTY_CHIP = "Пусто";
export const EMPTY_TEXT =
  "Запрос выполнен успешно, но среди сохранённых квитанций для матчей ближайших 7 суток нет ни одного кандидата value. Это не сбой данных.";
export const CHECKED_COUNT_LABEL = "Проверено квитанций в окне";
export const EMPTY_ZERO_RECEIPTS_TEXT =
  "Для матчей этого окна сохранённых квитанций value пока нет. Квитанции создаются после ручного ввода коэффициентов на странице матча.";
export const EMPTY_ZERO_RECEIPTS_LINK = "Открыть матчи";
export const EMPTY_OUTCOMES_LEGEND = "Квитанции с этими исходами в список кандидатов не попадают.";

export const VALUE_OUTCOME_LABELS: Readonly<Record<string, string>> = {
  VALUE_CANDIDATE: "кандидат value",
  INSUFFICIENT_EVIDENCE: "недостаточно доказательств",
  NO_VALUE: "не прошло пороги политики",
};
/** Unknown outcome code: the raw code, never blank. */
export function valueOutcomeLabel(code: string): string {
  return Object.hasOwn(VALUE_OUTCOME_LABELS, code) ? VALUE_OUTCOME_LABELS[code]! : code;
}
const FIXED_OUTCOME_ORDER = ["INSUFFICIENT_EVIDENCE", "NO_VALUE"] as const;
/** Fixed tile order: the two known outcomes, then every other code alphabetically. Never sorted by count. */
export function outcomeTileOrder(counts: Readonly<Record<string, number>>): readonly string[] {
  const fixed = FIXED_OUTCOME_ORDER.filter((code) => Object.hasOwn(counts, code));
  const others = Object.keys(counts).filter((code) => !(FIXED_OUTCOME_ORDER as readonly string[]).includes(code)).sort();
  return [...fixed, ...others];
}

/* Policy-unmet plaque */
export const POLICY_PLAQUE_LABEL = "Ограничение версии политики value";
export const POLICY_PLAQUE_TEXT =
  "У всех квитанций этого окна версия конфигурации прогноза или схемы коэффициентов не соответствует политике value, поэтому кандидатов нет. Это ограничение версии, а не отсутствие расхождений с рынком. Политика на этой странице не меняется.";
export const POLICY_PLAQUE_LINK = "Методология и ограничения";
export const POLICY_PLAQUE_HREF = "/methodology#limitations";

/* State C: unavailable */
export const UNAVAILABLE_HEADING = "Сканер value сейчас недоступен";
export const UNAVAILABLE_CHIP = "Недоступно";
export const UNAVAILABLE_TEXT = "Не удалось получить список кандидатов. Это не значит, что кандидатов нет.";
export const UNAVAILABLE_HINT = "Обновите страницу или вернитесь позже.";
export const UNAVAILABLE_LINK = "Обновить страницу";

/* Navigation, home page and methodology (wired by Plan 15-04) */
export const SCANNER_HOME_CONTENT = {
  label: "Сканер value",
  href: "/scanner",
  detail: "Сводный список кандидатов value на ближайшие 7 суток: значения из сохранённых квитанций, без ранжирования по преимуществу.",
} as const;
export const SCANNER_METHODOLOGY_LIMITATION =
  "Политика value привязана к определённой версии конфигурации прогноза и схемы коэффициентов; квитанции с другой версией кандидатов не дают, поэтому сканер value может быть пустым при исправных данных.";
