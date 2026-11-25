import { AH_LINES_V1, lineClassOf, parseAhLineToken, PUSH_AWARE_EV_POLICY_VERSION, splitLinesOf } from "@bet-stats/domain";
import type { AhLineToken, AhResult, ForecastSelection, MarketFamily, OddsMarket, OddsSelection } from "@bet-stats/domain";

import { AH_RESULT_ORDER, formatAhLine, selectionLabelFor } from "../../../components/enum-labels";

/**
 * Чистые помощники прогнозного верстака — без React и без директив «use client».
 * Модуль импортируют и жадное ядро (forecast-workbench.tsx), и оба ленивых
 * модуля (forecast-comparison-panel.tsx, value-outcome-section.tsx), поэтому
 * чанк-граф остаётся ациклическим: ленивые модули никогда не импортируют
 * forecast-workbench.tsx обратно (T-10-06).
 */

/** Результат value-сравнения — один и тот же тип для жадного состояния и ленивой секции. */
export type ValueResult = { id: string; fixtureId: string; forecastSnapshotId: string; oddsSnapshotId: string; market: OddsMarket; selection: OddsSelection; outcome: "VALUE_CANDIDATE" | "NO_VALUE" | "INSUFFICIENT_EVIDENCE"; reasons: readonly string[]; modelProbability: string; noVigProbability: string; fairOdds: string | null; edge: string; expectedValue: string; receipt: Record<string, unknown>; createdAt: string };

/** Доля 0..1 → «38.1%». */
export function percent(value: number | string): string { return `${(Number(value) * 100).toFixed(1)}%`; }

/** machine_reason → «machine reason». */
export function labelReason(reason: string): string { return reason.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replaceAll("_", " "); }

function signedPercent(value: number): string { return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }

/** Направление изменения записью словами, а не сырой дельтой. */
export function directionText(direction: "increase" | "decrease" | "unchanged", delta: number): string { return direction === "increase" ? `вырос на ${signedPercent(delta)}` : direction === "decrease" ? `снизился на ${signedPercent(Math.abs(delta))}` : "без изменений"; }

const CORE_ODDS_FIELD_LABELS: Readonly<Record<ForecastSelection, string>> = { HOME: "Десятичный коэффициент на хозяев", DRAW: "Десятичный коэффициент на ничью", AWAY: "Десятичный коэффициент на гостей", OVER_2_5: "Десятичный коэффициент: Тотал больше 2.5", UNDER_2_5: "Десятичный коэффициент: Тотал меньше 2.5", YES: "Десятичный коэффициент: Да", NO: "Десятичный коэффициент: Нет" };

/** Число исходов в книге точного счёта: 16 явных счетов и «Любой другой счёт». */
export const EXACT_SCORE_FIELD_COUNT = 17;

/** `ASIAN_HANDICAP:<токен>` — единственный способ построить идентификатор линии для формы, черновика и отправки. */
export function ahMarketIdFor(token: string): string { return `ASIAN_HANDICAP:${token}`; }

/** Канонический идентификатор рынка формы: семейство, а для АГ — семейство с линией; без выбранной линии идентификатора нет. */
export function formMarketId(family: MarketFamily, ahLine: string): string | null {
  if (family !== "ASIAN_HANDICAP") return family;
  return parseAhLineToken(ahLine) === null ? null : ahMarketIdFor(ahLine);
}

/**
 * Подпись поля коэффициента: основные рынки сохраняют прежние подписи, АГ — «Десятичный коэффициент: Хозяева −0.75»,
 * точный счёт — «Счёт 2:1» / «Любой другой счёт». Неизвестное значение возвращается сырым кодом.
 */
export function oddsFieldLabel(market: string, selection: string): string {
  if (market.startsWith("ASIAN_HANDICAP:")) return `Десятичный коэффициент: ${selectionLabelFor(market, selection)}`;
  if (market === "EXACT_SCORE") return selectionLabelFor(market, selection);
  return Object.hasOwn(CORE_ODDS_FIELD_LABELS, selection) ? CORE_ODDS_FIELD_LABELS[selection as ForecastSelection] : selection;
}

export interface AhLineOption { readonly value: AhLineToken; readonly label: string }

/** 21 линия по возрастанию: «Хозяева −2.5 / Гости +2.5»; главная линия выбранного прогноза получает суффикс. */
export function ahLineOptions(mainLine?: string): readonly AhLineOption[] {
  return AH_LINES_V1.lines.map((token) => {
    const id = ahMarketIdFor(token);
    const label = `${selectionLabelFor(id, "HOME")} / ${selectionLabelFor(id, "AWAY")}`;
    return { value: token, label: token === mainLine ? `${label} (главная линия)` : label };
  });
}

