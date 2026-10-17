import { reasonLabel } from "./enum-labels";

export type FixtureDataState = { state: "AVAILABLE" | "LIMITED" | "STALE" | "UNSUPPORTED" | "UNRESOLVED"; reason: string; provider: string; capturedAt: string; sourceUpdatedAt: string | null; freshnessThresholdMs: number; value: null };

const labels: Record<FixtureDataState["state"], string> = {
  AVAILABLE: "Доступно",
  LIMITED: "Неполные данные",
  STALE: "Устаревшие данные",
  UNSUPPORTED: "Не поддерживается",
  UNRESOLVED: "Неоднозначная идентичность",
};

const badgeStyles: Record<FixtureDataState["state"], { bg: string; color: string; border: string; dot: string }> = {
  AVAILABLE: { bg: "rgba(20, 80, 59, 0.09)", color: "#14503b", border: "rgba(20, 80, 59, 0.35)", dot: "#14503b" },
  LIMITED: { bg: "rgba(217, 154, 11, 0.18)", color: "#7a5600", border: "rgba(217, 154, 11, 0.5)", dot: "#d99a0b" },
  STALE: { bg: "rgba(163, 43, 43, 0.1)", color: "#a32b2b", border: "rgba(163, 43, 43, 0.35)", dot: "#a32b2b" },
  UNSUPPORTED: { bg: "rgba(70, 84, 76, 0.09)", color: "#46544c", border: "rgba(70, 84, 76, 0.35)", dot: "#5c6b62" },
  UNRESOLVED: { bg: "rgba(44, 93, 130, 0.1)", color: "#2c5d82", border: "rgba(44, 93, 130, 0.35)", dot: "#2c5d82" },
};

export function DataStateNotice({ data, compact = false }: { data: FixtureDataState; compact?: boolean }) {
  const style = badgeStyles[data.state] ?? badgeStyles.UNSUPPORTED;

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
        <span>Захвачено: <time dateTime={data.capturedAt}>{data.capturedAt}</time></span>
        <span>
          Обновление источника:{" "}
          {data.sourceUpdatedAt ? (
            <time dateTime={data.sourceUpdatedAt}>{data.sourceUpdatedAt}</time>
          ) : (
            <span>Недоступно</span>
          )}
        </span>
      </div>
    </aside>
  );
}
