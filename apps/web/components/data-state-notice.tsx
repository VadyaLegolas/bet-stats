import { reasonLabel } from "./enum-labels";
import { formatInstant } from "./time-format";

export type FixtureDataState = { state: "AVAILABLE" | "LIMITED" | "STALE" | "UNSUPPORTED" | "UNRESOLVED"; reason: string; provider: string; capturedAt: string; sourceUpdatedAt: string | null; freshnessThresholdMs: number; value: null };

const labels: Record<FixtureDataState["state"], string> = {
  AVAILABLE: "Доступно",
  LIMITED: "Неполные данные",
  STALE: "Устаревшие данные",
  UNSUPPORTED: "Не поддерживается",
  UNRESOLVED: "Неоднозначная идентичность",
};

/* Token-driven colours (see provider-state-notice): identical output in the
   light theme, readable automatically in the dark one. */
const badgeStyles: Record<FixtureDataState["state"], { bg: string; color: string; border: string; dot: string }> = {
  AVAILABLE: { bg: "color-mix(in srgb, var(--color-accent) 9%, transparent)", color: "var(--color-accent)", border: "color-mix(in srgb, var(--color-accent) 35%, transparent)", dot: "var(--color-accent)" },
  LIMITED: { bg: "color-mix(in srgb, var(--color-signal) 18%, transparent)", color: "var(--color-warning)", border: "color-mix(in srgb, var(--color-signal) 50%, transparent)", dot: "var(--color-signal)" },
  STALE: { bg: "color-mix(in srgb, var(--color-danger) 10%, transparent)", color: "var(--color-danger)", border: "color-mix(in srgb, var(--color-danger) 35%, transparent)", dot: "var(--color-danger)" },
  UNSUPPORTED: { bg: "color-mix(in srgb, var(--color-text-secondary) 9%, transparent)", color: "var(--color-text-secondary)", border: "color-mix(in srgb, var(--color-text-secondary) 35%, transparent)", dot: "var(--color-muted)" },
  UNRESOLVED: { bg: "color-mix(in srgb, var(--color-info) 10%, transparent)", color: "var(--color-info)", border: "color-mix(in srgb, var(--color-info) 35%, transparent)", dot: "var(--color-info)" },
};

export function DataStateNotice({ data, compact = false }: { data: FixtureDataState; compact?: boolean }) {
  const style = badgeStyles[data.state] ?? badgeStyles.UNSUPPORTED;
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";

  if (compact) {
    return (
      <span
        aria-label={`Качество данных: ${labels[data.state] ?? "Данные недоступны"}`}
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
        {labels[data.state] ?? "Данные недоступны"}
      </span>
    );
  }

  return (
    <aside
      aria-label="Качество данных"
      style={{
        borderLeft: `4px solid ${style.dot}`,
        background: "var(--color-surface)",
        padding: "12px 16px",
        borderRadius: "var(--radius-control)",
        marginBlock: 12,
        border: "1px solid var(--color-border-subtle)",
        borderLeftWidth: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: style.dot, display: "inline-block" }} />
        <strong style={{ color: style.color }}>{labels[data.state] ?? "Данные недоступны"}</strong>
      </div>
      <p style={{ margin: "4px 0", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        {reasonLabel(data.reason)}.
      </p>
      <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
        <span>Источник: <strong style={{ color: "var(--color-text-secondary)" }}>{data.provider}</strong></span>
        <span>Захвачено: <time dateTime={data.capturedAt} title={data.capturedAt}>{formatInstant(data.capturedAt, timeZone)}</time></span>
        <span>
          Обновление источника:{" "}
          {data.sourceUpdatedAt ? (
            <time dateTime={data.sourceUpdatedAt} title={data.sourceUpdatedAt}>{formatInstant(data.sourceUpdatedAt, timeZone)}</time>
          ) : (
            <span>Недоступно</span>
          )}
        </span>
      </div>
    </aside>
  );
}
