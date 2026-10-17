import type { ForecastKind, OddsMarket, OddsSelection } from "@bet-stats/domain";

/**
 * Central Russian labels for raw enum codes that reach rendered UI copy.
 *
 * Fallback contract (pure, dependency-free, never throws):
 * - every mapped function falls back to the raw code so an unknown value never renders blank;
 * - `reasonLabel` falls back to the previous lowercase-underscore transform;
 * - `evidenceLimitationLabel` falls back to the input unchanged because DTO limitation
 *   reasons can be full English sentences that must not be mangled.
 */

export const MARKET_LABELS: Record<OddsMarket, string> = { ONE_X_TWO: "1X2", OVER_UNDER_2_5: "Тотал 2.5", BTTS: "Обе забьют" };
export const SELECTION_LABELS: Record<OddsSelection, string> = { HOME: "Хозяева", DRAW: "Ничья", AWAY: "Гости", OVER_2_5: "Тотал больше 2.5", UNDER_2_5: "Тотал меньше 2.5", YES: "Да", NO: "Нет" };

const FORECAST_KIND_LABELS: Record<ForecastKind, string> = { INITIAL: "первичный", PRE_MATCH: "предматчевый", LINEUP_CONFIRMED: "по подтверждённому составу" };
const ROUTE_OUTCOME_LABELS: Record<string, string> = { ADMITTED: "Допущено", DENIED: "Отклонено", NO_FALLBACK: "Резервный источник недоступен", SUCCEEDED: "Успешно", FAILED: "Сбой", QUARANTINED: "Карантин" };
const ROUTE_TRIGGER_LABELS: Record<string, string> = { PRIMARY: "Первичный источник", UNSUPPORTED_COVERAGE: "Регион не поддерживается", ALLOWANCE_EXHAUSTED: "Бюджет запросов исчерпан", CIRCUIT_OPEN: "Сработал предохранитель", TRANSPORT_FAILURE: "Сбой транспорта", RATE_LIMITED: "Превышен лимит частоты", PROVIDER_UNAVAILABLE: "Провайдер недоступен", ROUTE_PENDING: "Маршрут ожидается", NO_PRODUCTION_FALLBACK: "Продакшен-резерв недоступен", UNSUPPORTED_CAPABILITY: "Возможность не поддерживается", STALE_CAPABILITY: "Устаревшая возможность", EXPIRED_CAPABILITY: "Возможность истекла", CRITICAL_HEADROOM: "Критический запас бюджета", UNKNOWN_CAPABILITY: "Неизвестная возможность", CAPABILITY_MISMATCH: "Несовпадение возможности" };
const REASON_LABELS: Record<string, string> = { PROVIDER_OBSERVATION_RECORDED: "получено наблюдение провайдера", PROVENANCE_NOT_AVAILABLE: "провенанс источника недоступен", FRESHNESS_THRESHOLD_EXCEEDED: "превышен порог свежести", SOURCE_UPDATE_TIME_MISSING: "нет времени обновления источника", INVALID_SOURCE_UPDATE_TIME: "недопустимое время обновления источника", UNKNOWN_DATA_STATE: "состояние данных неизвестно" };
const EVIDENCE_LIMITATION_LABELS: Record<string, string> = { NO_ELIGIBLE_HISTORY: "нет пригодной истории", LIMITED_HISTORY: "история ограничена", MISSING_TIMESTAMP: "нет отметки времени", EMPTY: "нет данных" };
const VALUE_REASON_LABELS: Record<string, string> = { POLICY_CONFIG_MISMATCH: "версия конфигурации или схемы не соответствует политике value", UNRESOLVED_CANONICAL_IDENTITY: "каноническая идентичность команд не подтверждена", FIXTURE_MISMATCH: "снимки относятся к разным матчам", MARKET_SELECTION_MISMATCH: "рынок или выбор не совпадают", CONFIDENCE_BELOW_THRESHOLD: "уверенность ниже порога", EDGE_BELOW_THRESHOLD: "преимущество ниже порога", EV_BELOW_THRESHOLD: "ожидаемое value ниже порога" };
const VALUE_SIDE_LABELS: Record<string, string> = { HOME: "хозяев", AWAY: "гостей" };
const CONFIDENCE_COMPONENT_LABELS: Record<string, string> = { completeness: "Полнота данных", lineupAvailability: "Доступность составов", freshness: "Свежесть данных", sourceReliability: "Надёжность источника", modelStability: "Стабильность модели" };
const FORECAST_LIMITATION_FIXED: Record<string, string> = { UNRESOLVED_CANONICAL_IDENTITY: "каноническая идентичность команд не подтверждена" };
const FORECAST_LIMITATION_KINDS: Record<string, string> = { GOAL_RATES: "голевые показатели", ELO: "рейтинг Эло", FORM_5: "форма за 5 матчей", HOME_STRENGTH: "сила дома", AWAY_STRENGTH: "сила в гостях", REST_DAYS: "дни отдыха", BUILD_ID: "идентификатор сборки доказательств" };
const FINANCIAL_OUTCOME_LABELS: Record<string, string> = { WIN: "выигрыш", LOSS: "проигрыш", VOID: "возврат ставки", PENDING: "ожидает итога" };
const RECONCILIATION_METHOD_LABELS: Record<string, string> = { EXACT_EXTERNAL_REF: "точное совпадение внешней ссылки", UNIQUE_CONSERVATIVE_MATCH: "уникальное консервативное совпадение", MANUAL_REVIEW: "ручная проверка", OPERATOR_CONFIRMED: "подтверждено оператором" };
const SERVICE_STATE_LABELS: Record<string, string> = { UP: "доступно", DOWN: "недоступно", DEGRADED: "деградация" };
const IMPACT_LABELS: Record<string, string> = { BLOCKING: "блокирует", DEGRADED: "деградация" };
const INCIDENT_STATUS_LABELS: Record<string, string> = { OPEN: "открыт", RESOLVED: "решён" };

