"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Instants from the URL → whole UTC day for the date inputs. The end bound is exclusive
 * in the API contract, so `to` walks back one millisecond before flooring to a day. */
const toDateInput = (value: string | undefined, end: boolean): string => {
  if (!value) return "";
  if (DATE_ONLY.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const instant = end ? parsed.getTime() - 1 : parsed.getTime();
  return new Date(instant).toISOString().slice(0, 10);
};

/** Picked day → API instants: `from` starts the day (inclusive), `to` ends it
 * (next-day start is the exclusive bound, so the picked end day stays whole). */
const startOfUtcDay = (day: string) => `${day}T00:00:00.000Z`;
const endOfUtcDay = (day: string) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS).toISOString();
const utcDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

type Preset = { label: string; range: () => { from: string; to: string } | null };

const PRESETS: readonly Preset[] = [
  { label: "Ближайшие 48 часов", range: () => null },
  { label: "Сегодня", range: () => ({ from: utcDay(0), to: utcDay(0) }) },
  { label: "Завтра", range: () => ({ from: utcDay(1), to: utcDay(1) }) },
  { label: "Ближайшие 3 дня", range: () => ({ from: utcDay(0), to: utcDay(2) }) },
  { label: "Ближайшая неделя", range: () => ({ from: utcDay(0), to: utcDay(6) }) },
];

export type FilterSyncState = { pending: boolean; message?: string; error?: boolean };

type SyncResult = { league: string; status: string; fixtures: number; results?: number; reason?: string };

const plural = (count: number, one: string, few: string, many: string): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const formatSyncResults = (results: readonly SyncResult[]): string =>
  results.map((result) => {
    if (result.status === "synced") return `${result.league}: загружено ${result.fixtures} ${plural(result.fixtures, "матч", "матча", "матчей")}`;
    if (result.status === "skipped") return `${result.league}: уже загружено недавно`;
    if (result.status === "failed" && result.reason === "PROVIDER_ACCESS_RESTRICTED") return `${result.league}: лига недоступна на тарифе провайдера`;
    if (result.status === "failed") return `${result.league}: сбой запроса к провайдеру`;
    return `${result.league}: отказ (${result.reason ?? "UNKNOWN"})`;
  }).join(" · ");

const describeSyncFailure = (status: number, reason: string | undefined): string => {
  if (status === 503 && reason === "DETERMINISTIC_MODE") return "Синхронизация недоступна в демонстрационном режиме без базы данных.";
  if (status === 503 && reason === "DATABASE_NOT_CONFIGURED") return "Синхронизация недоступна: не настроена база данных (DATABASE_URL).";
  if (status === 503 && reason === "PROVIDER_TOKEN_NOT_CONFIGURED") return "Синхронизация недоступна: не настроен токен футбольного провайдера.";
  if (status === 404) return "Синхронизация недоступна: нет учётных данных оператора.";
  return "Не удалось запустить обновление.";
};

/** Per-league summaries of a results publication run — same ` · ` join as formatSyncResults,
 * but reports published outcomes (and the service's denied status) instead of downloaded fixtures. */
export const formatResultsSyncResults = (results: readonly SyncResult[]): string =>
  results.map((result) => {
    if (result.status === "synced") {
      const count = result.results ?? 0;
      return `${result.league}: опубликовано ${count} ${plural(count, "результат", "результата", "результатов")}`;
    }
    if (result.status === "skipped") return `${result.league}: уже опубликовано недавно`;
    if (result.status === "failed" && result.reason === "PROVIDER_ACCESS_RESTRICTED") return `${result.league}: лига недоступна на тарифе провайдера`;
    if (result.status === "failed" && result.reason === "PROVIDER_REQUEST_FAILED") return `${result.league}: сбой запроса к провайдеру`;
    return `${result.league}: отказ (${result.reason ?? "UNKNOWN"})`;
  }).join(" · ");

const describeResultsSyncFailure = (status: number, reason: string | undefined): string => {
  if (status === 503 && reason === "DETERMINISTIC_MODE") return "Загрузка результатов недоступна в демонстрационном режиме без базы данных.";
  if (status === 503 && reason === "DATABASE_NOT_CONFIGURED") return "Загрузка результатов недоступна: не настроена база данных (DATABASE_URL).";
  if (status === 503 && reason === "PROVIDER_TOKEN_NOT_CONFIGURED") return "Загрузка результатов недоступна: не настроен токен футбольного провайдера.";
  if (status === 404) return "Загрузка результатов недоступна: нет учётных данных оператора.";
  return "Не удалось запустить загрузку результатов.";
};

type SyncPhaseOutcome = { message: string; error: boolean; synced: boolean };

