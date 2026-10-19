import { permanentRedirect } from "next/navigation";

import { resolveCohortBounds } from "./cohort-bounds";
import { resolveCohortIdentity } from "./cohort-identity";
import { ScorecardDashboard, type ScorecardViewModel } from "./scorecard-dashboard";

type Search = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const eligibilityHeaders = () => ({ "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "", "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "", "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT || new Date().toISOString() });

async function fetchEvidence(search: Search, view: "scorecard" | "value-candidates") {
  const query = new URLSearchParams();
  for (const [key, value] of resolveCohortIdentity(search)) query.set(key, value);
  const bounds = resolveCohortBounds(search);
  query.set("from", bounds.from);
  query.set("to", bounds.to);
  if (view === "value-candidates") { const cursor = first(search.cursor); if (cursor) query.set("cursor", cursor); query.set("limit", "25"); }
  return fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:3001"}/evaluation/${view}?${query}`, { headers: { accept: "application/json", ...eligibilityHeaders() }, cache: "no-store", redirect: "manual" });
}

export default async function ScorecardsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const scoreResponse = await fetchEvidence(search, "scorecard");
  if (scoreResponse.status === 308) permanentRedirect(scoreResponse.headers.get("location") ?? "/scorecards");
  if (!scoreResponse.ok) return <section><h1>Ведомость результатов прогнозов</h1><p role="alert">Защищённые доказательства оценки не удалось загрузить. Точные фильтры не изменены.</p></section>;
  const scorecard = await scoreResponse.json() as ScorecardViewModel;
  const candidateResponse = await fetchEvidence(search, "value-candidates");
  const candidates = candidateResponse.ok ? await candidateResponse.json() as Parameters<typeof ScorecardDashboard>[0]["candidates"] : { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } };
  const cursor = first(search.cursor);
  return <ScorecardDashboard scorecard={scorecard} candidates={candidates} {...(cursor ? { cursor } : {})} />;
}
