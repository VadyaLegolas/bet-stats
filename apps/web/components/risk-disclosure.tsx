export const PERSISTENT_RISK_DISCLOSURE =
  "Probabilities are estimates, not guarantees. You can lose money when betting.";

export function RiskDisclosure() {
  return (
    <aside
      aria-label="Betting risk disclosure"
      style={{ border: "1px solid #CBD5E1", borderRadius: 8, marginBlock: 24, padding: 16 }}
    >
      <p style={{ margin: 0 }}>{PERSISTENT_RISK_DISCLOSURE}</p>
    </aside>
  );
}
