import type { ForecastResponseDto } from "@bet-stats/domain";
import Link from "next/link";

import { DataStateNotice, type FixtureDataState } from "../../../components/data-state-notice";
import { RiskDisclosure } from "../../../components/risk-disclosure";
import { ProviderStateNotice, type ProviderState } from "../../../components/provider-state-notice";
import { ForecastWorkbench } from "./forecast-workbench";
import { statusLabel } from "../status-labels";

type Fixture = { id: string; competition: { id: string; name: string; season: string }; teams: { home: { id: string; name: string }; away: { id: string; name: string } }; kickoff: string; status: string; dataState: FixtureDataState; providerState: ProviderState };
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:3001";
/** Fresh per call: the API's eligibility guard rejects decision stamps older than
 * one hour, so a module-level frozen timestamp would break this page silently. */
const eligibilityHeaders = () => ({ "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "", "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "", "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT || new Date().toISOString() });
async function load(id: string): Promise<Fixture | null> { const response = await fetch(`${API_ORIGIN}/fixtures/${encodeURIComponent(id)}`, { cache: "no-store" }); if (response.status === 404) return null; if (!response.ok) throw new Error("load failed"); return response.json() as Promise<Fixture>; }
async function loadForecasts(id: string): Promise<readonly ForecastResponseDto[]> { const response = await fetch(`${API_ORIGIN}/fixtures/${encodeURIComponent(id)}/forecasts`, { headers: { accept: "application/json", ...eligibilityHeaders() }, cache: "no-store" }); return response.ok ? response.json() as Promise<readonly ForecastResponseDto[]> : []; }
function safeReturn(value: string | string[] | undefined): string { const candidate = Array.isArray(value) ? value[0] : value; return candidate?.startsWith("/fixtures") && !candidate.startsWith("//") ? candidate : "/fixtures"; }

export default async function Detail({ params, searchParams }: { params: Promise<{ fixtureId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ fixtureId }, search] = await Promise.all([params, searchParams]); const back = safeReturn(search.returnTo); let fixture: Fixture | null;
  try { fixture = await load(fixtureId); } catch { return <section><h1>Матч недоступен</h1><p role="alert">Не удалось загрузить данные матча.</p><Link href={back}>Назад к матчам</Link></section>; }
  if (!fixture) return <section><h1>Матч не найден</h1><p>Запрошенный канонический матч не существует.</p><Link href={back}>Назад к матчам</Link></section>;
  const forecasts = await loadForecasts(fixture.id);
  const evidenceHref = (teamId: string) => `/teams/${encodeURIComponent(teamId)}/evidence?asOf=${encodeURIComponent(fixture!.kickoff)}&fixtureId=${encodeURIComponent(fixture!.id)}`;
  return <article style={{ maxWidth: 960, marginInline: "auto", padding: 16, overflowWrap: "anywhere" }}><Link href={back}>Назад к матчам</Link><h1>{fixture.teams.home.name} против {fixture.teams.away.name}</h1><dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 2fr", gap: 12 }}><dt>Соревнование</dt><dd>{fixture.competition.name}</dd><dt>Сезон</dt><dd>{fixture.competition.season}</dd><dt>Начало (UTC)</dt><dd><time dateTime={fixture.kickoff}>{fixture.kickoff}</time></dd><dt>Статус</dt><dd>{statusLabel(fixture.status)}</dd><dt>Исторические доказательства</dt><dd style={{ display: "flex", flexWrap: "wrap", gap: 12 }}><Link style={{ minHeight: 48, display: "inline-flex", alignItems: "center" }} href={evidenceHref(fixture.teams.home.id)}>Доказательства {fixture.teams.home.name} на момент начала</Link><Link style={{ minHeight: 48, display: "inline-flex", alignItems: "center" }} href={evidenceHref(fixture.teams.away.id)}>Доказательства {fixture.teams.away.name} на момент начала</Link></dd></dl><ProviderStateNotice state={fixture.providerState}/><DataStateNotice data={fixture.dataState}/><RiskDisclosure /><ForecastWorkbench fixtureId={fixture.id} forecasts={forecasts} /></article>;
}
