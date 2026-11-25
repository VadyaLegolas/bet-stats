import Link from "next/link";

import type { NoVigClvUnavailableReason, ForecastSelection } from "@bet-stats/domain";

import { ResponsiveEvidence, type EvidenceColumn } from "../../components/responsive-evidence";
import { ResultsSyncButton } from "../../components/results-sync-button";
import { LocalDataBlock } from "../../components/local-data-block";
import { ContextualMethodologyWarning } from "../../components/contextual-methodology-warning";
import { financialOutcomeLabel, oddsSelectionLabel } from "../../components/enum-labels";
import { formatOdds } from "../../components/odds-format";
import { formatInstant } from "../../components/time-format";
import { CohortFilter } from "../../components/cohort-filter";

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

/** Read-time `no-vig-clv-v1` reading carried by every candidate row (evaluation-only; never an input to ranking). */
export type NoVigClvView =
  | Readonly<{ status: "UNAVAILABLE"; policyVersion: string; reason: string; source?: string }>
  | Readonly<{ status: "AVAILABLE"; policyVersion: string; value: string; pCandidateFair: string; pCloseFair: string; closingObservedAt: string; source: string }>;

type CandidateRow = Readonly<{
  id: string; selection: string; decimalOdds: string; outcome: string; stakeUnits: string; profitUnits: string;
  /** Frozen at settlement (`odds-ratio-clv-v1`, raw odds, margin included); meaning unchanged. */
  clv: { status: string; reason: string | null; value: string | null; policyVersion?: string };
  /** Optional so an older API response degrades to «нет данных» instead of breaking the page. */
  clvNoVig?: NoVigClvView;
}>;

type CandidatePage = Readonly<{ items: readonly CandidateRow[]; nextCursor: string | null; pageTotals: { count: number; stakeUnits: string; profitUnits: string } }>;

export function canonicalScorecardQuery(identity: ScorecardViewModel["cohortIdentity"]): string {
  const query = new URLSearchParams();
  for (const key of ["modelVersion", "competitionId", "market", "from", "to"] as const) query.set(key, identity[key]);
  return query.toString();
}


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

/** Russian copy for every typed unavailable reason of `no-vig-clv-v1`; the Record makes a new domain reason a compile error here. */
const NO_VIG_CLV_REASON_COPY: Readonly<Record<NoVigClvUnavailableReason, string>> = {
  CLOSING_SET_MISSING: "оператор не записал коэффициенты закрытия для этого матча и рынка",
  CLOSING_SET_INCOMPLETE: "набор закрытия неполный: нужны все выборы рынка",
  CANDIDATE_SET_INCOMPLETE: "набор коэффициентов кандидата неполный: нужны все выборы рынка",
  SOURCE_CONVENTION_MISMATCH: "закрытие записано по другому источнику, чем коэффициент кандидата",
  INVALID_TIMESTAMP: "метка времени набора некорректна",
  CLOSING_BEFORE_CANDIDATE: "закрытие записано раньше, чем коэффициент кандидата",
  CLOSING_NOT_PRE_KICKOFF: "закрытие записано не до начала матча",
  INVALID_ODDS: "коэффициенты одного из наборов некорректны",
};

const CLV_REASON_COPY = {
  NO_COMPARABLE_CLOSE: "нет сопоставимого коэффициента закрытия линии",
  CLOSING_OBSERVATION_MISSING: "нет наблюдения коэффициента закрытия",
  ...NO_VIG_CLV_REASON_COPY,
} as const;
export const describeClvReason = (code: string): string => CLV_REASON_COPY[code as keyof typeof CLV_REASON_COPY] ?? code;

/** Empty-state hint: the lifecycle a value candidate must complete before it becomes a settled
 * unit on this page. Rendered only while there is nothing to show, so a populated registry stays clean. */
export const CANDIDATE_CHAIN_HINT = "Цепочка: кандидат value → финиш матча → публикация результатов («Загрузить результаты») → единица оценки.";

/** Candidate CLV cell of the frozen odds-ratio policy: the numeric value wins; otherwise the human reason, else «нет данных». */
const describeCandidateClv = (clv: { status: string; reason: string | null; value: string | null }): string =>
  clv.value ?? (clv.reason ? describeClvReason(clv.reason) : clv.status === "UNAVAILABLE" ? "нет данных" : clv.status);

