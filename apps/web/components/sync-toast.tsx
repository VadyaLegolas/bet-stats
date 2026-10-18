"use client";

import { useEffect, useRef, useState } from "react";

import type { FilterSyncState } from "./date-range-filter";

/** Transient popups confirming the manual «Обновить матчи» / «Загрузить результаты»
 * actions. The inline status line under the buttons stays the durable record — a toast
 * only makes the outcome visible at the moment it happens, then disappears on its own. */

export type SyncToastPhase = "fixtures" | "results";
export type SyncToastKind = "success" | "error";

export type SyncToast = {
  readonly id: number;
  readonly phase: SyncToastPhase;
  readonly kind: SyncToastKind;
  readonly message: string;
  readonly leaving: boolean;
};

/** Errors stay longer — they carry the reason the action failed. */
export const TOAST_TTL_MS: Readonly<Record<SyncToastKind, number>> = { success: 5000, error: 8000 };
/** Exit-fade duration; the element is removed this long after the hide mark. */
export const TOAST_EXIT_MS = 320;
/** At most three popups on screen; the oldest is dropped first. */
export const MAX_TOASTS = 3;

/** Toast for a finished sync phase: nothing while a phase runs or produced no message. */
export const syncToastFor = (phase: SyncToastPhase, state: FilterSyncState): { kind: SyncToastKind; message: string } | null =>
  state.pending || !state.message ? null : { kind: state.error ? "error" : "success", message: state.message };

export const toastTitle = (phase: SyncToastPhase, kind: SyncToastKind): string =>
  phase === "fixtures"
    ? kind === "error" ? "Не удалось обновить матчи" : "Матчи обновлены"
    : kind === "error" ? "Не удалось загрузить результаты" : "Результаты обновлены";

export function SyncToastStack({ toasts, onDismiss }: { readonly toasts: readonly SyncToast[]; readonly onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="sync-toast-stack" role="region" aria-label="Всплывающие уведомления">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`sync-toast sync-toast--${toast.kind}${toast.leaving ? " sync-toast--leaving" : ""}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <strong>{toastTitle(toast.phase, toast.kind)}</strong>
          <p>{toast.message}</p>
          <button type="button" className="sync-toast-close" aria-label="Закрыть уведомление" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Toast lifecycle for one page: push schedules hide (fade) then remove; dismiss and
 * unmount clear the pending timers so no state update lands after teardown. */
export function useSyncToasts(): { readonly toasts: readonly SyncToast[]; readonly push: (phase: SyncToastPhase, state: FilterSyncState) => void; readonly dismiss: (id: number) => void } {
  const [toasts, setToasts] = useState<readonly SyncToast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, { hide: ReturnType<typeof setTimeout>; remove: ReturnType<typeof setTimeout> }>());

  useEffect(() => () => {
    for (const entry of timers.current.values()) {
      clearTimeout(entry.hide);
      clearTimeout(entry.remove);
    }
    timers.current.clear();
  }, []);

  const dismiss = (id: number) => {
    const entry = timers.current.get(id);
    if (entry) {
      clearTimeout(entry.hide);
      clearTimeout(entry.remove);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const push = (phase: SyncToastPhase, state: FilterSyncState) => {
    const toast = syncToastFor(phase, state);
    if (!toast) return;
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, phase, kind: toast.kind, message: toast.message, leaving: false }].slice(-MAX_TOASTS));
    const hide = setTimeout(() => {
      setToasts((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
    }, TOAST_TTL_MS[toast.kind]);
    const remove = setTimeout(() => {
      timers.current.delete(id);
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, TOAST_TTL_MS[toast.kind] + TOAST_EXIT_MS);
    timers.current.set(id, { hide, remove });
  };

  return { toasts, push, dismiss };
}
