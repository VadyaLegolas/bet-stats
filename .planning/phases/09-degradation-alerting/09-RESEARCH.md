# Phase 9: Degradation Alerting - Research

**Researched:** 2026-11-07
**Domain:** Operational degradation detection (PostgreSQL-durable alerts), webhook dispatch, ops-center UI
**Confidence:** HIGH (in-repo contracts verified by reading source this session; external channel facts MEDIUM)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All four gray areas (delivery channel, severity/quieting, operations-center view, thresholds/anti-fatigue) were delegated to the agent by the operator. Decisions and their rationale follow. The research baseline (`.planning/research/ARCHITECTURE.md` §F3, `SUMMARY.md` alerting row) is accepted as-is: `OpsAlert` + transition + delivery tables in PostgreSQL, one evaluator worker tick, dedup fingerprint, webhook via native `fetch`, Redis per-minute 5xx buckets fed by a NestJS exception filter, alert block in `/internal/operations`.

#### Delivery channel (ALRT-04)
- **D-01:** v1.1 ships **webhook only** — a single optional `ALERT_WEBHOOK_URL` receiving a generic JSON POST via Node's native `fetch`. No `nodemailer`/SMTP in this phase: free-tier SMTP limits are unverified (roadmap research flag), and SMTP credentials add secret surface for an operator-only feature. Unconfigured channel ⇒ detection still runs and the UI shows channel state honestly as «не настроен» (non-green), the same opt-in pattern as `BACKUP_ENABLED`/off-host in Phase 8. — **Reversibility:** reversible — SMTP later becomes a second dispatcher behind the same delivery interface; detection, tables, and UI do not change.
- **D-02:** Every dispatch attempt is recorded in the delivery table (timestamp, HTTP status or bounded error code, attempt count) with bounded retries and backoff, then marked FAILED. A failed or missing channel **never loses or dampens an alert** — rows live in PostgreSQL regardless (ALRT-02).

