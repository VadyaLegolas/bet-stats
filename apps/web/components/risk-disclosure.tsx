export const PERSISTENT_RISK_DISCLOSURE =
  "Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.";

export function RiskDisclosure() {
  return (
    <aside aria-label="Раскрытие рисков ставок" className="notice notice--danger notice--spaced">
      <p>{PERSISTENT_RISK_DISCLOSURE}</p>
    </aside>
  );
}
