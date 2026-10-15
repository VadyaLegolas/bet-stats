"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export type LocalDataBlockState = "loading" | "available" | "limited" | "stale" | "unavailable" | "retrying";

type LocalDataBlockProps = Readonly<{
  name: string;
  state: LocalDataBlockState;
  reason?: string;
  lastValidAt?: string;
  retryAllowed: boolean;
  onRetry?: () => Promise<void>;
  children: ReactNode;
  refreshLabel?: string;
  retainContent?: boolean;
}>;

function visibleTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
}

export function LocalDataBlock({ name, state, reason, lastValidAt, retryAllowed, onRetry, children, refreshLabel, retainContent = false }: LocalDataBlockProps) {
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const retryControl = useRef<HTMLButtonElement>(null);
  const effectiveState: LocalDataBlockState = pending ? "retrying" : state;
  const hasValidContent = retainContent || Boolean(lastValidAt) || state === "available" || state === "limited" || state === "stale";

  useEffect(() => {
    if (announcement === "Обновлено" || announcement.endsWith("не удалось загрузить")) retryControl.current?.focus();
  }, [announcement]);

  async function retry() {
    if (!retryAllowed || !onRetry || pending) return;
    setPending(true);
    setAnnouncement(`Повторная загрузка: ${name.toLowerCase()}…`);
    try {
      await onRetry();
      setAnnouncement("Обновлено");
    } catch {
      setAnnouncement(`Не удалось загрузить: ${name.toLowerCase()}`);
    } finally {
      setPending(false);
    }
  }

  const blocking = effectiveState === "unavailable" && !hasValidContent;
  const degraded = effectiveState === "limited" || effectiveState === "stale" || effectiveState === "unavailable";
  return (
    <section className="local-data-block" aria-busy={effectiveState === "loading" || effectiveState === "retrying"} data-local-state={effectiveState}>
      {(hasValidContent || effectiveState === "available") && children}
      {effectiveState === "loading" && <p role="status">Загрузка: {name.toLowerCase()}…</p>}
      {degraded && (
        <div role={blocking ? "alert" : "status"} className="local-data-notice">
          <strong>{effectiveState === "limited" ? `${name}: неполные данные` : effectiveState === "stale" ? `${name}: данные неактуальны` : `Не удалось загрузить: ${name.toLowerCase()}`}</strong>
          <p>{reason ?? "Корректные данные в других частях этой страницы не изменились."}</p>
          <p>Последнее корректное обновление: {lastValidAt ? <time dateTime={lastValidAt}>{visibleTime(lastValidAt)}</time> : "Недоступно"}. Отсутствующие значения не считались нулём.</p>
        </div>
      )}
      {retryAllowed && onRetry && (degraded || effectiveState === "retrying") && <button ref={retryControl} type="button" disabled={pending} onClick={() => void retry()}>{pending ? "Повторяем…" : "Повторить попытку"}</button>}
      {refreshLabel && retryAllowed && onRetry && effectiveState === "available" && <button ref={retryControl} type="button" onClick={() => void retry()}>{refreshLabel}</button>}
      <p className="local-data-status" role="status" aria-live="polite">{announcement}</p>
    </section>
  );
}
