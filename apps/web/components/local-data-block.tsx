"use client";

import type { ReactNode } from "react";
import { useState } from "react";

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
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
}

export function LocalDataBlock({ name, state, reason, lastValidAt, retryAllowed, onRetry, children, refreshLabel, retainContent = false }: LocalDataBlockProps) {
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const effectiveState: LocalDataBlockState = pending ? "retrying" : state;
  const hasValidContent = retainContent || Boolean(lastValidAt) || state === "available" || state === "limited" || state === "stale";

  async function retry() {
    if (!retryAllowed || !onRetry || pending) return;
    setPending(true);
    setAnnouncement(`Trying ${name.toLowerCase()} again…`);
    try {
      await onRetry();
      setAnnouncement("Updated");
    } catch {
      setAnnouncement(`${name} could not be loaded`);
    } finally {
      setPending(false);
    }
  }

  const blocking = effectiveState === "unavailable" && !hasValidContent;
  const degraded = effectiveState === "limited" || effectiveState === "stale" || effectiveState === "unavailable";
  return (
    <section className="local-data-block" aria-busy={effectiveState === "loading" || effectiveState === "retrying"} data-local-state={effectiveState}>
      {(hasValidContent || effectiveState === "available") && children}
      {effectiveState === "loading" && <p role="status">Loading {name.toLowerCase()}…</p>}
      {degraded && (
        <div role={blocking ? "alert" : "status"} className="local-data-notice">
          <strong>{effectiveState === "limited" ? `${name} is limited` : effectiveState === "stale" ? `${name} is not current` : `${name} could not be loaded`}</strong>
          <p>{reason ?? "Valid information elsewhere on this page is unchanged."}</p>
          <p>Last valid update: {lastValidAt ? <time dateTime={lastValidAt}>{visibleTime(lastValidAt)}</time> : "Not available"}. Missing values were not treated as zero.</p>
        </div>
      )}
      {retryAllowed && onRetry && (degraded || effectiveState === "retrying") && <button type="button" disabled={pending} onClick={() => void retry()}>{pending ? "Trying again…" : "Try again"}</button>}
      {refreshLabel && retryAllowed && onRetry && effectiveState === "available" && <button type="button" onClick={() => void retry()}>{refreshLabel}</button>}
      <p className="local-data-status" role="status" aria-live="polite">{announcement}</p>
    </section>
  );
}
