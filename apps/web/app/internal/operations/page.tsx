"use client";

import { useEffect, useMemo, useState } from "react";

type Overview = {
  readiness: { state: "READY" | "DEGRADED" | "NOT_READY"; services: Array<{ name: string; state: string }>; lastCheckedAt: string };
  providerHealth: Array<{ provider: string; endpointFamily: string; circuitState: string; lastSuccessfulObservationAt: string | null; reason: string | null }>;
  quotas: Array<{ provider: string; endpointFamily: string; used: number; effectiveAllowance: number | null; percentage: number | null; resetAt: string | null; criticalReservations: number }>;
  failures: { groups: Array<{ rootCause: string; impact: string; scope: string; count: number; firstOccurrence: string; lastOccurrence: string; retryable: boolean; correlationIds: string[] }>; jobs: Array<{ id: string; rootCause: string; impact: string; scope: string; occurredAt: string; retryable: boolean; correlationId: string | null }>; pagination: { page: number; pageSize: number; total: number; start: number; end: number; pages: number } };
  dataQuality: Array<{ code: string; scope: string; count: number; firstOccurrence: string; lastOccurrence: string }>;
  incidents: Array<{ id: string; status: string; impact: string; summary: string; startedAt: string; lastUpdatedAt: string; correlationId: string | null }>;
};

