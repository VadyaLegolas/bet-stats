import { reasonLabel } from "./enum-labels";
import { formatInstant } from "./time-format";

export type FixtureDataState = { state: "AVAILABLE" | "LIMITED" | "STALE" | "UNSUPPORTED" | "UNRESOLVED"; reason: string; provider: string; capturedAt: string; sourceUpdatedAt: string | null; freshnessThresholdMs: number; value: null };

const labels: Record<FixtureDataState["state"], string> = {
  AVAILABLE: "Доступно",
  LIMITED: "Неполные данные",
  STALE: "Устаревшие данные",
  UNSUPPORTED: "Не поддерживается",
  UNRESOLVED: "Неоднозначная идентичность",
};

/* Tone classes (globals.css) carry the token colour recipe, so both themes stay
   readable without per-component colour records. */
const stateTones: Record<FixtureDataState["state"], string> = {
  AVAILABLE: "tone-positive",
  LIMITED: "tone-warning",
  STALE: "tone-danger",
  UNSUPPORTED: "tone-neutral",
  UNRESOLVED: "tone-info",
};

export function DataStateNotice({ data, compact = false }: { data: FixtureDataState; compact?: boolean }) {
  const tone = stateTones[data.state] ?? stateTones.UNSUPPORTED;
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";

  if (compact) {
    return (
      <span
        aria-label={`Качество данных: ${labels[data.state] ?? "Данные недоступны"}`}
        className={`state-chip ${tone}`}
      >
        <span className="state-dot" />
        {labels[data.state] ?? "Данные недоступны"}
      </span>
    );
  }

  return (
    <aside aria-label="Качество данных" className={`state-notice ${tone}`}>
      <div className="state-notice-head">
        <span className="state-dot state-dot--lg" />
        <strong className="state-notice-title">{labels[data.state] ?? "Данные недоступны"}</strong>
      </div>
      <p className="state-notice-text">
        {reasonLabel(data.reason)}.
      </p>
      <div className="state-notice-meta">
        <span>Источник: <strong>{data.provider}</strong></span>
        <span>Захвачено: <time dateTime={data.capturedAt} title={data.capturedAt}>{formatInstant(data.capturedAt, timeZone)}</time></span>
        <span>
          Обновление источника:{" "}
          {data.sourceUpdatedAt ? (
            <time dateTime={data.sourceUpdatedAt} title={data.sourceUpdatedAt}>{formatInstant(data.sourceUpdatedAt, timeZone)}</time>
          ) : (
            <span>Недоступно</span>
          )}
        </span>
      </div>
    </aside>
  );
}
