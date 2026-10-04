"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type ProviderState = { provider?: string; circuit?: string; endpointFamily?: string; allowance?: number | null; observedAllowance?: number | null; configuredAllowance?: number | null; reserved?: number | null; remaining?: number | null; resetAt?: string | null; alreadyAuthorizedCritical?: number | null; blockedReason?: string | null };
type ImmutableGuarantees = { observations: "UNCHANGED"; issuedForecasts: "UNCHANGED"; valueReceipts: "UNCHANGED"; results: "UNCHANGED"; settlements: "UNCHANGED" };
type Preview = { previewId: string; previewVersion: string; fingerprint: string; recoveryType: "INGESTION" | "EVALUATION"; reason: string; calls?: number; builds?: number; lane: string; stale?: boolean; logicalIdentity: string; expiresAt: string; scope: Record<string, string>; quotaEffect: { reservations: number; remainingCalls?: number | null }; immutableGuarantees: ImmutableGuarantees; input?: { from?: string; to?: string }; headroom?: { remainingCalls?: number } };
type Queued = { replayPlanId?: string; planId?: string; correlationId?: string; lane?: string; status?: string; queued?: boolean; duplicate?: boolean; immutableGuarantees?: ImmutableGuarantees };

const field = { display: "grid", gap: 6 } as const;
const button = { minHeight: 48, padding: "8px 16px" } as const;
const card = { border: "1px solid #CBD5E1", borderRadius: 8, background: "#FFFFFF", padding: 20, overflowWrap: "anywhere" } as const;

function titleCase(value: string | undefined) { return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "Not available"; }
function safeNumber(value: number | null | undefined) { return value === null || value === undefined ? "Not available" : String(value); }

function localDateTimeToUtc(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_LOCAL_TIME");
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = parts as [number, number, number, number, number];
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  const sameLocalFields = (candidate: Date) => candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day && candidate.getHours() === hour && candidate.getMinutes() === minute;
  if (!sameLocalFields(local)) throw new Error("INVALID_LOCAL_TIME");

  const offsets = new Set([-4, -2, 0, 2, 4].map((hours) => new Date(local.getTime() + hours * 3_600_000).getTimezoneOffset()));
  const candidates = [...offsets]
    .map((offset) => new Date(Date.UTC(year, month - 1, day, hour, minute) + offset * 60_000))
    .filter(sameLocalFields)
    .map((candidate) => candidate.getTime());
  if (new Set(candidates).size !== 1) throw new Error("AMBIGUOUS_LOCAL_TIME");
  return new Date(candidates[0]!).toISOString();
}