const card = { border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", padding: 20, overflowWrap: "anywhere" } as const;
const grid = { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" } as const;
const button = { minHeight: 44, padding: "8px 14px" } as const;

function visibleState(state: Overview["readiness"]["state"]): string { return state === "READY" ? "Готово" : state === "DEGRADED" ? "Деградировано" : "Не готово"; }
function date(value: string | null): string { return value ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(value)) : "Недоступно"; }

function Block({ title, loading, error, empty, onRetry, children }: { title: string; loading: boolean; error: string; empty: boolean; onRetry(): void; children: React.ReactNode }) {
  return <section aria-labelledby={`${title.toLowerCase().replace(/[^a-zа-яё]+/g, "-")}-heading`} style={card} aria-busy={loading || undefined}>
    <h2 id={`${title.toLowerCase().replace(/[^a-zа-яё]+/g, "-")}-heading`}>{title}</h2>
    {loading && <p role="status">Загрузка: {title.toLowerCase()}…</p>}
    {error && <div role="alert"><p>{error}</p><button style={button} onClick={onRetry}>Повторить попытку</button></div>}
    {!loading && !error && empty ? <p>Нет операционных записей, соответствующих этому представлению.</p> : !error ? children : null}
  </section>;
}

function CopyCorrelation({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <><button style={button} aria-label={`Скопировать корреляционный ID ${value}`} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>{value}</button><span role="status" aria-live="polite">{copied ? "Корреляционный ID скопирован" : ""}</span></>;
}

export default function OperationsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useMemo(() => typeof window === "undefined" ? "?page=1&pageSize=25&windowHours=24" : window.location.search || "?page=1&pageSize=25&windowHours=24", []);
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/internal-api/operations/overview${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("OPERATIONS_UNAVAILABLE");
      setOverview(await response.json() as Overview);
    } catch { setError("Этот операционный блок недоступен. Ранее показанные безопасные сведения остаются без изменений."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  return <section style={{ display: "grid", gap: 24, minWidth: 0 }}>
    <header><h1 tabIndex={-1}>Центр операций</h1><p>Только безопасные операционные метаданные. Сырые полезные нагрузки, учётные данные, заголовки, трассировки стека и журналы здесь недоступны никогда.</p><button style={button} disabled={loading} onClick={() => void load()}>{loading && overview ? "Обновление…" : "Обновить операционные данные"}</button></header>
    <Block title="Готовность системы" loading={loading && !overview} error={error} empty={false} onRetry={() => void load()}>
      {overview && <><p><strong>{visibleState(overview.readiness.state)}</strong></p><p>Последняя проверка: <time dateTime={overview.readiness.lastCheckedAt}>{date(overview.readiness.lastCheckedAt)}</time></p><dl>{overview.readiness.services.map((service) => <div key={service.name}><dt>{service.name}</dt><dd>{service.state}</dd></div>)}</dl></>}
    </Block>
    <Block title="Состояние поставщиков" loading={loading && !overview} error={error} empty={overview?.providerHealth.length === 0} onRetry={() => void load()}>
      <div style={grid}>{overview?.providerHealth.map((provider) => <article key={`${provider.provider}:${provider.endpointFamily}`} style={card}><h3>{provider.provider}</h3><p>{provider.endpointFamily} · {provider.circuitState}</p><p>Последнее успешное наблюдение: <time dateTime={provider.lastSuccessfulObservationAt ?? undefined}>{date(provider.lastSuccessfulObservationAt)}</time></p><p>Безопасная причина: {provider.reason ?? "Нет"}</p></article>)}</div>
    </Block>
    <Block title="Использование квот" loading={loading && !overview} error={error} empty={overview?.quotas.length === 0} onRetry={() => void load()}>
      <div style={grid}>{overview?.quotas.map((quota) => <article key={`${quota.provider}:${quota.endpointFamily}`} style={card}><h3>{quota.provider} · {quota.endpointFamily}</h3><p><strong>{quota.used} / {quota.effectiveAllowance ?? "Недоступно"}</strong>{quota.percentage === null ? "" : ` (${quota.percentage}%)`}</p><p>Сброс: <time dateTime={quota.resetAt ?? undefined}>{date(quota.resetAt)}</time></p><p>Критические бронирования: {quota.criticalReservations}</p></article>)}</div>
    </Block>
    <Block title="Неудачные задачи и мёртвые письма" loading={loading && !overview} error={error} empty={overview?.failures.groups.length === 0} onRetry={() => void load()}>
      {overview?.failures.groups.map((group) => <details key={`${group.rootCause}:${group.impact}:${group.scope}`}><summary>{group.rootCause} · {group.impact} · {group.count}</summary><dl><dt>Затронутая область</dt><dd>{group.scope}</dd><dt>Первое появление</dt><dd>{date(group.firstOccurrence)}</dd><dt>Последнее появление</dt><dd>{date(group.lastOccurrence)}</dd><dt>Возможность повтора</dt><dd>{group.retryable ? "Можно повторить через проверённое восстановление" : "Повтор невозможен"}</dd></dl></details>)}
      {overview && <><p>Показано {overview.failures.pagination.start}–{overview.failures.pagination.end} из {overview.failures.pagination.total}</p><ul>{overview.failures.jobs.map((job) => <li key={job.id}><strong>{job.id}</strong> · {job.rootCause} · {job.impact}{job.correlationId && <> · <CopyCorrelation value={job.correlationId}/></>}</li>)}</ul><nav aria-label="Страницы отказов">{Array.from({ length: overview.failures.pagination.pages }, (_, index) => <a key={index + 1} href={`?${new URLSearchParams({ page: String(index + 1), pageSize: String(overview.failures.pagination.pageSize), windowHours: "24" })}`}>{index + 1}</a>)}</nav></>}
    </Block>
    <Block title="Ошибки качества данных" loading={loading && !overview} error={error} empty={overview?.dataQuality.length === 0} onRetry={() => void load()}>
      <ul>{overview?.dataQuality.map((item) => <li key={`${item.code}:${item.scope}`}>{item.code} · {item.scope} · {item.count} · {date(item.lastOccurrence)}</li>)}</ul>
    </Block>
    <Block title="Последние инциденты" loading={loading && !overview} error={error} empty={overview?.incidents.length === 0} onRetry={() => void load()}>
      <ul>{overview?.incidents.map((incident) => <li key={incident.id}>{incident.summary} · {incident.impact} · {incident.status} · {date(incident.lastUpdatedAt)}{incident.correlationId && <> · <CopyCorrelation value={incident.correlationId}/></>}</li>)}</ul>
    </Block>
  </section>;
}
