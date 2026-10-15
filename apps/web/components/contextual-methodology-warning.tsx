import Link from "next/link";

export const METHODOLOGY_WARNINGS = Object.freeze({
  forecast: "Вероятности — это оценки, а не гарантии. Доказательства могут быть неполными или устаревшими.",
  value: "Положительное ожидаемое value — это оценка модели, а не обещание прибыли.",
  scorecard: "Историческая оценка не гарантирует будущих результатов.",
});

export type MethodologyWarningContext = keyof typeof METHODOLOGY_WARNINGS;

export function ContextualMethodologyWarning({ context }: { context: MethodologyWarningContext }) {
  return <aside
    aria-label={`${context}: предупреждение о методологии`}
    data-methodology-context={context}
    style={{ border: "1px solid var(--color-border)", borderInlineStart: "4px solid var(--color-signal)", borderRadius: 4, background: "var(--color-signal-subtle)", padding: 14, marginBlock: 14 }}
  >
    <p style={{ marginBlockStart: 0 }}>{METHODOLOGY_WARNINGS[context]}</p>
    <Link href="/methodology#limitations">Методология и ограничения</Link>
  </aside>;
}
