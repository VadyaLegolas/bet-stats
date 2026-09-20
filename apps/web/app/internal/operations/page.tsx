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

const card = { border: "1px solid #CBD5E1", borderRadius: 8, background: "#FFFFFF", padding: 20, overflowWrap: "anywhere" } as const;
const grid = { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" } as const;
const button = { minHeight: 44, padding: "8px 14px" } as const;

function visibleState(state: Overview["readiness"]["state"]): string { return state === "READY" ? "Ready" : state === "DEGRADED" ? "Degraded" : "Not ready"; }
function date(value: string | null): string { return value ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(value)) : "Not available"; }

function Block({ title, loading, error, empty, onRetry, children }: { title: string; loading: boolean; error: string; empty: boolean; onRetry(): void; children: React.ReactNode }) {
  return <section aria-labelledby={`${title.toLowerCase().replace(/[^a-z]+/g, "-")}-heading`} style={card} aria-busy={loading || undefined}>
    <h2 id={`${title.toLowerCase().replace(/[^a-z]+/g, "-")}-heading`}>{title}</h2>
    {loading && <p role="status">Loading {title.toLowerCase()}…</p>}
    {error && <div role="alert"><p>{error}</p><button style={button} onClick={onRetry}>Try again</button></div>}
    {!loading && !error && empty ? <p>No operational records match this view.</p> : !error ? children : null}
  </section>;
}

function CopyCorrelation({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <><button style={button} aria-label={`Copy correlation ID ${value}`} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>{value}</button><span role="status" aria-live="polite">{copied ? "Correlation ID copied" : ""}</span></>;
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
    } catch { setError("This operational block is unavailable. Existing safe information remains unchanged."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  return <section style={{ display: "grid", gap: 24, minWidth: 0 }}>
    <header><h1 tabIndex={-1}>Operations center</h1><p>Safe operational metadata only. Raw payloads, credentials, headers, stack traces, and logs are never available here.</p><button style={button} disabled={loading} onClick={() => void load()}>{loading && overview ? "Refreshing…" : "Refresh operations"}</button></header>
    <Block title="System readiness" loading={loading && !overview} error={error} empty={false} onRetry={() => void load()}>
      {overview && <><p><strong>{visibleState(overview.readiness.state)}</strong></p><p>Last checked: <time dateTime={overview.readiness.lastCheckedAt}>{date(overview.readiness.lastCheckedAt)}</time></p><dl>{overview.readiness.services.map((service) => <div key={service.name}><dt>{service.name}</dt><dd>{service.state}</dd></div>)}</dl></>}
    </Block>
    <Block title="Provider health" loading={loading && !overview} error={error} empty={overview?.providerHealth.length === 0} onRetry={() => void load()}>
      <div style={grid}>{overview?.providerHealth.map((provider) => <article key={`${provider.provider}:${provider.endpointFamily}`} style={card}><h3>{provider.provider}</h3><p>{provider.endpointFamily} · {provider.circuitState}</p><p>Last successful observation: <time dateTime={provider.lastSuccessfulObservationAt ?? undefined}>{date(provider.lastSuccessfulObservationAt)}</time></p><p>Safe reason: {provider.reason ?? "None"}</p></article>)}</div>
    </Block>
    <Block title="Quota consumption" loading={loading && !overview} error={error} empty={overview?.quotas.length === 0} onRetry={() => void load()}>
      <div style={grid}>{overview?.quotas.map((quota) => <article key={`${quota.provider}:${quota.endpointFamily}`} style={card}><h3>{quota.provider} · {quota.endpointFamily}</h3><p><strong>{quota.used} / {quota.effectiveAllowance ?? "Not available"}</strong>{quota.percentage === null ? "" : ` (${quota.percentage}%)`}</p><p>Reset: <time dateTime={quota.resetAt ?? undefined}>{date(quota.resetAt)}</time></p><p>Critical reservations: {quota.criticalReservations}</p></article>)}</div>
    </Block>
    <Block title="Failed and dead-lettered work" loading={loading && !overview} error={error} empty={overview?.failures.groups.length === 0} onRetry={() => void load()}>
      {overview?.failures.groups.map((group) => <details key={`${group.rootCause}:${group.impact}:${group.scope}`}><summary>{group.rootCause} · {group.impact} · {group.count}</summary><dl><dt>Affected scope</dt><dd>{group.scope}</dd><dt>First occurrence</dt><dd>{date(group.firstOccurrence)}</dd><dt>Last occurrence</dt><dd>{date(group.lastOccurrence)}</dd><dt>Retryability</dt><dd>{group.retryable ? "Retryable through reviewed recovery" : "Not retryable"}</dd></dl></details>)}
      {overview && <><p>Showing {overview.failures.pagination.start}–{overview.failures.pagination.end} of {overview.failures.pagination.total}</p><ul>{overview.failures.jobs.map((job) => <li key={job.id}><strong>{job.id}</strong> · {job.rootCause} · {job.impact}{job.correlationId && <> · <CopyCorrelation value={job.correlationId}/></>}</li>)}</ul><nav aria-label="Failure pages">{Array.from({ length: overview.failures.pagination.pages }, (_, index) => <a key={index + 1} href={`?${new URLSearchParams({ page: String(index + 1), pageSize: String(overview.failures.pagination.pageSize), windowHours: "24" })}`}>{index + 1}</a>)}</nav></>}
    </Block>
    <Block title="Data-quality errors" loading={loading && !overview} error={error} empty={overview?.dataQuality.length === 0} onRetry={() => void load()}>
      <ul>{overview?.dataQuality.map((item) => <li key={`${item.code}:${item.scope}`}>{item.code} · {item.scope} · {item.count} · {date(item.lastOccurrence)}</li>)}</ul>
    </Block>
    <Block title="Recent incidents" loading={loading && !overview} error={error} empty={overview?.incidents.length === 0} onRetry={() => void load()}>
      <ul>{overview?.incidents.map((incident) => <li key={incident.id}>{incident.summary} · {incident.impact} · {incident.status} · {date(incident.lastUpdatedAt)}{incident.correlationId && <> · <CopyCorrelation value={incident.correlationId}/></>}</li>)}</ul>
    </Block>
  </section>;
}
