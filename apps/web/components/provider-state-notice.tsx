export type ProviderState = { state: "PRIMARY" | "FALLBACK" | "PENDING" | "UNAVAILABLE" | "LIMITED" | "UNSUPPORTED" | "STALE_CAPABILITY" | "BUDGET_PROTECTED" | "CIRCUIT_DENIED"; provider: string; reason: string; capturedAt: string | null; lastValidAt: string | null; retryAllowed: boolean; receipt: { id: string; policyVersion: string; outcome: string; trigger: string } | null };

const headings: Record<ProviderState["state"], string> = {
  PRIMARY: "Primary source",
  FALLBACK: "Fallback source used",
  PENDING: "Coverage pending",
  UNAVAILABLE: "Coverage unavailable",
  LIMITED: "Limited data",
  UNSUPPORTED: "Unsupported",
  STALE_CAPABILITY: "Stale capability",
  BUDGET_PROTECTED: "Budget protected",
  CIRCUIT_DENIED: "Circuit denied",
};

const providerBadgeStyles: Record<ProviderState["state"], { bg: string; color: string; border: string; dot: string }> = {
  PRIMARY: { bg: "rgba(20, 80, 59, 0.09)", color: "#14503b", border: "rgba(20, 80, 59, 0.35)", dot: "#14503b" },
  FALLBACK: { bg: "rgba(44, 93, 130, 0.1)", color: "#2c5d82", border: "rgba(44, 93, 130, 0.35)", dot: "#2c5d82" },
  PENDING: { bg: "rgba(70, 84, 76, 0.09)", color: "#46544c", border: "rgba(70, 84, 76, 0.35)", dot: "#5c6b62" },
  UNAVAILABLE: { bg: "rgba(163, 43, 43, 0.1)", color: "#a32b2b", border: "rgba(163, 43, 43, 0.35)", dot: "#a32b2b" },
  LIMITED: { bg: "rgba(217, 154, 11, 0.18)", color: "#7a5600", border: "rgba(217, 154, 11, 0.5)", dot: "#d99a0b" },
  UNSUPPORTED: { bg: "rgba(70, 84, 76, 0.09)", color: "#46544c", border: "rgba(70, 84, 76, 0.35)", dot: "#5c6b62" },
  STALE_CAPABILITY: { bg: "rgba(163, 43, 43, 0.1)", color: "#a32b2b", border: "rgba(163, 43, 43, 0.35)", dot: "#a32b2b" },
  BUDGET_PROTECTED: { bg: "rgba(217, 154, 11, 0.18)", color: "#7a5600", border: "rgba(217, 154, 11, 0.5)", dot: "#d99a0b" },
  CIRCUIT_DENIED: { bg: "rgba(163, 43, 43, 0.1)", color: "#a32b2b", border: "rgba(163, 43, 43, 0.35)", dot: "#a32b2b" },
};

export function ProviderStateNotice({ state, compact = false }: { state: ProviderState; compact?: boolean }) {
  const blocking = ["UNAVAILABLE", "LIMITED", "UNSUPPORTED"].includes(state.state);
  const style = providerBadgeStyles[state.state] ?? providerBadgeStyles.PENDING;

  if (compact) {
    return (
      <span
        aria-label={`Provider status: ${headings[state.state]}`}
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
      aria-label="Provider status"
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
          API-Football is the sole configured source for this competition and is unavailable. Last valid data remains labelled with its capture time; missing values are not treated as zero.
        </p>
      )}
      <p style={{ margin: "4px 0", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        Source: <strong style={{ color: "var(--color-text)" }}>{state.provider}</strong>. Reason: {state.reason.replaceAll("_", " ").toLowerCase()}.
      </p>
      <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
        {state.capturedAt && (
          <span>Capture time: <time dateTime={state.capturedAt}>{state.capturedAt}</time></span>
        )}
        {state.lastValidAt && (
          <span style={{ color: "var(--color-warning)" }}>Last valid capture: <time dateTime={state.lastValidAt}>{state.lastValidAt}</time></span>
        )}
      </div>
      {state.retryAllowed && (
        <button type="button" className="btn-secondary" style={{ minHeight: 38, padding: "6px 14px", marginTop: 12, fontSize: "0.875rem" }}>
          Check provider coverage again
        </button>
      )}
      {state.receipt && (
        <details style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
          <summary style={{ cursor: "pointer", color: "var(--color-accent-hover)" }}>Exact provider receipt</summary>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", marginTop: 8 }}>
            <dt style={{ color: "var(--color-muted)" }}>Receipt ID</dt>
            <dd style={{ margin: 0 }}><code>{state.receipt.id}</code></dd>
            <dt style={{ color: "var(--color-muted)" }}>Policy version</dt>
            <dd style={{ margin: 0 }}>{state.receipt.policyVersion}</dd>
            <dt style={{ color: "var(--color-muted)" }}>Outcome</dt>
            <dd style={{ margin: 0 }}>{state.receipt.outcome}</dd>
            <dt style={{ color: "var(--color-muted)" }}>Trigger</dt>
            <dd style={{ margin: 0 }}>{state.receipt.trigger}</dd>
          </dl>
        </details>
      )}
    </aside>
  );
}
