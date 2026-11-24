"use client";

import { useRef, useState } from "react";

import { alertSeverityLabel, alertSignalLabel, alertStatusLabel } from "../../../components/enum-labels";
import { formatInstant } from "../../../components/time-format";

/**
 * One sanitized alert row — exactly the API `alerts()` AlertView projection
 * (Plan 03): typed safe fields only, no secrets, raw payloads or headers (D-07,
 * T-09-09). The web page never receives anything else, so the DOM cannot leak.
 */
export type AlertRow = {
  id: string;
  signal: string;
  scope: string;
  severity: string;
  status: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  correlationIds: string[];
};

/** Channel honesty fact (D-13/D-01): webhook configuration plus the last delivery outcome. */
export type AlertsChannelState = { configured: boolean; lastDeliveryStatus: number | null; lastDeliveryAt: string | null };

/** The fact the block renders: the API alerts array plus the channel state. */
export type AlertsBlockFact = { alerts: AlertRow[]; channel: AlertsChannelState };

// Severity chips use the shared tone classes (globals.css): text labels carry
// the meaning, colour is supplemental and flips with the theme.
const SEVERITY_TONES: Record<string, string> = {
  CRITICAL: "tone-danger",
  WARNING: "tone-warning",
};
const RESOLVED_TONE = "tone-neutral";
const ACK_TONE = "tone-info";

/** Mirrored separator for the in-memory dedup key (D-05). The worker tree cannot
 *  be imported from the web app, so this is a mirror of
 *  workers/data-sync/src/jobs/alerts.ts ALERT_FINGERPRINT_SEPARATOR (U+001F). The
 *  key is in-memory only — no TEXT column is touched here — but the separator must
 *  stay in sync with the worker so the two dedup domains cannot silently drift.
 */
const DEDUP_KEY_SEPARATOR = "\u001f";

/** Severity is a closed set in the API; unknown values rank last (mirrors ALERT_SEVERITY_RANK read-model ordering). */
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 2, WARNING: 1 };

const PAGE_SIZE = 25;

function chip(label: string, tone: string): React.ReactNode {
  return <span className={`state-chip ${tone}`}>
    <span className="state-dot" />
    {label}
  </span>;
}

/** Russian plural: 1 алерт / 2–4 алерта / 5+ алертов (UI-SPEC copywriting contract). */
export function alertPlural(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} алерт`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} алерта`;
  return `${count} алертов`;
}

