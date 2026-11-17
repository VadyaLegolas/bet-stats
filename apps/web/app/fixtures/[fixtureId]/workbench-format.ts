import type { OddsMarket, OddsSelection } from "@bet-stats/domain";

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
