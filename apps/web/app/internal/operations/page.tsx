"use client";

import { useEffect, useMemo, useState } from "react";

import { impactLabel, incidentStatusLabel, serviceStateLabel } from "../../../components/enum-labels";
import { formatInstant } from "../../../components/time-format";
import { AlertsBlock } from "./alerts-block";
import { BackupStatusBlock, type BackupStatusFact } from "./backup-status-block";
import { overviewFetchSearch } from "./overview-request";

type Overview = {
  readiness: { state: "READY" | "DEGRADED" | "NOT_READY"; services: Array<{ name: string; state: string }>; lastCheckedAt: string };
  providerHealth: Array<{ provider: string; endpointFamily: string; circuitState: string; lastSuccessfulObservationAt: string | null; reason: string | null }>;
  quotas: Array<{ provider: string; endpointFamily: string; used: number; effectiveAllowance: number | null; percentage: number | null; resetAt: string | null; criticalReservations: number }>;
  failures: { groups: Array<{ rootCause: string; impact: string; scope: string; count: number; firstOccurrence: string; lastOccurrence: string; retryable: boolean; correlationIds: string[] }>; jobs: Array<{ id: string; rootCause: string; impact: string; scope: string; occurredAt: string; retryable: boolean; correlationId: string | null }>; pagination: { page: number; pageSize: number; total: number; start: number; end: number; pages: number } };
  dataQuality: Array<{ code: string; scope: string; count: number; firstOccurrence: string; lastOccurrence: string }>;
  incidents: Array<{ id: string; status: string; impact: string; summary: string; startedAt: string; lastUpdatedAt: string; correlationId: string | null }>;
  backups: BackupStatusFact;
  alerts: Array<{ id: string; signal: string; scope: string; severity: string; status: string; count: number; firstSeen: string; lastSeen: string; acknowledgedAt: string | null; resolvedAt: string | null; correlationIds: string[] }>;
  channelState: { configured: boolean; lastDeliveryStatus: number | null; lastDeliveryAt: string | null };
};


function visibleState(state: Overview["readiness"]["state"]): string { return state === "READY" ? "Готово" : state === "DEGRADED" ? "Деградировано" : "Не готово"; }
function date(value: string | null): string { return value ? formatInstant(value, Intl.DateTimeFormat().resolvedOptions().timeZone) : "Недоступно"; }

function Block({ title, loading, error, empty, onRetry, children }: { title: string; loading: boolean; error: string; empty: boolean; onRetry(): void; children: React.ReactNode }) {
  return <section aria-labelledby={`${title.toLowerCase().replace(/[^a-zа-яё]+/g, "-")}-heading`} className="panel panel--wrap" aria-busy={loading || undefined}>
    <h2 id={`${title.toLowerCase().replace(/[^a-zа-яё]+/g, "-")}-heading`}>{title}</h2>
    {loading && <p role="status">Загрузка: {title.toLowerCase()}…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={onRetry}>Повторить попытку</button></div>}
    {!loading && !error && empty ? <p>Нет операционных записей, соответствующих этому представлению.</p> : !error ? children : null}
  </section>;
}

