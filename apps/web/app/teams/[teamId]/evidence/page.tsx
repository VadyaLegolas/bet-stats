"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { EvidenceStateNotice } from "../../../../components/evidence-state-notice";

type Summary = { value?: unknown; sampleSize?: number; requestedSampleSize?: number; sourceUpdatedAt?: string | null | undefined; limitationReason?: string | null | undefined; limitation?: string | null | undefined };
type Trace = { fixtureId: string; effectiveAt?: string; observedAt?: string; venue?: string; result?: string; score?: string; source?: string; components?: string[] };
type Evidence = {
  team?: { id: string; name: string };
  teamId?: string;
  fixture?: { id: string; name: string; kickoff: string };
  requestedAsOf?: string;
  resolvedAsOf?: string | null;
  resolvedAsOfUtc?: string | null;
  displayTimeZone?: string;
  state?: string;
  freshness?: string;
  limitationReason?: string | null;
  summaries?: { five?: Summary; ten?: Summary };
  components?: Record<string, { value?: unknown; sampleSize?: number; limitation?: string | null; sourceRefs?: Trace[] }>;
  trace?: Trace[];
  receipt?: { configVersion?: string; buildId?: string; inputIds?: string[]; inputs?: Trace[] } | null;
};

const panel = { border: "1px solid #CBD5E1", borderRadius: 8, background: "#FFFFFF", padding: 20, minWidth: 0 } as const;

function summaryFrom(data: Evidence, key: "five" | "ten"): Summary {
  const direct = data.summaries?.[key];
  if (direct) return direct;
  const names = key === "five" ? ["form5", "weightedForm5", "five"] : ["form10", "weightedForm10", "ten"];
  const component = names.map((name) => data.components?.[name]).find(Boolean);
  return { value: component?.value, sampleSize: component?.sampleSize ?? 0, requestedSampleSize: key === "five" ? 5 : 10, limitationReason: component?.limitation };
}

function SummaryCard({ label, summary }: { label: string; summary: Summary }) {
  const sample = summary.sampleSize ?? 0;
  const target = summary.requestedSampleSize ?? Number(label);
  const available = summary.value !== null && summary.value !== undefined && sample > 0;
  return <article style={panel}><h2>{label}-match summary</h2><p style={{ fontSize: 28, fontWeight: 700 }}>{available ? String(summary.value) : "Not available"}</p><p>Sample: <span>{sample}/{target}</span></p>{summary.sourceUpdatedAt && <p>Source updated: <time dateTime={summary.sourceUpdatedAt}>{summary.sourceUpdatedAt}</time></p>}{summary.limitationReason && <p>{summary.limitationReason}</p>}</article>;
}

