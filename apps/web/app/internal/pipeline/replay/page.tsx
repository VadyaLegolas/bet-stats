"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type ProviderState = { provider?: string; circuit?: string; endpointFamily?: string; allowance?: number | null; observedAllowance?: number | null; configuredAllowance?: number | null; reserved?: number | null; remaining?: number | null; resetAt?: string | null; alreadyAuthorizedCritical?: number | null; blockedReason?: string | null };
type Preview = { previewId: string; previewVersion?: string; version?: string | number; calls?: number; builds?: number; units?: number; estimatedReservations?: number; lane?: string; stale?: boolean; logicalIdentity?: string; headroom?: { remainingCalls?: number }; effects?: { immutableObservations?: boolean; predictionSnapshotsMutated?: boolean } };
type Queued = { replayPlanId?: string; planId?: string; correlationId?: string; lane?: string; status?: string; queued?: boolean; duplicate?: boolean };

const field = { display: "grid", gap: 6 } as const;
const button = { minHeight: 48, padding: "8px 16px" } as const;
const card = { border: "1px solid #CBD5E1", borderRadius: 8, background: "#FFFFFF", padding: 20, overflowWrap: "anywhere" } as const;

function titleCase(value: string | undefined) { return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "Not available"; }
function safeNumber(value: number | null | undefined) { return value === null || value === undefined ? "Not available" : String(value); }

