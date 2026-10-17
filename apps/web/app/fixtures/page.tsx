import Link from "next/link";
import { DateRangeFilter } from "../../components/date-range-filter";
import { DataStateNotice, type FixtureDataState } from "../../components/data-state-notice";
import { ProviderStateNotice, type ProviderState } from "../../components/provider-state-notice";
import { statusLabel } from "./status-labels";
type Fixture = { id: string; competition: { id: string; name: string; season: string }; teams: { home: { id: string; name: string }; away: { id: string; name: string } }; kickoff: string; status: string; dataState: FixtureDataState; providerState: ProviderState; forecast?: { kind?: string; cutoff?: string; probabilities?: { home?: unknown; draw?: unknown; away?: unknown } } | null };
type Result = { items: readonly Fixture[]; range: { from: string; to: string } }; type Search = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

/** Presentational rounding of model probabilities to integer percentages that ALWAYS sum to
 * exactly 100. Input is first accepted only inside the tolerance window [0.9, 1.1] around the
 * expected sum of 1, then normalized proportionally (p = value / sum) and scaled ×100. The
 * largest-remainder method distributes the `100 − Σfloors` shortfall one point at a time to
 * the biggest fractional remainders; ties are broken deterministically home → draw → away.
 * Anything outside the contract (missing, non-finite, negative, or far-from-1 input) returns
 * null so the card shows the honest pending fallback instead of a misleading figure. */
export function forecastPercentages(probabilities: { home: number; draw: number; away: number } | undefined | null): { home: number; draw: number; away: number } | null {
  if (!probabilities) return null;
  const entries = [["home", probabilities.home], ["draw", probabilities.draw], ["away", probabilities.away]] as const;
  for (const [, value] of entries) if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const sum = probabilities.home + probabilities.draw + probabilities.away;
  if (sum < 0.9 || sum > 1.1) return null;
  const scaled = entries.map(([key, value]) => { const exact = (value / sum) * 100; return { key, exact, floor: Math.floor(exact) }; });
  const result = { home: 0, draw: 0, away: 0 };
  for (const item of scaled) result[item.key] = item.floor;
  // Array.prototype.sort is stable, so equal remainders keep home → draw → away order.
  const ranked = [...scaled].sort((a, b) => (b.exact - b.floor) - (a.exact - a.floor));
  const shortfall = 100 - scaled.reduce((total, item) => total + item.floor, 0);
  for (let index = 0; index < shortfall; index += 1) {
    const item = ranked[index];
    if (item) result[item.key] += 1;
  }
  return result;
}

/** Inline quick 1X2 forecast for a fixture card. Display-only and defensive: raw enum codes
 * (HOME/DRAW/AWAY, kind codes) must never reach the markup — only the Russian labels and the
 * integer percentages, or the honest pending fallback when no forecast has been issued yet
 * (a manual fixture sync may outrun the forecast sweep) or the payload is not usable.
 * `| undefined` on the prop keeps `exactOptionalPropertyTypes` honest for a stale API that
 * omits `forecast` entirely. */
export function FixtureForecastLine({ forecast }: { forecast?: { kind?: string; cutoff?: string; probabilities?: { home?: unknown; draw?: unknown; away?: unknown } } | null | undefined }) {
  const probabilities = forecast?.probabilities;
  const triple = probabilities && typeof probabilities.home === "number" && typeof probabilities.draw === "number" && typeof probabilities.away === "number" ? { home: probabilities.home, draw: probabilities.draw, away: probabilities.away } : null;
  const percentages = forecastPercentages(triple);
  return percentages
    ? <div className="fixture-forecast">Прогноз: П1 {percentages.home}% · Х {percentages.draw}% · П2 {percentages.away}%</div>
    : <div className="fixture-forecast fixture-forecast--pending">Прогноз пока не выпущен</div>;
}

function Filters({ search, leagues, autoSync, retry = false }: { search: Search; leagues: readonly string[]; autoSync: boolean; retry?: boolean }) {
  return (
    <DateRangeFilter from={first(search.from)} to={first(search.to)} competition={first(search.competition)} leagues={leagues} autoSync={autoSync} />
  );
}

/** Configured leagues for the competition select; the single-league fallback keeps the
 * deterministic demo mode (and its e2e contract) intact when the catalogue is unreachable. */
