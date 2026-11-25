import { parseExtendedMarketsView } from "@bet-stats/domain";
import type { AhFairOdds, AhLineClass, AhMarketLine, AhResult, AhSide, ExactScoreCellView, ExactScoreFairOdds, ExactScoreOtherView, ExtendedMarketsView } from "@bet-stats/domain";

import { AH_RESULT_ORDER, FAIR_ODDS_UNAVAILABLE_LABELS, formatAhLine, selectionLabelFor } from "../../../components/enum-labels";
import { formatOdds } from "../../../components/odds-format";
import { percent } from "./workbench-format";

/**
 * Чистая модель разделов «Азиатский гандикап» и «Точный счёт» (план 14-04, D-04, D-06..D-10).
 *
 * Без React и без директив клиента. Модуль импортирует только workbench-format.ts, enum-labels.ts и
 * odds-format.ts и никогда не импортирует модуль верстака страницы матча (правило чанк-графа T-10-06).
 *
 * Арифметики вероятностей здесь нет: окно, главная линия, пять исходов, эффективная вероятность и
 * справедливые коэффициенты приходят из DTO (расчёт при чтении в домене), а модель только форматирует,
 * упорядочивает и подписывает. Индексы окна — позиции строк, а не вероятности.
 */

/** Размер окна по умолчанию вокруг главной линии (D-08). */
export const AH_WINDOW_SIZE = 5;
/** Число линий `ah-lines-v1`; подписи расширителя названы для 21 линии. */
export const AH_LINE_COUNT = 21;
const WINDOW_RADIUS = 2;

export const DASH = "—";
export const UNAVAILABLE_TEXT = "Недоступно";
export const STRUCTURAL_ZERO_TEXT = "такого исхода на этой линии не бывает";

export type AhDisplaySide = AhSide;

/** Структурный ноль: исход не бывает на линиях этого класса (целые: нет половин; половинные: нет половин и возврата; четвертные: нет возврата). */
export function isStructuralZero(lineClass: AhLineClass, result: AhResult): boolean {
  if (result === "WIN" || result === "LOSS") return false;
  if (result === "PUSH") return lineClass !== "WHOLE";
  return lineClass !== "QUARTER";
}

/** Строки в порядке возрастания линии показываемой стороны (у гостей это обратный порядок домашних линий). */
function orderedLines(lines: readonly AhMarketLine[], side: AhDisplaySide): readonly AhMarketLine[] {
  const own = (line: AhMarketLine) => Number(side === "HOME" ? line.homeLine : line.awayLine);
  return [...lines].sort((a, b) => own(a) - own(b));
}

/**
 * Окно по умолчанию: ровно 5 подряд идущих строк с центром на главной линии, у краёв окно сдвигается;
 * развёрнутый режим даёт все строки. Ключ главной строки — домашний токен в обоих видах, поэтому
 * переключатель стороны не меняет, какая строка главная.
 */
export function ahWindow(lines: readonly AhMarketLine[], mainLine: string, side: AhDisplaySide, expanded: boolean): readonly AhMarketLine[] {
  const ordered = orderedLines(lines, side);
  if (expanded || ordered.length <= AH_WINDOW_SIZE) return ordered;
  const center = ordered.findIndex((line) => line.homeLine === mainLine);
  const lastStart = ordered.length - AH_WINDOW_SIZE;
  const wanted = center - WINDOW_RADIUS;
  const start = wanted < 0 ? 0 : wanted > lastStart ? lastStart : wanted;
  return ordered.slice(start, start + AH_WINDOW_SIZE);
}

export function windowCaption(expanded: boolean): string {
  return expanded ? `Показаны все ${AH_LINE_COUNT} линия.` : `Показаны ${AH_WINDOW_SIZE} линий из ${AH_LINE_COUNT} вокруг главной.`;
}