/** Mirrored page-local CopyCorrelation — importing page.tsx would create a cycle. */
function CopyCorrelation({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <><button aria-label={`Скопировать корреляционный ID ${value}`} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>{value}</button><span role="status" aria-live="polite">{copied ? "Корреляционный ID скопирован" : ""}</span></>;
}

/** Acknowledge success copy (role=status, polite) — D-04: the record stays active. */
const ACK_SUCCESS = "Алерт подтверждён. Запись остаётся активной; повторные уведомления подавлены.";
/** Acknowledge failure copy (role=alert) — no state changed, the button comes back. */
const ACK_FAILURE = "Не удалось подтвердить алерт: операции недоступны. Запись не изменилась, попробуйте позже.";

export function AlertsBlock({ fact, page = 1 }: { fact: AlertsBlockFact; page?: number }) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = (value: string | null): string => (value ? formatInstant(value, zone) : "Нет");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [localAck, setLocalAck] = useState<Record<string, string>>({});
  const [failedId, setFailedId] = useState<string | null>(null);
  const markerRefs = useRef<Record<string, HTMLElement | null>>({});

  const acknowledge = async (row: AlertRow) => {
    setPendingId(row.id); setFailedId(null);
    try {
      const response = await fetch(`/internal-api/operations/alerts/${encodeURIComponent(row.id)}/acknowledge`, { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("ACK_REJECTED");
      const at = new Date().toISOString();
      setLocalAck((previous) => ({ ...previous, [row.id]: at }));
      requestAnimationFrame(() => markerRefs.current[row.id]?.focus());
    } catch {
      setFailedId(row.id);
    } finally { setPendingId(null); }
  };

  // One row per dedup fingerprint (signal<U+001F>scope, D-05): the first occurrence wins.
  const seen = new Set<string>();
  const deduped = fact.alerts.filter((row) => {
    const key = `${row.signal}${DEDUP_KEY_SEPARATOR}${row.scope}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Active group first (severity desc, then lastSeen desc), then the resolved window (lastSeen desc).
  const byLastSeenDesc = (left: AlertRow, right: AlertRow): number => right.lastSeen.localeCompare(left.lastSeen) || left.id.localeCompare(right.id);
  const active = deduped.filter((row) => row.status !== "RESOLVED").sort((left, right) => (SEVERITY_RANK[right.severity] ?? 0) - (SEVERITY_RANK[left.severity] ?? 0) || byLastSeenDesc(left, right));
  const resolved = deduped.filter((row) => row.status === "RESOLVED").sort(byLastSeenDesc);
  const ordered = [...active, ...resolved];

  const total = ordered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const start = total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, current * PAGE_SIZE);
  const visible = ordered.slice(start - 1, end);

  const channel = fact.channel;
  const channelFailed = channel.configured && channel.lastDeliveryStatus !== null && (channel.lastDeliveryStatus < 200 || channel.lastDeliveryStatus >= 300);
  const channelState = !channel.configured ? "unconfigured" : channelFailed ? "failed" : "ok";

  const renderRow = (row: AlertRow): React.ReactNode => {
    const signalLabel = alertSignalLabel(row.signal);
    const isResolved = row.status === "RESOLVED";
    const acknowledgedAt = row.acknowledgedAt ?? localAck[row.id] ?? null;
    const severityTone = isResolved ? RESOLVED_TONE : SEVERITY_TONES[row.severity] ?? RESOLVED_TONE;
    return <li key={row.id} data-testid="alert-row" data-state={row.status.toLowerCase()} data-severity={row.severity} className="alert-row">
      <div className="cluster">
        {chip(alertSeverityLabel(row.severity), severityTone)}
        <span className="ops-line--sm">{alertStatusLabel(row.status)}</span>
        {acknowledgedAt && <span ref={(element) => { markerRefs.current[row.id] = element; }} tabIndex={-1} className={`state-chip state-chip--md ${ACK_TONE}`}>Подтверждён · <time dateTime={acknowledgedAt}>{date(acknowledgedAt)}</time></span>}
      </div>
      <p className="ops-line"><strong>{signalLabel !== row.signal ? `${signalLabel} · ${row.signal}` : row.signal}</strong></p>
      <dl className="alert-row-meta">
        <div><dt>Область</dt><dd>{row.scope || "Нет"}</dd></div>
        <div><dt>Появился</dt><dd><time dateTime={row.firstSeen}>{date(row.firstSeen)}</time></dd></div>
        <div><dt>Последний раз</dt><dd><time dateTime={row.lastSeen}>{date(row.lastSeen)}</time></dd></div>
        <div><dt>Повторений</dt><dd className="tabular-nums">{row.count}</dd></div>
        {isResolved && <div><dt>Решён</dt><dd><time dateTime={row.resolvedAt ?? undefined}>{date(row.resolvedAt)}</time></dd></div>}
      </dl>
      <div className="cluster ops-line--sm">
        <span>Корреляционные ID:</span>
        {row.correlationIds.length === 0 ? "Нет" : row.correlationIds.map((value) => <CopyCorrelation key={value} value={value} />)}
      </div>
      {!isResolved && !acknowledgedAt && <p className="ops-line"><button disabled={pendingId !== null} aria-label={`Подтвердить алерт ${signalLabel}`} onClick={() => void acknowledge(row)}>{pendingId === row.id ? "Подтверждение…" : "Подтвердить"}</button></p>}
      {localAck[row.id] && pendingId !== row.id && failedId !== row.id && <p role="status" aria-live="polite" className="ops-line ops-line--sm">{ACK_SUCCESS}</p>}
      {failedId === row.id && pendingId !== row.id && <p role="alert" className="ops-line ops-line--sm">{ACK_FAILURE}</p>}
    </li>;
  };

  return <article className="panel panel--wrap" data-testid="alerts-block" data-state={active.length > 0 ? "active" : "clear"}>
    <p data-testid="alerts-channel" data-state={channelState} className="ops-channel" style={{ color: !channel.configured ? "var(--color-warning)" : channelFailed ? "var(--color-danger)" : "var(--color-success)" }}>
      {!channel.configured
        ? "Канал доставки: не настроен — алерты сохраняются в базе, в вебхук не отправляются."
        : channelFailed
          ? `Канал доставки: вебхук настроен, последняя доставка не удалась (${channel.lastDeliveryStatus}).`
          : "Канал доставки: вебхук настроен."}
    </p>
    <div className="ops-section">
      <p className="ops-line"><strong>Активные</strong>{active.length > 0 && <span> · {alertPlural(active.length)}</span>}</p>
      {active.length === 0
        ? <div><p className="ops-line">Активных алертов нет</p><p className="ops-line ops-line--sm ops-line--muted">Сигналы деградации не обнаружены за последние 7 дней. Проверка выполняется автоматически.</p></div>
        : <ul className="stack">{visible.filter((row) => row.status !== "RESOLVED").map(renderRow)}</ul>}
    </div>
    <div className="ops-section">
      <p className="ops-line"><strong>Решённые за 7 дней</strong>{resolved.length > 0 && <span> · {alertPlural(resolved.length)}</span>}</p>
      {resolved.length === 0
        ? <p className="ops-line">Решённых алертов за последние 7 дней нет.</p>
        : <ul className="stack">{visible.filter((row) => row.status === "RESOLVED").map(renderRow)}</ul>}
    </div>
    {pages > 1 && <nav aria-label="Страницы алертов" className="ops-section">
      <p className="ops-line ops-line--sm tabular-nums">Показано {start}–{end} из {total}</p>
      <ul className="cluster list-reset">
        {Array.from({ length: pages }, (_, index) => {
          const target = index + 1;
          const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
          params.set("alertPage", String(target));
          return <li key={target}><a href={`?${params.toString()}`} aria-current={target === current ? "page" : undefined}>{target}</a></li>;
        })}
      </ul>
    </nav>}
  </article>;
}
