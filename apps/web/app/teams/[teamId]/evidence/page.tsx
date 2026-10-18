"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  parseEvidenceProjection,
  type EvidenceComponentKind,
  type EvidenceProjectionComponent,
  type EvidenceProjectionDto,
} from "@bet-stats/domain";

import { EvidenceStateNotice } from "../../../../components/evidence-state-notice";
import { evidenceLimitationLabel } from "../../../../components/enum-labels";

type Summary = { value?: unknown; sampleSize?: number; requestedSampleSize?: number; sourceUpdatedAt?: string | null | undefined; limitationReason?: string | null | undefined; limitation?: string | null | undefined };
type Trace = { fixtureId: string; effectiveAt?: string; observedAt?: string; venue?: "HOME" | "AWAY" | null; outcome?: "WIN" | "DRAW" | "LOSS" | null; score?: { home: number; away: number } | null; source?: string | null };
type Evidence = {
  team?: { id: string; name: string } | null;
  teamId?: string;
  fixture?: { id: string; name: string; kickoff: string } | null;
  fixtureLabels?: Record<string, string> | null;
  requestedAsOf?: string;
  resolvedAsOf?: string | null;
  resolvedAsOfUtc?: string | null;
  displayTimeZone?: string;
  state?: string;
  freshness?: string;
  limitationReason?: string | null;
  summaries?: { five?: Summary; ten?: Summary };
  components?: EvidenceProjectionDto["components"];
  trace?: Trace[];
  receipt?: { configVersion?: string; buildId?: string; inputIds?: string[]; inputs?: Trace[] } | null;
};