export default function TeamEvidencePage() {
  const params = useParams<{ teamId: string }>();
  const search = useSearchParams();
  const asOf = search.get("asOf") ?? "";
  const fixtureId = search.get("fixtureId");
  const [data, setData] = useState<Evidence | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setData(null); setFailed(false);
    void fetch(`/internal-api/teams/${encodeURIComponent(params.teamId)}/evidence?asOf=${encodeURIComponent(asOf)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("evidence unavailable"); return response.json() as Promise<Evidence>; })
      .then(setData, (error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setFailed(true); });
    return () => controller.abort();
  }, [asOf, params.teamId]);

  const back = fixtureId ? `/fixtures/${encodeURIComponent(fixtureId)}` : "/fixtures";
  if (failed) return <section><h1>Historical evidence unavailable</h1><p role="alert">Historical evidence could not be loaded for this cutoff. No newer data was substituted. Try again.</p><Link href={back}>{fixtureId ? "Back to fixture" : "Return to fixtures"}</Link></section>;
  if (!data) return <section aria-busy="true"><h1>Historical evidence</h1><p role="status">Loading historical evidence for the selected cutoff</p></section>;

  const resolved = data.resolvedAsOfUtc ?? data.resolvedAsOf;
  const invalid = !resolved;
  const five = summaryFrom(data, "five"); const ten = summaryFrom(data, "ten");
  const trace = data.trace ?? data.receipt?.inputs ?? [];
  const name = data.team?.name ?? data.teamId ?? params.teamId;
  return <section style={{ display: "grid", gap: 24, overflowWrap: "anywhere" }}>
    <Link href={back} style={{ minHeight: 48, display: "inline-flex", alignItems: "center", width: "fit-content" }}>{fixtureId ? "Back to fixture" : "Return to fixtures"}</Link>
    <header><h1>{name} historical evidence</h1><p>What the system could know at the selected time.</p>{data.fixture && <p>Evidence requested for {data.fixture.name} kickoff</p>}<dl><dt>Requested cutoff</dt><dd><time dateTime={data.requestedAsOf ?? asOf}>{data.requestedAsOf ?? asOf}</time></dd><dt>Resolved cutoff (UTC)</dt><dd>{resolved ? <time dateTime={resolved}>{resolved}</time> : "Not available"}</dd>{data.displayTimeZone && <><dt>Display timezone</dt><dd>{data.displayTimeZone}</dd></>}</dl></header>
    {invalid && <p role="alert">This cutoff could not be used. Enter a valid supported date and time.</p>}
    <EvidenceStateNotice state={data.state} freshness={data.freshness} limitationReason={data.limitationReason}/>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}><SummaryCard label="5" summary={five}/><SummaryCard label="10" summary={ten}/></div>
    <section aria-labelledby="components-heading"><h2 id="components-heading">Evidence components</h2>{Object.entries(data.components ?? {}).map(([component, value]) => <details key={component} style={panel}><summary>{component}</summary><p>{value.value === null || value.value === undefined ? "Not available" : String(value.value)}</p><p>Sample: {value.sampleSize ?? 0}</p>{value.limitation && <p>{value.limitation}</p>}</details>)}</section>
    <section aria-labelledby="trace-heading"><h2 id="trace-heading">Eligible match trace</h2>{trace.length === 0 ? <p>No matches qualify under the effective-time and capture-time cutoff.</p> : <div role="region" aria-label="Eligible matches" style={{ overflowX: "auto" }}><table><caption>Matches included in the historical evidence build</caption><thead><tr><th>Match</th><th>Venue</th><th>Result</th><th>Score</th><th>Effective time</th><th>Observed time</th><th>Source</th><th>Components</th></tr></thead><tbody>{trace.map((row) => <tr key={`${row.fixtureId}-${row.observedAt ?? ""}`}><td>{row.fixtureId}</td><td>{row.venue ?? "Unknown"}</td><td>{row.result ?? "Unknown"}</td><td>{row.score ?? "Unknown"}</td><td>{row.effectiveAt ? <time dateTime={row.effectiveAt}>{row.effectiveAt}</time> : "Unknown"}</td><td>{row.observedAt ? <time dateTime={row.observedAt}>{row.observedAt}</time> : "Unknown"}</td><td>{row.source ?? "Unknown"}</td><td>{row.components?.join(", ") ?? "Unknown"}</td></tr>)}</tbody></table></div>}</section>
    {!data.receipt && <p role="alert">Provenance is unavailable; this evidence cannot be reproduced.</p>}
    <details style={panel}><summary>Reproduction receipt{data.receipt?.configVersion ? ` — ${data.receipt.configVersion}` : ""}{data.receipt ? ` — ${(data.receipt.inputIds ?? data.receipt.inputs ?? []).length} input${(data.receipt.inputIds ?? data.receipt.inputs ?? []).length === 1 ? "" : "s"}` : ""}</summary>{data.receipt ? <pre aria-label="Reproduction receipt data" style={{ overflow: "auto", maxWidth: "100%" }}>{JSON.stringify(data.receipt, null, 2)}</pre> : <p>No receipt is available for this cutoff.</p>}</details>
  </section>;
}
