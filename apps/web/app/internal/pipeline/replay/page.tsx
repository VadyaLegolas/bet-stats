"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type ProviderState = { provider?: string; circuit?: string; endpointFamily?: string; allowance?: number | null; observedAllowance?: number | null; configuredAllowance?: number | null; reserved?: number | null; remaining?: number | null; resetAt?: string | null; alreadyAuthorizedCritical?: number | null; blockedReason?: string | null };
type ImmutableGuarantees = { observations: "UNCHANGED"; issuedForecasts: "UNCHANGED"; valueReceipts: "UNCHANGED"; results: "UNCHANGED"; settlements: "UNCHANGED" };
type Preview = { previewId: string; previewVersion: string; fingerprint: string; recoveryType: "INGESTION" | "EVALUATION"; reason: string; calls?: number; builds?: number; lane: string; stale?: boolean; logicalIdentity: string; expiresAt: string; scope: Record<string, string>; quotaEffect: { reservations: number; remainingCalls?: number | null }; immutableGuarantees: ImmutableGuarantees; input?: { from?: string; to?: string }; headroom?: { remainingCalls?: number } };
type Queued = { replayPlanId?: string; planId?: string; correlationId?: string; lane?: string; status?: string; queued?: boolean; duplicate?: boolean; immutableGuarantees?: ImmutableGuarantees };

