import Link from "next/link";

import { ResponsiveEvidence, type EvidenceColumn } from "../../components/responsive-evidence";
import { LocalDataBlock } from "../../components/local-data-block";
import { ContextualMethodologyWarning } from "../../components/contextual-methodology-warning";

export type ScorecardViewModel = Readonly<{
  cohortIdentity: { modelVersion: string; competitionId: string; market: string; from: string; to: string };
  health: { state: "UNAVAILABLE" | "LIMITED" | "AVAILABLE"; reasons: readonly string[]; performanceClaim: string | null };
  denominators: { fixtureCount: number; forecastCount: number; eventCount: number; valueCount: number };
  metrics: { meanBrierScore: number; meanLogLoss: number } | null;
  reliability: { policyId: string; buckets: readonly { index: number; lowerBound: number; upperBound: number; upperBoundInclusive: boolean; meanForecast: number; observedFrequency: number; count: number; gap: number; direction: string; evidenceState: string }[] };
  financial: { count: number; totalStakedUnits: string; totalProfitUnits: string; roi: string | null; yield: string | null; policyId: string };
  clv: { status: string; reason: string | null; comparableCount: number };
  receipts: { formulaId: string; cohortPolicyId: string };
}>;

type CandidatePage = Readonly<{ items: readonly { id: string; selection: string; decimalOdds: string; outcome: string; stakeUnits: string; profitUnits: string; clv: { status: string; reason: string | null; value: string | null } }[]; nextCursor: string | null; pageTotals: { count: number; stakeUnits: string; profitUnits: string } }>;

export function canonicalScorecardQuery(identity: ScorecardViewModel["cohortIdentity"]): string {
  const query = new URLSearchParams();
  for (const key of ["modelVersion", "competitionId", "market", "from", "to"] as const) query.set(key, identity[key]);
  return query.toString();
}

const panel = { border: "1px solid #CBD5E1", borderRadius: 10, padding: 20, marginBlock: 18 } as const;