export function expanderLabel(expanded: boolean): string {
  return expanded ? `Показать только ${AH_WINDOW_SIZE} линий вокруг главной` : `Показать все ${AH_LINE_COUNT} линию`;
}

export function expanderStatus(expanded: boolean): string {
  return expanded ? `Показаны все ${AH_LINE_COUNT} линия` : `Показаны ${AH_WINDOW_SIZE} линий вокруг главной`;
}

export interface OddsCellModel {
  readonly available: boolean;
  readonly text: string;
  readonly reason: string | null;
}

function fairOddsCell(fair: AhFairOdds | ExactScoreFairOdds): OddsCellModel {
  if (fair.status === "AVAILABLE") return { available: true, text: formatOdds(fair.odds), reason: null };
  const reason = FAIR_ODDS_UNAVAILABLE_LABELS[fair.reason];
  return { available: false, text: UNAVAILABLE_TEXT, reason: reason ?? null };
}

export interface AhOutcomeCell {
  readonly result: AhResult;
  readonly text: string;
  readonly structural: boolean;
  readonly srText: string | null;
}

export interface AhRowModel {
  /** Ключ строки — домашний токен линии: устойчив при переключении стороны. */
  readonly key: string;
  readonly label: string;
  /** «(Хозяева −0.75)» только в виде гостей. */
  readonly homeHint: string | null;
  /** Вспомогательная строка: четвертная линия делит ставку, нулевая возвращает ставку при ничьей. */
  readonly sub: string | null;
  readonly isMain: boolean;
  readonly outcomes: readonly AhOutcomeCell[];
  readonly effective: string;
  readonly fair: OddsCellModel;
}

function subLine(line: AhMarketLine, side: AhDisplaySide): string | null {
  if (line.lineClass === "QUARTER") {
    const [first, second] = line.sides[side].splitLines;
    return first !== undefined && second !== undefined ? `ставка делится между ${formatAhLine(first)} и ${formatAhLine(second)}` : null;
  }
  return line.homeLine === "0" ? "возврат при ничьей" : null;
}

/** Строка таблицы для показываемой стороны: все числа из DTO как есть, форматирование и подписи. */
export function ahRowModel(line: AhMarketLine, side: AhDisplaySide, mainLine: string): AhRowModel {
  const marketId = `ASIAN_HANDICAP:${line.homeLine}`;
  const view = line.sides[side];
  return {
    key: line.homeLine,
    label: selectionLabelFor(marketId, side),
    homeHint: side === "AWAY" ? `(${selectionLabelFor(marketId, "HOME")})` : null,
    sub: subLine(line, side),
    isMain: line.homeLine === mainLine,
    outcomes: AH_RESULT_ORDER.map((result): AhOutcomeCell => {
      const value = view.breakdown[result];
      const structural = value === 0 && isStructuralZero(line.lineClass, result);
      return { result, text: structural ? DASH : percent(value), structural, srText: structural ? STRUCTURAL_ZERO_TEXT : null };
    }),
    effective: percent(view.effectiveWinProbability),
    fair: fairOddsCell(view.fairOdds),
  };
}

export interface AhSummaryModel {
  readonly mainLabel: string;
  readonly home: OddsCellModel;
  readonly away: OddsCellModel;
}

/** Три плитки: главная линия и справедливые коэффициенты на хозяев и гостей этой линии (D-08). */
export function ahSummaryModel(lines: readonly AhMarketLine[], mainLine: string): AhSummaryModel {
  const marketId = `ASIAN_HANDICAP:${mainLine}`;
  const line = lines.find((candidate) => candidate.homeLine === mainLine);
  const unavailable: OddsCellModel = { available: false, text: UNAVAILABLE_TEXT, reason: null };
  return {
    mainLabel: `${selectionLabelFor(marketId, "HOME")} / ${selectionLabelFor(marketId, "AWAY")}`,
    home: line ? fairOddsCell(line.sides.HOME.fairOdds) : unavailable,
    away: line ? fairOddsCell(line.sides.AWAY.fairOdds) : unavailable,
  };
}