/** Unknown kind → the raw code. */
export function forecastKindLabel(kind: ForecastKind): string { return FORECAST_KIND_LABELS[kind] ?? kind; }
/** Unknown market → the raw code. */
export function oddsMarketLabel(market: OddsMarket): string { return MARKET_LABELS[market] ?? market; }
/** Unknown selection → the raw code. */
export function oddsSelectionLabel(selection: OddsSelection): string { return SELECTION_LABELS[selection] ?? selection; }
/** Unknown outcome → the raw code. */
export function routeOutcomeLabel(outcome: string): string { return ROUTE_OUTCOME_LABELS[outcome] ?? outcome; }
/** Unknown trigger → the raw code. */
export function routeTriggerLabel(trigger: string): string { return ROUTE_TRIGGER_LABELS[trigger] ?? trigger; }
/** Unknown reason → the previous lowercase-underscore transform. */
export function reasonLabel(reason: string): string { return REASON_LABELS[reason] ?? reason.replaceAll("_", " ").toLowerCase(); }
/**
 * Provider route reason: `projectProviderState` puts effective trigger/capability codes into
 * `reason`, so try the trigger dictionary first, then the data-state reason dictionary;
 * unknown → the lowercase-underscore transform.
 */
export function providerReasonLabel(reason: string): string { return ROUTE_TRIGGER_LABELS[reason] ?? reasonLabel(reason); }
/** Unknown limitation reason → the input unchanged (DTO prose must not be mangled). */
export function evidenceLimitationLabel(reason: string): string { return EVIDENCE_LIMITATION_LABELS[reason] ?? reason; }
/** Unknown financial outcome → the raw code. */
export function financialOutcomeLabel(outcome: string): string { return FINANCIAL_OUTCOME_LABELS[outcome] ?? outcome; }
/** Unknown method → the raw code. */
export function reconciliationMethodLabel(method: string): string { return RECONCILIATION_METHOD_LABELS[method] ?? method; }
/** Unknown service state → the raw code. */
export function serviceStateLabel(state: string): string { return SERVICE_STATE_LABELS[state] ?? state; }
/** Unknown impact → the raw code. */
export function impactLabel(impact: string): string { return IMPACT_LABELS[impact] ?? impact; }
/** Unknown incident status → the raw code. */
export function incidentStatusLabel(status: string): string { return INCIDENT_STATUS_LABELS[status] ?? status; }
/** Unknown value reason → the lowercase-underscore transform (camelCase reasons are split into words first). */
export function valueReasonLabel(reason: string): string {
  const fixed = VALUE_REASON_LABELS[reason];
  if (fixed) return fixed;
  const cutoff = /^(.+)_CUTOFF_MISMATCH$/.exec(reason);
  const side = cutoff ? VALUE_SIDE_LABELS[cutoff[1]!] : undefined;
  if (cutoff && side) return `отсечка доказательств ${side} не совпала`;
  return reason.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase();
}
/** Unknown confidence component → the previous lowercase-words transform. */
export function confidenceComponentLabel(name: string): string { return CONFIDENCE_COMPONENT_LABELS[name] ?? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase(); }
/**
 * Forecast limitation reason: parse the structured `MISSING_/WEAK_ + side + kind`,
 * `side_CUTOFF_MISMATCH` and `side_EVIDENCE_state` codes from the forecast model;
 * unknown reasons → the lowercase-underscore transform.
 */
export function forecastLimitationLabel(reason: string): string {
  const fixed = FORECAST_LIMITATION_FIXED[reason];
  if (fixed) return fixed;
  const weakMissing = /^(MISSING|WEAK)_(HOME|AWAY)_(.+)$/.exec(reason);
  if (weakMissing) {
    const kind = FORECAST_LIMITATION_KINDS[weakMissing[3]!];
    const side = VALUE_SIDE_LABELS[weakMissing[2]!];
    if (kind && side) return `${weakMissing[1] === "MISSING" ? "нет данных" : "мало данных"}: ${kind} ${side}`;
  }
  const sideFirst = /^(HOME|AWAY)_(CUTOFF_MISMATCH|EVIDENCE_(.+))$/.exec(reason);
  if (sideFirst) {
    const side = VALUE_SIDE_LABELS[sideFirst[1]!];
    if (side) return sideFirst[2] === "CUTOFF_MISMATCH" ? `отсечка доказательств ${side} не совпала` : `доказательства ${side} неполные (${sideFirst[3]!.toLowerCase()})`;
  }
  return reason.replaceAll("_", " ").toLowerCase();
}
