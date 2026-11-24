import { providerReasonLabel, routeOutcomeLabel, routeTriggerLabel } from "./enum-labels";
import { formatInstant } from "./time-format";

export type ProviderState = { state: "PRIMARY" | "FALLBACK" | "PENDING" | "UNAVAILABLE" | "LIMITED" | "UNSUPPORTED" | "STALE_CAPABILITY" | "BUDGET_PROTECTED" | "CIRCUIT_DENIED"; provider: string; reason: string; capturedAt: string | null; lastValidAt: string | null; retryAllowed: boolean; receipt: { id: string; policyVersion: string; outcome: string; trigger: string } | null };

const headings: Record<ProviderState["state"], string> = {
  PRIMARY: "Основной источник",
  FALLBACK: "Использован резервный источник",
  PENDING: "Покрытие ожидается",
  UNAVAILABLE: "Покрытие недоступно",
  LIMITED: "Неполные данные",
  UNSUPPORTED: "Не поддерживается",
  STALE_CAPABILITY: "Устаревшая возможность",
  BUDGET_PROTECTED: "Защита бюджета",
  CIRCUIT_DENIED: "Сработал предохранитель",
};

/* Tone classes (globals.css) carry the token colour recipe, so both themes stay
   readable without per-component colour records. */
const providerTones: Record<ProviderState["state"], string> = {
  PRIMARY: "tone-positive",
  FALLBACK: "tone-info",
  PENDING: "tone-neutral",
  UNAVAILABLE: "tone-danger",
  LIMITED: "tone-warning",
  UNSUPPORTED: "tone-neutral",
  STALE_CAPABILITY: "tone-danger",
  BUDGET_PROTECTED: "tone-warning",
  CIRCUIT_DENIED: "tone-danger",
};

export function ProviderStateNotice({ state, compact = false }: { state: ProviderState; compact?: boolean }) {
  const blocking = ["UNAVAILABLE", "LIMITED", "UNSUPPORTED"].includes(state.state);
  const tone = providerTones[state.state] ?? providerTones.PENDING;
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";

  if (compact) {
    return (
      <span
        aria-label={`Статус поставщика: ${headings[state.state]}`}
        role={blocking ? "alert" : "status"}
        className={`state-chip ${tone}`}
      >
        <span className="state-dot" />
        {headings[state.state]}
      </span>
    );
  }

  return (
    <aside aria-label="Статус поставщика" role={blocking ? "alert" : "status"} className={`state-notice ${tone}`}>
      <div className="state-notice-head">
        <span className="state-dot state-dot--lg" />
        <strong className="state-notice-title">{headings[state.state]}</strong>
      </div>
      {state.state === "LIMITED" && (
        <p className="state-notice-text state-notice-text--warning">
          API-Football — единственный настроенный источник для этого соревнования, и он недоступен. Последние корректные данные остаются помечены временем захвата; отсутствующие значения не считаются нулём.
        </p>
      )}
      <p className="state-notice-text">
        Источник: <strong>{state.provider}</strong>. Причина: {providerReasonLabel(state.reason)}.
      </p>
      <div className="state-notice-meta">
        {state.capturedAt && (
          <span>Время захвата: <time dateTime={state.capturedAt} title={state.capturedAt}>{formatInstant(state.capturedAt, timeZone)}</time></span>
        )}
        {state.lastValidAt && (
          <span className="state-notice-warn">Последний корректный захват: <time dateTime={state.lastValidAt} title={state.lastValidAt}>{formatInstant(state.lastValidAt, timeZone)}</time></span>
        )}
      </div>
      {state.retryAllowed && (
        <button type="button" className="btn-secondary btn-compact state-notice-retry">
          Проверить покрытие заново
        </button>
      )}
      {state.receipt && (
        <details className="state-notice-receipt">
          <summary>Точная квитанция поставщика</summary>
          <dl>
            <dt>ID квитанции</dt>
            <dd><code>{state.receipt.id}</code></dd>
            <dt>Версия политики</dt>
            <dd>{state.receipt.policyVersion}</dd>
            <dt>Исход</dt>
            <dd>{routeOutcomeLabel(state.receipt.outcome)}</dd>
            <dt>Триггер</dt>
            <dd>{routeTriggerLabel(state.receipt.trigger)}</dd>
          </dl>
        </details>
      )}
    </aside>
  );
}