export default function PipelineReplayPage() {
  const [providerState, setProviderState] = useState<ProviderState>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [queued, setQueued] = useState<Queued | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recoveryType, setRecoveryType] = useState<"INGESTION" | "EVALUATION">("INGESTION");
  const [reason, setReason] = useState("Restore historical evidence after a bounded provider outage");
  const [displayTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "browser local time");
  const submitLock = useRef(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { void fetch("/internal-api/pipeline/replay", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<ProviderState> : {}, () => ({})).then(setProviderState); }, []);
  useEffect(() => { const stale = () => { setPreview((value) => value ? { ...value, stale: true } : value); setConfirming(false); setError("This preview is no longer current. Preview recovery again."); previewButton.current?.focus(); }; window.addEventListener("replay-preview-stale", stale); return () => window.removeEventListener("replay-preview-stale", stale); }, []);
  useEffect(() => { if (confirming) dialogHeading.current?.focus(); }, [confirming]);
  useEffect(() => { if (!pending && preview?.stale) previewButton.current?.focus(); }, [pending, preview?.stale]);

  const closeConfirmation = () => { setConfirming(false); queueMicrotask(() => reviewButton.current?.focus()); };
  const dialogKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); closeConfirmation(); return; }
    if (event.key !== "Tab") return;
    const first = confirmButton.current; const last = cancelButton.current;
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogHeading.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const previewReplay = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true); setError(""); setQueued(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      if (payload.recoveryType === "INGESTION") {
        payload.from = localDateTimeToUtc(String(payload.from ?? ""));
        payload.to = localDateTimeToUtc(String(payload.to ?? ""));
      }
      const response = await fetch("/internal-api/pipeline/replay/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
      if (!response.ok) throw new Error();
      setPreview(await response.json() as Preview);
    } catch (caught) { setPreview(null); setError(caught instanceof Error && /LOCAL_TIME/.test(caught.message) ? "The local date and time could not be interpreted uniquely. Choose a valid, unambiguous time." : "Replay impact could not be calculated. No work was queued. Check the range and try again."); }
    finally { setPending(false); }
  };

  const queueReplay = async () => {
    if (!preview || preview.stale || submitLock.current) return;
    submitLock.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/internal-api/pipeline/replay/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewId: preview.previewId, previewVersion: preview.previewVersion, fingerprint: preview.fingerprint }), cache: "no-store" });
      if (response.status === 409) { setPreview({ ...preview, stale: true }); setError("This preview is no longer current. Preview recovery again."); setConfirming(false); return; }
      if (!response.ok) throw new Error();
      setQueued(await response.json() as Queued); setConfirming(false);
    } catch { setError("Replay could not be queued. No new work was queued. Try the preview again."); setConfirming(false); }
    finally { setPending(false); submitLock.current = false; }
  };

  const configured = providerState.configuredAllowance;
  const effective = configured ?? providerState.allowance;
  const units = preview?.recoveryType === "EVALUATION" ? 1 : preview?.calls ?? 0;
  return <section style={{ display: "grid", gap: 24 }}>
    <header><h1>Safe recovery</h1><p>Preview the exact impact before queueing ingestion or evaluation recovery. Existing facts remain immutable.</p></header>
    <section aria-labelledby="provider-heading" style={card}><h2 id="provider-heading">Provider state</h2><div aria-label="Provider state summary"><p>Circuit: {titleCase(providerState.circuit)}</p><p>Endpoint: {providerState.endpointFamily ?? "Not available"}</p><p>Configured allowance: {safeNumber(configured)}</p><p>Effective allowance: {safeNumber(effective)}</p><p>Reset: {providerState.resetAt ?? "Not available"}</p></div><details><summary>Full provider quota details</summary><dl><dt>Provider</dt><dd>{providerState.provider ?? "Not available"}</dd><dt>Observed allowance</dt><dd>{safeNumber(providerState.observedAllowance)}</dd><dt>Reserved</dt><dd>{safeNumber(providerState.reserved)}</dd><dt>Remaining</dt><dd>{safeNumber(providerState.remaining)}</dd></dl></details>{providerState.blockedReason && <p role="status">{providerState.blockedReason}</p>}</section>
    <form onSubmit={previewReplay} style={{ ...card, display: "grid", gap: 16 }}><h2>1. Preview</h2>
      <label style={field}>Recovery reason<textarea name="reason" required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="reason-help"/></label><p id="reason-help">Required, 10–500 characters. The reason is frozen into the audit record.</p>
      <label style={field}>Recovery domain<select name="recoveryType" value={recoveryType} onChange={(event) => { setRecoveryType(event.target.value as "INGESTION" | "EVALUATION"); setPreview(null); setQueued(null); }}><option value="INGESTION">Ingestion</option><option value="EVALUATION">Evaluation</option></select></label>
      {recoveryType === "INGESTION" ? <><label style={field}>Provider<select name="provider" defaultValue="football-data.org"><option value="football-data.org">football-data.org</option></select></label><label style={field}>Competition<select name="competitionId" defaultValue="PL"><option value="PL">Premier League</option><option value="CL">Champions League</option></select></label><label style={field}>Season<input name="seasonId" defaultValue="2026" required/></label><label style={field}>Endpoint family<select name="endpointFamily" defaultValue="FIXTURES"><option value="FIXTURES">Fixtures</option><option value="RESULTS">Results</option><option value="STANDINGS">Standings</option></select></label><label style={field}>From (local time)<input name="from" type="datetime-local" defaultValue="2026-08-01T00:00" required aria-describedby="utc-help"/></label><label style={field}>To (local time)<input name="to" type="datetime-local" defaultValue="2026-08-02T00:00" required aria-describedby="utc-help"/></label><p id="utc-help">Times use {displayTimeZone}, are converted to explicit UTC, and the range is limited to 31 days. Ambiguous daylight-saving times are rejected.</p></> : <><label style={field}>ResultVersion ID<input name="resultVersionId" required/></label><label style={field}>ForecastSnapshot ID<input name="forecastSnapshotId" required/></label><label style={field}>Policy hash<input name="policyHash" required minLength={8}/></label></>}
      <button ref={previewButton} style={button} disabled={pending || reason.trim().length < 10 || reason.trim().length > 500} type="submit">{pending && !confirming ? "Calculating recovery impact…" : "Preview recovery impact"}</button>
    </form>
    <p role="alert" tabIndex={-1}>{error}</p>
    {preview && <section aria-labelledby="impact-heading" style={card}><h2 id="impact-heading">Recovery impact</h2><p>2. Impact review</p><dl><dt>Exact scope</dt><dd>{Object.entries(preview.scope).map(([key, value]) => <span key={key} style={{ display: "block" }}>{key}: {value}</span>)}</dd><dt>Logical identity</dt><dd>{preview.logicalIdentity}</dd><dt>Preview expiry</dt><dd><time dateTime={preview.expiresAt}>{preview.expiresAt}</time></dd><dt>Policy lane</dt><dd>{preview.lane}</dd><dt>Quota effect</dt><dd>{preview.quotaEffect.reservations} reservations; remaining headroom {safeNumber(preview.quotaEffect.remainingCalls ?? preview.headroom?.remainingCalls)}</dd><dt>Reason</dt><dd>{preview.reason}</dd><dt>Immutable guarantees</dt><dd>Observations, issued forecasts, value receipts, results, and settlements stay unchanged.</dd></dl>{units === 0 && <p>No logical units match this range, so queueing is disabled.</p>}<button ref={reviewButton} style={button} disabled={pending || preview.stale || units === 0} onClick={() => setConfirming(true)}>Review and confirm recovery</button></section>}
    {confirming && preview && <div role="dialog" aria-modal="true" aria-labelledby="confirm-heading" onKeyDown={dialogKeys} style={{ ...card, position: "relative" }}><h2 ref={dialogHeading} tabIndex={-1} id="confirm-heading">Queue recovery for the exact scope shown?</h2><p>Existing observations and issued snapshots remain immutable. A reason is required and the action receives a correlation ID.</p><p><strong>Scope:</strong> {preview.logicalIdentity}</p><p><strong>Reason:</strong> {preview.reason}</p><button ref={confirmButton} style={button} disabled={pending} onClick={() => void queueReplay()}>{pending ? "Queueing recovery…" : "Confirm and queue recovery"}</button><button ref={cancelButton} style={button} disabled={pending} onClick={closeConfirmation}>Cancel</button></div>}
    {queued && <section role="status" style={card}><h2>Recovery queued</h2><p>Recovery queued. Correlation ID: {queued.correlationId ?? "Not available"}. Existing immutable facts were not changed.</p><dl><dt>Plan ID</dt><dd>{queued.replayPlanId ?? queued.planId ?? "Not available"}</dd><dt>Correlation ID</dt><dd>{queued.correlationId ?? "Not available"}</dd><dt>Lane</dt><dd>{queued.lane ?? preview?.lane ?? "Not available"}</dd><dt>Status</dt><dd>{queued.status ?? (queued.duplicate ? "Existing plan" : "Queued")}</dd><dt>Immutable guarantees</dt><dd>Observations, issued forecasts, value receipts, results, and settlements stay unchanged.</dd></dl></section>}
  </section>;
}
