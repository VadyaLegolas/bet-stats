export const PERSISTENT_RISK_DISCLOSURE =
  "Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.";

export function RiskDisclosure() {
  return (
    <aside
      aria-label="Раскрытие рисков ставок"
      style={{ border: "1px solid var(--color-border)", borderInlineStart: "4px solid var(--color-danger)", borderRadius: 4, background: "var(--color-danger-subtle)", marginBlock: 24, padding: 16 }}
    >
      <p style={{ margin: 0 }}>{PERSISTENT_RISK_DISCLOSURE}</p>
    </aside>
  );
}
