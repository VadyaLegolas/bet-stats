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

type Summary = { value?: unknown; sampleSize?: number; requestedSampleSize?: number; sourceUpdatedAt?: string | null | undefined; limitationReason?: string | null | undefined; limitation?: string | null | undefined };
type Trace = { fixtureId: string; effectiveAt?: string; observedAt?: string; venue?: string; result?: string; score?: string; source?: string; components?: string[] };
type Evidence = {
  team?: { id: string; name: string };
  teamId?: string;
  fixture?: { id: string; name: string; kickoff: string };
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

function SummaryCard({ label, summary }: { label: string; summary: Summary }) {
  const sample = summary.sampleSize ?? 0;
  const target = summary.requestedSampleSize ?? Number(label);
  const available = summary.value !== null && summary.value !== undefined && sample > 0;
  return <article style={panel}><h2>Сводка за {label} матчей</h2><p style={{ fontSize: 28, fontWeight: 700 }}>{available ? String(summary.value) : "Недоступно"}</p><p>Выборка: <span>{sample}/{target}</span></p>{summary.sourceUpdatedAt && <p>Источник обновлён: <time dateTime={summary.sourceUpdatedAt}>{summary.sourceUpdatedAt}</time></p>}{summary.limitationReason && <p>{summary.limitationReason}</p>}</article>;
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
      return fetch(`/internal-api/teams/${encodeURIComponent(params.teamId)}/evidence?asOf=${encodeURIComponent(asOf)}`, { cache: "no-store", signal: controller.signal });
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("evidence unavailable");
        const body = await response.json() as Evidence;
        if (body.resolvedAsOfUtc && body.components) parseEvidenceProjection(body);
        return body;
      })
      .then(setData, (error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setFailed(true); });
    return () => controller.abort();
  }, [asOf, params.teamId]);

  const back = fixtureId ? `/fixtures/${encodeURIComponent(fixtureId)}` : "/fixtures";
  if (failed) return <section><h1>Исторические доказательства недоступны</h1><p role="alert">Исторические доказательства не удалось загрузить для этой точки отсчёта. Более новые данные не подставлялись. Попробуйте снова.</p><Link href={back}>{fixtureId ? "Назад к матчу" : "Назад к матчам"}</Link></section>;
  if (!data) return <section aria-busy="true"><h1>Исторические доказательства</h1><p role="status">Загрузка исторических доказательств для выбранной точки отсчёта</p></section>;

  const resolved = data.resolvedAsOfUtc ?? data.resolvedAsOf;
  const invalid = !resolved;
  const five = summaryFrom(data, "five"); const ten = summaryFrom(data, "ten");
  const trace = data.trace ?? data.receipt?.inputs ?? [];
  const name = data.team?.name ?? data.teamId ?? params.teamId;
  return <section style={{ display: "grid", gap: 24, overflowWrap: "anywhere" }}>
    <Link href={back} style={{ minHeight: 48, display: "inline-flex", alignItems: "center", width: "fit-content" }}>{fixtureId ? "Назад к матчу" : "Назад к матчам"}</Link>
    <header><h1>{name}: исторические доказательства</h1><p>То, что система могла знать на выбранный момент.</p>{data.fixture && <p>Доказательства запрошены к началу матча {data.fixture.name}</p>}<dl><dt>Запрошенная точка отсчёта</dt><dd><time dateTime={data.requestedAsOf ?? asOf}>{data.requestedAsOf ?? asOf}</time></dd><dt>Определённая точка отсчёта (UTC)</dt><dd>{resolved ? <time dateTime={resolved}>{resolved}</time> : "Недоступно"}</dd>{data.displayTimeZone && <><dt>Часовой пояс отображения</dt><dd>{data.displayTimeZone}</dd></>}</dl></header>
    {invalid && <p role="alert">Эта точка отсчёта не может быть использована. Введите поддерживаемые дату и время.</p>}
    <EvidenceStateNotice state={data.state} freshness={data.freshness} limitationReason={data.limitationReason}/>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}><SummaryCard label="5" summary={five}/><SummaryCard label="10" summary={ten}/></div>
    <section aria-labelledby="components-heading"><h2 id="components-heading">Компоненты доказательств</h2>{Object.values(data.components ?? {}).map((component) => <details key={component.kind} style={panel}><summary>{componentLabel(component)}</summary><dl>{renderEvidenceComponentFields(component).map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.label}: {field.value}</dd></div>)}</dl><p>Выборка: {component.sampleSize}</p>{component.limitation && <p>{component.limitation}</p>}</details>)}</section>
    <section aria-labelledby="trace-heading"><h2 id="trace-heading">Трассировка подходящих матчей</h2>{trace.length === 0 ? <p>Нет матчей, подходящих под отсчёт по времени действия и времени захвата.</p> : <div role="region" aria-label="Подходящие матчи" style={{ overflowX: "auto" }}><table><caption>Матчи, включённые в сборку исторических доказательств</caption><thead><tr><th>Матч</th><th>Стадион</th><th>Исход</th><th>Счёт</th><th>Время действия</th><th>Время наблюдения</th><th>Источник</th><th>Компоненты</th></tr></thead><tbody>{trace.map((row) => <tr key={`${row.fixtureId}-${row.observedAt ?? ""}`}><td>{row.fixtureId}</td><td>{row.venue ?? "Неизвестно"}</td><td>{row.result ?? "Неизвестно"}</td><td>{row.score ?? "Неизвестно"}</td><td>{row.effectiveAt ? <time dateTime={row.effectiveAt}>{row.effectiveAt}</time> : "Неизвестно"}</td><td>{row.observedAt ? <time dateTime={row.observedAt}>{row.observedAt}</time> : "Неизвестно"}</td><td>{row.source ?? "Неизвестно"}</td><td>{row.components?.join(", ") ?? "Неизвестно"}</td></tr>)}</tbody></table></div>}</section>
    {!data.receipt && <p role="alert">Происхождение данных недоступно; эти доказательства нельзя воспроизвести.</p>}
    <details style={panel}><summary>Квитанция воспроизведения{data.receipt?.configVersion ? ` — ${data.receipt.configVersion}` : ""}{data.receipt ? ` — ${(data.receipt.inputIds ?? data.receipt.inputs ?? []).length} ${(data.receipt.inputIds ?? data.receipt.inputs ?? []).length === 1 ? "входное значение" : "входных значений"}` : ""}</summary>{data.receipt ? <pre aria-label="Данные квитанции воспроизведения" style={{ overflow: "auto", maxWidth: "100%" }}>{JSON.stringify(data.receipt, null, 2)}</pre> : <p>Квитанция для этой точки отсчёта недоступна.</p>}</details>
  </section>;
}
