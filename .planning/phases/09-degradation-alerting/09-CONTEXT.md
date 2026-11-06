# Phase 9: Degradation Alerting - Context

**Gathered:** 2026-11-06
**Status:** Ready for planning
**Mode:** Interactive (discuss) — operator delegated all four gray areas to the agent («реши все сам»); decisions below are agent-authored and grounded in `.planning/research/*` plus a codebase scout.

<domain>
## Phase Boundary

The operator is proactively told when the platform degrades — provider-quota exhaustion, worker job failures and dead letters, sync-run failures, 5xx spikes, and backup staleness — through durable PostgreSQL alert records with deduplication, severity tiers, and transition history, viewable with correlation context in the existing operations center, and optionally dispatched to a configurable webhook. Detection lives in PostgreSQL; a channel is an attempt, never the source of truth. Probes and alerting never call live external providers, and per-job failures never create alert fatigue. No user-facing notifications, no paid alerting SaaS (roadmap exclusions).

Requirements: ALRT-01, ALRT-02, ALRT-03, ALRT-04.

</domain>

<decisions>
## Implementation Decisions

All four gray areas (delivery channel, severity/quieting, operations-center view, thresholds/anti-fatigue) were delegated to the agent by the operator. Decisions and their rationale follow. The research baseline (`.planning/research/ARCHITECTURE.md` §F3, `SUMMARY.md` alerting row) is accepted as-is: `OpsAlert` + transition + delivery tables in PostgreSQL, one evaluator worker tick, dedup fingerprint, webhook via native `fetch`, Redis per-minute 5xx buckets fed by a NestJS exception filter, alert block in `/internal/operations`.

### Delivery channel (ALRT-04)
- **D-01:** v1.1 ships **webhook only** — a single optional `ALERT_WEBHOOK_URL` receiving a generic JSON POST via Node's native `fetch`. No `nodemailer`/SMTP in this phase: free-tier SMTP limits are unverified (roadmap research flag), and SMTP credentials add secret surface for an operator-only feature. Unconfigured channel ⇒ detection still runs and the UI shows channel state honestly as «не настроен» (non-green), the same opt-in pattern as `BACKUP_ENABLED`/off-host in Phase 8. — **Reversibility:** reversible — SMTP later becomes a second dispatcher behind the same delivery interface; detection, tables, and UI do not change.
- **D-02:** Every dispatch attempt is recorded in the delivery table (timestamp, HTTP status or bounded error code, attempt count) with bounded retries and backoff, then marked FAILED. A failed or missing channel **never loses or dampens an alert** — rows live in PostgreSQL regardless (ALRT-02).

