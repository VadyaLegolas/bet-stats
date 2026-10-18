import Link from "next/link";

import type { OddsSelection } from "@bet-stats/domain";

import { ResponsiveEvidence, type EvidenceColumn } from "../../components/responsive-evidence";
import { ResultsSyncButton } from "../../components/results-sync-button";
import { LocalDataBlock } from "../../components/local-data-block";
import { ContextualMethodologyWarning } from "../../components/contextual-methodology-warning";
import { financialOutcomeLabel, oddsSelectionLabel } from "../../components/enum-labels";
import { formatOdds } from "../../components/odds-format";

export type ScorecardViewModel = Readonly<{
  cohortIdentity: { modelVersion: string; competitionId: string; market: string; from: string; to: string };
  health: { state: "UNAVAILABLE" | "LIMITED" | "AVAILABLE"; reasons: readonly string[]; performanceClaim: string | null };
  denominators: { fixtureCount: number; forecastCount: number; eventCount: number; valueCount: number };
  metrics: { meanBrierScore: number; meanLogLoss: number } | null;
  reliability: { policyId: string; buckets: readonly { index: number; lowerBound: number; upperBound: number; upperBoundInclusive: boolean; meanForecast: number; observedFrequency: number; count: number; gap: number; direction: string; evidenceState: string }[] };
  financial: { count: number; totalStakedUnits: string; totalProfitUnits: string; roi: string | null; yield: string | null; policyId: string };
  clv: { status: string; reason: string | null; comparableCount: number };
  receipts: { formulaId: string; cohortPolicyId: string };
}>;

type CandidatePage = Readonly<{ items: readonly { id: string; selection: string; decimalOdds: string; outcome: string; stakeUnits: string; profitUnits: string; clv: { status: string; reason: string | null; value: string | null } }[]; nextCursor: string | null; pageTotals: { count: number; stakeUnits: string; profitUnits: string } }>;

export function canonicalScorecardQuery(identity: ScorecardViewModel["cohortIdentity"]): string {
  const query = new URLSearchParams();
  for (const key of ["modelVersion", "competitionId", "market", "from", "to"] as const) query.set(key, identity[key]);
  return query.toString();
}