/** One sync phase as data: fetch + HTTP mapping, no side effects, so the fixtures-only
 * runner (autoSync mount path) and the combined «fixtures + results» runner share it. */
const requestFixturesPhase = async (league: string, force: boolean): Promise<SyncPhaseOutcome> => {
  try {
    const response = await fetch("/internal-api/fixtures/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(league ? { competitions: [league] } : {}), force }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { reason?: string } | null;
      return { message: describeSyncFailure(response.status, detail?.reason), error: true, synced: false };
    }
    const { results } = await response.json() as { results: readonly SyncResult[] };
    return { message: formatSyncResults(results), error: false, synced: results.some((result) => result.status === "synced") };
  } catch {
    return { message: "Сервер данных недоступен — обновление не выполнено.", error: true, synced: false };
  }
};

/** Same shape for the results publication phase. `force: true` (the dedicated
 * «Загрузить результаты» button) bypasses the service's freshness gate; `false` (the
 * combined «Обновить матчи» run) lets a league whose RESULTS observations are younger
 * than MIN_SYNC_INTERVAL_MS report «уже опубликовано недавно» without spending provider
 * requests. */
const requestResultsPhase = async (league: string, force: boolean): Promise<SyncPhaseOutcome> => {
  try {
    const response = await fetch("/internal-api/fixtures/results-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force, ...(league ? { competitions: [league] } : {}) }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { reason?: string } | null;
      return { message: describeResultsSyncFailure(response.status, detail?.reason), error: true, synced: false };
    }
    const { results } = await response.json() as { results: readonly SyncResult[] };
    return { message: formatResultsSyncResults(results), error: false, synced: results.some((result) => result.status === "synced") };
  } catch {
    return { message: "Сервер данных недоступен — загрузка результатов не выполнена.", error: true, synced: false };
  }
};

// Exported so the node-environment unit tests can drive the exact handler the
// «Загрузить результаты» button's onClick delegates to (no DOM library in scope).
export const runResultsSync = async (league: string, setState: (state: FilterSyncState) => void, refresh: () => void): Promise<void> => {
  setState({ pending: true });
  const outcome = await requestResultsPhase(league, true);
  setState({ pending: false, message: outcome.message, error: outcome.error });
  if (outcome.error) return;
  window.dispatchEvent(new CustomEvent("fixtures-quota-refresh"));
  if (outcome.synced) refresh();
};

// Exported so the node-environment unit tests can drive the exact handler the
// «Обновить матчи» button's onClick delegates to (no DOM library in scope). One click
// runs two phases: the fixture schedule (forced) and then a results publication under
// the service's freshness gate, so a repeat click within the window costs no extra
// provider requests. One status line reports both phases; the run stops after the
// fixtures phase only when that request itself is unreachable (same server, same
// outage — the dedicated results button remains for a retry).
export const runFixturesAndResultsSync = async (league: string, setState: (state: FilterSyncState) => void, refresh: () => void): Promise<void> => {
  setState({ pending: true });
  const fixtures = await requestFixturesPhase(league, true);
  if (fixtures.error) {
    setState({ pending: false, message: fixtures.message, error: true });
    return;
  }
  // Progressive line: the schedule summary stays visible while results are running.
  setState({ pending: true, message: fixtures.message });
  window.dispatchEvent(new CustomEvent("fixtures-quota-refresh"));
  const results = await requestResultsPhase(league, false);
  if (!results.error) window.dispatchEvent(new CustomEvent("fixtures-quota-refresh"));
  setState({ pending: false, message: `${fixtures.message} · ${results.message}`, error: results.error });
  if (fixtures.synced || results.synced) refresh();
};