const panel = { border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", padding: 20, minWidth: 0 } as const;

export type EvidenceDisplayField = Readonly<{ label: string; value: string }>;

export function renderEvidenceComponentFields(component: EvidenceProjectionComponent): readonly EvidenceDisplayField[] {
  if (component.value === null) return [{ label: "Значение", value: "Недоступно" }];
  switch (component.kind) {
    case "form5": return [{ label: "Взвешенная форма за 5 матчей", value: `${component.value.toFixed(2)} очков/матч` }];
    case "form10": return [{ label: "Взвешенная форма за 10 матчей", value: `${component.value.toFixed(2)} очков/матч` }];
    case "elo": return [{ label: "Рейтинг Elo", value: `${component.value.toFixed(1)} очков рейтинга` }];
    case "homeStrength": return [{ label: "Сила дома", value: `${component.value.toFixed(2)} очков/матч` }];
    case "awayStrength": return [{ label: "Сила гостей", value: `${component.value.toFixed(2)} очков/матч` }];
    case "goalRates": return [
      { label: "Забитые голы", value: `${component.value.for.toFixed(2)} голов/матч` },
      { label: "Пропущенные голы", value: `${component.value.against.toFixed(2)} голов/матч` },
    ];
    case "restDays": return [{ label: "Отдых", value: `${component.value.toFixed(2)} дней` }];
    case "h2h": return [
      { label: "Очки H2H", value: `${component.value.pointsPerMatch.toFixed(2)} очков/матч` },
      { label: "Вес H2H", value: component.value.weight.toFixed(3) },
    ];
  }
}

function componentLabel(component: EvidenceProjectionComponent): string {
  switch (component.kind) {
    case "form5": return "Взвешенная форма за 5 матчей";
    case "form10": return "Взвешенная форма за 10 матчей";
    case "elo": return "Рейтинг Elo";
    case "homeStrength": return "Сила дома";
    case "awayStrength": return "Сила гостей";
    case "goalRates": return "Голевые показатели";
    case "restDays": return "Дни отдыха";
    case "h2h": return "Доказательства личных встреч";
  }
}

function summaryFrom(data: Evidence, key: "five" | "ten"): Summary {
  const direct = data.summaries?.[key];
  if (direct) return direct;
  const names: readonly EvidenceComponentKind[] = key === "five" ? ["form5"] : ["form10"];
  const component = names.map((name) => data.components?.[name]).find(Boolean);
  return { value: component?.value, sampleSize: component?.sampleSize ?? 0, requestedSampleSize: key === "five" ? 5 : 10, limitationReason: component?.limitation };
}

function summaryValue(value: unknown): string { return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : String(value); }

function SummaryCard({ label, summary }: { label: string; summary: Summary }) {
  const sample = summary.sampleSize ?? 0;
  const target = summary.requestedSampleSize ?? Number(label);
  const available = summary.value !== null && summary.value !== undefined && sample > 0;
  return <article style={panel}><h2>Сводка за {label} матчей</h2><p style={{ fontSize: 28, fontWeight: 700 }}>{available ? summaryValue(summary.value) : "Недоступно"}</p><p>Выборка: <span>{sample}/{target}</span></p>{summary.sourceUpdatedAt && <p>Источник обновлён: <time dateTime={summary.sourceUpdatedAt}>{summary.sourceUpdatedAt}</time></p>}{summary.limitationReason && <p>{evidenceLimitationLabel(summary.limitationReason)}</p>}</article>;
}

export function evidenceHeading(teamName: string | null | undefined): string {
  const trimmed = typeof teamName === "string" ? teamName.trim() : "";
  return trimmed === "" ? "Исторические доказательства" : `${trimmed}: исторические доказательства`;
}

const TRACE_FALLBACK = "Неизвестно";

/** Russian labels of the evidence components whose source refs include the fixture; none → null. Pure. */
export function traceComponentLabels(data: { components?: EvidenceProjectionDto["components"] | undefined }, fixtureId: string): string | null {
  const labels = Object.values(data.components ?? {})
    .filter((component): component is EvidenceProjectionComponent => component !== undefined && component !== null && (component.sourceRefs ?? []).some((ref) => ref.fixtureId === fixtureId))
    .map((component) => componentLabel(component));
  return labels.length === 0 ? null : labels.join(", ");
}

export function EvidenceTraceTable({ rows, fixtureLabels, components }: { rows: readonly Trace[]; fixtureLabels?: Record<string, string> | null | undefined; components?: EvidenceProjectionDto["components"] | undefined }) {
  return <div role="region" aria-label="Подходящие матчи" style={{ overflowX: "auto" }}><table><caption>Матчи, включённые в сборку исторических доказательств</caption><thead><tr><th>Матч</th><th>Место</th><th>Исход</th><th>Счёт</th><th>Время действия</th><th>Время наблюдения</th><th>Источник</th><th>Компоненты</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.fixtureId}-${row.observedAt ?? ""}`}><td>{fixtureLabels?.[row.fixtureId] ?? row.fixtureId}</td><td>{row.venue === "HOME" ? "дома" : row.venue === "AWAY" ? "в гостях" : TRACE_FALLBACK}</td><td>{row.outcome === "WIN" ? "победа" : row.outcome === "DRAW" ? "ничья" : row.outcome === "LOSS" ? "поражение" : TRACE_FALLBACK}</td><td>{row.score ? `${row.score.home}:${row.score.away}` : TRACE_FALLBACK}</td><td>{row.effectiveAt ? <time dateTime={row.effectiveAt}>{row.effectiveAt}</time> : TRACE_FALLBACK}</td><td>{row.observedAt ? <time dateTime={row.observedAt}>{row.observedAt}</time> : TRACE_FALLBACK}</td><td>{row.source ?? TRACE_FALLBACK}</td><td>{traceComponentLabels({ components }, row.fixtureId) ?? TRACE_FALLBACK}</td></tr>)}</tbody></table></div>;
}

export default function TeamEvidencePage() {
  const params = useParams<{ teamId: string }>();
  const search = useSearchParams();
  const asOf = search.get("asOf") ?? "";
  const fixtureId = search.get("fixtureId");
  const [data, setData] = useState<Evidence | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      setData(null); setFailed(false);
      const fixtureQuery = typeof fixtureId === "string" && fixtureId !== "" ? `&fixtureId=${encodeURIComponent(fixtureId)}` : "";
      return fetch(`/internal-api/teams/${encodeURIComponent(params.teamId)}/evidence?asOf=${encodeURIComponent(asOf)}${fixtureQuery}`, { cache: "no-store", signal: controller.signal });
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("evidence unavailable");
        const body = await response.json() as Evidence;
        if (body.resolvedAsOfUtc && body.components) parseEvidenceProjection(body);
        return body;
      })
      .then(setData, (error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setFailed(true); });
    return () => controller.abort();
  }, [asOf, fixtureId, params.teamId]);

  const back = fixtureId ? `/fixtures/${encodeURIComponent(fixtureId)}` : "/fixtures";
  if (failed) return <section><h1>Исторические доказательства недоступны</h1><p role="alert">Исторические доказательства не удалось загрузить для этой точки отсчёта. Более новые данные не подставлялись. Попробуйте снова.</p><Link href={back}>{fixtureId ? "Назад к матчу" : "Назад к матчам"}</Link></section>;
  if (!data) return <section aria-busy="true"><h1>Исторические доказательства</h1><p role="status">Загрузка исторических доказательств для выбранной точки отсчёта</p></section>;

  const resolved = data.resolvedAsOfUtc ?? data.resolvedAsOf;
  const invalid = !resolved;
  const five = summaryFrom(data, "five"); const ten = summaryFrom(data, "ten");
  const trace = data.trace ?? data.receipt?.inputs ?? [];
  return <section style={{ display: "grid", gap: 24, overflowWrap: "anywhere" }}>
    <Link href={back} style={{ minHeight: 48, display: "inline-flex", alignItems: "center", width: "fit-content" }}>{fixtureId ? "Назад к матчу" : "Назад к матчам"}</Link>
    <header><h1>{evidenceHeading(data.team?.name)}</h1><p>То, что система могла знать на выбранный момент.</p>{data.fixture && <p>Доказательства запрошены к началу матча {data.fixture.name}</p>}<dl><dt>Запрошенная точка отсчёта</dt><dd><time dateTime={data.requestedAsOf ?? asOf}>{data.requestedAsOf ?? asOf}</time></dd><dt>Определённая точка отсчёта (UTC)</dt><dd>{resolved ? <time dateTime={resolved}>{resolved}</time> : "Недоступно"}</dd>{data.displayTimeZone && <><dt>Часовой пояс отображения</dt><dd>{data.displayTimeZone}</dd></>}</dl></header>
    {invalid && <p role="alert">Эта точка отсчёта не может быть использована. Введите поддерживаемые дату и время.</p>}
    <EvidenceStateNotice state={data.state} freshness={data.freshness} limitationReason={data.limitationReason}/>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}><SummaryCard label="5" summary={five}/><SummaryCard label="10" summary={ten}/></div>
    <section aria-labelledby="components-heading"><h2 id="components-heading">Компоненты доказательств</h2>{Object.values(data.components ?? {}).map((component) => <details key={component.kind} style={panel}><summary>{componentLabel(component)}</summary><dl>{renderEvidenceComponentFields(component).map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.label}: {field.value}</dd></div>)}</dl><p>Выборка: {component.sampleSize}</p>{component.limitation && <p>{evidenceLimitationLabel(component.limitation)}</p>}</details>)}</section>
    <section aria-labelledby="trace-heading"><h2 id="trace-heading">Трассировка подходящих матчей</h2>{trace.length === 0 ? <p>Нет матчей, подходящих под отсчёт по времени действия и времени захвата.</p> : <EvidenceTraceTable rows={trace} fixtureLabels={data.fixtureLabels} components={data.components}/>}</section>
    {!data.receipt && <p role="alert">Происхождение данных недоступно; эти доказательства нельзя воспроизвести.</p>}
    <details style={panel}><summary>Квитанция воспроизведения{data.receipt?.configVersion ? ` (конфиг ${data.receipt.configVersion})` : ""}{data.receipt ? ` — ${(data.receipt.inputIds ?? data.receipt.inputs ?? []).length} ${(data.receipt.inputIds ?? data.receipt.inputs ?? []).length === 1 ? "входное значение" : "входных значений"}` : ""}</summary>{data.receipt ? <pre aria-label="Данные квитанции воспроизведения" style={{ overflow: "auto", maxWidth: "100%" }}>{JSON.stringify(data.receipt, null, 2)}</pre> : <p>Квитанция для этой точки отсчёта недоступна.</p>}</details>
  </section>;
}