const field = { display: "grid", gap: 6 } as const;
const button = { minHeight: 48, padding: "8px 16px" } as const;
const card = { border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", padding: 20, overflowWrap: "anywhere" } as const;

function titleCase(value: string | undefined) { return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "Недоступно"; }
function safeNumber(value: number | null | undefined) { return value === null || value === undefined ? "Недоступно" : String(value); }

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
  const [reason, setReason] = useState("Восстановить исторические доказательства после ограниченного сбоя поставщика");
  const [displayTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "локального времени браузера");
  const submitLock = useRef(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { void fetch("/internal-api/pipeline/replay", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<ProviderState> : {}, () => ({})).then(setProviderState); }, []);
  useEffect(() => { const stale = () => { setPreview((value) => value ? { ...value, stale: true } : value); setConfirming(false); setError("Этот предпросмотр больше не актуален. Повторите предпросмотр восстановления."); previewButton.current?.focus(); }; window.addEventListener("replay-preview-stale", stale); return () => window.removeEventListener("replay-preview-stale", stale); }, []);
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
    } catch (caught) { setPreview(null); setError(caught instanceof Error && /LOCAL_TIME/.test(caught.message) ? "Не удалось однозначно интерпретировать локальные дату и время. Выберите допустимое однозначное время." : "Не удалось рассчитать влияние воспроизведения. Ничего не поставлено в очередь. Проверьте диапазон и повторите попытку."); }
    finally { setPending(false); }
  };

  const queueReplay = async () => {
    if (!preview || preview.stale || submitLock.current) return;
    submitLock.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/internal-api/pipeline/replay/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ previewId: preview.previewId, previewVersion: preview.previewVersion, fingerprint: preview.fingerprint }), cache: "no-store" });
      if (response.status === 409) { setPreview({ ...preview, stale: true }); setError("Этот предпросмотр больше не актуален. Повторите предпросмотр восстановления."); setConfirming(false); return; }
      if (!response.ok) throw new Error();
      setQueued(await response.json() as Queued); setConfirming(false);
    } catch { setError("Воспроизведение не удалось поставить в очередь. Новая работа не поставлена в очередь. Повторите предпросмотр."); setConfirming(false); }
    finally { setPending(false); submitLock.current = false; }
  };

  const configured = providerState.configuredAllowance;
  const effective = configured ?? providerState.allowance;
  const units = preview?.recoveryType === "EVALUATION" ? 1 : preview?.calls ?? 0;
  return <section style={{ display: "grid", gap: 24 }}>
    <header><h1>Безопасное восстановление</h1><p>Просмотрите точное влияние перед постановкой в очередь восстановления данных или оценки. Существующие факты остаются неизменяемыми.</p></header>
    <section aria-labelledby="provider-heading" style={card}><h2 id="provider-heading">Состояние поставщика</h2><div aria-label="Сводка состояния поставщика"><p>Предохранитель: {titleCase(providerState.circuit)}</p><p>Эндпоинт: {providerState.endpointFamily ?? "Недоступно"}</p><p>Настроенная квота: {safeNumber(configured)}</p><p>Действующая квота: {safeNumber(effective)}</p><p>Сброс: {providerState.resetAt ?? "Недоступно"}</p></div><details><summary>Полные сведения о квоте поставщика</summary><dl><dt>Поставщик</dt><dd>{providerState.provider ?? "Недоступно"}</dd><dt>Наблюдаемая квота</dt><dd>{safeNumber(providerState.observedAllowance)}</dd><dt>Забронировано</dt><dd>{safeNumber(providerState.reserved)}</dd><dt>Осталось</dt><dd>{safeNumber(providerState.remaining)}</dd></dl></details>{providerState.blockedReason && <p role="status">{providerState.blockedReason}</p>}</section>
    <form onSubmit={previewReplay} style={{ ...card, display: "grid", gap: 16 }}><h2>1. Предпросмотр</h2>
      <label style={field}>Причина восстановления<textarea name="reason" required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="reason-help"/></label><p id="reason-help">Обязательное поле, от 10 до 500 символов. Причина фиксируется в аудиторской записи.</p>
      <label style={field}>Область восстановления<select name="recoveryType" value={recoveryType} onChange={(event) => { setRecoveryType(event.target.value as "INGESTION" | "EVALUATION"); setPreview(null); setQueued(null); }}><option value="INGESTION">Ingestion</option><option value="EVALUATION">Evaluation</option></select></label>
      {recoveryType === "INGESTION" ? <><label style={field}>Поставщик<select name="provider" defaultValue="football-data.org"><option value="football-data.org">football-data.org</option></select></label><label style={field}>Соревнование<select name="competitionId" defaultValue="PL"><option value="PL">Premier League</option><option value="CL">Champions League</option></select></label><label style={field}>Сезон<input name="seasonId" defaultValue="2026" required/></label><label style={field}>Группа эндпоинтов<select name="endpointFamily" defaultValue="FIXTURES"><option value="FIXTURES">Fixtures</option><option value="RESULTS">Results</option><option value="STANDINGS">Standings</option></select></label><label style={field}>С (местное время)<input name="from" type="datetime-local" defaultValue="2026-08-01T00:00" required aria-describedby="utc-help"/></label><label style={field}>По (местное время)<input name="to" type="datetime-local" defaultValue="2026-08-02T00:00" required aria-describedby="utc-help"/></label><p id="utc-help">Время задано для {displayTimeZone} и преобразуется в явный UTC; диапазон ограничен 31 днём. Неоднозначное время перехода на летнее время отклоняется.</p></> : <><label style={field}>ResultVersion ID<input name="resultVersionId" required/></label><label style={field}>ForecastSnapshot ID<input name="forecastSnapshotId" required/></label><label style={field}>Хэш политики<input name="policyHash" required minLength={8}/></label></>}
      <button ref={previewButton} style={button} disabled={pending || reason.trim().length < 10 || reason.trim().length > 500} type="submit">{pending && !confirming ? "Расчёт влияния восстановления…" : "Предпросмотр влияния восстановления"}</button>
    </form>
    <p role="alert" tabIndex={-1}>{error}</p>
    {preview && <section aria-labelledby="impact-heading" style={card}><h2 id="impact-heading">Влияние восстановления</h2><p>2. Проверка влияния</p><dl><dt>Точная область</dt><dd>{Object.entries(preview.scope).map(([key, value]) => <span key={key} style={{ display: "block" }}>{key}: {value}</span>)}</dd><dt>Логическая идентичность</dt><dd>{preview.logicalIdentity}</dd><dt>Срок действия предпросмотра</dt><dd><time dateTime={preview.expiresAt}>{preview.expiresAt}</time></dd><dt>Канал политики</dt><dd>{preview.lane}</dd><dt>Влияние на квоту</dt><dd>{preview.quotaEffect.reservations} бронирований; доступный запас {safeNumber(preview.quotaEffect.remainingCalls ?? preview.headroom?.remainingCalls)}</dd><dt>Причина</dt><dd>{preview.reason}</dd><dt>Неизменяемые гарантии</dt><dd>Наблюдения, выпущенные прогнозы, квитанции value, результаты и расчёты остаются неизменными.</dd></dl>{units === 0 && <p>Логические единицы, соответствующие этому диапазону, не найдены; постановка в очередь отключена.</p>}<button ref={reviewButton} style={button} disabled={pending || preview.stale || units === 0} onClick={() => setConfirming(true)}>Проверить и подтвердить восстановление</button></section>}
    {confirming && preview && <div role="dialog" aria-modal="true" aria-labelledby="confirm-heading" onKeyDown={dialogKeys} style={{ ...card, position: "relative" }}><h2 ref={dialogHeading} tabIndex={-1} id="confirm-heading">Поставить в очередь восстановление для показанной точной области?</h2><p>Существующие наблюдения и выпущенные снимки остаются неизменяемыми. Причина обязательна, действие получает корреляционный ID.</p><p><strong>Область:</strong> {preview.logicalIdentity}</p><p><strong>Причина:</strong> {preview.reason}</p><button ref={confirmButton} style={button} disabled={pending} onClick={() => void queueReplay()}>{pending ? "Постановка восстановления в очередь…" : "Подтвердить и поставить в очередь"}</button><button ref={cancelButton} style={button} disabled={pending} onClick={closeConfirmation}>Отмена</button></div>}
    {queued && <section role="status" style={card}><h2>Восстановление поставлено в очередь</h2><p>Восстановление поставлено в очередь. Корреляционный ID: {queued.correlationId ?? "Недоступно"}. Существующие неизменяемые факты не изменены.</p><dl><dt>ID плана</dt><dd>{queued.replayPlanId ?? queued.planId ?? "Недоступно"}</dd><dt>Корреляционный ID</dt><dd>{queued.correlationId ?? "Недоступно"}</dd><dt>Канал</dt><dd>{queued.lane ?? preview?.lane ?? "Недоступно"}</dd><dt>Статус</dt><dd>{queued.status ?? (queued.duplicate ? "Существующий план" : "В очереди")}</dd><dt>Неизменяемые гарантии</dt><dd>Наблюдения, выпущенные прогнозы, квитанции value, результаты и расчёты остаются неизменными.</dd></dl></section>}
  </section>;
}