export function ScorecardDashboard({ scorecard, candidates, cursor }: { scorecard: ScorecardViewModel; candidates: CandidatePage; cursor?: string }) {
  const identityQuery = canonicalScorecardQuery(scorecard.cohortIdentity);
  const healthTitle = scorecard.health.state === "AVAILABLE" ? "Qualified evidence" : scorecard.health.state === "LIMITED" ? "Limited evidence" : "Evidence unavailable";
  return <section>
    <h1>Forecast evidence scorecard</h1>
    <p>Historical evaluation of frozen forecasts and manually entered prices. This is analytical evidence, not betting advice.</p>
    <ContextualMethodologyWarning context="scorecard" />
    <form method="get" style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
      {(["modelVersion", "competitionId", "market", "from", "to"] as const).map((key) => <label key={key}>{key}<input name={key} defaultValue={scorecard.cohortIdentity[key]} style={{ width: "100%", minHeight: 44 }} /></label>)}
      <button type="submit" style={{ minHeight: 44 }}>Apply exact cohort</button>
    </form>
    <section aria-labelledby="cohort-health" style={panel}>
      <h2 id="cohort-health">{healthTitle}</h2>
      {scorecard.health.state === "UNAVAILABLE" && <p role="alert">No scoreable evidence is available for this exact cohort. Filters were not broadened.</p>}
      {scorecard.health.state === "LIMITED" && <p role="alert">Sample thresholds are not met; metrics below are descriptive and not a performance claim.</p>}
      <p>{scorecard.denominators.fixtureCount} fixtures · {scorecard.denominators.forecastCount} forecasts · {scorecard.denominators.eventCount} probability events · {scorecard.denominators.valueCount} value candidates</p>
      <p>Exact cohort: {scorecard.cohortIdentity.modelVersion} · {scorecard.cohortIdentity.competitionId} · {scorecard.cohortIdentity.market}</p>
    </section>
    <section style={panel}><h2>Proper scores</h2>{scorecard.metrics ? <><p>Brier score: {scorecard.metrics.meanBrierScore.toFixed(4)}</p><p>Log Loss: {scorecard.metrics.meanLogLoss.toFixed(4)}</p></> : <p>No proper-score metrics are available.</p>}</section>
    <section style={panel} role="region" aria-label="Reliability evidence"><h2>Reliability</h2><LocalDataBlock name="Reliability evidence" state={scorecard.health.state === "AVAILABLE" ? "available" : scorecard.health.state === "LIMITED" ? "limited" : "unavailable"} reason={scorecard.health.reasons.join("; ") || "No scoreable evidence is available for this exact cohort."} retryAllowed={false} retainContent><p><strong>Conclusion:</strong> {scorecard.reliability.buckets.some((bucket) => bucket.count > 0) ? "Observed outcomes are compared with frozen probability buckets." : "Insufficient evidence for populated reliability buckets."}</p><p>{scorecard.denominators.eventCount} probability events in this exact cohort. Empty buckets remain insufficient evidence and are never shown as zero outcomes.</p><ResponsiveEvidence projectionId="scorecard-reliability" label="Reliability evidence table" tableLabel="Complete reliability data" caption="Complete calibration data for every probability bucket" rows={scorecard.reliability.buckets} columns={reliabilityColumns} rowKey={(bucket) => String(bucket.index)} conclusion={(bucket) => `Probability range ${bucket.lowerBound.toFixed(1)}–${bucket.upperBound.toFixed(1)}`} denominator={(bucket) => `${bucket.count} probability events`} warning={(bucket) => bucket.evidenceState === "INSUFFICIENT" ? "Insufficient evidence" : bucket.evidenceState}/></LocalDataBlock></section>
    <section style={panel}><h2>Flat one-unit evidence</h2><p>{scorecard.financial.count} settled candidates · {scorecard.financial.totalStakedUnits} units evaluated · {scorecard.financial.totalProfitUnits} units result</p><p>ROI / Yield: {scorecard.financial.roi ?? "unavailable"}</p></section>
    <section style={panel}><h2>Closing-line evidence</h2>{scorecard.clv.status === "AVAILABLE" ? <p>{scorecard.clv.comparableCount} comparable prices.</p> : <p>Closing-line evidence is unavailable: {scorecard.clv.reason}.</p>}</section>
    <section style={panel}><h2>Candidate ledger</h2>{candidates.items.length === 0 ? <p>No settled value candidates exist in this exact cohort.</p> : <div style={{ overflowX: "auto" }}><table><thead><tr><th>Selection</th><th>Odds</th><th>Outcome</th><th>Stake units</th><th>Profit units</th><th>CLV</th></tr></thead><tbody>{candidates.items.map((item) => <tr key={item.id}><td>{item.selection}</td><td>{item.decimalOdds}</td><td>{item.outcome}</td><td>{item.stakeUnits}</td><td>{Number(item.profitUnits) > 0 ? `+${item.profitUnits}` : item.profitUnits}</td><td>{item.clv.value ?? item.clv.reason ?? item.clv.status}</td></tr>)}</tbody></table></div>}<p>Page totals: {candidates.pageTotals.count} candidates, {candidates.pageTotals.stakeUnits} units staked, {candidates.pageTotals.profitUnits} units profit.</p><nav aria-label="Candidate pages">{cursor && <Link href={`/scorecards?${identityQuery}`}>Previous (first page)</Link>} {candidates.nextCursor && <Link href={`/scorecards?${identityQuery}&cursor=${encodeURIComponent(candidates.nextCursor)}`}>Next</Link>}</nav></section>
    <details id="formula-policy-receipts"><summary>Formula and policy receipts</summary><dl><dt>Formula</dt><dd>{scorecard.receipts.formulaId}</dd><dt>Cohort policy</dt><dd>{scorecard.receipts.cohortPolicyId}</dd><dt>Reliability policy</dt><dd>{scorecard.reliability.policyId}</dd><dt>Financial policy</dt><dd>{scorecard.financial.policyId}</dd></dl></details>
  </section>;
}

type ReliabilityBucket = ScorecardViewModel["reliability"]["buckets"][number];
const reliabilityColumns: readonly EvidenceColumn<ReliabilityBucket>[] = [
  { key: "range", label: "Range", value: (bucket) => `${bucket.lowerBound.toFixed(1)}–${bucket.upperBound.toFixed(1)}` },
  { key: "meanForecast", label: "Mean forecast", value: (bucket) => bucket.meanForecast.toFixed(3) },
  { key: "observedFrequency", label: "Observed", value: (bucket) => bucket.count === 0 ? "Insufficient evidence" : bucket.observedFrequency.toFixed(3) },
  { key: "count", label: "Count", value: (bucket) => bucket.count },
  { key: "direction", label: "Direction", value: (bucket) => bucket.count === 0 ? "Insufficient evidence" : bucket.direction },
];