const panel = { border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", padding: 20, marginBlock: 18 } as const;

/** Human-readable Russian copy for the scorecard enum codes. The API contract keeps the
 * codes; only the display layer is translated. Unknown codes pass through unchanged so a
 * new backend value degrades to the raw code instead of hiding information. */
const DIRECTION_COPY = {
  ALIGNED: "Совпадает с наблюдениями",
  UNDER_CONFIDENT: "Наблюдаемое выше прогноза",
  OVER_CONFIDENT: "Наблюдаемое ниже прогноза",
} as const;
export const describeDirection = (code: string): string => DIRECTION_COPY[code as keyof typeof DIRECTION_COPY] ?? code;

const HEALTH_REASON_COPY = {
  NO_SCOREABLE_FIXTURES: "нет завершённых матчей, пригодных для оценки",
  COHORT_BELOW_MINIMUM: "выборка когорты меньше минимума",
  BUCKET_BELOW_MINIMUM: "отдельные корзины вероятностей заполнены меньше минимума",
} as const;
export const describeHealthReason = (code: string): string => HEALTH_REASON_COPY[code as keyof typeof HEALTH_REASON_COPY] ?? code;

const CLV_REASON_COPY = {
  NO_COMPARABLE_CLOSE: "нет сопоставимого коэффициента закрытия линии",
  CLOSING_OBSERVATION_MISSING: "нет наблюдения коэффициента закрытия",
} as const;
export const describeClvReason = (code: string): string => CLV_REASON_COPY[code as keyof typeof CLV_REASON_COPY] ?? code;

/** Empty-state hint: the lifecycle a value candidate must complete before it becomes a settled
 * unit on this page. Rendered only while there is nothing to show, so a populated registry stays clean. */
export const CANDIDATE_CHAIN_HINT = "Цепочка: кандидат value → финиш матча → публикация результатов («Загрузить результаты») → единица оценки.";

/** Candidate CLV cell: the numeric value wins; otherwise the human reason, else «нет данных». */
const describeCandidateClv = (clv: { status: string; reason: string | null; value: string | null }): string =>
  clv.value ?? (clv.reason ? describeClvReason(clv.reason) : clv.status === "UNAVAILABLE" ? "нет данных" : clv.status);

export function ScorecardDashboard({ scorecard, candidates, cursor }: { scorecard: ScorecardViewModel; candidates: CandidatePage; cursor?: string }) {
  const identityQuery = canonicalScorecardQuery(scorecard.cohortIdentity);
  const healthTitle = scorecard.health.state === "AVAILABLE" ? "Подтверждённые доказательства" : scorecard.health.state === "LIMITED" ? "Ограниченные доказательства" : "Доказательства недоступны";
  return <section>
    <h1>Ведомость результатов прогнозов</h1>
    <p>Историческая оценка зафиксированных прогнозов и вручную введённых коэффициентов. Это аналитические доказательства, а не рекомендации к ставкам.</p>
    <ContextualMethodologyWarning context="scorecard" />
    <ResultsSyncButton />
    <form method="get" style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
      {(["modelVersion", "competitionId", "market", "from", "to"] as const).map((key) => <label key={key}>{key}<input name={key} defaultValue={scorecard.cohortIdentity[key]} style={{ width: "100%", minHeight: 44 }} /></label>)}
      <button type="submit" style={{ minHeight: 44 }}>Применить точную когорту</button>
    </form>
    <section aria-labelledby="cohort-health" style={panel}>
      <h2 id="cohort-health">{healthTitle}</h2>
      {scorecard.health.state === "UNAVAILABLE" && <p role="alert">Нет пригодных для оценки доказательств для этой точной когорты. Фильтры не расширялись.</p>}
      {scorecard.health.state === "LIMITED" && <p role="alert">Пороги выборки не выполнены; приведённые ниже метрики носят описательный характер и не являются заявлением о производительности.</p>}
      <p>{scorecard.denominators.fixtureCount} матчей · {scorecard.denominators.forecastCount} прогнозов · {scorecard.denominators.eventCount} вероятностных событий · {scorecard.denominators.valueCount} кандидатов value</p>
      <p>Точная когорта: {scorecard.cohortIdentity.modelVersion} · {scorecard.cohortIdentity.competitionId} · {scorecard.cohortIdentity.market}</p>
    </section>
    <section style={panel}><h2>Правильные меры оценки</h2>{scorecard.metrics ? <><p>Оценка Брайера: {scorecard.metrics.meanBrierScore.toFixed(4)}</p><p>Логарифмическая потеря: {scorecard.metrics.meanLogLoss.toFixed(4)}</p></> : <p>Метрики правильных мер оценки недоступны.</p>}</section>
    <section style={panel} role="region" aria-label="Доказательства надёжности"><h2>Надёжность</h2><LocalDataBlock name="Доказательства надёжности" state={scorecard.health.state === "AVAILABLE" ? "available" : scorecard.health.state === "LIMITED" ? "limited" : "unavailable"} reason={scorecard.health.reasons.map(describeHealthReason).join("; ") || "Нет пригодных для оценки доказательств для этой точной когорты."} retryAllowed={false} retainContent><p><strong>Заключение:</strong> {scorecard.reliability.buckets.some((bucket) => bucket.count > 0) ? "Наблюдаемые исходы сопоставляются с зафиксированными корзинами вероятностей." : "Недостаточно доказательств для заполненных корзин надёжности."}</p><p>{scorecard.denominators.eventCount} вероятностных событий в этой точной когорте. Пустые корзины остаются недостаточными доказательствами и никогда не отображаются как нулевые исходы.</p><ResponsiveEvidence projectionId="scorecard-reliability" label="Таблица доказательств надёжности" tableLabel="Полные данные надёжности" caption="Полные данные калибровки для каждой корзины вероятностей" rows={scorecard.reliability.buckets} columns={reliabilityColumns} rowKey={(bucket) => String(bucket.index)} conclusion={(bucket) => `Диапазон вероятностей ${bucket.lowerBound.toFixed(1)}–${bucket.upperBound.toFixed(1)}`} denominator={(bucket) => `${bucket.count} вероятностных событий`} warning={(bucket) => bucket.evidenceState === "INSUFFICIENT" ? "Недостаточно доказательств" : ""}/></LocalDataBlock></section>
    <section style={panel}><h2>Доказательства фиксированной ставки в одну единицу</h2><p>{scorecard.financial.count} рассчитанных кандидатов · {scorecard.financial.totalStakedUnits} единиц оценено · {scorecard.financial.totalProfitUnits} единиц результата</p><p>ROI / Доходность: {scorecard.financial.roi ?? "недоступно"}</p>{scorecard.financial.count === 0 && <p>Единицы оценки появляются только из рассчитанных кандидатов — цепочка появления в реестре ниже.</p>}</section>
    <section style={panel}><h2>Доказательства по закрытию линии</h2>{scorecard.clv.status === "AVAILABLE" ? <p>{scorecard.clv.comparableCount} сопоставимых коэффициентов.</p> : <p>Доказательства по закрытию линии недоступны: {scorecard.clv.reason ? describeClvReason(scorecard.clv.reason) : "причина не указана"}.</p>}</section>
    <section style={panel}><h2>Реестр кандидатов</h2>{candidates.items.length === 0 ? <><p>В этой точной когорте нет рассчитанных кандидатов value.</p><p>{CANDIDATE_CHAIN_HINT}</p></> : <div style={{ overflowX: "auto" }}><table><thead><tr><th>Выбор</th><th>Коэффициент</th><th>Исход</th><th>Единиц поставлено</th><th>Единиц прибыли</th><th>CLV</th></tr></thead><tbody>{candidates.items.map((item) => <tr key={item.id}><td>{oddsSelectionLabel(item.selection as OddsSelection)}</td><td>{formatOdds(item.decimalOdds)}</td><td>{financialOutcomeLabel(item.outcome)}</td><td>{item.stakeUnits}</td><td>{Number(item.profitUnits) > 0 ? `+${item.profitUnits}` : item.profitUnits}</td><td>{describeCandidateClv(item.clv)}</td></tr>)}</tbody></table></div>}<p>Итоги страницы: {candidates.pageTotals.count} кандидатов, {candidates.pageTotals.stakeUnits} единиц поставлено, {candidates.pageTotals.profitUnits} единиц прибыли.</p><nav aria-label="Страницы кандидатов">{cursor && <Link href={`/scorecards?${identityQuery}`}>Назад (первая страница)</Link>} {candidates.nextCursor && <Link href={`/scorecards?${identityQuery}&cursor=${encodeURIComponent(candidates.nextCursor)}`}>Далее</Link>}</nav></section>
    <details id="formula-policy-receipts"><summary>Квитанции формул и политик</summary><dl><dt>Формула</dt><dd>{scorecard.receipts.formulaId}</dd><dt>Политика когорты</dt><dd>{scorecard.receipts.cohortPolicyId}</dd><dt>Политика надёжности</dt><dd>{scorecard.reliability.policyId}</dd><dt>Финансовая политика</dt><dd>{scorecard.financial.policyId}</dd></dl></details>
  </section>;
}

type ReliabilityBucket = ScorecardViewModel["reliability"]["buckets"][number];
const reliabilityColumns: readonly EvidenceColumn<ReliabilityBucket>[] = [
  { key: "range", label: "Диапазон", value: (bucket) => `${bucket.lowerBound.toFixed(1)}–${bucket.upperBound.toFixed(1)}` },
  { key: "meanForecast", label: "Средний прогноз", value: (bucket) => bucket.meanForecast.toFixed(3) },
  { key: "observedFrequency", label: "Наблюдаемое", value: (bucket) => bucket.count === 0 ? "Недостаточно доказательств" : bucket.observedFrequency.toFixed(3) },
  { key: "count", label: "Количество", value: (bucket) => bucket.count },
  { key: "direction", label: "Направление", value: (bucket) => bucket.count === 0 ? "Недостаточно доказательств" : describeDirection(bucket.direction) },
];
