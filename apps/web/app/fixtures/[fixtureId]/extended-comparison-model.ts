import type { AhFairOdds, AhMarketLine, AhSide, ExactScoreCellView, ExactScoreFairOdds, ExactScoreOtherView } from "@bet-stats/domain";

import { selectionLabelFor } from "../../../components/enum-labels";
import { formatOdds } from "../../../components/odds-format";
import { percent } from "./workbench-format";

/**
 * Чистая модель строк сравнения «вид прогноза — книга коэффициентов» для азиатского гандикапа и точного счёта (план 14-06, D-20).
 *
 * Без React и без директив клиента; модуль не импортирует верстак страницы матча (правило чанк-графа T-10-06).
 * Вероятности, справедливые коэффициенты и вероятность возврата берутся из вида как есть, подразумеваемая
 * вероятность и «без вига» — из снимка коэффициентов как есть: арифметики вероятностей здесь нет.
 */

export const UNAVAILABLE = "Недоступно";
export const AH_OVERROUND_LABEL = "Перекрытие (приближённо)";
export const AH_NO_VIG_NOTE = "Для азиатского гандикапа вероятности без вига считаются пропорциональным приближением и не учитывают возврат ставки. Они нужны только для оценки маржи букмекера; ожидаемое value их не использует.";
export const COMPARISON_BLOCKED_NOTE = "Сравнение недоступно: для этого прогноза расширенные рынки недоступны. Выберите другой снимок прогноза.";

/** Минимум, который читается из снимка коэффициентов (структурный тип: не зависит от верстака). */
export interface ComparisonOddsSnapshot {
  readonly selections: readonly Readonly<{ selection: string; decimalOdds: string; impliedProbability: string; noVigProbability: string }>[];
}

export interface ExtendedComparisonRow {
  readonly key: string;
  readonly label: string;
  /** Эффективная вероятность выигрыша (АГ) или вероятность счёта (точный счёт). */
  readonly probability: string;
  /** Вероятность возврата ставки (только АГ). */
  readonly refund: string | null;
  readonly fair: string;
  readonly book: string;
  readonly implied: string;
  readonly noVig: string;
}

function fairText(fair: AhFairOdds | ExactScoreFairOdds): string { return fair.status === "AVAILABLE" ? formatOdds(fair.odds) : UNAVAILABLE; }

function bookCells(odds: ComparisonOddsSnapshot, selection: string): Pick<ExtendedComparisonRow, "book" | "implied" | "noVig"> {
  const entry = odds.selections.find((item) => item.selection === selection);
  return entry
    ? { book: formatOdds(entry.decimalOdds), implied: percent(entry.impliedProbability), noVig: percent(entry.noVigProbability) }
    : { book: UNAVAILABLE, implied: UNAVAILABLE, noVig: UNAVAILABLE };
}

const AH_SIDES: readonly AhSide[] = ["HOME", "AWAY"];

/** Две строки (хозяева, гости) выбранной линии; линия не из вида — пустой список. */
export function ahComparisonRows(view: Readonly<{ asianHandicap: Readonly<{ lines: readonly AhMarketLine[] }> }>, lineToken: string, odds: ComparisonOddsSnapshot): readonly ExtendedComparisonRow[] {
  const line = view.asianHandicap.lines.find((candidate) => candidate.homeLine === lineToken);
  if (!line) return [];
  const marketId = `ASIAN_HANDICAP:${line.homeLine}`;
  return AH_SIDES.map((side): ExtendedComparisonRow => {
    const sideView = line.sides[side];
    return { key: side, label: selectionLabelFor(marketId, side), probability: percent(sideView.effectiveWinProbability), refund: percent(sideView.breakdown.PUSH), fair: fairText(sideView.fairOdds), ...bookCells(odds, side) };
  });
}

/** 17 строк в порядке реестра выбора: 16 явных счетов и «Любой другой счёт». */
export function exactScoreComparisonRows(view: Readonly<{ exactScore: Readonly<{ cells: readonly ExactScoreCellView[]; other: ExactScoreOtherView }> }>, odds: ComparisonOddsSnapshot): readonly ExtendedComparisonRow[] {
  return [...view.exactScore.cells, view.exactScore.other].map((cell): ExtendedComparisonRow => ({
    key: cell.selection,
    label: selectionLabelFor("EXACT_SCORE", cell.selection),
    probability: percent(cell.probability),
    refund: null,
    fair: fairText(cell.fairOdds),
    ...bookCells(odds, cell.selection),
  }));
}
