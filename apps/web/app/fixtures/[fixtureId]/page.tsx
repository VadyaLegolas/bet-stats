import type { CalibratedForecastResponseDto } from "@bet-stats/domain";
import { DataStateNotice, type FixtureDataState } from "../../../components/data-state-notice";
import { RiskDisclosure } from "../../../components/risk-disclosure";
import { ProviderStateNotice, type ProviderState } from "../../../components/provider-state-notice";
import { loadExtendedMarkets } from "./extended-markets-loader";
import { ForecastWorkbench } from "./forecast-workbench";
import { BackLink, MatchHero } from "./match-hero";

type Fixture = { id: string; competition: { id: string; name: string; season: string }; teams: { home: { id: string; name: string }; away: { id: string; name: string } }; kickoff: string; status: string; dataState: FixtureDataState; providerState: ProviderState };
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:3001";
/** Fresh per call: the API's eligibility guard rejects decision stamps older than
 * one hour, so a module-level frozen timestamp would break this page silently. */
const eligibilityHeaders = () => ({ "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "", "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "", "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT || new Date().toISOString() });
async function load(id: string): Promise<Fixture | null> { const response = await fetch(`${API_ORIGIN}/fixtures/${encodeURIComponent(id)}`, { cache: "no-store" }); if (response.status === 404) return null; if (!response.ok) throw new Error("load failed"); return response.json() as Promise<Fixture>; }
async function loadForecasts(id: string): Promise<readonly CalibratedForecastResponseDto[]> { const response = await fetch(`${API_ORIGIN}/fixtures/${encodeURIComponent(id)}/forecasts`, { headers: { accept: "application/json", ...eligibilityHeaders() }, cache: "no-store" }); return response.ok ? response.json() as Promise<readonly CalibratedForecastResponseDto[]> : []; }
function safeReturn(value: string | string[] | undefined): string { const candidate = Array.isArray(value) ? value[0] : value; return candidate?.startsWith("/fixtures") && !candidate.startsWith("//") ? candidate : "/fixtures"; }

export default async function Detail({ params, searchParams }: { params: Promise<{ fixtureId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ fixtureId }, search] = await Promise.all([params, searchParams]); const back = safeReturn(search.returnTo); let fixture: Fixture | null;
  try { fixture = await load(fixtureId); } catch { return <section><h1>Матч недоступен</h1><p role="alert">Не удалось загрузить данные матча.</p><BackLink href={back} /></section>; }
  if (!fixture) return <section><h1>Матч не найден</h1><p>Запрошенный канонический матч не существует.</p><BackLink href={back} /></section>;
  const forecasts = await loadForecasts(fixture.id);
  const extendedMarkets = await loadExtendedMarkets({ apiOrigin: API_ORIGIN, fixtureId: fixture.id, forecastIds: forecasts.map(({ id }) => id), headers: eligibilityHeaders() });
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";
  const evidenceHref = (teamId: string) => `/teams/${encodeURIComponent(teamId)}/evidence?asOf=${encodeURIComponent(fixture!.kickoff)}&fixtureId=${encodeURIComponent(fixture!.id)}`;
  return <article className="page-column page-column--wrap match-page"><BackLink href={back} /><MatchHero fixture={fixture} timeZone={timeZone} evidenceHref={evidenceHref} /><ProviderStateNotice state={fixture.providerState}/><DataStateNotice data={fixture.dataState}/><RiskDisclosure /><ForecastWorkbench fixtureId={fixture.id} forecasts={forecasts} timeZone={timeZone} extendedMarkets={extendedMarkets} /></article>;
}
