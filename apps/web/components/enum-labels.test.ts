import { AH_LINES_V1, AH_RESULTS, MARKET_FAMILIES, type AhLineToken } from "@bet-stats/domain";
import { describe, expect, it } from "vitest";

import {
  AH_RESULT_LABELS,
  AH_RESULT_ORDER,
  backupStateLabel,
  confidenceComponentLabel,
  evidenceLimitationLabel,
  financialOutcomeLabel,
  forecastKindLabel,
  EXTENDED_MARKETS_UNAVAILABLE_FALLBACK,
  EXTENDED_MARKETS_UNAVAILABLE_LABELS,
  extendedUnavailableLabel,
  FAIR_ODDS_UNAVAILABLE_LABELS,
  forecastLimitationLabel,
  formatAhLine,
  impactLabel,
  incidentStatusLabel,
  MARKET_FAMILY_LABELS,
  MARKET_LABELS,
  oddsMarketLabel,
  oddsSelectionLabel,
  offsiteStateLabel,
  providerReasonLabel,
  reasonLabel,
  reconciliationMethodLabel,
  routeOutcomeLabel,
  routeTriggerLabel,
  SCORE_MATRIX_SOURCE_LABELS,
  selectionLabelFor,
  SELECTION_LABELS,
  serviceStateLabel,
  valueReasonLabel,
} from "./enum-labels";

describe("forecastKindLabel", () => {
  it("maps every forecast kind to Russian", () => {
    expect(forecastKindLabel("INITIAL")).toBe("первичный");
    expect(forecastKindLabel("PRE_MATCH")).toBe("предматчевый");
    expect(forecastKindLabel("LINEUP_CONFIRMED")).toBe("по подтверждённому составу");
  });
});

describe("odds market and selection labels", () => {
  it("keeps the exact market and selection dictionaries", () => {
    expect(MARKET_LABELS).toEqual({ ONE_X_TWO: "1X2", OVER_UNDER_2_5: "Тотал 2.5", BTTS: "Обе забьют" });
    expect(SELECTION_LABELS).toEqual({ HOME: "Хозяева", DRAW: "Ничья", AWAY: "Гости", OVER_2_5: "Тотал больше 2.5", UNDER_2_5: "Тотал меньше 2.5", YES: "Да", NO: "Нет" });
  });
  it("routes the label functions through the same records", () => {
    expect(oddsMarketLabel("ONE_X_TWO")).toBe("1X2");
    expect(oddsMarketLabel("OVER_UNDER_2_5")).toBe("Тотал 2.5");
    expect(oddsMarketLabel("BTTS")).toBe("Обе забьют");
    expect(oddsSelectionLabel("HOME")).toBe("Хозяева");
    expect(oddsSelectionLabel("DRAW")).toBe("Ничья");
    expect(oddsSelectionLabel("AWAY")).toBe("Гости");
    expect(oddsSelectionLabel("OVER_2_5")).toBe("Тотал больше 2.5");
    expect(oddsSelectionLabel("UNDER_2_5")).toBe("Тотал меньше 2.5");
    expect(oddsSelectionLabel("YES")).toBe("Да");
    expect(oddsSelectionLabel("NO")).toBe("Нет");
  });
});

describe("routeOutcomeLabel", () => {
  it("maps every receipt outcome to Russian", () => {
    expect(routeOutcomeLabel("ADMITTED")).toBe("Допущено");
    expect(routeOutcomeLabel("DENIED")).toBe("Отклонено");
    expect(routeOutcomeLabel("NO_FALLBACK")).toBe("Резервный источник недоступен");
    expect(routeOutcomeLabel("SUCCEEDED")).toBe("Успешно");
    expect(routeOutcomeLabel("FAILED")).toBe("Сбой");
    expect(routeOutcomeLabel("QUARANTINED")).toBe("Карантин");
  });
  it("passes an unknown outcome through unchanged", () => {
    expect(routeOutcomeLabel("MYSTERY")).toBe("MYSTERY");
  });
});

