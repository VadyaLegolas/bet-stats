import { describe, expect, it } from "vitest";

import {
  evidenceLimitationLabel,
  financialOutcomeLabel,
  forecastKindLabel,
  impactLabel,
  incidentStatusLabel,
  MARKET_LABELS,
  oddsMarketLabel,
  oddsSelectionLabel,
  providerReasonLabel,
  reasonLabel,
  reconciliationMethodLabel,
  routeOutcomeLabel,
  routeTriggerLabel,
  SELECTION_LABELS,
  serviceStateLabel,
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
