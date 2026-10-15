export const PERSISTENT_RISK_DISCLOSURE =
  "Probabilities are estimates, not guarantees. You can lose money when betting.";

export function RiskDisclosure() {
  return (
    <aside
      aria-label="Betting risk disclosure"
      style={{ border: "1px solid var(--color-border)", borderInlineStart: "4px solid var(--color-danger)", borderRadius: 4, background: "var(--color-danger-subtle)", marginBlock: 24, padding: 16 }}
    >
      <p style={{ margin: 0 }}>{PERSISTENT_RISK_DISCLOSURE}</p>
    </aside>
  );
}