describe("routeTriggerLabel", () => {
  it("maps every route trigger to Russian", () => {
    expect(routeTriggerLabel("PRIMARY")).toBe("Первичный источник");
    expect(routeTriggerLabel("UNSUPPORTED_COVERAGE")).toBe("Регион не поддерживается");
    expect(routeTriggerLabel("ALLOWANCE_EXHAUSTED")).toBe("Бюджет запросов исчерпан");
    expect(routeTriggerLabel("CIRCUIT_OPEN")).toBe("Сработал предохранитель");
    expect(routeTriggerLabel("TRANSPORT_FAILURE")).toBe("Сбой транспорта");
    expect(routeTriggerLabel("RATE_LIMITED")).toBe("Превышен лимит частоты");
    expect(routeTriggerLabel("PROVIDER_UNAVAILABLE")).toBe("Провайдер недоступен");
    expect(routeTriggerLabel("ROUTE_PENDING")).toBe("Маршрут ожидается");
    expect(routeTriggerLabel("NO_PRODUCTION_FALLBACK")).toBe("Продакшен-резерв недоступен");
    expect(routeTriggerLabel("UNSUPPORTED_CAPABILITY")).toBe("Возможность не поддерживается");
    expect(routeTriggerLabel("STALE_CAPABILITY")).toBe("Устаревшая возможность");
    expect(routeTriggerLabel("EXPIRED_CAPABILITY")).toBe("Возможность истекла");
    expect(routeTriggerLabel("CRITICAL_HEADROOM")).toBe("Критический запас бюджета");
    expect(routeTriggerLabel("UNKNOWN_CAPABILITY")).toBe("Неизвестная возможность");
    expect(routeTriggerLabel("CAPABILITY_MISMATCH")).toBe("Несовпадение возможности");
  });
  it("passes an unknown trigger through unchanged", () => {
    expect(routeTriggerLabel("MYSTERY_TRIGGER")).toBe("MYSTERY_TRIGGER");
  });
});

describe("reasonLabel", () => {
  it("maps every known data-state reason to Russian", () => {
    expect(reasonLabel("PROVIDER_OBSERVATION_RECORDED")).toBe("получено наблюдение провайдера");
    expect(reasonLabel("PROVENANCE_NOT_AVAILABLE")).toBe("провенанс источника недоступен");
    expect(reasonLabel("FRESHNESS_THRESHOLD_EXCEEDED")).toBe("превышен порог свежести");
    expect(reasonLabel("SOURCE_UPDATE_TIME_MISSING")).toBe("нет времени обновления источника");
    expect(reasonLabel("INVALID_SOURCE_UPDATE_TIME")).toBe("недопустимое время обновления источника");
    expect(reasonLabel("UNKNOWN_DATA_STATE")).toBe("состояние данных неизвестно");
  });
  it("falls back to the lowercase-underscore transform for unknown reasons", () => {
    expect(reasonLabel("NO_PRODUCTION_FALLBACK")).toBe("no production fallback");
    expect(reasonLabel("UPSTREAM_UNAVAILABLE")).toBe("upstream unavailable");
  });
});

describe("providerReasonLabel", () => {
  it("translates trigger and capability codes that flow into provider reasons", () => {
    expect(providerReasonLabel("PRIMARY")).toBe("Первичный источник");
    expect(providerReasonLabel("ROUTE_PENDING")).toBe("Маршрут ожидается");
    expect(providerReasonLabel("NO_PRODUCTION_FALLBACK")).toBe("Продакшен-резерв недоступен");
    expect(providerReasonLabel("CIRCUIT_OPEN")).toBe("Сработал предохранитель");
    expect(providerReasonLabel("EXPIRED_CAPABILITY")).toBe("Возможность истекла");
  });
  it("uses the data-state dictionary for non-trigger reasons", () => {
    expect(providerReasonLabel("FRESHNESS_THRESHOLD_EXCEEDED")).toBe("превышен порог свежести");
  });
  it("falls back to the lowercase-underscore transform for unknown reasons", () => {
    expect(providerReasonLabel("UPSTREAM_UNAVAILABLE")).toBe("upstream unavailable");
  });
});

