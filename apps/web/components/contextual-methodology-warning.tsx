import Link from "next/link";

export const METHODOLOGY_WARNINGS = Object.freeze({
  forecast: "Probabilities are estimates, not guarantees. Evidence may be incomplete or stale.",
  value: "A positive expected value is a model estimate, not a promise of profit.",
  scorecard: "Historical evaluation does not guarantee future performance.",
});

export type MethodologyWarningContext = keyof typeof METHODOLOGY_WARNINGS;

export function ContextualMethodologyWarning({ context }: { context: MethodologyWarningContext }) {
  return <aside
    aria-label={`${context} methodology warning`}
    data-methodology-context={context}
    style={{ borderInlineStart: "4px solid #A16207", background: "#FEFCE8", padding: 14, marginBlock: 14 }}
  >
    <p style={{ marginBlockStart: 0 }}>{METHODOLOGY_WARNINGS[context]}</p>
    <Link href="/methodology#limitations">Methodology and limitations</Link>
  </aside>;
}
