"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatCountdown, formatRequests } from "./quota-format";

export interface SyncQuotaPayload {
  provider: string;
  daily: { used: number; allowance: number; remaining: number; resetAt: string; resetTimezone: string };
  minute: { used: number; limit: number; remaining: number; windowSeconds: number };
}

/** Header counter for the fixture-sync request budget: used/remaining of the daily guard
 * rail with a live countdown to the 00:00 UTC reset (the counter itself rolls to zero with
 * the reset), plus the provider's rolling per-minute window. Refreshes on mount, every
 * minute, after each manual sync, and once when the countdown crosses zero; degrades to an
 * honest unavailable pill when the read fails. */
export function QuotaCounter() {
  const [quota, setQuota] = useState<SyncQuotaPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const handledZero = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/internal-api/fixtures/quota", { cache: "no-store" });
      if (!response.ok) throw new Error(`quota responded ${response.status}`);
      setQuota(await response.json() as SyncQuotaPayload);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate fetch-on-mount: the quota counter loads immediately, then polls
    void load();
    const poll = window.setInterval(() => void load(), 60_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    const refresh = () => void load();
    window.addEventListener("fixtures-quota-refresh", refresh);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      window.removeEventListener("fixtures-quota-refresh", refresh);
    };
  }, [load]);

  const resetInMs = quota ? new Date(quota.daily.resetAt).getTime() - now : 0;
  useEffect(() => {
    if (!quota) {
      handledZero.current = false;
      return;
    }
    if (resetInMs > 0) {
      handledZero.current = false;
      return;
    }
    if (!handledZero.current) {
      handledZero.current = true;
      void load();
    }
  }, [quota, resetInMs, load]);

  if (!quota) {
    return <p className="quota-counter quota-counter--pending">{failed ? "Лимиты обновления: недоступно" : "Лимиты обновления…"}</p>;
  }

  const { daily, minute } = quota;
  const usedPercent = daily.allowance > 0 ? Math.min(100, Math.round((daily.used / daily.allowance) * 100)) : 0;
  return (
    <section className="quota-counter" aria-label="Лимиты запросов на обновление матчей">
      <p className="quota-counter-label">Лимиты обновления матчей</p>
      <p className="quota-counter-figures">
        <strong className="quota-counter-used">{daily.used}/{daily.allowance}</strong>
        <span className="quota-counter-remaining">· осталось {formatRequests(daily.remaining)}</span>
      </p>
      <div
        className="quota-meter"
        role="progressbar"
        aria-label="Израсходовано запросов на обновление матчей"
        aria-valuemin={0}
        aria-valuemax={daily.allowance}
        aria-valuenow={daily.used}
        aria-valuetext={`${daily.used} из ${daily.allowance}`}
      >
        <span className="quota-meter-fill" style={{ width: `${usedPercent}%` }} />
      </div>
      <p className="quota-counter-reset">
        Сброс через {formatCountdown(Math.max(0, resetInMs))}
        <span className="quota-counter-reset-time"> · {daily.resetTimezone === "UTC" ? "00:00 UTC" : daily.resetTimezone}</span>
      </p>
      <p className="quota-counter-provider">
        Провайдер: {minute.used}/{minute.limit} за минуту · окно {minute.windowSeconds} с
      </p>
    </section>
  );
}