describe("evidenceLimitationLabel", () => {
  it("maps every known limitation reason to Russian", () => {
    expect(evidenceLimitationLabel("NO_ELIGIBLE_HISTORY")).toBe("нет пригодной истории");
    expect(evidenceLimitationLabel("LIMITED_HISTORY")).toBe("история ограничена");
    expect(evidenceLimitationLabel("MISSING_TIMESTAMP")).toBe("нет отметки времени");
    expect(evidenceLimitationLabel("EMPTY")).toBe("нет данных");
  });
  it("passes full English DTO sentences through byte-identical", () => {
    const sentence = "Not enough completed matches before this cutoff.";
    expect(evidenceLimitationLabel(sentence)).toBe(sentence);
  });
});

describe("financialOutcomeLabel", () => {
  it("maps every settlement outcome to Russian", () => {
    expect(financialOutcomeLabel("WIN")).toBe("выигрыш");
    expect(financialOutcomeLabel("LOSS")).toBe("проигрыш");
    expect(financialOutcomeLabel("VOID")).toBe("возврат ставки");
    expect(financialOutcomeLabel("PENDING")).toBe("ожидает итога");
  });
  it("passes an unknown outcome through unchanged", () => {
    expect(financialOutcomeLabel("MYSTERY")).toBe("MYSTERY");
  });
});

describe("reconciliationMethodLabel", () => {
  it("maps every reconciliation method to Russian", () => {
    expect(reconciliationMethodLabel("EXACT_EXTERNAL_REF")).toBe("точное совпадение внешней ссылки");
    expect(reconciliationMethodLabel("UNIQUE_CONSERVATIVE_MATCH")).toBe("уникальное консервативное совпадение");
    expect(reconciliationMethodLabel("MANUAL_REVIEW")).toBe("ручная проверка");
    expect(reconciliationMethodLabel("OPERATOR_CONFIRMED")).toBe("подтверждено оператором");
  });
  it("passes an unknown method through unchanged", () => {
    expect(reconciliationMethodLabel("MYSTERY_METHOD")).toBe("MYSTERY_METHOD");
  });
});

describe("valueReasonLabel", () => {
  it("maps every value decision reason to Russian", () => {
    expect(valueReasonLabel("POLICY_CONFIG_MISMATCH")).toBe("версия конфигурации или схемы не соответствует политике value");
    expect(valueReasonLabel("UNRESOLVED_CANONICAL_IDENTITY")).toBe("каноническая идентичность команд не подтверждена");
    expect(valueReasonLabel("FIXTURE_MISMATCH")).toBe("снимки относятся к разным матчам");
    expect(valueReasonLabel("MARKET_SELECTION_MISMATCH")).toBe("рынок или выбор не совпадают");
    expect(valueReasonLabel("CONFIDENCE_BELOW_THRESHOLD")).toBe("уверенность ниже порога");
    expect(valueReasonLabel("EDGE_BELOW_THRESHOLD")).toBe("преимущество ниже порога");
    expect(valueReasonLabel("EV_BELOW_THRESHOLD")).toBe("ожидаемое value ниже порога");
  });
  it("translates side-prefixed cutoff mismatch codes", () => {
    expect(valueReasonLabel("HOME_CUTOFF_MISMATCH")).toBe("отсечка доказательств хозяев не совпала");
    expect(valueReasonLabel("AWAY_CUTOFF_MISMATCH")).toBe("отсечка доказательств гостей не совпала");
  });
  it("falls back to the lowercase-words transform for unknown reasons", () => {
    expect(valueReasonLabel("SOME_NEW_GATE_FAILED")).toBe("some new gate failed");
  });
});

describe("confidenceComponentLabel", () => {
  it("maps every confidence component to Russian", () => {
    expect(confidenceComponentLabel("completeness")).toBe("Полнота данных");
    expect(confidenceComponentLabel("lineupAvailability")).toBe("Доступность составов");
    expect(confidenceComponentLabel("freshness")).toBe("Свежесть данных");
    expect(confidenceComponentLabel("sourceReliability")).toBe("Надёжность источника");
    expect(confidenceComponentLabel("modelStability")).toBe("Стабильность модели");
  });
  it("falls back to the lowercase-words transform for unknown components", () => {
    expect(confidenceComponentLabel("someNewFactor")).toBe("some new factor");
  });
});

