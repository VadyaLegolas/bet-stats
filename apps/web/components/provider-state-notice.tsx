import { providerReasonLabel, routeOutcomeLabel, routeTriggerLabel } from "./enum-labels";
import { formatInstant } from "./time-format";

export type ProviderState = { state: "PRIMARY" | "FALLBACK" | "PENDING" | "UNAVAILABLE" | "LIMITED" | "UNSUPPORTED" | "STALE_CAPABILITY" | "BUDGET_PROTECTED" | "CIRCUIT_DENIED"; provider: string; reason: string; capturedAt: string | null; lastValidAt: string | null; retryAllowed: boolean; receipt: { id: string; policyVersion: string; outcome: string; trigger: string } | null };

const headings: Record<ProviderState["state"], string> = {
  PRIMARY: "Основной источник",
  FALLBACK: "Использован резервный источник",
  PENDING: "Покрытие ожидается",
  UNAVAILABLE: "Покрытие недоступно",
  LIMITED: "Неполные данные",
  UNSUPPORTED: "Не поддерживается",
  STALE_CAPABILITY: "Устаревшая возможность",
  BUDGET_PROTECTED: "Защита бюджета",
  CIRCUIT_DENIED: "Сработал предохранитель",
};

/* Badge colours reference the theme tokens (via color-mix for the washes and
   borders) instead of literal rgba values, so both themes stay readable: the
   light output is byte-identical to the previous literals, the dark theme
   inherits its lifted signal colours from globals.css. */
const providerBadgeStyles: Record<ProviderState["state"], { bg: string; color: string; border: string; dot: string }> = {
  PRIMARY: { bg: "color-mix(in srgb, var(--color-accent) 9%, transparent)", color: "var(--color-accent)", border: "color-mix(in srgb, var(--color-accent) 35%, transparent)", dot: "var(--color-accent)" },
  FALLBACK: { bg: "color-mix(in srgb, var(--color-info) 10%, transparent)", color: "var(--color-info)", border: "color-mix(in srgb, var(--color-info) 35%, transparent)", dot: "var(--color-info)" },
  PENDING: { bg: "color-mix(in srgb, var(--color-text-secondary) 9%, transparent)", color: "var(--color-text-secondary)", border: "color-mix(in srgb, var(--color-text-secondary) 35%, transparent)", dot: "var(--color-muted)" },
  UNAVAILABLE: { bg: "color-mix(in srgb, var(--color-danger) 10%, transparent)", color: "var(--color-danger)", border: "color-mix(in srgb, var(--color-danger) 35%, transparent)", dot: "var(--color-danger)" },
  LIMITED: { bg: "color-mix(in srgb, var(--color-signal) 18%, transparent)", color: "var(--color-warning)", border: "color-mix(in srgb, var(--color-signal) 50%, transparent)", dot: "var(--color-signal)" },
  UNSUPPORTED: { bg: "color-mix(in srgb, var(--color-text-secondary) 9%, transparent)", color: "var(--color-text-secondary)", border: "color-mix(in srgb, var(--color-text-secondary) 35%, transparent)", dot: "var(--color-muted)" },
  STALE_CAPABILITY: { bg: "color-mix(in srgb, var(--color-danger) 10%, transparent)", color: "var(--color-danger)", border: "color-mix(in srgb, var(--color-danger) 35%, transparent)", dot: "var(--color-danger)" },
  BUDGET_PROTECTED: { bg: "color-mix(in srgb, var(--color-signal) 18%, transparent)", color: "var(--color-warning)", border: "color-mix(in srgb, var(--color-signal) 50%, transparent)", dot: "var(--color-signal)" },
  CIRCUIT_DENIED: { bg: "color-mix(in srgb, var(--color-danger) 10%, transparent)", color: "var(--color-danger)", border: "color-mix(in srgb, var(--color-danger) 35%, transparent)", dot: "var(--color-danger)" },
};

export function ProviderStateNotice({ state, compact = false }: { state: ProviderState; compact?: boolean }) {
  const blocking = ["UNAVAILABLE", "LIMITED", "UNSUPPORTED"].includes(state.state);
  const style = providerBadgeStyles[state.state] ?? providerBadgeStyles.PENDING;
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";

  if (compact) {
    return (
      <span
        aria-label={`Статус поставщика: ${headings[state.state]}`}
        role={blocking ? "alert" : "status"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: style.bg,
          color: style.color,
          border: `1px solid ${style.border}`,
          borderRadius: "9999px",
          padding: "2px 10px",
          fontSize: "0.75rem",
          fontWeight: 600,
          letterSpacing: "0.01em",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: style.dot, display: "inline-block" }} />
        {headings[state.state]}
      </span>
    );
  }

  return (
    <aside
      aria-label="Статус поставщика"
      role={blocking ? "alert" : "status"}
      style={{
        borderLeft: `4px solid ${style.dot}`,
        background: "var(--color-surface)",
        padding: "16px",
        borderRadius: "var(--radius-control)",
        marginBlock: 12,
        border: "1px solid var(--color-border-subtle)",
        borderLeftWidth: 4,
        overflowWrap: "anywhere",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: style.dot, display: "inline-block" }} />
        <strong style={{ color: style.color, fontSize: "1rem" }}>{headings[state.state]}</strong>
      </div>
      {state.state === "LIMITED" && (
        <p style={{ margin: "4px 0 8px", fontSize: "0.875rem", color: "var(--color-warning)" }}>
          API-Football — единственный настроенный источник для этого соревнования, и он недоступен. Последние корректные данные остаются помечены временем захвата; отсутствующие значения не считаются нулём.
        </p>
      )}
      <p style={{ margin: "4px 0", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        Источник: <strong style={{ color: "var(--color-text)" }}>{state.provider}</strong>. Причина: {providerReasonLabel(state.reason)}.
      </p>
      <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
        {state.capturedAt && (
          <span>Время захвата: <time dateTime={state.capturedAt} title={state.capturedAt}>{formatInstant(state.capturedAt, timeZone)}</time></span>
        )}
        {state.lastValidAt && (
          <span style={{ color: "var(--color-warning)" }}>Последний корректный захват: <time dateTime={state.lastValidAt} title={state.lastValidAt}>{formatInstant(state.lastValidAt, timeZone)}</time></span>
        )}
      </div>
      {state.retryAllowed && (
        <button type="button" className="btn-secondary" style={{ minHeight: 38, padding: "6px 14px", marginTop: 12, fontSize: "0.875rem" }}>
          Проверить покрытие заново
        </button>
      )}
      {state.receipt && (
        <details style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
          <summary style={{ cursor: "pointer", color: "var(--color-accent-hover)" }}>Точная квитанция поставщика</summary>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", marginTop: 8 }}>
            <dt style={{ color: "var(--color-muted)" }}>ID квитанции</dt>
            <dd style={{ margin: 0 }}><code>{state.receipt.id}</code></dd>
            <dt style={{ color: "var(--color-muted)" }}>Версия политики</dt>
            <dd style={{ margin: 0 }}>{state.receipt.policyVersion}</dd>
            <dt style={{ color: "var(--color-muted)" }}>Исход</dt>
            <dd style={{ margin: 0 }}>{routeOutcomeLabel(state.receipt.outcome)}</dd>
            <dt style={{ color: "var(--color-muted)" }}>Триггер</dt>
            <dd style={{ margin: 0 }}>{routeTriggerLabel(state.receipt.trigger)}</dd>
          </dl>
        </details>
      )}
    </aside>
  );
}