#### Severity tiers, lifecycle, quieting (ALRT-01/02)
- **D-03:** Two active tiers: **CRITICAL** (quota exhausted or critical reservations held; circuit `OPEN`; BLOCKING sync root causes `QUARANTINE|IDENTITY|PAYLOAD`; backup `FAILED` or ≥48h without a successful dump; 5xx hard threshold; a dead-lettered blocking job) and **WARNING** (quota ≥80%; circuit `HALF_OPEN`; backup `STALE` per Phase-8's read-time rule; elevated 5xx; retryable failure bursts). Severity lives on the alert row and escalates in place with a recorded transition.
- **D-04:** Lifecycle `OPEN → RESOLVED` automatically when the evaluator observes the signal cleared — no operator action required to close. An operator **acknowledge** marks the alert seen and suppresses re-notification but never closes or deletes it (the record stays truthful). Every state change appends an immutable transition row (ALRT-02 transition history), following the append-only receipt discipline.
- **D-05:** Anti-fatigue rules: exactly **one OPEN row per dedup fingerprint** (occurrences bump `count`/`lastSeen`, never insert); re-notification only on severity escalation or re-open after RESOLVED — never per occurrence; CRITICAL opens on first detection while WARNING must persist **2 consecutive ticks** (flap damping); individual job failures never open an alert — only grouped bursts by root cause (Phase-6 D-10 grouping).

#### View in the operations center (ALRT-03)
- **D-06:** One new **«Алерты» Block** on the existing `/internal/operations` page (Phase-6/8 `Block` conventions, Russian labels, aria-busy/loading/error/empty states): active alerts first (severity desc, `lastSeen` desc), then recent resolved (7-day window). Row = severity chip, signal code, scope, first/last seen, count, correlation IDs, acknowledge action. Pagination follows the existing `failures` pattern; a dedicated alerts sub-page is deferred until history outgrows the block.
- **D-07:** Alert DTOs and the webhook payload carry **typed safe fields only** — codes, scopes, counts, instants, correlation IDs (Phase-6 D-12, Phase-8 T-08-13 redaction discipline). No secrets, no raw payloads, no connection strings; a planted-secret redaction test guards the payload.

#### Thresholds and evaluation (ALRT-01, success criteria 3/4)
- **D-08:** One **evaluator worker tick** in `workers/data-sync` (the proven `scheduleRetentionPurge` interval-scheduler pattern; default every 5 min, configurable) reads PostgreSQL (quota observations, sync attempts/runs, backup runs) plus Redis (5xx buckets, BullMQ failed/dead-letter counts), upserts alert rows, then dispatches. Evaluator downtime only delays detection — it can never lose it, because state lives in PostgreSQL.
- **D-09:** **5xx signal:** the NestJS exception filter increments per-minute Redis buckets; alert when ≥10% of requests in a rolling 5-minute window are 5xx **and** the window holds ≥10 requests (minimum-volume guard so low traffic cannot page).
- **D-10:** **Quota signal:** percentage computed from the latest `ProviderQuotaObservation` per provider/endpointFamily — ≥80% → WARNING, ≥100% or `criticalReservations > 0` → CRITICAL; the natural quota reset ends the window and resolves the alert.
- **D-11:** **Sync/worker signal:** grouped by rootCause+scope — ≥5 FAILED `SyncAttempt`s in 10 min → WARNING, any BLOCKING-classified failure → CRITICAL regardless of count; exhausted-retry dead letters (BullMQ failed set / `provider-policy.ts` `dead-letter` status) alert per job name+root cause, never per individual job.
- **D-12:** **Backup signal** reuses Phase-8 read-time staleness: `STALE` (≥25h) → WARNING, `FAILED` receipt or ≥48h without success → CRITICAL. `NOT_CONFIGURED` does **not** alert — it is an explicit non-green UI state of an opt-in feature, and a permanent alert would train the operator to ignore the channel. Only configured+enabled backups participate.
- **D-13:** **Delivery health:** a weekly synthetic alert through the real webhook; if the delivery fails, that failure itself raises a CRITICAL self-alert (PITFALLS: «the alerting system never alerts on itself»). Alerting makes zero calls to live external *providers* — the webhook targets the operator's own channel (success criterion 4).

#### the agent's Discretion
Env-var names beyond the proposed `ALERTS_ENABLED`/`ALERT_WEBHOOK_URL`/tick interval, exact column layout inside the research-named `OpsAlert`/transition/delivery models, webhook envelope shape (subject/title/text fields), where the alerts read path plugs into `operations.service.ts` (a new `alerts()` repository method beside `failures()`), window/threshold defaults proposed above (planner may tune with justification), the exception-filter bucket key scheme, and the full test matrix.

### Deferred Ideas (OUT OF SCOPE)

- SMTP/email dispatch (`nodemailer`) — «optionally» in the roadmap; add later as a second dispatcher without touching detection.
- User-facing notifications (Telegram/email) — explicitly excluded from v1.1.
- Paid alerting SaaS (Sentry/PagerDuty/Healthchecks.io) — out of scope; webhook covers operator alerting.
- Dedicated alerts history sub-page — deferred until the 7-day block window stops fitting.
- Operator-facing threshold configuration UI — thresholds are env/config for now.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ALRT-01 | Degradation alerts for provider-quota exhaustion, worker job failures/dead letters, sync-run failures, 5xx spikes, backup staleness | D-08..D-12 signal adapters; five signal sources verified in `schema.prisma` and `operations.service.ts` (Standard Stack + Architecture Patterns) |
| ALRT-02 | Durable PostgreSQL records with dedup, severity tiers, transition history; channel delivery is an attempt, never source of truth | `OpsAlert`/transition/delivery models + guarded-transition trigger pattern (Pattern 2/3), PITFALLS Pitfall 3 (Common Pitfalls 1–3) |
| ALRT-03 | View active/recent alerts in ops center with correlation context and redacted secrets | UI-SPEC (approved contract) + `Block`/`CopyCorrelation` patterns verified in `page.tsx` (Pattern 6, Code Examples) |
| ALRT-04 | Dispatch to configurable webhook without leaking secrets or betting data | Native-fetch dispatcher with timeout/backoff (Pattern 4), rate-limit facts (State of the Art), redaction test (Common Pitfalls 6) |
</phase_requirements>

## Project Constraints (from AGENTS.md)

Extracted from `./AGENTS.md` (project instructions) — treat with the authority of locked decisions:

- **Language:** all user-facing UI text, comments in user-facing components, and agent replies are in **Russian**; technical identifiers, code, and commit messages stay in **English** (user request, 2026-10-15). Signal codes/scopes/correlation IDs render as English machine codes beside Russian labels.
- **Stack is fixed:** pnpm workspaces + Turborepo; Next.js/React/TypeScript/Tailwind/TanStack Query/Recharts; NestJS; PostgreSQL/Prisma; Redis/BullMQ. Do not introduce a second ORM, an alternate job runner, or Axios.
- **Data cost / API budget:** free tiers only; API-Football must stay below its daily free-tier allowance — alert probes must never call live providers (PITFALLS P12).
- **Data integrity:** canonical entities + provider external-reference tables; immutable snapshots/receipts; append-only corrections.
- **Reliability:** sync jobs idempotent, cached, retried with backoff, circuit-breaker protected; BullMQ retry/backoff owns job retries, Cockatiel owns provider resilience — keep them separate.
- **Responsible gambling:** no automatic wagering, certainty claims, or hidden risk; alert copy must avoid urgency/certainty framing.
- **`apps/web/AGENTS.md` (Next.js block):** this Next.js version differs from training data — read the relevant guide in `node_modules/next/dist/docs/` (resolved from `apps/web/`) **before writing any web code**; heed deprecation notices. The `next dev`-written AGENTS block must not be dropped from a diff.
- **GSD workflow enforcement (AGENTS.md):** planning artifacts and execution flow through GSD commands; direct repo edits outside a GSD workflow require the user's explicit bypass.
- **Operating rules from STATE.md (precedent, still active):**
  - `gsd_run`/`gsd-tools` are **not on PATH** in the executor shell — state/roadmap/requirements tracking and final docs commits are done as manual file edits + plain `git` commits ([STATE.md:249] "…are not on PATH in this executor shell — state/roadmap/requirements tracking and final docs commits are done as manual file edits + plain git commits (07-01..07-03 and 08-01 precedent)").
  - Never kill the user's dev servers; only `scripts\app-lifecycle.ps1` starts the stack (web proxies/API guards read secrets from `process.env`) ([STATE.md:242]).
  - The worker must stay import-side-effect-free: auto-start is behind `isDirectExecution()`; importing `workers/data-sync/src/main.ts` from tests must never boot a sweep ([STATE.md:292]).

## Summary

Phase 9 adds an **operator-only degradation alerting loop** with zero new runtime dependencies: a single evaluator tick in `workers/data-sync` reads five signal sources (quota observations, sync attempts/runs, backup runs in PostgreSQL; per-minute 5xx buckets and BullMQ failed-set counts in Redis), upserts deduplicated `OpsAlert` rows with severity/lifecycle/transition history in PostgreSQL, dispatches an optional webhook via Node's native `fetch`, and surfaces everything in one new «Алерты» block on the existing `/internal/operations` page. Detection lives in PostgreSQL; a channel is only an attempt (D-01/D-02).

The codebase already contains every integration point this phase needs: the `scheduleRetentionPurge` interval-scheduler pattern (evaluator tick template), the `inspector.getFailed()` BullMQ failed-set reader, `computeBackupFact` read-time staleness, `redactSecrets`, the `Block`/`CopyCorrelation` UI conventions, the `OperatorGuard` + HMAC gateway/proxy chain, and the CI schema gate. The genuinely **new** technical surfaces are (a) three Prisma models + a migration with a *guarded* transition trigger (not a blanket append-only one), (b) a NestJS global exception filter feeding Redis buckets — **no exception filter exists anywhere in the repo today**, and (c) the webhook dispatcher with bounded retries.

**Primary recommendation:** plan the phase as four vertical slices — (1) schema + guarded triggers + mutation-rejection tests, (2) evaluator tick with five signal adapters + dedup/damping unit tests, (3) API exception filter + alerts read model + acknowledge endpoint, (4) webhook dispatcher + UI block + redaction canary tests — with slice 1 first because CI gates every migration.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| 5xx request counting | API / Backend (NestJS exception filter) | — | Only the API tier sees HTTP status codes; filter increments Redis buckets at response time |
| Signal evaluation (quota, sync, backup, dead letters, 5xx read) | Worker (`workers/data-sync` evaluator tick) | — | D-08: one tick in the worker; reads PostgreSQL + Redis, never calls providers |
| Alert state (dedup, severity, lifecycle, transitions) | Database / Storage (PostgreSQL) | — | ALRT-02: durable source of truth; Redis is explicitly never-source-of-truth |
| Webhook dispatch + attempt evidence | Worker (evaluator, after upsert) | — | Dispatch follows detection in the same tick; delivery rows are write-only evidence |
| Alerts read model + acknowledge endpoint | API / Backend (`operations` module, `OperatorGuard`) | — | Existing operations controller/guard; no new auth surface |
| Signing/proxy of operator requests | Frontend server (Next `internal-api` route) + gateway | — | Already covers `/internal/operations` and `/internal-api/operations` prefixes |
| «Алерты» block rendering | Browser / Client (`page.tsx` client component) | — | Existing `Block` conventions on a client-rendered ops page |
| Backup staleness input | Database / Storage (read-time fact) | Worker | Reuses `computeBackupFact` — no re-derived thresholds |

## Standard Stack

### Core (all pre-installed — the phase adds **zero** new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.22.0 (repo `engines`: `">=24.0.0 <25"`, verified `package.json:7-10`) | runtime | Native `fetch` + `AbortSignal.timeout` ship with it; CI enforces Node 24 |
| `bullmq` | 6.3.2 (lockfile `pnpm-lock.yaml:1526`) | failed-set polling for dead-letter signal; optional `QueueEvents` | Already a dependency of both API (`apps/api/package.json:20`) and worker (`workers/data-sync/package.json:17`) |
| `ioredis` | 5.11.1 (lockfile `pnpm-lock.yaml:2267`) | 5xx bucket INCR/MULTI, failed-set reads | Existing API dependency (`apps/api/package.json:23`); existing lazy-connect pattern in `privacy.service.ts:164` |
| Native `fetch` (undici) | Node 24 built-in | webhook POST dispatch | STACK.md: "Generic outbound webhook via built-in fetch … Zero dependencies, no vendor lock-in" — HIGH confidence |
| Prisma 7 + PostgreSQL 18 | existing | `OpsAlert`/transition/delivery models + guarded triggers | Schema-first constraint; migration gated by CI `pnpm verify:release:schema` |
| NestJS | 11.1.29 (`apps/api/package.json:17`) | exception filter, alerts read path, acknowledge endpoint | Framework built-in `ExceptionFilter`/`@Catch` — no library needed |
| Zod (via `@bet-stats/config`) | existing | `readAlertsConfig` env reader (mirrors `readBackupConfig`) | Project convention: opt-in config readers that fail absent, not default |
| `redactSecrets` (`@bet-stats/config`) | existing | belt-and-braces payload redaction | `packages/config/src/index.ts:53-60` |
| Vitest 4.1.11 / Playwright 1.62.1 | root `package.json:34,27` | unit/integration/web/e2e tests | One runner across the monorepo |

### Supporting (patterns, not packages)

| Pattern | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `scheduleRetentionPurge` interval scheduler | in-repo | evaluator tick (setTimeout chain, injected clock, `onError`, `close()`) | every periodic worker task |
| `inspector.getFailed(start, end)` | in-repo (`queues/index.ts:244`) | dead-letter evidence | reading BullMQ failed set |
| Redis `MULTI INCR + EXPIRE` window counter | official Redis docs | per-minute 5xx buckets | any fixed-window counter |
| Guarded-transition SQL trigger | in-repo migrations | allow-listed UPDATE on `OpsAlert`, append-only transitions | lifecycle tables |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Failed-set polling (D-08) | `QueueEvents` listener | QueueEvents gives immediacy but **requires a dedicated Redis connection** and its own `close()` lifecycle; polling keeps one tick, one connection set, and matches the locked decision. Use QueueEvents only if per-event immediacy is later required |
| Native `fetch` webhook | `nodemailer`/SMTP | deferred (D-01) — SMTP adds secret surface and unverified free-tier limits |
| Interval scheduler | `node-cron` / BullMQ repeatable jobs | cron adds a dependency; BullMQ repeat option was already rejected in Phase 8 ([STATE.md:248] "no cron library, no BullMQ v5 repeat option") |
| Native `fetch` | axios | explicitly forbidden by AGENTS/STACK ("Do not add Axios by default") |
| In-DB counters | Prometheus + Grafana | disproportionate for a single operator (STACK.md) |

**Installation:** none — `pnpm install` output must be unchanged (`pnpm-lock.yaml` diff empty) for this phase.

**Version verification:** no packages are added, so no registry versions were written into this document; all versions above are pinned facts read from the repo lockfile/manifests this session (in-repo, [VERIFIED: pnpm-lock.yaml:1526,2267] etc.). If the planner adds *any* package (it should not), run `npm view <pkg> version` and the Package Legitimacy Gate first.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** Everything reuses pinned dependencies already in the lockfile (`bullmq`, `ioredis`, `@nestjs/common`, native `fetch`, Prisma).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| — | — | — | — | — | — | no installs planned |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*If a future revision introduces a package (e.g. `nodemailer` after D-01's SMTP deferral is lifted), the planner must run `gsd_run query package-legitimacy check --ecosystem npm <pkg>` plus `npm view <pkg> version scripts.postinstall` and gate the install behind `checkpoint:human-verify` unless it is confirmed against official documentation.*

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────────────┐
  HTTP requests ────────► │ API (NestJS 11)              │
  (operator browser)      │  • existing endpoints        │
        │                 │  • NEW global exception       │
        │                 │    filter ──INCR+EXPIRE──┐    │
        │                 │  • NEW alerts() read +    │    │
        │                 │    POST …/alerts/:id/ack  │    │
        │                 └───────┬───────────────────┼────┘
        │                         │ Prisma reads      │ Redis per-minute
        ▼                         ▼                   ▼ 5xx buckets
  ┌──────────────┐        ┌──────────────────┐   ┌─────────────┐
  │ Next web      │        │ PostgreSQL        │   │ Redis       │
  │ /internal/    │        │  OpsAlert         │   │  • buckets  │
  │ operations    │◄──────►│  OpsAlertTransition│  │  • BullMQ   │
  │ «Алерты» Block│        │  OpsAlertDelivery  │   │    failed   │
  └──────┬───────┘        │  (5 signal sources │   │    set      │
         │                │   already live:    │   └──────┬──────┘
         │                │   SyncRun/Attempt, │          │
  internal-api proxy      │   ProviderQuota-   │          │
  (HMAC + method bind)    │   Observation,     │          │
         │                │   ProviderCircuit- │          │
         ▼                │   State, BackupRun) │         │
  ┌──────────────┐        └────────▲───────────┘          │
  │ Operator      │                │                       │
  │ gateway       │        ┌───────┴────────────────────┐  │
  │ (Basic+HMAC)  │        │ Worker evaluator tick (5m)  │  │
  └───────────────┘        │  read signals → dedup upsert│◄─┘
                           │  → transition rows          │
                           │  → dispatch webhook (fetch) │
                           └───────┬────────────────────┘
                                   │ HTTPS POST (operator's own channel,
                                   │ never a live provider)
                                   ▼
                           ┌──────────────────┐
                           │ ALERT_WEBHOOK_URL │  attempts logged to
                           │ (optional)        │  OpsAlertDelivery
                           └──────────────────┘
```

Decision points: evaluator decides severity (CRITICAL/WARNING) and lifecycle (OPEN/RESOLVED/acknowledged) per tick; dispatch happens only on open/escalation/re-open (D-05); unconfigured webhook ⇒ detection still runs, channel line renders «не настроен».

### Recommended Project Structure

```
packages/database/prisma/
├── schema.prisma                     # + OpsAlert, OpsAlertTransition, OpsAlertDelivery
└── migrations/2026xxxx_phase09_ops_alerts/migration.sql   # guarded triggers
packages/config/src/index.ts          # + readAlertsConfig (ALERTS_ENABLED, ALERT_WEBHOOK_URL, tick)
workers/data-sync/src/jobs/alerts.ts  # F3: signal evaluators + dedup + dispatch
│                                     #   (or jobs/alerts/ {signals,evaluator,dispatch}.ts)
workers/data-sync/src/main.ts         # + startAlertingRuntime() composed beside startBackupRuntime()
apps/api/src/modules/operations/
├── operations.controller.ts          # + POST internal/operations/alerts/:alertId/acknowledge
├── operations.service.ts             # + alerts() repository method beside failures()
└── (5xx filter registered in app.module.ts via APP_FILTER or main.ts useGlobalFilters)
apps/web/app/internal/operations/
├── page.tsx                          # + «Алерты» Block (first after header, per UI-SPEC)
└── alerts-block.tsx                  # co-located card/button constants (BackupStatusBlock pattern)
apps/web/components/enum-labels.ts    # + alertSeverityLabel/alertStatusLabel/alertSignalLabel
tests/unit/alerts-*.test.ts           # evaluator, dedup, damping, dispatcher, config
tests/integration/alerts-*.test.ts    # real Postgres: upsert dedup, trigger guards, acknowledge idempotency
apps/web/app/internal/operations/alerts-block.test.ts   # SSR render tests (web project)
```

(ARCHITECTURE.md F3 names the same split: "`apps/api/src/modules/alerts/*`; `workers/data-sync/src/jobs/alerts.ts`" — `.planning/research/ARCHITECTURE.md:220`.)

### Pattern 1: Evaluator tick = self-closing interval scheduler (no cron)

**What:** a `setTimeout` chain armed from persisted state, with injected clock, `onError`, `close()`.
**When to use:** the D-08 tick (and the D-13 weekly synthetic delivery probe).
**Example:** existing template, `workers/data-sync/src/jobs/retention-purge.ts:28-39` [VERIFIED]:

```ts
export type RetentionPurgeScheduler = Readonly<{ close(): void; refresh(): Promise<void> }>;

/** Arms each purge at the earliest persisted expiry and recomputes after it. */
export function scheduleRetentionPurge(input: {
  database: PrismaClient;
  now?: () => Date;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  onError?: (error: unknown) => void;
  idlePollMs?: number;
  retryMs?: number;
}): RetentionPurgeScheduler { /* timer chain; MAX_TIMER_DELAY = 2 ** 31 - 1 */ }
```

Composition precedent: `workers/data-sync/src/main.ts:77` [VERIFIED] `const retentionPurgeScheduler = scheduleRetentionPurge({ database, onError: (error) => console.error(JSON.stringify({ event: "privacy.retention_purge.failed", ... })) });` and the config-gated runtime precedent `main.ts:103-140` (`startBackupRuntime` returns `undefined` and logs `backup.disabled` when off).

### Pattern 2: Dedup upsert + append-only transition (ALRT-02)

**What:** `@@unique` on the dedup fingerprint; OPEN row per fingerprint; occurrences bump `count`/`lastSeen`; every state change appends a transition row.
**When to use:** every signal adapter output.
**Example (shape, planner-adjustable):**

```ts
// fingerprint = signal code + scope (e.g. "PROVIDER_QUOTA\0api-football/FIXTURES")
const alert = await tx.opsAlert.upsert({
  where: { dedupFingerprint: fingerprint },
  create: { dedupFingerprint: fingerprint, signal: code, scope, severity, status: "OPEN",
            firstSeen: now, lastSeen: now, count: 1, correlationIds },
  update: { lastSeen: now, count: { increment: 1 }, severity /* only on escalation */ },
});
// status changes (escalation, RESOLVED) append:
await tx.opsAlertTransition.create({ data: { alertId: alert.id, from, to, severityFrom, severityTo, at: now } });
```

### Pattern 3: Guarded transition trigger — **not** blanket append-only

**What:** `OpsAlert` must stay updatable (count/lastSeen/severity/status/ack), so it cannot get a `reject_append_only_change()`-style trigger; the *transition* table should be strictly append-only.
**When to use:** the phase-09 migration.
**Template already in repo** [VERIFIED: packages/database/prisma/migrations/20261022_phase08_backup_runs/migration.sql:22,28]:

```sql
CREATE OR REPLACE FUNCTION guard_backup_run() RETURNS trigger LANGUAGE plpgsql AS $$
-- ...
CREATE TRIGGER "BackupRun_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "BackupRun" FOR EACH ROW EXECUTE FUNCTION guard_backup_run();
```

Guarded-transition variants that allow *only* listed columns to change exist too (`guard_sync_run_transition`, `guard_replay_delivery_transition`) — copy their RAISE-EXCEPTION style for `OpsAlert` (e.g. reject changes to `id`, `dedupFingerprint`, `firstSeen`, `createdAt`; allow `severity/status/count/lastSeen/acknowledgedAt/resolvedAt`).

### Pattern 4: Webhook dispatcher via native `fetch`

**What:** one bounded POST per dispatch decision, timeout per attempt, no redirects, bounded retries with jitter, `Retry-After` honored, every attempt recorded.
**When to use:** D-01/D-02 dispatch and D-13 weekly synthetic.

```ts
const response = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),          // typed allowlist DTO only (D-07)
  redirect: "manual",                     // 3xx = failure; never follow to an unvalidated target
  signal: AbortSignal.timeout(10_000),    // fresh signal per attempt
});
// non-2xx or 429 → bounded retry (e.g. 3 attempts, exp backoff + jitter, honor Retry-After);
// then append OpsAlertDelivery row { at, httpStatus | bounded errorCode, attempt } and stop (D-02)
```

Source basis: [CITED: docs.bullmq.io + Node/MDN fetch docs via research seam] — `AbortSignal.timeout` per attempt, treat non-2xx as failure, exponential backoff with jitter, honor `Retry-After` on 429 (confidence MEDIUM; the retry-loop *policy values* are [ASSUMED] planner-tunable).

### Pattern 5: 5xx buckets = global NestJS exception filter + Redis window counters

**What:** a global filter counts 5xx responses into per-minute Redis keys; the evaluator sums the last 5 buckets against D-09's ratio + volume guard.
**When to use:** HTTP_5XX signal only.

```ts
// registration: app.useGlobalFilters(new Http5xxBucketFilter(redis)) in apps/api/src/main.ts,
// or an APP_FILTER provider in app.module.ts — official docs: docs.nestjs.com/exception-filters
// IMPORTANT: the filter must delegate to Nest's base behavior (HttpAdapterHost /
// extend BaseExceptionFilter) or it silently replaces the default error contract.
```

Bucket write (official Redis rate-limiter pattern, [CITED: redis.io/commands/incr]):

```ts
const key = `bet-stats:http5xx:${Math.floor(Date.now() / 60_000)}`; // minute-pinned key
await redis.multi().incr(key).expire(key, 120).exec();              // atomic; TTL ≥ 2× window
// read: sum keys for the last 5 minute indexes; missing key = 0
```

### Pattern 6: Redacted, typed DTOs + planted-secret test (D-07)

**What:** alerts DTO and webhook payload are closed scalar constructors; `redactSecrets` pass; a canary test proves leakage never reaches JSON or DOM.
**When to use:** every read/write path leaving the API or worker.
**Existing precedent** [VERIFIED: apps/api/src/modules/operations/operations.service.ts:165-167]:

```ts
// D-15: belt-and-braces redactSecrets pass — the closed BackupFact carries
// basenames, sizes, instants, durations and reason codes, nothing else.
backups: redactSecrets(computeBackupFact(backupRows, current)) as BackupFact,
```

Canary test templates: `tests/integration/operator-overview.test.ts:73` [VERIFIED] `expect(flatten(overview)).not.toMatch(/secret-token-canary|raw-payload-canary|authorization-header-canary|environment-canary|stack-trace-canary|unrestricted-log-canary/);` and e2e `tests/e2e/release-degradation.spec.ts:9` `const CANARY = "release-secret-canary-never-render";`.

### Anti-Patterns to Avoid

- **Alert state in Redis / channel-only alerting** — a missed webhook is unrecoverable; Postgres `OpsAlert` is the state, dispatch is evidence (ARCHITECTURE.md F3 / Anti-Pattern 3).
- **Reusing raw provider payloads as alert messages** — correct for audit storage, wrong for messages (PITFALLS:64); build from a typed allowlist.
- **Per-occurrence notifications** — only open/escalation/re-open dispatch (D-05).
- **A global filter that forgets to delegate** — changes the entire API error contract; test that 400/404 bodies are byte-identical after adding it.
- **Blanket append-only trigger on `OpsAlert`** — the next dedup `count` bump fails at runtime.
- **Calling live providers from probes or tests** — violates CI-02 and burns the API-Football budget (PITFALLS P12).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dedup / "one active row per condition" | Redis SETNX store, in-memory map | Postgres unique fingerprint + Prisma upsert | durable, auditable, survives restarts; Redis is never-source-of-truth |
| Alert lifecycle transitions | free-text status column edits | append-only `OpsAlertTransition` rows + guarded trigger | matches receipts discipline; mutation-rejection testable |
| Secret scrubbing | ad-hoc string replace per payload | `redactSecrets` + closed DTO constructors | one regex-driven choke point already tested in `packages/config` |
| Periodic evaluation | `node-cron` / new scheduler lib | `scheduleRetentionPurge`-style interval chain | proven in-repo, injectable clock, no dependency |
| Webhook HTTP client | axios / got / SDK | native `fetch` + `AbortSignal.timeout` | AGENTS/STACK forbid adding HTTP stacks |
| Operator authentication | new tokens/sessions for acknowledge | `OperatorGuard` + existing HMAC proxy/gateway | zero new auth surface; gateway already protects the prefixes |
| Pagination/sort for the block | bespoke paging | failures pattern (`page`/`pageSize`, 25 max, `pagination` envelope) | consistency + already validated |
| Russian label lookup | inline ternaries in JSX | `enum-labels.ts` maps with `?? value` fallback | unknown codes degrade to raw code, never blank |

**Key insight:** every "custom" piece here already exists in the repo as a tested pattern; hand-rolling would duplicate the redaction/dedup/append-only disciplines that Phase 6–8 reviews specifically hardened.

## Common Pitfalls

### Pitfall 1: Global exception filter silently changes the API error contract
**What goes wrong:** responses for 400/404/500 change shape, breaking web/e2e expectations.
**Why it happens:** a custom `@Catch()` filter must itself write the response; forgetting to delegate replaces Nest's default handling.
**How to avoid:** extend `BaseExceptionFilter` or resolve `HttpAdapterHost` and reply with the original status/body; add a regression test asserting existing error bodies (e.g. uniform `NotFoundException("Not found")`) are unchanged.
**Warning signs:** web tests expecting `{ message: "Not found" }` start failing; 404 probes return 500.

### Pitfall 2: Trigger blocks the dedup bump
**What goes wrong:** first alert inserts fine; every subsequent occurrence throws from the trigger.
**Why it happens:** copying the `*_append_only` trigger template onto `OpsAlert`.
**How to avoid:** allow-listed guarded transition (Pattern 3) on `OpsAlert`; strict append-only only on `OpsAlertTransition`/`OpsAlertDelivery`; mutation-rejection tests for both directions (UPDATE/DELETE rejected on transition/delivery; disallowed column UPDATE rejected on alert).
**Warning signs:** evaluator tick logs `onError` every tick after the first alert.

### Pitfall 3: Overview query rejects new parameters
**What goes wrong:** adding `alertPage` (UI-SPEC default) makes the whole overview 400.
**Why it happens:** strict allowlist [VERIFIED: apps/api/src/modules/operations/operations.service.ts:125-128]:

```ts
const allowed = new Set(["page", "pageSize", "windowHours", "impact", "rootCause"]);
if (Object.keys(raw).some((key) => !allowed.has(key))) throw new BadRequestException("INVALID_OPERATIONS_QUERY");
const page = raw.page ?? 1; const pageSize = raw.pageSize ?? 25; const windowHours = raw.windowHours ?? 24;
if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25 || !Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) throw new BadRequestException("INVALID_OPERATIONS_QUERY");
```

**How to avoid:** extend `allowed` (and the controller's `optionalInteger` mapping) with the alerts parameter, or serve alerts from a dedicated sub-resource; keep `pageSize ≤ 25` and `windowHours ≤ 168` caps.
**Warning signs:** 400 `INVALID_OPERATIONS_QUERY` on the ops page after the block lands.

### Pitfall 4: Acknowledge POST body never reaches the API
**What goes wrong:** acknowledge 404s or no-ops.
**Why it happens:** the web proxy forwards **no request body** and the HMAC canonical string binds method+path only [VERIFIED: apps/web/app/internal-api/operations/[[...path]]/route.ts:49-52]:

```ts
// The HMAC canonical string binds the method, so forwarding it adds zero
// secret surface: a signed GET can never become a POST (T-08-14). The manual
// trigger POSTs carry no body beyond the path — nothing is forwarded upstream.
```

plus segment validation [VERIFIED: same file:46]: `if (path.some((segment) => !/^[A-Za-z0-9_-]{1,64}$/.test(segment))) return NextResponse.json({ message: "Not found" }, { status: 404, ... });`
**How to avoid:** path-based idempotent POST (`/internal/operations/alerts/{alertId}/acknowledge`, cuid ids match the segment regex), no JSON body; gateway already protects the prefix (`protectedPrefixes` includes `"/internal/operations"` and `"/internal-api/operations"` — `infra/operator-gateway/security.mjs:3-8`).

### Pitfall 5: Alert fatigue (success criterion 4)
**What goes wrong:** per-job/per-retry pages; operator mutes the channel within a week.
**Why it happens:** no dedup, no flap damping, dispatch on every occurrence.
**How to avoid:** D-05 rules verbatim — one OPEN row per fingerprint, count bump only, WARNING needs 2 consecutive ticks, dispatch only on open/escalation/re-open, group by rootCause+scope. **Warning signs:** >20 alerts/day; same fingerprint hundreds of times (PITFALLS:74).

### Pitfall 6: Secret/betting-data leakage through the channel or DOM
**What goes wrong:** provider keys ride in payload fields; webhook URL logged.
**Why it happens:** payload built from raw rows; `redactSecrets` does **not** match webhook URLs — its key regex is [VERIFIED: packages/config/src/index.ts:51] `const sensitiveKey = /(?:token|password|secret|api.?key|authorization|database.?url)/i;` (note: no bare `url` term).
**How to avoid:** typed allowlist DTO (codes/scope/counts/instants/correlation IDs only), `redactSecrets` pass, planted-secret test on both JSON and rendered DOM; never log `ALERT_WEBHOOK_URL`.

### Pitfall 7: QueueEvents connection leaks / duplicated listeners
**What goes wrong:** extra blocking Redis connection never closed; double counting if both a listener and polling run.
**How to avoid:** per D-08 the evaluator **polls** the failed set; if QueueEvents is added later, one instance per queue with `close()` in the runtime's `close()` (the `startBackupRuntime` close shape, `main.ts:131-139`).
**Note:** events carry only `{ jobId, failedReason, prev }` — no job name; `Job.fromId` is required to resolve job identity [CITED: docs.bullmq.io Quick Start].

### Pitfall 8: Non-atomic Redis counters leak TTL-less keys
**How to avoid:** `MULTI INCR+EXPIRE` (or INCR-with-EXPIRE-only-on-first) in one round trip; window-pinned keys (`…:${minuteIndex}`) expire naturally. Separate `INCR` then `EXPIRE` risks orphan keys with no TTL [CITED: redis.io/commands/incr rate-limiter pattern].

### Pitfall 9: Evaluator downtime freezes a green state
**How to avoid:** all staleness/ratio decisions computed at read time from persisted instants with an injected `now` (Phase-8 D-14 discipline); the tick only *writes* alerts; a delayed tick delays detection, never loses it (D-08).

### Pitfall 10: Test/boot side effects and env-mode traps
- Importing `workers/data-sync/src/main.ts` must stay side-effect-free (`isDirectExecution()`, `main.ts:157-174`).
- The stack only runs via `scripts\app-lifecycle.ps1` (`turbo run dev --env-mode=loose`); turbo's strict env mode strips `.env` ([STATE.md:295]).
- E2E/CI web stacks must keep `NEXT_DIST_DIR=.next-e2e` so Next's distDir lock never kills the dev server ([STATE.md:243]).

### Pitfall 11: 5xx noise at low traffic / non-exception 5xx
**How to avoid:** D-09 minimum-volume guard (≥10 requests in the window) plus ratio threshold; the filter only observes *exception-derived* 5xx — document that as the v1.1 scope (Next-tier 5xx and non-throwing 5xx are out of scope).

### Pitfall 12: `NOT_CONFIGURED` backup spams a permanent alert
**How to avoid:** D-12 — only configured+enabled backups participate; absence renders non-green in the UI, never as an alert.

## Code Examples

Verified patterns from official sources and the repo:

### Interval scheduler with injected clock (worker tick)
```ts
// Source: workers/data-sync/src/jobs/retention-purge.ts:26-39 (in-repo, read this session)
const MAX_TIMER_DELAY = 2 ** 31 - 1;
export type RetentionPurgeScheduler = Readonly<{ close(): void; refresh(): Promise<void> }>;
export function scheduleRetentionPurge(input: {
  database: PrismaClient; now?: () => Date;
  setTimeout?: (cb: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
  onError?: (error: unknown) => void; idlePollMs?: number; retryMs?: number;
}): RetentionPurgeScheduler { /* arm() → run() → arm() chain with onError retry */ }
```

### Failed-set read (dead-letter signal)
```ts
// Source: workers/data-sync/src/queues/index.ts:241-248 (in-repo)
const pageSize = 100;
for (let start = 0; ; start += pageSize) {
  const failed = await inspector.getFailed(start, start + pageSize - 1);
  await Promise.all(failed.map((job) => reconcileFailedDelivery(input.database, job.data, job.opts.attempts ?? SYNC_MAX_ATTEMPTS)));
  if (failed.length < pageSize) break;
}
```
Failed retention: `removeOnFail: { age: 604_800, count: 5_000 }` [VERIFIED: `queues/index.ts:124`] — failed jobs persist 7 days / up to 5000, so failed-set counts are available to the tick.

### Dead-letter classification source
```ts
// Source: workers/data-sync/src/resilience/provider-policy.ts:36 (in-repo)
if (attempt >= (input.maxAttempts ?? 3)) return { status: "dead-letter", attempts: attempt, reason: classification.reason, correlationId: input.correlationId, history, circuit } as const;
```

### BLOCKING classification (sync signal)
```ts
// Source: apps/api/src/modules/operations/operations.service.ts:192 (in-repo)
impact: /QUARANTINE|IDENTITY|PAYLOAD/.test(attempt.classifiedReason ?? "") ? "BLOCKING" as const : "DEGRADED" as const,
// retryable: /TIMEOUT|RATE|5XX|UNAVAILABLE/.test(attempt.classifiedReason ?? "")
```

### Backup staleness inputs (backup signal)
```ts
// Source: apps/api/src/modules/operations/operations.service.ts:21,45,47 (in-repo)
export type BackupState = "NOT_CONFIGURED" | "NEVER_VERIFIED" | "STALE" | "FAILED" | "HEALTHY";
export const BACKUP_FRESH_MS = 25 * 3_600_000;
export const DRILL_GRACE_MS = 24 * 3_600_000;
```

### Redis window counter (5xx buckets) — official pattern
```ts
// Source: redis.io/commands/incr "Pattern: rate limiter 1" (MULTI INCR + EXPIRE per window key)
await redis.multi().incr(key).expire(key, 120).exec();
```

### Acknowledge endpoint skeleton (inherits existing guard)
```ts
// Source: apps/api/src/modules/operations/operations.controller.ts:8-9,22-28 (in-repo)
@Controller("internal/operations")
@UseGuards(OperatorGuard)
export class OperationsController { /* @Post("backups/run") @HttpCode(HttpStatus.ACCEPTED) precedent */ }
// → @Post("alerts/:alertId/acknowledge") @HttpCode(HttpStatus.ACCEPTED), idempotent, path-only
```

### Env config reader (opt-in, fail-absent)
```ts
// Source: packages/config/src/index.ts:148-150 (in-repo pattern)
export function readBackupConfig(input: Record<string, string | undefined>): BackupConfig {
  return { enabled: input.BACKUP_ENABLED === "true" || input.BACKUP_ENABLED === "1", /* ... */ };
}
// → readAlertsConfig: ALERTS_ENABLED, ALERT_WEBHOOK_URL (https?/http? validated, never logged),
//    ALERTS_TICK_MS (bounded), ALERTS_WEBHOOK_TIMEOUT_MS — BACKUP_* keys are deliberately NOT
//    in the production-required superRefine; do the same for ALERT_* (opt-in feature).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Log-line → notification alerting | Durable dedup row → typed payload → channel attempt | 2026 research baseline (ARCHITECTURE F3) | missed delivery ≠ missed fact |
| Instantaneous error thresholds | Windowed ratio + minimum-volume guard (D-09) | SRE burn-rate era; single-operator scale keeps it one window | low traffic can't page |
| Polling `getFailed` only | Optional `QueueEvents` streaming (needs dedicated connection) | BullMQ v5+ | immediacy at the cost of one more connection; D-08 keeps polling |
| Manual `INCR` + `EXPIRE` | `MULTI`/Lua atomic window counters (Redis also ships native `INCREX`) | Redis docs today | no TTL-less orphan keys |
| SMTP free-tier channels | Generic webhook via native `fetch` (D-01) | this phase | zero deps, no credential surface |
| Research baseline "no CI / lint only in web" | Phase 7 shipped CI (`ci.yml`: frozen install → `verify:release:schema` → typecheck → lint → build → unit; integration job runs `test:integration:docker`) | Phase 7 complete | new migrations/tests must pass the gate |

**Deprecated/outdated (research docs superseded by the code):**
- `SUMMARY.md:12` "there is no CI today, lint covers only `apps/web`" — **stale**: `.github/workflows/ci.yml` now runs schema validation, typecheck, lint, unit, build, and Docker integration.
- `STACK.md:60` claims "The API already has a centralized exception handler emitting console JSON events" — **not found in the repo**: `apps/api/src/main.ts:19-31` registers only `ValidationPipe` + correlation middleware, and a repo-wide grep for `ExceptionFilter` / `@Catch(` returns no matches. The 5xx filter is net-new work, not an incremental change.
- `SUMMARY.md`/`ARCHITECTURE.md` predate Phase 8: backup signals now come from `BackupRun` + `BackupVerificationReceipt` with the five-state read-time rule (D-14).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Discord webhook numeric rate limit (~30 req/60s per URL) is community-observed; official docs document 429/Retry-After but not the bucket size | State of the Art | Low — expected dispatch volume (escalation-only + weekly synthetic) is orders of magnitude below any plausible limit; honor `Retry-After` regardless |
| A2 | SMTP free-tier limits remain unverified (roadmap research flag) | Standard Stack | None this phase — SMTP is deferred by D-01 |
| A3 | The webhook target is operator-owned and unavailable in dev/CI, so tests must stub the endpoint with a local HTTP server | Validation Architecture | Low — but the plan must not assume any real channel exists |
| A4 | v1.1 5xx detection covers API-tier exceptions only (not Next.js web responses) | Common Pitfalls 11 | Medium — if the operator expects full-stack 5xx, the filter scope must widen later |
| A5 | BullMQ failed-set counts are usable because `removeOnFail` retains 7d/5000 per queue (verified for sync/enrichment/settlement/backtest/backup queues) | Standard Stack | Low — jobs older than the retention age simply drop out of the count |
| A6 | Redis `INCREX` availability across the deployed Redis 8 image is unverified; the `MULTI` pattern is used instead | Pattern 5 | None — MULTI works on all supported versions |
| A7 | UI-SPEC frontmatter says `status: approved` / `reviewed_at: 2026-11-06`, but its Checker Sign-Off boxes are unchecked and it ends `**Approval:** pending` (STATE.md says "Phase 9 UI-SPEC approved") | Open Questions | Low — planner should confirm sign-off state before execution (config has `ui_safety_gate: true`) |
| A8 | Threshold defaults in D-08..D-12 (5 min tick, 10%/10 req/5 min, 80%/100% quota, 5 attempts/10 min, 2-tick WARNING damping) are agent-authored and may be tuned by the planner within the discretion area | User Constraints | Low — all are explicitly listed as planner-tunable |

**If this table is empty:** not applicable — assumptions listed above are the ones needing confirmation.

## Open Questions

1. **Alerts pagination parameter shape** (discretion: `alertPage` vs a dedicated sub-resource)
   - What we know: UI-SPEC defaults to `alertPage` in the same query string; the overview validator rejects unknown keys (Pitfall 3); failures own `page`.
   - What's unclear: extend the allowlist or split the read path.
   - Recommendation: extend the allowlist with `alertPage` (mirrors `page` handling, keeps one fetch per the UI-SPEC "single overview fetch" contract) and add a unit test for the 400-on-unknown-key behavior.

2. **Evaluator runtime attachment** (discretion)
   - What we know: `start()` composes `startReplayWorker` + `startBackupRuntime` (`main.ts:142-155`); backup is a separate config-gated runtime with its own `close()`.
   - What's unclear: fold the tick into `startReplayWorker` or add `startAlertingRuntime`.
   - Recommendation: a new `startAlertingRuntime({ databaseUrl, redisUrl, alertsConfig, log })` composed in `start()` beside `startBackupRuntime` — symmetric opt-in gating (`ALERTS_ENABLED`), symmetric `close()`, and no timers when disabled.

3. **Where the D-13 weekly synthetic cadence is armed from**
   - What we know: Phase 8 arms ticks from persisted receipts (`completedAt + interval`, idle-poll until first success).
   - What's unclear: the synthetic probe's persisted anchor (latest `OpsAlertDelivery` of the synthetic fingerprint is the natural fit).
   - Recommendation: arm from the last synthetic delivery attempt timestamp using the same idle-poll pattern.

4. **5xx bucket key scheme** (explicitly discretion)
   - Recommendation: `bet-stats:http5xx:<minuteIndex>` with 120s TTL, both counters in one bucket key (`total`/`failed` as two keys or a hash) so the ratio needs one read.

5. **Correlation context per signal**
   - What we know: SyncRun carries `correlationId` [VERIFIED: schema.prisma:398]; quota/circuit/backup rows have no correlation ID.
   - Recommendation: correlationIds is an optional string[] on the DTO (UI renders `Нет` when empty); never fabricate IDs.

6. **UI-SPEC sign-off status** (see A7) — confirm with the operator/UI checker before execution.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | v24.22.0 (engines `>=24 <25`) | — |
| pnpm | workspaces | ✓ | 10.34.5 (packageManager pin) | — |
| Docker | integration tests / Testcontainers-style harness | ✓ | server 29.9.2 | — |
| PostgreSQL | signal sources + alert tables | ✓ (port 5432 open) | 18 line | — |
| Redis | 5xx buckets + BullMQ failed set | ✓ (port 6379 open) | 8 line | — |
| Playwright/Chromium | e2e block + gateway tests | ✓ (`@playwright/test` 1.62.1; CI installs chromium) | — | — |
| Live webhook endpoint | real dispatch verification | ✗ | — | local stub HTTP server in tests; manual operator verification at UAT |
| `gsd-tools` on PATH | docs commits | ✗ (found at `C:\Users\Vlad\.config\opencode\gsd-core\bin\gsd-tools.cjs`, not on PATH) | 1.18.0 | manual file edits + plain `git` commits (STATE.md precedent) |

**Missing dependencies with no fallback:** none blocking.
**Missing dependencies with fallback:** real webhook channel → local stub server for automated tests; end-to-end delivery verified only if the operator supplies `ALERT_WEBHOOK_URL` at UAT.

**Step 2.6 notes:** no external SaaS, no paid API, no new runtime — the phase is fully self-hosted. CI must never call a live provider or a live webhook (CI-02, PITFALLS P12).

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (root), separate web project config `apps/web/vitest.config.ts` |
| Config file | `vitest.config.ts` (projects: `unit` = `packages/**/*.test.ts` + `tests/unit/**`; `integration` = `tests/integration/**`, `fileParallelism: false`) |
| Quick run command | `pnpm test` (= `vitest run --project unit && pnpm --filter @bet-stats/web test`) |
| Full suite command | `pnpm test:integration` / CI: `pnpm run test:integration:docker`; release gate: `pnpm verify:release` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ALRT-01 | Five signal adapters raise CRITICAL/WARNING per D-10..D-12 | unit | `pnpm exec vitest run --project unit tests/unit/alerts-signals.test.ts` | ❌ Wave 0 |
| ALRT-02 | One OPEN row per fingerprint; transitions append; UPDATE/DELETE rejected | integration | `pnpm exec vitest run --project integration tests/integration/alerts.test.ts` | ❌ Wave 0 |
| ALRT-02 | Acknowledge is idempotent and never closes/deletes | integration | same file, `…alerts.test.ts` acknowledge cases | ❌ Wave 0 |
| ALRT-03 | Block renders states (empty/loading/error/populated) + ordering | web unit | `pnpm --filter @bet-stats/web exec vitest run -c vitest.config.ts app/internal/operations/alerts-block.test.ts` | ❌ Wave 0 |
| ALRT-03 | Canary secrets never reach JSON/DOM | integration/e2e | `pnpm exec vitest run --project integration tests/integration/alerts.test.ts` + extend `tests/e2e/operator-overview.spec.ts` | ❌ Wave 0 |
| ALRT-04 | Dispatcher: timeout, non-2xx → bounded retry → FAILED delivery row; payload allowlist | unit | `pnpm exec vitest run --project unit tests/unit/alerts-dispatch.test.ts` | ❌ Wave 0 |
| ALRT-04 | 5xx filter counts buckets without changing error contract | unit/integration | `tests/unit/alerts-5xx-filter.test.ts` (mock host) + integration error-contract regression | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test` (unit + web)
- **Per wave merge:** `pnpm test` + `pnpm test:integration:docker` + `pnpm typecheck` + `pnpm lint`
- **Phase gate:** full CI suite green (schema validate → typecheck → lint → unit → build → Docker integration) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/alerts-signals.test.ts` — thresholds, flap damping, NOT_CONFIGURED exclusion, min-volume guard
- [ ] `tests/unit/alerts-dispatch.test.ts` — fetch stub (timeout/429/3xx/bounded attempts), payload canary
- [ ] `tests/unit/alerts-5xx-filter.test.ts` — bucket writes + unchanged error contract
- [ ] `tests/integration/alerts.test.ts` — real Postgres: dedup upsert, guarded triggers, acknowledge idempotency, read-model ordering/pagination
- [ ] `apps/web/app/internal/operations/alerts-block.test.ts` — SSR states, Russian copy, ordering (mirror `backup-status-block.test.ts`)
- [ ] Framework install: **none** (Vitest/Playwright already configured)

*Existing test infrastructure covers the harness; all phase-specific files are new.*

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: "high"` in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | reuses existing `OperatorGuard` + gateway Basic auth; no new credentials |
| V3 Session Management | no | operator contour is stateless (HMAC-signed requests) |
| V4 Access Control | no | same controller-level guard; new route lives under the already-protected `/internal/operations` prefix |
| V5 Input Validation | yes | overview query allowlist + `alertPage` bounds; path-param segment regex `/^[A-Za-z0-9_-]{1,64}$/`; Zod `readAlertsConfig` (webhook URL scheme + bounded tick/timeout) |
| V6 Cryptography | no new crypto | reuse existing HMAC-SHA256 signing chain (`OPERATOR_PROXY_SIGNING_SECRET`); never implement signature logic in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret exfiltration via webhook/DOM (provider keys, URLs, raw payloads) | Information Disclosure | typed allowlist DTO + `redactSecrets` + planted-secret canary test (PITFALLS:348) |
| Webhook URL treated as loggable config | Information Disclosure | never log/print `ALERT_WEBHOOK_URL`; note `redactSecrets`' key regex does **not** match `url` |
| Redirect-based SSRF/token leak on dispatch | Tampering | `redirect: "manual"` (3xx = failure), validate scheme `http(s)://` at config read, timeout per attempt |
| Spoofed/garbage scope or root-cause strings rendered as HTML | Tampering | `safeIdentity`/`safeCode`/`safeCorrelation` regex gates (operations.service.ts:120-122) + React escaping |
| Alert storm → operator blind / Redis/DB DoS | Denial of Service | dedup fingerprint, one OPEN row, dispatch only on open/escalation, bounded retries, 120s bucket TTLs |
| Forged acknowledge without operator credential | Spoofing | `OperatorGuard` (timing-safe credential compare, `NotFoundException` on failure) + gateway Basic + HMAC binding method/path |
| 429 retry loops against the channel (invalid-request bans) | Denial of Service | bounded attempts, honor `Retry-After`, stop after final failure and record FAILED (D-02) |

## Sources

### Primary (HIGH confidence)
- In-repo reads this session: `workers/data-sync/src/jobs/retention-purge.ts`, `workers/data-sync/src/main.ts`, `workers/data-sync/src/queues/index.ts`, `workers/data-sync/src/resilience/provider-policy.ts:36`, `apps/api/src/modules/operations/{operations.controller,operations.service}.ts`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/modules/reconciliation/operator.guard.ts`, `apps/web/app/internal/operations/page.tsx`, `apps/web/app/internal-api/operations/[[...path]]/route.ts`, `apps/web/components/enum-labels.ts`, `infra/operator-gateway/security.mjs`, `packages/config/src/index.ts`, `packages/database/prisma/schema.prisma` (LedgerState 44-50, CircuitState 59-63, SyncRun 388-418, SyncAttempt 441-454, ProviderCircuitState 456-471, ProviderQuotaObservation 536-548, BackupRun 766-785, BackupVerificationReceipt 790-805), `packages/database/prisma/migrations/*` (guard trigger templates), `.github/workflows/ci.yml`, root `package.json`, `vitest.config.ts`, `pnpm-lock.yaml`
- `.planning/phases/09-degradation-alerting/09-CONTEXT.md` (locked D-01..D-13), `09-UI-SPEC.md` (approved UI contract)
- `.planning/REQUIREMENTS.md` §ALRT-01..04; `.planning/research/ARCHITECTURE.md:150-153,173,220`; `.planning/research/PITFALLS.md:58-74`; `.planning/research/STACK.md:55-63`

### Secondary (MEDIUM confidence)
- [CITED: docs.bullmq.io/api/interfaces/v3.QueueEventsListener.html] — `failed`/`retries-exhausted` event shapes; dedicated Redis connection; no Job instance in events
- [CITED: docs.nestjs.com/exception-filters] — `app.useGlobalFilters()` / `APP_FILTER`, base-filter delegation
- [CITED: redis.io/commands/incr] — `MULTI` INCR+EXPIRE window-counter pattern
- [CITED: docs.slack.dev/apis/web-api/rate-limits/] — incoming webhooks 1 msg/sec, 429 + `Retry-After`
- Research seam digests cached (`research-store` keys `0055a245…`, `667bbe68…`, `d5c33b50…`, `27297e1c…`, `0280365f…`) — provider `websearch`, confidence MEDIUM/LOW per `classify-confidence`

### Tertiary (LOW confidence)
- Webhook retry-loop specifics (backoff/jitter/timeout values) synthesized from community engineering posts — [ASSUMED], planner-tunable
- Discord numeric webhook bucket (~30/min) — community-observed, [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new dependencies; every version and integration point read from the repo this session
- Architecture: **HIGH** — locked decisions (D-01..D-13) + verified in-repo patterns; external API facts (QueueEvents/Nest/Redis) cited from official docs
- Pitfalls: **HIGH** for repo-derived pitfalls (trigger/allowlist/proxy/redaction), **MEDIUM** for channel behavior (unverified against a real endpoint)

**Research date:** 2026-11-07
**Valid until:** 30 days (stable stack; only webhook-target behavior is runtime-dependent)