describe("forecastLimitationLabel", () => {
  it("maps structured missing and weak component codes to Russian", () => {
    expect(forecastLimitationLabel("MISSING_HOME_GOAL_RATES")).toBe("нет данных: голевые показатели хозяев");
    expect(forecastLimitationLabel("MISSING_AWAY_GOAL_RATES")).toBe("нет данных: голевые показатели гостей");
    expect(forecastLimitationLabel("WEAK_HOME_ELO")).toBe("мало данных: рейтинг Эло хозяев");
    expect(forecastLimitationLabel("WEAK_AWAY_FORM_5")).toBe("мало данных: форма за 5 матчей гостей");
    expect(forecastLimitationLabel("MISSING_HOME_HOME_STRENGTH")).toBe("нет данных: сила дома хозяев");
    expect(forecastLimitationLabel("MISSING_AWAY_REST_DAYS")).toBe("нет данных: дни отдыха гостей");
    expect(forecastLimitationLabel("MISSING_HOME_BUILD_ID")).toBe("нет данных: идентификатор сборки доказательств хозяев");
  });
  it("maps cutoff and evidence state codes to Russian", () => {
    expect(forecastLimitationLabel("HOME_CUTOFF_MISMATCH")).toBe("отсечка доказательств хозяев не совпала");
    expect(forecastLimitationLabel("AWAY_EVIDENCE_LIMITED")).toBe("доказательства гостей неполные (limited)");
  });
  it("maps the fixed canonical reason and falls back for unknown codes", () => {
    expect(forecastLimitationLabel("UNRESOLVED_CANONICAL_IDENTITY")).toBe("каноническая идентичность команд не подтверждена");
    expect(forecastLimitationLabel("SOME_NEW_LIMITATION")).toBe("some new limitation");
  });
});

describe("operations labels", () => {
  it("maps service states, impacts and incident statuses to Russian", () => {
    expect(serviceStateLabel("UP")).toBe("доступно");
    expect(serviceStateLabel("DOWN")).toBe("недоступно");
    expect(serviceStateLabel("DEGRADED")).toBe("деградация");
    expect(impactLabel("BLOCKING")).toBe("блокирует");
    expect(impactLabel("DEGRADED")).toBe("деградация");
    expect(incidentStatusLabel("OPEN")).toBe("открыт");
    expect(incidentStatusLabel("RESOLVED")).toBe("решён");
  });
  it("passes unknown values through unchanged", () => {
    expect(serviceStateLabel("MYSTERY_STATE")).toBe("MYSTERY_STATE");
    expect(impactLabel("MYSTERY_IMPACT")).toBe("MYSTERY_IMPACT");
    expect(incidentStatusLabel("MYSTERY_STATUS")).toBe("MYSTERY_STATUS");
  });
});

describe("backup state labels", () => {
  it("maps the five read-time backup states and the three offsite states to Russian", () => {
    expect(backupStateLabel("NOT_CONFIGURED")).toBe("Не настроено");
    expect(backupStateLabel("NEVER_VERIFIED")).toBe("Никогда не проверялось");
    expect(backupStateLabel("STALE")).toBe("Устарело");
    expect(backupStateLabel("FAILED")).toBe("Сбой");
    expect(backupStateLabel("HEALTHY")).toBe("Здорово");
    expect(offsiteStateLabel("NOT_CONFIGURED")).toBe("Не настроено");
    expect(offsiteStateLabel("COPIED")).toBe("Скопировано");
    expect(offsiteStateLabel("DEGRADED")).toBe("Деградировано");
  });
  it("passes unknown states through unchanged", () => {
    expect(backupStateLabel("MYSTERY_BACKUP_STATE")).toBe("MYSTERY_BACKUP_STATE");
    expect(offsiteStateLabel("MYSTERY_OFFSITE_STATE")).toBe("MYSTERY_OFFSITE_STATE");
  });
});