function CopyCorrelation({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <><button aria-label={`Скопировать корреляционный ID ${value}`} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>{value}</button><span role="status" aria-live="polite">{copied ? "Корреляционный ID скопирован" : ""}</span></>;
}

export default function OperationsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [triggerPending, setTriggerPending] = useState<"backup" | "drill" | null>(null);
  const [triggerNotice, setTriggerNotice] = useState<string | null>(null);
  const [triggerNoticeFailed, setTriggerNoticeFailed] = useState(false);
  const query = useMemo(() => typeof window === "undefined" ? "?page=1&pageSize=25&windowHours=24" : window.location.search || "?page=1&pageSize=25&windowHours=24", []);
  // Alerts paginate independently from the failures `page` parameter (UI-SPEC default):
  // own alertPage URL parameter, 25 items per page, both blocks never clobber each other.
  const alertPage = useMemo(() => {
    const value = Number.parseInt(new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("alertPage") ?? "1", 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }, []);
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/internal-api/operations/overview${overviewFetchSearch(query, alertPage)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("OPERATIONS_UNAVAILABLE");
      setOverview(await response.json() as Overview);
    } catch {
      if (typeof window !== "undefined" && window.location.port === "3000") {
        window.location.href = `/internal/operations/gateway${window.location.search}`;
        return;
      }
      setError("Этот операционный блок недоступен. Ранее показанные безопасные сведения остаются без изменений.");
    }
    finally { setLoading(false); }
  };
  const trigger = async (kind: "backup" | "drill") => {
    setTriggerPending(kind); setTriggerNotice(null); setTriggerNoticeFailed(false);
    try {
      const response = await fetch(`/internal-api/operations/backups/${kind === "backup" ? "run" : "drill"}`, { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("TRIGGER_REJECTED");
      setTriggerNotice(kind === "backup" ? "Резервная копия поставлена в очередь." : "Проверка восстановления поставлена в очередь.");
      await load();
    } catch {
      setTriggerNoticeFailed(true);
      setTriggerNotice(kind === "backup" ? "Не удалось создать резервную копию: операции недоступны или резервные копии не настроены." : "Не удалось запустить проверку восстановления: операции недоступны или резервные копии не настроены.");
    } finally { setTriggerPending(null); }
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate fetch-on-mount: the operations overview loads once on page mount
  useEffect(() => { void load(); }, []);

  return <section className="page-stack">
    <header><h1 tabIndex={-1}>Центр операций</h1><p>Только безопасные операционные метаданные. Сырые полезные нагрузки, учётные данные, заголовки, трассировки стека и журналы здесь недоступны никогда.</p><button disabled={loading} onClick={() => void load()}>{loading && overview ? "Обновление…" : "Обновить операционные данные"}</button></header>
    <Block title="Алерты" loading={loading && !overview} error={error} empty={false} onRetry={() => void load()}>
      {overview && <AlertsBlock fact={{ alerts: overview.alerts, channel: overview.channelState }} page={alertPage} />}
    </Block>
    <Block title="Готовность системы" loading={loading && !overview} error={error} empty={false} onRetry={() => void load()}>
      {overview && <><p><strong>{visibleState(overview.readiness.state)}</strong></p><p>Последняя проверка: <time dateTime={overview.readiness.lastCheckedAt}>{date(overview.readiness.lastCheckedAt)}</time></p><dl>{overview.readiness.services.map((service) => <div key={service.name}><dt>{service.name}</dt><dd>{serviceStateLabel(service.state)}</dd></div>)}</dl></>}
    </Block>
    <Block title="Резервные копии и проверка восстановления" loading={loading && !overview} error={error} empty={false} onRetry={() => void load()}>
      {overview && <BackupStatusBlock backups={overview.backups} pending={triggerPending} notice={triggerNotice} noticeFailed={triggerNoticeFailed} onBackup={() => void trigger("backup")} onDrill={() => void trigger("drill")} />}
    </Block>
    <Block title="Состояние поставщиков" loading={loading && !overview} error={error} empty={overview?.providerHealth.length === 0} onRetry={() => void load()}>
      <div className="card-grid">{overview?.providerHealth.map((provider) => <article key={`${provider.provider}:${provider.endpointFamily}`} className="panel panel--wrap"><h3>{provider.provider}</h3><p>{provider.endpointFamily} · {provider.circuitState}</p><p>Последнее успешное наблюдение: <time dateTime={provider.lastSuccessfulObservationAt ?? undefined}>{date(provider.lastSuccessfulObservationAt)}</time></p><p>Безопасная причина: {provider.reason ?? "Нет"}</p></article>)}</div>
    </Block>
    <Block title="Использование квот" loading={loading && !overview} error={error} empty={overview?.quotas.length === 0} onRetry={() => void load()}>
      <div className="card-grid">{overview?.quotas.map((quota) => <article key={`${quota.provider}:${quota.endpointFamily}`} className="panel panel--wrap"><h3>{quota.provider} · {quota.endpointFamily}</h3><p><strong>{quota.used} / {quota.effectiveAllowance ?? "Недоступно"}</strong>{quota.percentage === null ? "" : ` (${quota.percentage}%)`}</p><p>Сброс: <time dateTime={quota.resetAt ?? undefined}>{date(quota.resetAt)}</time></p><p>Критические бронирования: {quota.criticalReservations}</p></article>)}</div>
    </Block>
    <Block title="Неудачные задачи и мёртвые письма" loading={loading && !overview} error={error} empty={overview?.failures.groups.length === 0} onRetry={() => void load()}>
      {overview?.failures.groups.map((group) => <details key={`${group.rootCause}:${group.impact}:${group.scope}`}><summary>{group.rootCause} · {group.impact} · {group.count}</summary><dl><dt>Затронутая область</dt><dd>{group.scope}</dd><dt>Первое появление</dt><dd>{date(group.firstOccurrence)}</dd><dt>Последнее появление</dt><dd>{date(group.lastOccurrence)}</dd><dt>Возможность повтора</dt><dd>{group.retryable ? "Можно повторить через проверённое восстановление" : "Повтор невозможен"}</dd></dl></details>)}
      {overview && <><p>Показано {overview.failures.pagination.start}–{overview.failures.pagination.end} из {overview.failures.pagination.total}</p><ul>{overview.failures.jobs.map((job) => <li key={job.id}><strong>{job.id}</strong> · {job.rootCause} · {job.impact}{job.correlationId && <> · <CopyCorrelation value={job.correlationId}/></>}</li>)}</ul><nav aria-label="Страницы отказов">{Array.from({ length: overview.failures.pagination.pages }, (_, index) => <a key={index + 1} href={`?${new URLSearchParams({ page: String(index + 1), pageSize: String(overview.failures.pagination.pageSize), windowHours: "24" })}`}>{index + 1}</a>)}</nav></>}
    </Block>
    <Block title="Ошибки качества данных" loading={loading && !overview} error={error} empty={overview?.dataQuality.length === 0} onRetry={() => void load()}>
      <ul>{overview?.dataQuality.map((item) => <li key={`${item.code}:${item.scope}`}>{item.code} · {item.scope} · {item.count} · {date(item.lastOccurrence)}</li>)}</ul>
    </Block>
    <Block title="Последние инциденты" loading={loading && !overview} error={error} empty={overview?.incidents.length === 0} onRetry={() => void load()}>
      <ul>{overview?.incidents.map((incident) => <li key={incident.id}>{incident.summary} · {impactLabel(incident.impact)} · {incidentStatusLabel(incident.status)} · {date(incident.lastUpdatedAt)}{incident.correlationId && <> · <CopyCorrelation value={incident.correlationId}/></>}</li>)}</ul>
    </Block>
  </section>;
}
