import { type ForecastComparisonDto, type OddsMarket, type OddsSelection } from "@bet-stats/domain";

import { forecastLimitationLabel, oddsMarketLabel, oddsSelectionLabel } from "../../../components/enum-labels";
import { ResponsiveEvidence, type EvidenceColumn } from "../../../components/responsive-evidence";
import { directionText, percent } from "./workbench-format";

type ComparisonSourceRef = ForecastComparisonDto["sourceRefs"]["added"][number];
/** Evidence instant → «11.10.2026 13:00 UTC»; an unparsable value stays exact. */
export function formatUtc(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
/** Human-short fingerprint (12 hex chars) — the exact payload hash stays in the hover receipt. */
export function shortFingerprint(value: string): string { return value.length > 12 ? `${value.slice(0, 12)}…` : value; }
export function shortFixtureId(fixtureId: string): string { return fixtureId.length > 8 ? `${fixtureId.slice(0, 8)}…` : fixtureId; }
function SourceRefItem({ source, name }: { source: ComparisonSourceRef; name?: string | undefined }) {
  return <li title={`Матч: ${source.fixtureId} · отпечаток: ${source.payloadHash} · обновление источника: ${source.sourceUpdatedAt ?? "нет"}`}>
    <strong>{name ?? shortFixtureId(source.fixtureId)}</strong> · {formatUtc(source.effectiveAt)} · отпечаток <code>{shortFingerprint(source.payloadHash)}</code> · наблюдено {formatUtc(source.observedAt)}
  </li>;
}
function sourceRefList(sources: readonly ComparisonSourceRef[], labels: Readonly<Record<string, string>> | undefined) {
  if (sources.length === 0) return "нет";
  return <ul>{sources.map((source) => <SourceRefItem key={`${source.fixtureId}:${source.payloadHash}:${source.observedAt}`} source={source} name={labels?.[source.fixtureId]} />)}</ul>;
}

type RevisionDelta = ForecastComparisonDto["probabilities"][number];
const revisionColumns: readonly EvidenceColumn<RevisionDelta>[] = [
  { key: "market", label: "Рынок", value: (row) => oddsMarketLabel(row.market as OddsMarket) },
  { key: "selection", label: "Выбор", value: (row) => oddsSelectionLabel(row.selection as OddsSelection) },
  { key: "left", label: "Левый", value: (row) => percent(row.left) },
  { key: "right", label: "Правый", value: (row) => percent(row.right) },
  { key: "change", label: "Изменение", value: (row) => directionText(row.direction, row.delta) },
];

export function ForecastComparisonPanel({ comparison }: { comparison: ForecastComparisonDto }) {
  const material = comparison.sourceRefs.added.length + comparison.sourceRefs.removed.length + comparison.limitations.added.length + comparison.limitations.removed.length;
  return <div>
    <h4>Значимые изменения доказательств, модели и ограничений</h4>
    {material === 0 ? <p>Отображаемые компоненты модели не изменились между этими точными снимками.</p> : <ul><li>Добавленные доказательства: {sourceRefList(comparison.sourceRefs.added, comparison.fixtureLabels)}</li><li>Удалённые доказательства: {sourceRefList(comparison.sourceRefs.removed, comparison.fixtureLabels)}</li><li>Добавленные ограничения: {comparison.limitations.added.map(forecastLimitationLabel).join(", ") || "нет"}</li><li>Устранённые ограничения: {comparison.limitations.removed.map(forecastLimitationLabel).join(", ") || "нет"}</li></ul>}
    <ResponsiveEvidence projectionId="forecast-revision-delta" label="Доказательства изменения вероятностей" tableLabel="Полные данные об изменении вероятностей" caption="Стабильные изменения вероятностей для выбранных неизменяемых снимков" rows={comparison.probabilities} columns={revisionColumns} rowKey={(row) => `${row.market}:${row.selection}`} conclusion={(row) => `${oddsMarketLabel(row.market as OddsMarket)} — ${oddsSelectionLabel(row.selection as OddsSelection)}`} denominator={(row) => directionText(row.direction, row.delta)}/>
    <details><summary>Точные квитанции сравнения</summary><dl><dt>ID левого снимка</dt><dd><code>{comparison.left.id}</code></dd><dt>ID правого снимка</dt><dd><code>{comparison.right.id}</code></dd><dt>Левая отсечка</dt><dd><time dateTime={comparison.left.cutoff}>{comparison.left.cutoff}</time></dd><dt>Правая отсечка</dt><dd><time dateTime={comparison.right.cutoff}>{comparison.right.cutoff}</time></dd></dl></details>
    <p>Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.</p>
  </div>;
}