const AH_LINE_PINS: Readonly<Record<AhLineToken, string>> = {
  "-2.5": "−2.5", "-2.25": "−2.25", "-2": "−2", "-1.75": "−1.75", "-1.5": "−1.5", "-1.25": "−1.25", "-1": "−1", "-0.75": "−0.75", "-0.5": "−0.5", "-0.25": "−0.25",
  "0": "0",
  "+0.25": "+0.25", "+0.5": "+0.5", "+0.75": "+0.75", "+1": "+1", "+1.25": "+1.25", "+1.5": "+1.5", "+1.75": "+1.75", "+2": "+2", "+2.25": "+2.25", "+2.5": "+2.5",
};

describe("extended market dictionaries are exhaustive over the domain unions", () => {
  it("covers every market family, Asian handicap result and unavailable reason", () => {
    expect(Object.keys(MARKET_FAMILY_LABELS).sort()).toEqual([...MARKET_FAMILIES].sort());
    expect(MARKET_FAMILY_LABELS).toEqual({ ONE_X_TWO: "1X2", OVER_UNDER_2_5: "Тотал 2.5", BTTS: "Обе забьют", ASIAN_HANDICAP: "Азиатский гандикап", EXACT_SCORE: "Точный счёт" });
    expect(Object.keys(AH_RESULT_LABELS).sort()).toEqual([...AH_RESULTS].sort());
    expect([...AH_RESULT_ORDER]).toEqual(["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"]);
    expect(AH_RESULT_ORDER.map((result) => AH_RESULT_LABELS[result])).toEqual(["Выигрыш", "Выигрыш половины ставки", "Возврат ставки", "Проигрыш половины ставки", "Проигрыш"]);
    expect(Object.keys(EXTENDED_MARKETS_UNAVAILABLE_LABELS)).toEqual(["SCORE_MATRIX_UNAVAILABLE"]);
    expect(EXTENDED_MARKETS_UNAVAILABLE_LABELS.SCORE_MATRIX_UNAVAILABLE).toBe("Для этого прогноза расширенные рынки недоступны: матрица счёта не была сохранена.");
    expect(EXTENDED_MARKETS_UNAVAILABLE_FALLBACK).toBe("Расширенные рынки для этого прогноза недоступны.");
    expect(extendedUnavailableLabel("SCORE_MATRIX_UNAVAILABLE")).toBe(EXTENDED_MARKETS_UNAVAILABLE_LABELS.SCORE_MATRIX_UNAVAILABLE);
    expect(extendedUnavailableLabel("MYSTERY")).toBe(EXTENDED_MARKETS_UNAVAILABLE_FALLBACK);
    expect(FAIR_ODDS_UNAVAILABLE_LABELS).toEqual({ NO_WIN_PROBABILITY: "вероятность выигрыша равна нулю", ZERO_PROBABILITY: "вероятность счёта равна нулю" });
    expect(SCORE_MATRIX_SOURCE_LABELS).toEqual({ PERSISTED: "сохранена при выпуске прогноза", REDERIVED: "воспроизведена по сохранённым параметрам и сверена с рынками прогноза" });
  });
  it("never labels a code with itself", () => {
    for (const labels of [MARKET_FAMILY_LABELS, AH_RESULT_LABELS, EXTENDED_MARKETS_UNAVAILABLE_LABELS, FAIR_ODDS_UNAVAILABLE_LABELS, SCORE_MATRIX_SOURCE_LABELS] as Array<Record<string, string>>) {
      for (const [code, label] of Object.entries(labels)) expect(label, code).not.toBe(code);
    }
  });
  it("extends the financial outcome and value reason dictionaries without changing existing values", () => {
    expect(financialOutcomeLabel("HALF_WIN")).toBe("выигрыш половины ставки");
    expect(financialOutcomeLabel("HALF_LOSS")).toBe("проигрыш половины ставки");
    expect(financialOutcomeLabel("PUSH")).toBe("возврат ставки");
    expect(financialOutcomeLabel("WIN")).toBe("выигрыш");
    expect(valueReasonLabel("UNSUPPORTED_ODDS_MARKET")).toBe("рынок или линия гандикапа не поддерживаются");
    expect(valueReasonLabel("SCORE_MATRIX_UNAVAILABLE")).toBe("для этого прогноза расширенные рынки недоступны: матрица счёта не была сохранена");
  });
});

