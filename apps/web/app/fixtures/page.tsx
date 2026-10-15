import Link from "next/link";
import { DataStateNotice, type FixtureDataState } from "../../components/data-state-notice";
import { ProviderStateNotice, type ProviderState } from "../../components/provider-state-notice";
type Fixture = { id: string; competition: { id: string; name: string; season: string }; teams: { home: { id: string; name: string }; away: { id: string; name: string } }; kickoff: string; status: string; dataState: FixtureDataState; providerState: ProviderState };
type Result = { items: readonly Fixture[]; range: { from: string; to: string } }; type Search = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
function Filters({ search, range, retry = false }: { search: Search; range?: Result["range"]; retry?: boolean }) {
  return (
    <form method="get" className="fixtures-filter-card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        <span>From (UTC)</span>
        <input name="from" defaultValue={first(search.from) ?? range?.from ?? ""} style={{ minHeight: 44, width: 220, maxWidth: "100%" }} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        <span>To (UTC)</span>
        <input name="to" defaultValue={first(search.to) ?? range?.to ?? ""} style={{ minHeight: 44, width: 220, maxWidth: "100%" }} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        <span>Competition</span>
        <select name="competition" defaultValue={first(search.competition) ?? "Premier League"} style={{ minHeight: 44, maxWidth: "100%" }}>
          <option>Premier League</option>
        </select>
      </label>
      <button type="submit" className="btn-primary" style={{ minHeight: 44, padding: "8px 20px" }}>
        {retry ? "Try loading fixtures again" : "Apply filters"}
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
        <h1 className="page-title">Upcoming fixtures</h1>
        <p role="alert" style={{ color: "var(--color-danger)", background: "var(--color-danger-subtle)", padding: 16, borderRadius: "var(--radius-control)" }}>
          Fixtures could not be loaded. Your filters were kept. Select Try loading fixtures again.
        </p>
        <Filters search={search} retry />
      </section>
    );
  }

  const groups = new Map<string, Fixture[]>();
  const dateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone });
  for (const fixture of result.items) {
    const label = dateFormat.format(new Date(fixture.kickoff));
    groups.set(label, [...(groups.get(label) ?? []), fixture]);
  }

  const query = new URLSearchParams(Object.entries(search).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const returnTo = `/fixtures${query.size ? `?${query}` : ""}`;

  return (
    <section style={{ maxWidth: 960, marginInline: "auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Upcoming fixtures</h1>
        <p className="page-deck">
          Times are grouped in {timeZone}. The default range is the next 48 hours.
        </p>
      </div>

      <Filters search={search} range={result.range} />

      {result.items.length === 0 ? (
        <div className="fixture-empty-state">
          <p>
            No fixtures are available for this range. Change the competition or date range, then apply filters again.
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
                        {fixture.teams.home.name} <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>vs</span> {fixture.teams.away.name}
                      </Link>
                    </h3>
                    <div className="fixture-meta">
                      <span className="fixture-time">
                        {new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone }).format(new Date(fixture.kickoff))}
                      </span>
                      <span>·</span>
                      <span>{fixture.competition.name}</span>
                      <span>·</span>
                      <span style={{ textTransform: "capitalize" }}>{fixture.status.toLowerCase()}</span>
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
