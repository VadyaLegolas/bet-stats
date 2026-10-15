import Link from "next/link";
import { DataStateNotice, type FixtureDataState } from "../../components/data-state-notice";
import { ProviderStateNotice, type ProviderState } from "../../components/provider-state-notice";
import { statusLabel } from "./status-labels";
type Fixture = { id: string; competition: { id: string; name: string; season: string }; teams: { home: { id: string; name: string }; away: { id: string; name: string } }; kickoff: string; status: string; dataState: FixtureDataState; providerState: ProviderState };
type Result = { items: readonly Fixture[]; range: { from: string; to: string } }; type Search = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

function Filters({ search, range, retry = false }: { search: Search; range?: Result["range"]; retry?: boolean }) {
  return (
    <form method="get" className="fixtures-filter-card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        <span>С (UTC)</span>
        <input name="from" defaultValue={first(search.from) ?? range?.from ?? ""} style={{ minHeight: 44, width: 220, maxWidth: "100%" }} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        <span>По (UTC)</span>
        <input name="to" defaultValue={first(search.to) ?? range?.to ?? ""} style={{ minHeight: 44, width: 220, maxWidth: "100%" }} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        <span>Соревнование</span>
        <select name="competition" defaultValue={first(search.competition) ?? "Premier League"} style={{ minHeight: 44, maxWidth: "100%" }}>
          <option>Premier League</option>
        </select>
      </label>
      <button type="submit" className="btn-primary" style={{ minHeight: 44, padding: "8px 20px" }}>
        {retry ? "Повторить загрузку матчей" : "Применить фильтры"}
      </button>
    </form>
  );
}

async function load(search: Search): Promise<Result> {
  const query = new URLSearchParams();
  for (const key of ["from", "to", "competition"] as const) {
    const value = first(search[key]);
    if (value) query.set(key, value);
  }
  const response = await fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:3001"}/fixtures?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error("load failed");
  return response.json() as Promise<Result>;
}

export default async function FixturesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";
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
        <Filters search={search} retry />
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

      <Filters search={search} range={result.range} />

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