describe("formatAhLine", () => {
  it("pins all 21 line labels with U+2212 for negatives", () => {
    expect(AH_LINES_V1.lines).toHaveLength(21);
    for (const token of AH_LINES_V1.lines) expect(formatAhLine(token), token).toBe(AH_LINE_PINS[token]);
    expect(formatAhLine("-0.75")).toBe("−0.75");
    expect(formatAhLine("+0.25")).toBe("+0.25");
    expect(formatAhLine("0")).toBe("0");
    expect(formatAhLine("+1")).toBe("+1");
  });
  it("returns an unknown token as is and never throws", () => {
    for (const token of ["+1.00", "0.0", "-0", "abc", "", "-3"]) expect(formatAhLine(token)).toBe(token);
  });
});

describe("selectionLabelFor and oddsMarketLabel", () => {
  it("labels Asian handicap sides from each side's own line", () => {
    expect(selectionLabelFor("ASIAN_HANDICAP:-0.75", "HOME")).toBe("Хозяева −0.75");
    expect(selectionLabelFor("ASIAN_HANDICAP:-0.75", "AWAY")).toBe("Гости +0.75");
    expect(selectionLabelFor("ASIAN_HANDICAP:+1.5", "AWAY")).toBe("Гости −1.5");
    expect(selectionLabelFor("ASIAN_HANDICAP:0", "HOME")).toBe("Хозяева 0");
    expect(selectionLabelFor("ASIAN_HANDICAP:0", "AWAY")).toBe("Гости 0");
  });
  it("pins the 17 exact score selection labels", () => {
    const expected: string[] = [];
    for (let home = 0; home <= 3; home += 1) for (let away = 0; away <= 3; away += 1) expected.push(`Счёт ${home}:${away}`);
    expected.push("Любой другой счёт");
    const selections = [...Array.from({ length: 16 }, (_, index) => `${Math.floor(index / 4)}-${index % 4}`), "OTHER"];
    expect(selections.map((selection) => selectionLabelFor("EXACT_SCORE", selection))).toEqual(expected);
    expect(new Set(expected).size).toBe(17);
  });
  it("keeps the existing labels for the three core markets and falls back to the raw code", () => {
    expect(selectionLabelFor("ONE_X_TWO", "DRAW")).toBe("Ничья");
    expect(selectionLabelFor("BTTS", "YES")).toBe("Да");
    expect(selectionLabelFor("OVER_UNDER_2_5", "OVER_2_5")).toBe("Тотал больше 2.5");
    expect(selectionLabelFor("MYSTERY", "MYSTERY_SELECTION")).toBe("MYSTERY_SELECTION");
    expect(selectionLabelFor("EXACT_SCORE", "9-9")).toBe("9-9");
    expect(selectionLabelFor("ASIAN_HANDICAP:-0.75", "DRAW")).toBe("DRAW");
  });
  it("labels canonical market ids and falls back for unknown markets", () => {
    expect(oddsMarketLabel("ASIAN_HANDICAP:-0.75")).toBe("Азиатский гандикап −0.75");
    expect(oddsMarketLabel("ASIAN_HANDICAP:+0.25")).toBe("Азиатский гандикап +0.25");
    expect(oddsMarketLabel("ASIAN_HANDICAP:0")).toBe("Азиатский гандикап 0");
    expect(oddsMarketLabel("EXACT_SCORE")).toBe("Точный счёт");
    expect(oddsMarketLabel("ONE_X_TWO")).toBe("1X2");
    expect(oddsMarketLabel("ASIAN_HANDICAP:+1.00")).toBe("ASIAN_HANDICAP:+1.00");
    expect(oddsMarketLabel("MYSTERY_MARKET")).toBe("MYSTERY_MARKET");
  });
});