### Severity tiers, lifecycle, quieting (ALRT-01/02)
- **D-03:** Two active tiers: **CRITICAL** (quota exhausted or critical reservations held; circuit `OPEN`; BLOCKING sync root causes `QUARANTINE|IDENTITY|PAYLOAD`; backup `FAILED` or ≥48h without a successful dump; 5xx hard threshold; a dead-lettered blocking job) and **WARNING** (quota ≥80%; circuit `HALF_OPEN`; backup `STALE` per Phase-8's read-time rule; elevated 5xx; retryable failure bursts). Severity lives on the alert row and escalates in place with a recorded transition.
- **D-04:** Lifecycle `OPEN → RESOLVED` automatically when the evaluator observes the signal cleared — no operator action required to close. An operator **acknowledge** marks the alert seen and suppresses re-notification but never closes or deletes it (the record stays truthful). Every state change appends an immutable transition row (ALRT-02 transition history), following the append-only receipt discipline.
- **D-05:** Anti-fatigue rules: exactly **one OPEN row per dedup fingerprint** (occurrences bump `count`/`lastSeen`, never insert); re-notification only on severity escalation or re-open after RESOLVED — never per occurrence; CRITICAL opens on first detection while WARNING must persist **2 consecutive ticks** (flap damping); individual job failures never open an alert — only grouped bursts by root cause (Phase-6 D-10 grouping).

### View in the operations center (ALRT-03)
- **D-06:** One new **«Алерты» Block** on the existing `/internal/operations` page (Phase-6/8 `Block` conventions, Russian labels, aria-busy/loading/error/empty states): active alerts first (severity desc, `lastSeen` desc), then recent resolved (7-day window). Row = severity chip, signal code, scope, first/last seen, count, correlation IDs, acknowledge action. Pagination follows the existing `failures` pattern; a dedicated alerts sub-page is deferred until history outgrows the block.
- **D-07:** Alert DTOs and the webhook payload carry **typed safe fields only** — codes, scopes, counts, instants, correlation IDs (Phase-6 D-12, Phase-8 T-08-13 redaction discipline). No secrets, no raw payloads, no connection strings; a planted-secret redaction test guards the payload.

### Thresholds and evaluation (ALRT-01, success criteria 3/4)
- **D-08:** One **evaluator worker tick** in `workers/data-sync` (the proven `scheduleRetentionPurge` interval-scheduler pattern; default every 5 min, configurable) reads PostgreSQL (quota observations, sync attempts/runs, backup runs) plus Redis (5xx buckets, BullMQ failed/dead-letter counts), upserts alert rows, then dispatches. Evaluator downtime only delays detection — it can never lose it, because state lives in PostgreSQL.
- **D-09:** **5xx signal:** the NestJS exception filter increments per-minute Redis buckets; alert when ≥10% of requests in a rolling 5-minute window are 5xx **and** the window holds ≥10 requests (minimum-volume guard so low traffic cannot page).
- **D-10:** **Quota signal:** percentage computed from the latest `ProviderQuotaObservation` per provider/endpointFamily — ≥80% → WARNING, ≥100% or `criticalReservations > 0` → CRITICAL; the natural quota reset ends the window and resolves the alert.
- **D-11:** **Sync/worker signal:** grouped by rootCause+scope — ≥5 FAILED `SyncAttempt`s in 10 min → WARNING, any BLOCKING-classified failure → CRITICAL regardless of count; exhausted-retry dead letters (BullMQ failed set / `provider-policy.ts` `dead-letter` status) alert per job name+root cause, never per individual job.
- **D-12:** **Backup signal** reuses Phase-8 read-time staleness: `STALE` (≥25h) → WARNING, `FAILED` receipt or ≥48h without success → CRITICAL. `NOT_CONFIGURED` does **not** alert — it is an explicit non-green UI state of an opt-in feature, and a permanent alert would train the operator to ignore the channel. Only configured+enabled backups participate.
- **D-13:** **Delivery health:** a weekly synthetic alert through the real webhook; if the delivery fails, that failure itself raises a CRITICAL self-alert (PITFALLS: «the alerting system never alerts on itself»). Alerting makes zero calls to live external *providers* — the webhook targets the operator's own channel (success criterion 4).

### the agent's Discretion
Env-var names beyond the proposed `ALERTS_ENABLED`/`ALERT_WEBHOOK_URL`/tick interval, exact column layout inside the research-named `OpsAlert`/transition/delivery models, webhook envelope shape (subject/title/text fields), where the alerts read path plugs into `operations.service.ts` (a new `alerts()` repository method beside `failures()`), window/threshold defaults proposed above (planner may tune with justification), the exception-filter bucket key scheme, and the full test matrix.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §ALRT-01, ALRT-02, ALRT-03, ALRT-04 — the four acceptance requirements for this phase.
- `.planning/ROADMAP.md` §Phase 9 — goal, success criteria, research flags (channel choice/rate limits, QueueEvents, native fetch).

### Research (already validates the approach — must not be re-litigated)
- `.planning/research/SUMMARY.md` — alerting row: `OpsAlert` rows (dedup), signal adapters (quota, BullMQ failed-set-as-DLQ, SyncRun, 5xx buckets, backup age), webhook (±nodemailer) dispatch, ops-center alert tab.
- `.planning/research/ARCHITECTURE.md` §F3 alerting — evaluator detects → durable dedup-fingerprint row → `OpsAlertDelivery` attempt evidence → `/internal/operations` alert tab; 5xx buckets fed by a NestJS exception filter.
- `.planning/research/STACK.md` — generic outbound webhook via built-in `fetch` (HIGH confidence); `nodemailer` optional, not required.
- `.planning/research/PITFALLS.md` §alerting (lines ~61, ~70, ~348) — fatigue, secret exfiltration via channel, delivery-health self-alerting; typed allowlist DTOs + planted-secret redaction test.

### Inherited phase contracts
- `.planning/phases/08-backups-and-restore-verification/08-CONTEXT.md` — D-14 backup five-state read-time staleness (25h) reused as a signal; D-15 redaction; opt-in non-green honesty (D-04/D-06).
- `.planning/phases/06-release-experience-and-operations/06-CONTEXT.md` — D-09..D-12 operator center: root-cause grouping, correlation IDs, safe metadata only, no raw payloads.
- `.planning/phases/07-ci-pipeline-quality-gates/07-CONTEXT.md` — CI gates the new migration/tests must pass (mutation-rejection discipline for new durable tables).

### Live implementation contracts
- `apps/api/src/modules/operations/operations.service.ts` — overview assembly (`failures`, `quotas`, `incidents`, `backups` read models) — where the alerts read path joins.
- `apps/web/app/internal/operations/page.tsx` — operations center `Block` conventions + Russian labels — where the alerts block renders.
- `workers/data-sync/src/main.ts` + `workers/data-sync/src/queues/index.ts` — worker composition root and queue factories — where the evaluator tick attaches.
- `workers/data-sync/src/jobs/retention-purge.ts` — `scheduleRetentionPurge` interval-scheduler pattern — template for the evaluator tick.
- `workers/data-sync/src/resilience/provider-policy.ts` — `dead-letter` attempt classification — source for the dead-letter signal.
- `packages/database/prisma/schema.prisma` — `SyncRun`, `SyncAttempt`, `ProviderQuotaObservation`, `ProviderCircuitState`, `BackupRun` models — the five signal sources; new alert models are added here via migration.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Operations `Block` component + Russian label maps in `page.tsx`: verbatim template for the «Алерты» block (loading/error/empty/aria-busy, `role="alert"` scoping rules learned in Phase-8 UAT).
- `failures()` grouping in `operations.service.ts` (rootCause+impact+scope, correlation-ID fan-out, pagination): the pattern for both the anti-fatigue aggregation and the alerts read model.
- `scheduleRetentionPurge()` self-closing interval scheduler: no cron dependency needed for the evaluator tick.
- `redactSecrets` (`@bet-stats/config`) and the Phase-8 closed-scalar select discipline: redaction pass for alert DTOs and the webhook payload.
- `computeBackupFact` five-state staleness: backup signal reads the same read-time logic instead of re-deriving thresholds.
- `OperatorGuard` + signed gateway/proxy chain: any new internal endpoints (acknowledge) inherit it with zero new auth surface.

### Established Patterns
- Opt-in features gate on config and report honest non-green when unconfigured; absence never looks green.
- Append-only durable facts with frozen DB triggers + mutation-rejection tests (receipts, snapshots, reconciliation decisions).
- Read-time computation with injected clock so worker downtime can never freeze a green state.
- Fail-closed classification (`provider-policy.ts`) with typed reason codes — alert severities key off these codes, not free text.

### Integration Points
- Database: new alert/transition/delivery models + migration (CI-gated schema validation).
- API: NestJS exception filter incrementing Redis 5xx buckets; `alerts()` read path + acknowledge endpoint behind the existing guard/proxy.
- Worker: evaluator tick + webhook dispatcher attach in `main.ts` alongside the backup/drill schedulers.
- Web: one new `Block` in the operations page; no new nav destinations.

</code_context>

<specifics>
## Specific Ideas

- «Реши все сам» — оператор делегировал все четыре области; решения выше авторские, но привязаны к ресёрчу и коду.
- Ключевая дисциплина: детекция живёт в PostgreSQL, канал — только попытка; сбой webhook не должен терять алерт.
- Усталость от алертов — главный риск фазы: группировка по root cause, один ряд на fingerprint, повторное уведомление только при эскалации.
- Русские лейблы и честные не-зелёные состояния — как в фазах 6 и 8.
- Оповещения — только операторские; пользовательские нотификации вне v1.1.

</specifics>

<deferred>
## Deferred Ideas

- SMTP/email dispatch (`nodemailer`) — «optionally» in the roadmap; add later as a second dispatcher without touching detection.
- User-facing notifications (Telegram/email) — explicitly excluded from v1.1.
- Paid alerting SaaS (Sentry/PagerDuty/Healthchecks.io) — out of scope; webhook covers operator alerting.
- Dedicated alerts history sub-page — deferred until the 7-day block window stops fitting.
- Operator-facing threshold configuration UI — thresholds are env/config for now.

### Reviewed Todos
None — `todo.match-phase 9` returned 0 matches; discussion stayed within phase scope.

</deferred>

---

*Phase: 9-degradation-alerting*
*Context gathered: 2026-11-06*