export interface ExactCellModel {
  readonly selection: string;
  /** «Счёт 2:1. » для экранных дикторов. */
  readonly srScore: string;
  readonly srOdds: string;
  readonly probability: string;
  /** Видимая приставка «коэф. » (для дикторов она скрыта, вместо неё srOdds). */
  readonly oddsPrefix: string;
  readonly odds: OddsCellModel;
}

export interface ExactRowModel {
  readonly homeGoals: number;
  readonly cells: readonly ExactCellModel[];
}

export interface ExactGridModel {
  /** Голы гостей: заголовки столбцов. */
  readonly columns: readonly number[];
  readonly rows: readonly ExactRowModel[];
  readonly other: ExactCellModel;
}

const SR_ODDS = "Справедливый коэффициент: ";
const ODDS_PREFIX = "коэф. ";

function exactCell(cell: ExactScoreCellView | ExactScoreOtherView): ExactCellModel {
  return {
    selection: cell.selection,
    srScore: `${selectionLabelFor("EXACT_SCORE", cell.selection)}. `,
    srOdds: SR_ODDS,
    probability: percent(cell.probability),
    oddsPrefix: ODDS_PREFIX,
    odds: fairOddsCell(cell.fairOdds),
  };
}

/** Сетка 4x4: строки — голы хозяев, клетки — голы гостей, плюс строка OTHER (D-09). */
export function exactGridModel(exactScore: Readonly<{ cells: readonly ExactScoreCellView[]; other: ExactScoreOtherView }>): ExactGridModel {
  const homeGoals = [...new Set(exactScore.cells.map((cell) => cell.homeGoals))].sort((a, b) => a - b);
  return {
    columns: [...new Set(exactScore.cells.map((cell) => cell.awayGoals))].sort((a, b) => a - b),
    rows: homeGoals.map((goals) => ({
      homeGoals: goals,
      cells: exactScore.cells.filter((cell) => cell.homeGoals === goals).sort((a, b) => a.awayGoals - b.awayGoals).map(exactCell),
    })),
    other: exactCell(exactScore.other),
  };
}

/** Строка хвоста (Pitfall 9): хвост уже учтён нормировкой на сохранённую массу и не лежит отдельно в «Любом другом счёте». */
export function tailLine(tailMass: number): string {
  return `Хвост матрицы вне 0–7 голов: ${percent(tailMass)} — уже учтён нормировкой на сохранённую массу и распределён по всем счетам.`;
}

/**
 * Слот раздела на странице: вид из API, сбой чтения или закрытое «нераспознано». Разделы никогда не рисуют
 * раскладку AVAILABLE для значения, которое не прошло закрытый разбор домена (T-14-12).
 */
export type ExtendedMarketsSlot = ExtendedMarketsView | Readonly<{ state: "READ_FAILED" }> | Readonly<{ state: "UNAVAILABLE"; reason: "UNRECOGNISED" }>;

const UNRECOGNISED: ExtendedMarketsSlot = Object.freeze({ state: "UNAVAILABLE", reason: "UNRECOGNISED" } as const);

function hasExactly(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.every((key, index) => key === actual[index]);
}

/** Закрытая классификация любого значения (ответ API или проп слота): неизвестная причина и нераспознанная форма дают общее уведомление. */
export function normaliseExtendedMarkets(value: unknown): ExtendedMarketsSlot {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const state = (value as { state?: unknown }).state;
    if (state === "READ_FAILED" && hasExactly(value, ["state"])) return { state: "READ_FAILED" };
    if (state === "UNAVAILABLE" && hasExactly(value, ["reason", "state"]) && (value as { reason?: unknown }).reason === "UNRECOGNISED") return UNRECOGNISED;
  }
  try {
    return parseExtendedMarketsView(value);
  } catch {
    return UNRECOGNISED;
  }
}