export default function PipelineReplayPage() {
  const [providerState, setProviderState] = useState<ProviderState>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [queued, setQueued] = useState<Queued | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [forceRevision, setForceRevision] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [purpose, setPurpose] = useState("Restore historical evidence after a bounded provider outage");
  const submitLock = useRef(false);
  const previewButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { void fetch("/internal-api/pipeline/replay", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<ProviderState> : {}, () => ({})).then(setProviderState); }, []);
  useEffect(() => { const stale = () => { setPreview((value) => value ? { ...value, stale: true } : value); setError("The replay preview changed and is stale. Preview replay again before queueing."); previewButton.current?.focus(); }; window.addEventListener("replay-preview-stale", stale); return () => window.removeEventListener("replay-preview-stale", stale); }, []);

  const previewReplay = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true); setError(""); setQueued(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/internal-api/pipeline/replay/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
      if (!response.ok) throw new Error();
      setPreview(await response.json() as Preview);
    } catch { setPreview(null); setError("Replay impact could not be calculated. No work was queued. Check the range and try again."); }
    finally { setPending(false); }
  };

  const queueReplay = async () => {
    if (!preview || preview.stale || submitLock.current) return;
    if (forceRevision && revisionReason.trim().length < 3) { setError("A revision reason is required before starting a new audited revision."); return; }
    submitLock.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/internal-api/pipeline/replay/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewId: preview.previewId, previewVersion: preview.previewVersion ?? String(preview.version ?? ""), newRevision: forceRevision, reason: forceRevision ? revisionReason.trim() : undefined }), cache: "no-store" });
      if (response.status === 409) { setPreview({ ...preview, stale: true }); setError("The replay preview changed and is stale. Preview replay again before queueing."); setConfirming(false); queueMicrotask(() => previewButton.current?.focus()); return; }
      if (!response.ok) throw new Error();
      setQueued(await response.json() as Queued); setConfirming(false);
    } catch { setError("Replay could not be queued. No new work was queued. Try the preview again."); setConfirming(false); }
    finally { setPending(false); submitLock.current = false; }
  };

  const configured = providerState.configuredAllowance;
  const effective = configured ?? providerState.allowance;
  const units = preview?.units ?? preview?.calls ?? 0;
  return <section style={{ display: "grid", gap: 24 }}>
    <header><h1>Historical pipeline replay</h1><p>Preview a bounded replay before queueing any work. Existing observations remain immutable.</p></header>
    <section aria-labelledby="provider-heading" style={card}><h2 id="provider-heading">Provider state</h2><div aria-label="Provider state summary"><p>Circuit: {titleCase(providerState.circuit)}</p><p>Endpoint: {providerState.endpointFamily ?? "Not available"}</p><p>Allowance: {safeNumber(providerState.allowance)}</p><p>Configured allowance: {safeNumber(configured)}</p><p>Effective allowance: {safeNumber(effective)}</p><p>Reset: {providerState.resetAt ?? "Not available"}</p><p>Already-authorized critical work: {safeNumber(providerState.alreadyAuthorizedCritical)}</p></div><details><summary>Full provider quota details</summary><dl><dt>Provider</dt><dd>{providerState.provider ?? "Not available"}</dd><dt>Observed allowance</dt><dd>{safeNumber(providerState.observedAllowance)}</dd><dt>Reserved</dt><dd>{safeNumber(providerState.reserved)}</dd><dt>Remaining</dt><dd>{safeNumber(providerState.remaining)}</dd></dl></details>{providerState.blockedReason && <p role="status">{providerState.blockedReason}</p>}</section>
    <form onSubmit={previewReplay} style={{ ...card, display: "grid", gap: 16 }}><h2>Replay scope</h2><label style={field}>Purpose<textarea name="purpose" required minLength={10} value={purpose} onChange={(event) => setPurpose(event.target.value)}/></label><label style={field}>Provider<select name="provider" defaultValue="football-data.org"><option value="football-data.org">football-data.org</option></select></label><label style={field}>Competition<select name="competitionId" defaultValue="PL"><option value="PL">Premier League</option><option value="CL">Champions League</option></select></label><label style={field}>Season<input name="seasonId" defaultValue="2026" required/></label><label style={field}>Endpoint family<select name="endpointFamily" defaultValue="FIXTURES"><option value="FIXTURES">Fixtures</option><option value="RESULTS">Results</option><option value="STANDINGS">Standings</option></select></label><label style={field}>From (UTC)<input name="from" type="datetime-local" defaultValue="2026-08-01T00:00" required aria-describedby="utc-help"/></label><label style={field}>To (UTC)<input name="to" type="datetime-local" defaultValue="2026-08-02T00:00" required aria-describedby="utc-help"/></label><p id="utc-help">Times are interpreted as UTC and the range is limited to 31 days.</p><label style={field}>Policy lane<input value="standard" readOnly/></label><button ref={previewButton} style={button} disabled={pending} type="submit">{pending && !confirming ? "Calculating replay impact…" : "Preview replay"}</button></form>
    <p role="alert" tabIndex={-1}>{error}</p>
    {preview && <section aria-labelledby="impact-heading" style={card}><h2 id="impact-heading">Replay impact</h2><p>{units} logical units</p><dl><dt>Estimated reservations</dt><dd>{preview.estimatedReservations ?? preview.calls ?? 0}</dd><dt>Evidence builds</dt><dd>{preview.builds ?? units}</dd><dt>Lane</dt><dd>{preview.lane ?? "standard"}</dd><dt>Remaining headroom</dt><dd>{safeNumber(preview.headroom?.remainingCalls)}</dd><dt>Immutable observations</dt><dd>Preserved</dd><dt>Future snapshots</dt><dd>Not changed</dd></dl>{units === 0 && <p>No logical units match this range, so queueing is disabled.</p>}<label style={field}><span><input type="checkbox" checked={forceRevision} onChange={(event) => { setForceRevision(event.target.checked); setConfirming(event.target.checked); }}/> Force new revision</span></label>{forceRevision && <label style={field}>Revision reason<textarea required aria-required="true" value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)}/></label>}<button style={button} disabled={pending || preview.stale || units === 0} onClick={() => setConfirming(true)}>Queue replay</button></section>}
    {confirming && preview && <div role="dialog" aria-modal="true" aria-labelledby="confirm-heading" style={{ ...card, position: "relative" }}><h2 id="confirm-heading">{forceRevision ? "Start new revision" : "Queue replay"}</h2><p>{forceRevision ? "Start a new immutable revision with new logical run identities? Existing observations remain immutable." : "Queue this replay using the existing logical identities? Existing observations remain immutable and duplicate facts will not be created."}</p><button style={button} disabled={pending || (forceRevision && revisionReason.trim().length < 3)} onClick={() => void queueReplay()}>{pending ? "Queueing replay…" : forceRevision ? "Confirm new revision" : "Confirm queue replay"}</button><button style={button} disabled={pending} onClick={() => setConfirming(false)}>{forceRevision ? "Keep current replay" : "Return to replay preview"}</button></div>}
    {queued && <section role="status" style={card}><h2>Replay queued</h2><dl><dt>Replay plan</dt><dd>{queued.replayPlanId ?? queued.planId ?? "Not available"}</dd>{queued.correlationId && <><dt>Correlation ID</dt><dd>{queued.correlationId}</dd></>}<dt>Lane</dt><dd>{queued.lane ?? preview?.lane ?? "standard"}</dd><dt>Status</dt><dd>{queued.status ?? (queued.duplicate ? "Existing plan" : "Queued")}</dd></dl></section>}
  </section>;
}