export function DateRangeFilter({ from, to, competition, leagues, autoSync }: { from?: string | undefined; to?: string | undefined; competition?: string | undefined; readonly leagues: readonly string[]; autoSync?: boolean | undefined }) {
  const router = useRouter();
  const [dayFrom, setDayFrom] = useState(() => toDateInput(from, false));
  const [dayTo, setDayTo] = useState(() => toDateInput(to, true));
  const [selectedLeague, setSelectedLeague] = useState(() => leagues.includes(competition ?? "") ? competition ?? "" : leagues.length === 1 ? leagues[0] ?? "" : "");
  const [syncState, setSyncState] = useState<FilterSyncState>({ pending: false });
  const [resultsSyncState, setResultsSyncState] = useState<FilterSyncState>({ pending: false });
  // The most recently started action owns the shared status line; the other button's
  // message survives until it runs again.
  const [messageOwner, setMessageOwner] = useState<"sync" | "results" | null>(null);
  const statusState: FilterSyncState = messageOwner === "results" ? resultsSyncState : syncState;

  const navigate = (next: { from?: string | undefined; to?: string | undefined }) => {
    const query = new URLSearchParams();
    if (selectedLeague) query.set("competition", selectedLeague);
    if (next.from) query.set("from", next.from);
    if (next.to) query.set("to", next.to);
    router.push(`/fixtures${query.size ? `?${query}` : ""}`);
  };

  const runSync = async (force: boolean) => {
    setMessageOwner("sync");
    setSyncState({ pending: true });
    const outcome = await requestFixturesPhase(selectedLeague, force);
    setSyncState({ pending: false, message: outcome.message, error: outcome.error });
    if (outcome.error) return;
    window.dispatchEvent(new CustomEvent("fixtures-quota-refresh"));
    if (outcome.synced) router.refresh();
  };

  useEffect(() => {
    if (autoSync) void runSync(false);
    // Sync once when the page mounts; subsequent refreshes come from the manual button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreset = (preset: Preset) => {
    const target = preset.range();
    setDayFrom(target?.from ?? "");
    setDayTo(target?.to ?? "");
    navigate(target ? { from: startOfUtcDay(target.from), to: endOfUtcDay(target.to) } : {});
  };

  const activePreset = (preset: Preset): boolean => {
    const target = preset.range();
    return target === null ? !dayFrom && !dayTo : target.from === dayFrom && target.to === dayTo;
  };

  const submit = () => {
    // A date picker speaks in whole days, so a reversed pair is repaired, not rejected.
    const [first, second] = dayFrom && dayTo && dayFrom > dayTo ? [dayTo, dayFrom] : [dayFrom, dayTo];
    navigate({ from: first ? startOfUtcDay(first) : undefined, to: second ? endOfUtcDay(second) : undefined });
  };

  const fieldLabel = { display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem", color: "var(--color-text-secondary)" } as const;

  return (
    <form className="fixtures-filter-card" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="filter-presets" role="group" aria-label="Быстрый выбор периода">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="filter-chip"
            aria-pressed={activePreset(preset)}
            onClick={() => applyPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="filter-fields">
        <label style={fieldLabel}>
          <span>С (дата, UTC)</span>
          <input
            type="date"
            value={dayFrom}
            max={dayTo || undefined}
            onChange={(event) => setDayFrom(event.target.value)}
            style={{ minHeight: 44, width: 220, maxWidth: "100%" }}
          />
        </label>
        <label style={fieldLabel}>
          <span>По (дата, UTC, включительно)</span>
          <input
            type="date"
            value={dayTo}
            min={dayFrom || undefined}
            onChange={(event) => setDayTo(event.target.value)}
            style={{ minHeight: 44, width: 220, maxWidth: "100%" }}
          />
        </label>
        <label style={fieldLabel}>
          <span>Соревнование</span>
          <select
            value={selectedLeague}
            onChange={(event) => setSelectedLeague(event.target.value)}
            style={{ minHeight: 44, maxWidth: "100%" }}
          >
            {leagues.length > 1 ? <option value="">Все лиги</option> : null}
            {leagues.map((league) => <option key={league}>{league}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-primary" style={{ minHeight: 44, padding: "8px 20px" }}>
          Применить даты
        </button>
        <button
          type="button"
          className="btn-secondary"
          style={{ minHeight: 44, padding: "8px 20px" }}
          disabled={syncState.pending || resultsSyncState.pending}
          onClick={() => {
            setMessageOwner("sync");
            void runFixturesAndResultsSync(selectedLeague, setSyncState, () => router.refresh());
          }}
        >
          {syncState.pending ? "Обновляю…" : "Обновить матчи"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          style={{ minHeight: 44, padding: "8px 20px" }}
          disabled={syncState.pending || resultsSyncState.pending}
          onClick={() => {
            setMessageOwner("results");
            void runResultsSync(selectedLeague, setResultsSyncState, () => router.refresh());
          }}
        >
          {resultsSyncState.pending ? "Загружаю результаты…" : "Загрузить результаты"}
        </button>
      </div>
      {statusState.message ? (
        <p role="status" aria-live="polite" className="filter-hint" style={statusState.error ? { color: "var(--color-danger)" } : undefined}>
          {statusState.message}
        </p>
      ) : null}
      <p className="filter-hint">
        Даты выбираются календарём и трактуются по UTC: выбранный день «По» включается целиком.
        Пустые даты означают ближайшие 48 часов. «Обновить матчи» загружает расписание и итоги завершённых матчей.
        «Загрузить результаты» публикует итоги принудительно — даже если результаты загружались недавно.
      </p>
    </form>
  );
}
