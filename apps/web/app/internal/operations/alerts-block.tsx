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

// Co-located mirrors of the operations page card/button constants — page.tsx
// cannot be imported here without a cycle, and the plan forbids restyling.
const card = { border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", padding: 20, overflowWrap: "anywhere" } as const;
const button = { minHeight: 44, padding: "8px 14px" } as const;

// Token-driven severity chips (data-state-notice.tsx color-mix pattern): text
// labels carry the meaning, color is supplemental, dark theme works unchanged.
const CHIP_STYLES: Record<string, { bg: string; color: string; border: string; dot: string }> = {
  CRITICAL: { bg: "color-mix(in srgb, var(--color-danger) 10%, transparent)", color: "var(--color-danger)", border: "color-mix(in srgb, var(--color-danger) 35%, transparent)", dot: "var(--color-danger)" },
  WARNING: { bg: "color-mix(in srgb, var(--color-signal) 18%, transparent)", color: "var(--color-warning)", border: "color-mix(in srgb, var(--color-signal) 50%, transparent)", dot: "var(--color-signal)" },
};
const RESOLVED_CHIP = { bg: "color-mix(in srgb, var(--color-text-secondary) 9%, transparent)", color: "var(--color-text-secondary)", border: "color-mix(in srgb, var(--color-text-secondary) 35%, transparent)", dot: "var(--color-muted)" };
const ACK_CHIP = { bg: "color-mix(in srgb, var(--color-info) 10%, transparent)", color: "var(--color-info)", border: "color-mix(in srgb, var(--color-info) 35%, transparent)", dot: "var(--color-info)" };

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

function chip(label: string, style: { bg: string; color: string; border: string; dot: string }): React.ReactNode {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: style.bg, color: style.color, border: `1px solid ${style.border}`, borderRadius: "9999px", padding: "2px 10px", fontSize: "0.75rem", fontWeight: 600, lineHeight: 1.3 }}>
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: style.dot, display: "inline-block" }} />
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
  return <><button style={button} aria-label={`Скопировать корреляционный ID ${value}`} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>{value}</button><span role="status" aria-live="polite">{copied ? "Корреляционный ID скопирован" : ""}</span></>;
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
    const severityStyle = isResolved ? RESOLVED_CHIP : CHIP_STYLES[row.severity] ?? RESOLVED_CHIP;
    return <li key={row.id} data-testid="alert-row" data-state={row.status.toLowerCase()} data-severity={row.severity} style={{ border: "1px solid var(--color-border-subtle)", borderRadius: 4, padding: 16, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {chip(alertSeverityLabel(row.severity), severityStyle)}
        <span style={{ fontSize: "0.875rem" }}>{alertStatusLabel(row.status)}</span>
        {acknowledgedAt && <span ref={(element) => { markerRefs.current[row.id] = element; }} tabIndex={-1} style={{ fontSize: "0.875rem", ...ACK_CHIP, background: ACK_CHIP.bg, border: `1px solid ${ACK_CHIP.border}`, color: ACK_CHIP.color, borderRadius: "9999px", padding: "2px 10px" }}>Подтверждён · <time dateTime={acknowledgedAt}>{date(acknowledgedAt)}</time></span>}
      </div>
      <p style={{ margin: 0 }}><strong>{signalLabel !== row.signal ? `${signalLabel} · ${row.signal}` : row.signal}</strong></p>
      <dl style={{ margin: 0, fontSize: "0.875rem", display: "grid", gap: 4 }}>
        <div><dt>Область</dt><dd>{row.scope || "Нет"}</dd></div>
        <div><dt>Появился</dt><dd><time dateTime={row.firstSeen}>{date(row.firstSeen)}</time></dd></div>
        <div><dt>Последний раз</dt><dd><time dateTime={row.lastSeen}>{date(row.lastSeen)}</time></dd></div>
        <div><dt>Повторений</dt><dd style={{ fontVariantNumeric: "tabular-nums" }}>{row.count}</dd></div>
        {isResolved && <div><dt>Решён</dt><dd><time dateTime={row.resolvedAt ?? undefined}>{date(row.resolvedAt)}</time></dd></div>}
      </dl>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: "0.875rem" }}>
        <span>Корреляционные ID:</span>
        {row.correlationIds.length === 0 ? "Нет" : row.correlationIds.map((value) => <CopyCorrelation key={value} value={value} />)}
      </div>
      {!isResolved && !acknowledgedAt && <p style={{ margin: 0 }}><button style={button} disabled={pendingId !== null} aria-label={`Подтвердить алерт ${signalLabel}`} onClick={() => void acknowledge(row)}>{pendingId === row.id ? "Подтверждение…" : "Подтвердить"}</button></p>}
      {localAck[row.id] && pendingId !== row.id && failedId !== row.id && <p role="status" aria-live="polite" style={{ margin: 0, fontSize: "0.875rem" }}>{ACK_SUCCESS}</p>}
      {failedId === row.id && pendingId !== row.id && <p role="alert" style={{ margin: 0, fontSize: "0.875rem" }}>{ACK_FAILURE}</p>}
    </li>;
  };

  return <article style={card} data-testid="alerts-block" data-state={active.length > 0 ? "active" : "clear"}>
    <p data-testid="alerts-channel" data-state={channelState} style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: !channel.configured ? "var(--color-warning)" : channelFailed ? "var(--color-danger)" : "var(--color-success)" }}>
      {!channel.configured
        ? "Канал доставки: не настроен — алерты сохраняются в базе, в вебхук не отправляются."
        : channelFailed
          ? `Канал доставки: вебхук настроен, последняя доставка не удалась (${channel.lastDeliveryStatus}).`
          : "Канал доставки: вебхук настроен."}
    </p>
    <div style={{ marginTop: 24 }}>
      <p style={{ margin: 0 }}><strong>Активные</strong>{active.length > 0 && <span> · {alertPlural(active.length)}</span>}</p>
      {active.length === 0
        ? <div><p style={{ margin: 0 }}>Активных алертов нет</p><p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>Сигналы деградации не обнаружены за последние 7 дней. Проверка выполняется автоматически.</p></div>
        : <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 16 }}>{visible.filter((row) => row.status !== "RESOLVED").map(renderRow)}</ul>}
    </div>
    <div style={{ marginTop: 32 }}>
      <p style={{ margin: 0 }}><strong>Решённые за 7 дней</strong>{resolved.length > 0 && <span> · {alertPlural(resolved.length)}</span>}</p>
      {resolved.length === 0
        ? <p style={{ margin: 0 }}>Решённых алертов за последние 7 дней нет.</p>
        : <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 16 }}>{visible.filter((row) => row.status === "RESOLVED").map(renderRow)}</ul>}
    </div>
    {pages > 1 && <nav aria-label="Страницы алертов" style={{ marginTop: 24 }}>
      <p style={{ margin: 0, fontSize: "0.875rem", fontVariantNumeric: "tabular-nums" }}>Показано {start}–{end} из {total}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
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
