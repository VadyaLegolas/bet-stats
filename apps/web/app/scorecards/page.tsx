import { permanentRedirect } from "next/navigation";

import { ScorecardDashboard, type ScorecardViewModel } from "./scorecard-dashboard";

type Search = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const eligibilityHeaders = () => ({ "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "", "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "", "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT ?? "" });

async function fetchEvidence(search: Search, view: "scorecard" | "value-candidates") {
  const query = new URLSearchParams();
  for (const key of ["modelVersion", "competitionId", "market", "from", "to"] as const) { const value = first(search[key]); if (value) query.set(key, value); }
  if (view === "value-candidates") { const cursor = first(search.cursor); if (cursor) query.set("cursor", cursor); query.set("limit", "25"); }
  return fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:3001"}/evaluation/${view}?${query}`, { headers: { accept: "application/json", ...eligibilityHeaders() }, cache: "no-store", redirect: "manual" });
}

export default async function ScorecardsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const scoreResponse = await fetchEvidence(search, "scorecard");
  if (scoreResponse.status === 308) permanentRedirect(scoreResponse.headers.get("location") ?? "/scorecards");
  if (!scoreResponse.ok) return <section><h1>Forecast evidence scorecard</h1><p role="alert">Protected evaluation evidence could not be loaded. Exact filters remain unchanged.</p></section>;
  const scorecard = await scoreResponse.json() as ScorecardViewModel;
  const candidateResponse = await fetchEvidence(search, "value-candidates");
  const candidates = candidateResponse.ok ? await candidateResponse.json() as Parameters<typeof ScorecardDashboard>[0]["candidates"] : { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } };
  const cursor = first(search.cursor);
  return <ScorecardDashboard scorecard={scorecard} candidates={candidates} {...(cursor ? { cursor } : {})} />;
}
