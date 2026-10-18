"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { runResultsSync, type FilterSyncState } from "./date-range-filter";
import { SyncToastStack, useSyncToasts } from "./sync-toast";

/** Standalone «Загрузить результаты» so publishing outcomes does not require a
 * detour through «Матчи»: the scorecards page mounts it above the ведомость.
 * Same handler (runResultsSync), durable status line and transient popup as
 * the fixtures filter's button; `league` scopes the run the same way, and the
 * default empty value publishes results for every league. */
export function ResultsSyncButton({ league = "" }: { league?: string }) {
  const router = useRouter();
  const [state, setState] = useState<FilterSyncState>({ pending: false });
  const { toasts, push: pushToast, dismiss: dismissToast } = useSyncToasts();

  return (
    <section style={{ border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", padding: 20, marginBlock: 18 }}>
      <h2>Загрузка результатов</h2>
      <button
        type="button"
        className="btn-secondary"
        style={{ minHeight: 44, padding: "8px 20px" }}
        disabled={state.pending}
        onClick={() => void runResultsSync(league, (next) => { setState(next); pushToast("results", next); }, () => router.refresh())}
      >
        {state.pending ? "Загружаю результаты…" : "Загрузить результаты"}
      </button>
      {state.message ? (
        <p role="status" aria-live="polite" className="filter-hint" style={state.error ? { color: "var(--color-danger)" } : undefined}>
          {state.message}
        </p>
      ) : null}
      <p className="filter-hint">
        Публикует итоги завершённых матчей принудительно — даже если результаты загружались недавно.
        Ведомость ниже обновится сама.
      </p>
      <SyncToastStack toasts={toasts} onDismiss={dismissToast} />
    </section>
  );
}
