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
    className="notice"
  >
    <p>{METHODOLOGY_WARNINGS[context]}</p>
    <Link href="/methodology#limitations">Методология и ограничения</Link>
  </aside>;
}
