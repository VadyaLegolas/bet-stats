/* Общий компонент: используется и в примере списка на главной, и в настоящем списке матчей. */

/** Подписи исходов 1X2 для скринридеров, в порядке хозяева / ничья / гости. */
export const PROB_OUTCOME_LABELS = ["победа хозяев", "ничья", "победа гостей"] as const;

export function ProbBar({ probs, small = false }: { probs: readonly number[]; small?: boolean }) {
  return (
    <div className={small ? "prob-bar prob-bar--sm" : "prob-bar"} aria-hidden="true">
      <span className="prob-bar-home" style={{ width: `${probs[0]}%` }} />
      <span className="prob-bar-draw" style={{ width: `${probs[1]}%` }} />
      <span className="prob-bar-away" style={{ width: `${probs[2]}%` }} />
    </div>
  );
}