/** Пояснение четвертной линии: две соседние линии берутся из домена (`splitLinesOf`), UI ничего не считает; для остальных линий `null`. */
export function quarterSplitNote(token: string): string | null {
  const line = parseAhLineToken(token);
  if (line === null || lineClassOf(line) !== "QUARTER") return null;
  const [first, second] = splitLinesOf(line, "HOME");
  return first === undefined || second === undefined ? null : `На четвертной линии ставка делится между ${formatAhLine(first)} и ${formatAhLine(second)}: возможны выигрыш и проигрыш половины ставки.`;
}

/** Сколько выборов книги ещё требуют внимания: у них есть ошибка поля (пусто или некорректно). */
export function unfilledCount(selections: readonly string[], errors: Readonly<Partial<Record<string, string>>>): number { return selections.filter((selection) => Boolean(errors[selection])).length; }

/** Первый по порядку выбор книги с ошибкой поля или `null`. */
export function firstInvalidField(selections: readonly string[], errors: Readonly<Partial<Record<string, string>>>): string | null { return selections.find((selection) => Boolean(errors[selection])) ?? null; }

const INCOMPLETE_BOOK = "Заполните все выборы перед отправкой этой неизменяемой книги коэффициентов.";
export const AH_LINE_REQUIRED_ERROR = "Выберите линию гандикапа.";
export const AH_LINE_REQUIRED_STATUS = "Выберите линию гандикапа и заполните оба коэффициента перед отправкой этой неизменяемой книги коэффициентов.";

/** Строка статуса неудачной отправки: у точного счёта добавляется счётчик «n из 17». */
export function incompleteBookMessage(family: MarketFamily, failing: number): string {
  return family === "EXACT_SCORE" ? `${INCOMPLETE_BOOK} Не заполнено полей: ${failing} из ${EXACT_SCORE_FIELD_COUNT}.` : INCOMPLETE_BOOK;
}

/** Знаковая запись возврата на единицу ставки: «+0.930», «−0.500», «0.000» (U+2212 для минуса). Нечисловое значение возвращается как есть. */
export function formatSigned(value: number | string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  const magnitude = Math.abs(parsed).toFixed(3);
  return magnitude === "0.000" ? magnitude : `${parsed < 0 ? "−" : "+"}${magnitude}`;
}

/** Знаковая запись доли в процентах: «+4.32%», «−1.50%», «0.00%». */
export function formatSignedPercent(value: number | string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  const magnitude = Math.abs(parsed * 100).toFixed(2);
  return magnitude === "0.00" ? `${magnitude}%` : `${parsed < 0 ? "−" : "+"}${magnitude}%`;
}

export interface AhBreakdownRow { readonly result: AhResult; readonly probability: string; readonly returnPerUnit: string; readonly contribution: string }
export interface AhBreakdownReceipt { readonly policyVersion: typeof PUSH_AWARE_EV_POLICY_VERSION; readonly rows: readonly AhBreakdownRow[] }

const DECIMAL_STRING = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const isDecimalString = (value: unknown): value is string => typeof value === "string" && DECIMAL_STRING.test(value) && Number.isFinite(Number(value));

/**
 * Закрытый разбор блока `receipt.extended` квитанции азиатского гандикапа (D-13): вид ASIAN_HANDICAP, метка политики
 * push-aware-ev-v1 и ровно пять исходов в порядке WIN, HALF_WIN, PUSH, HALF_LOSS, LOSS с конечными десятичными строками.
 * Любое отклонение даёт `null`: значения не достраиваются и не придумываются, итог не пересчитывается.
 */
export function readAhBreakdownReceipt(receipt: Readonly<Record<string, unknown>> | null | undefined): AhBreakdownReceipt | null {
  const block = receipt?.extended;
  if (block === null || typeof block !== "object" || Array.isArray(block)) return null;
  const extended = block as Record<string, unknown>;
  if (extended.kind !== "ASIAN_HANDICAP" || extended.evPolicyVersion !== PUSH_AWARE_EV_POLICY_VERSION) return null;
  const outcomes = extended.evOutcomes;
  if (!Array.isArray(outcomes) || outcomes.length !== AH_RESULT_ORDER.length) return null;
  const rows: AhBreakdownRow[] = [];
  for (const [index, raw] of outcomes.entries()) {
    const expected = AH_RESULT_ORDER[index]!;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    if (entry.result !== expected || !isDecimalString(entry.probability) || !isDecimalString(entry.returnPerUnit) || !isDecimalString(entry.contribution)) return null;
    rows.push({ result: expected, probability: entry.probability, returnPerUnit: entry.returnPerUnit, contribution: entry.contribution });
  }
  return { policyVersion: PUSH_AWARE_EV_POLICY_VERSION, rows };
}