async function loadLeagues(): Promise<readonly string[]> {
  try {
    const response = await fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:3001"}/fixtures/leagues`, { cache: "no-store" });
    if (!response.ok) throw new Error("leagues unavailable");
    const body = await response.json() as { items?: unknown };
    return Array.isArray(body.items) && body.items.length > 0 ? body.items.filter((item): item is string => typeof item === "string") : ["Premier League"];
  } catch {
    return ["Premier League"];
  }
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** The date picker speaks whole UTC days; widen bare dates to the API's instant contract
 * so hand-edited `?from=2026-10-15` links work too. Full instants pass through untouched. */
const toApiInstant = (key: "from" | "to", value: string): string => {
  if (!DAY_ONLY.test(value)) return value;
  if (key === "from") return `${value}T00:00:00.000Z`;
  return new Date(new Date(`${value}T00:00:00.000Z`).getTime() + 86_400_000).toISOString();
};

async function load(search: Search): Promise<Result> {
  const query = new URLSearchParams();
  for (const key of ["from", "to", "competition"] as const) {
    const value = first(search[key]);
    if (value) query.set(key, key === "competition" ? value : toApiInstant(key, value));
  }
  const response = await fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:3001"}/fixtures?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error("load failed");
  return response.json() as Promise<Result>;
}

export default async function FixturesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";
  const [leagues, autoSync] = await Promise.all([loadLeagues(), Promise.resolve(process.env.FIXTURES_AUTO_SYNC === "true")]);
  let result: Result;
  try {
    result = await load(search);
  } catch {
    return (
      <section style={{ maxWidth: 960, marginInline: "auto" }}>
        <h1 className="page-title">Предстоящие матчи</h1>
        <p role="alert" style={{ color: "var(--color-danger)", background: "var(--color-danger-subtle)", padding: 16, borderRadius: "var(--radius-control)" }}>
          Не удалось загрузить матчи. Ваша фильтрация сохранена. Выберите «Повторить загрузку матчей».
        </p>
        <Filters search={search} leagues={leagues} autoSync={autoSync} retry />
      </section>
    );
  }

  const groups = new Map<string, Fixture[]>();
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
  const groupLabel = (value: string): string => {
    const parts = dateFormat.formatToParts(new Date(value));
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.filter((part) => part.type === type).map((part) => part.value).join("");
    const weekday = pick("weekday");
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${pick("day")} ${pick("month")} ${pick("year")}`;
  };
  for (const fixture of result.items) {
    const label = groupLabel(fixture.kickoff);
    groups.set(label, [...(groups.get(label) ?? []), fixture]);
  }

  const query = new URLSearchParams(Object.entries(search).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const returnTo = `/fixtures${query.size ? `?${query}` : ""}`;

  return (
    <section style={{ maxWidth: 960, marginInline: "auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Предстоящие матчи</h1>
        <p className="page-deck">
          Время указано в часовом поясе {timeZone}. По умолчанию показан ближайшие 48 часов.
        </p>
      </div>

      <Filters search={search} leagues={leagues} autoSync={autoSync} />

      {result.items.length === 0 ? (
        <div className="fixture-empty-state">
          <p>
            В выбранном периоде нет матчей. Измените соревнование или диапазон дат и примените фильтры заново.
          </p>
        </div>
      ) : (
        [...groups].map(([label, fixtures]) => (
          <section key={label} style={{ marginTop: 32 }}>
            <h2 className="date-group-heading">{label}</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {fixtures.map((fixture) => (
                <li key={fixture.id} className="fixture-card">
                  <div className="fixture-header">
                    <h3 className="fixture-title">
                      <Link href={`/fixtures/${encodeURIComponent(fixture.id)}?returnTo=${encodeURIComponent(returnTo)}`}>
                        {fixture.teams.home.name} <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>против</span> {fixture.teams.away.name}
                      </Link>
                    </h3>
                    <div className="fixture-meta">
                      <span className="fixture-time">
                        {new Intl.DateTimeFormat("ru-RU", { timeStyle: "short", timeZone }).format(new Date(fixture.kickoff))}
                      </span>
                      <span>·</span>
                      <span>{fixture.competition.name}</span>
                      <span>·</span>
                      <span>{statusLabel(fixture.status)}</span>
                    </div>
                  </div>
                  <FixtureForecastLine forecast={fixture.forecast} />
                  <div className="fixture-badges">
                    <ProviderStateNotice state={fixture.providerState} compact />
                    <DataStateNotice data={fixture.dataState} compact />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