/** Signed percent of a decimal CLV fraction; U+2212 for negatives, never a bare number that reads as a promise. */
export function formatClvPercent(value: string): string | null {
  const fraction = Number(value);
  if (!Number.isFinite(fraction)) return null;
  const percent = (fraction * 100).toFixed(2);
  if (Number(percent) === 0) return "0.00 %";
  return fraction > 0 ? `+${percent} %` : `−${percent.replace("-", "")} %`;
}

function NoVigClvCell({ reading, timeZone }: { reading: NoVigClvView | undefined; timeZone: string }) {
  if (!reading) return <>нет данных</>;
  if (reading.status === "UNAVAILABLE") return <>{`CLV без маржи недоступен: ${describeClvReason(reading.reason)}`}</>;
  const percent = formatClvPercent(reading.value);
  if (percent === null) return <>нет данных</>;
  return <><strong>{percent}</strong><br /><small>{`${reading.policyVersion} · закрытие ${formatInstant(reading.closingObservedAt, timeZone)} ${timeZone} · источник ${reading.source}`}</small></>;
}

export function ScorecardDashboard({ scorecard, candidates, cursor }: { scorecard: ScorecardViewModel; candidates: CandidatePage; cursor?: string }) {
  const identityQuery = canonicalScorecardQuery(scorecard.cohortIdentity);
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";
  const healthTitle = scorecard.health.state === "AVAILABLE" ? "Подтверждённые доказательства" : scorecard.health.state === "LIMITED" ? "Ограниченные доказательства" : "Доказательства недоступны";
  return <section>
    <h1>Ведомость результатов прогнозов</h1>
    <p className="page-deck">Историческая оценка зафиксированных прогнозов и вручную введённых коэффициентов. Это аналитические доказательства, а не рекомендации к ставкам.</p>
    <ContextualMethodologyWarning context="scorecard" />
    <ResultsSyncButton />
    <div className="panel panel--stack">
      <CohortFilter identity={scorecard.cohortIdentity} />
    </div>
    <section aria-labelledby="cohort-health" className="panel panel--stack">
      <h2 id="cohort-health">{healthTitle}</h2>
      {scorecard.health.state === "UNAVAILABLE" && <p role="alert">Нет пригодных для оценки доказательств для этой точной когорты. Фильтры не расширялись.</p>}
      {scorecard.health.state === "LIMITED" && <p role="alert">Пороги выборки не выполнены; приведённые ниже метрики носят описательный характер и не являются заявлением о производительности.</p>}
      <p>{scorecard.denominators.fixtureCount} матчей · {scorecard.denominators.forecastCount} прогнозов · {scorecard.denominators.eventCount} вероятностных событий · {scorecard.denominators.valueCount} кандидатов value</p>
      <p>Точная когорта: {scorecard.cohortIdentity.modelVersion} · {scorecard.cohortIdentity.competitionId} · {scorecard.cohortIdentity.market}</p>
    </section>
    <section className="panel panel--stack"><h2>Правильные меры оценки</h2>{scorecard.metrics ? <div className="kpi-grid"><p className="kpi-tile"><span className="kpi-label">Оценка Брайера<span className="sr-only">:</span></span> <span className="kpi-value">{scorecard.metrics.meanBrierScore.toFixed(4)}</span></p><p className="kpi-tile"><span className="kpi-label">Логарифмическая потеря<span className="sr-only">:</span></span> <span className="kpi-value">{scorecard.metrics.meanLogLoss.toFixed(4)}</span></p></div> : <p>Метрики правильных мер оценки недоступны.</p>}</section>
    <section className="panel panel--stack" role="region" aria-label="Доказательства надёжности"><h2>Надёжность</h2><LocalDataBlock name="Доказательства надёжности" state={scorecard.health.state === "AVAILABLE" ? "available" : scorecard.health.state === "LIMITED" ? "limited" : "unavailable"} reason={scorecard.health.reasons.map(describeHealthReason).join("; ") || "Нет пригодных для оценки доказательств для этой точной когорты."} retryAllowed={false} retainContent><p><strong>Заключение:</strong> {scorecard.reliability.buckets.some((bucket) => bucket.count > 0) ? "Наблюдаемые исходы сопоставляются с зафиксированными корзинами вероятностей." : "Недостаточно доказательств для заполненных корзин надёжности."}</p><p>{scorecard.denominators.eventCount} вероятностных событий в этой точной когорте. Пустые корзины остаются недостаточными доказательствами и никогда не отображаются как нулевые исходы.</p><ResponsiveEvidence projectionId="scorecard-reliability" label="Таблица доказательств надёжности" tableLabel="Полные данные надёжности" caption="Полные данные калибровки для каждой корзины вероятностей" rows={scorecard.reliability.buckets} columns={reliabilityColumns} rowKey={(bucket) => String(bucket.index)} conclusion={(bucket) => `Диапазон вероятностей ${bucket.lowerBound.toFixed(1)}–${bucket.upperBound.toFixed(1)}`} denominator={(bucket) => `${bucket.count} вероятностных событий`} warning={(bucket) => bucket.evidenceState === "INSUFFICIENT" ? "Недостаточно доказательств" : ""}/></LocalDataBlock></section>
    <section className="panel panel--stack"><h2>Доказательства фиксированной ставки в одну единицу</h2><p>{scorecard.financial.count} рассчитанных кандидатов · {scorecard.financial.totalStakedUnits} единиц оценено · {scorecard.financial.totalProfitUnits} единиц результата</p><p>ROI / Доходность: {scorecard.financial.roi ?? "недоступно"}</p>{scorecard.financial.count === 0 && <p>Единицы оценки появляются только из рассчитанных кандидатов — цепочка появления в реестре ниже.</p>}</section>
    <section className="panel panel--stack"><h2>Доказательства по закрытию линии</h2>{scorecard.clv.status === "AVAILABLE" ? <p>{scorecard.clv.comparableCount} сопоставимых коэффициентов.</p> : <p>Доказательства по закрытию линии недоступны: {scorecard.clv.reason ? describeClvReason(scorecard.clv.reason) : "причина не указана"}.</p>}<p>CLV без маржи показывает, как изменилась справедливая вероятность выбора между фиксацией коэффициента кандидата и закрытием линии. Это не прогноз, не обещание прибыли и не рекомендация; значение используется только для оценки качества и не влияет на отбор кандидатов. Закрытие вводит оператор вручную из одного источника, выборки малы. <Link href="/methodology#clv">Подробнее в методологии</Link>.</p></section>
    <section className="panel panel--stack"><h2>Реестр кандидатов</h2>{candidates.items.length === 0 ? <><p>В этой точной когорте нет рассчитанных кандидатов value.</p><p>{CANDIDATE_CHAIN_HINT}</p></> : <div className="scroll-x"><table><thead><tr><th>Выбор</th><th>Коэффициент</th><th>Исход</th><th>Единиц поставлено</th><th>Единиц прибыли</th><th>CLV без маржи (no-vig-clv-v1)</th><th>CLV по коэффициентам (odds-ratio-clv-v1, с маржой)</th></tr></thead><tbody>{candidates.items.map((item) => <tr key={item.id}><td>{oddsSelectionLabel(item.selection as ForecastSelection)}</td><td>{formatOdds(item.decimalOdds)}</td><td>{financialOutcomeLabel(item.outcome)}</td><td>{item.stakeUnits}</td><td>{Number(item.profitUnits) > 0 ? `+${item.profitUnits}` : item.profitUnits}</td><td><NoVigClvCell reading={item.clvNoVig} timeZone={timeZone} /></td><td>{describeCandidateClv(item.clv)}{item.clv.policyVersion && <><br /><small>{item.clv.policyVersion}</small></>}</td></tr>)}</tbody></table></div>}<p>Итоги страницы: {candidates.pageTotals.count} кандидатов, {candidates.pageTotals.stakeUnits} единиц поставлено, {candidates.pageTotals.profitUnits} единиц прибыли.</p><nav aria-label="Страницы кандидатов" className="cluster">{cursor && <Link className="link-touch" href={`/scorecards?${identityQuery}`}>Назад (первая страница)</Link>} {candidates.nextCursor && <Link className="link-touch" href={`/scorecards?${identityQuery}&cursor=${encodeURIComponent(candidates.nextCursor)}`}>Далее</Link>}</nav></section>
    <details id="formula-policy-receipts" className="panel panel--stack"><summary>Квитанции формул и политик</summary><dl><dt>Формула</dt><dd>{scorecard.receipts.formulaId}</dd><dt>Политика когорты</dt><dd>{scorecard.receipts.cohortPolicyId}</dd><dt>Политика надёжности</dt><dd>{scorecard.reliability.policyId}</dd><dt>Финансовая политика</dt><dd>{scorecard.financial.policyId}</dd></dl></details>
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
