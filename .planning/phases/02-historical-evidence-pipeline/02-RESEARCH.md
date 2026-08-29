# Phase 2: Historical Evidence Pipeline - Research

**Researched:** 2026-08-29
**Domain:** bitemporal football evidence, resilient BullMQ ingestion, deterministic feature rebuilds
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Chronological Evidence Contract
- **D-01:** Every source observation records provider, endpoint, capture time, source update time when available, payload hash, and raw payload or an immutable raw reference. Normalized facts must remain traceable to the exact observation that produced them.
- **D-02:** As-of eligibility uses a dual-time rule: both the football event/effective time and the system's `observedAt` time must be at or before the requested cutoff. A later correction may improve current truth but cannot enter an earlier feature view. — **Reversibility:** one-way — changing temporal semantics after derived evidence is stored would invalidate historical features and require rebuilding every affected snapshot.
- **D-03:** Corrections append a new observation and version or supersede normalized fact state; they do not destructively rewrite evidence previously visible to an as-of query.
- **D-04:** Team features are deterministic pure calculations over an explicitly ordered eligible match set. Stable tie-breaking is kickoff, capture time, then canonical fixture ID.
- **D-05:** Five- and ten-match weighted form use the most recent eligible completed matches with recency weighting, actual sample size, and no padding. Missing matches remain missing rather than becoming zero.
- **D-06:** Elo, home/away strength, goal rates, rest days, and low-weight H2H share one cutoff-aware feature contract and return component values, sample counts, window boundaries, source timestamps, and limitation reasons.

#### Queue and Quota Priorities
- **D-07:** Scheduled and replay work uses explicit critical, standard, and optional lanes. Results and fixture continuity are critical; standings are standard; lineups, injuries, odds, and secondary statistics are optional and remain out of the Phase 2 live path.
- **D-08:** Job IDs are deterministic from provider, competition/season, endpoint, requested window, and logical run purpose. Retrying or replaying the same logical unit reuses its identity unless the operator explicitly starts a new revision.
- **D-09:** Provider budget policy reserves headroom for critical work. Optional or lower-priority work is rejected before provider construction or I/O when consuming it could starve critical fixture/result calls. — **Reversibility:** costly — changing priority semantics later affects queue topology, reservation accounting, operator controls, and historical incident interpretation.
- **D-10:** Every provider call continues to require an atomic durable reservation keyed by provider, provider-local reset date, endpoint class, and job identity. Reservation outcomes and quota state are operator-visible.
- **D-11:** Cache hits may avoid a provider call but cannot manufacture a reservation. Cache entries carry provider, capture time, expiry, and payload identity; PostgreSQL remains authoritative for durable facts and audit history.

#### Failure Recovery and Replay
- **D-12:** Automatic retries are bounded and use exponential backoff with jitter. Non-retryable validation/identity failures fail immediately; repeated transient failures enter a dead-letter state with correlation ID, classified reason, attempt history, and replay parameters.
- **D-13:** Circuit breakers are scoped by provider and endpoint family, expose closed/open/half-open state, and block new I/O before budget is spent while degraded state remains visible.
- **D-14:** A normalized fact and its provenance are committed atomically. Derived feature publication occurs only after the requested source window reaches a declared terminal state, so users never receive an unlabeled partial recomputation.
- **D-15:** Operator replay supports failed jobs and bounded historical windows, defaults to dry-run impact reporting, and preserves the original logical identity for idempotent reprocessing. A forced new revision must be explicit and auditable.
- **D-16:** Replay can repair current normalized truth and recompute derived features, but it cannot mutate immutable observations or any future prediction snapshot. Phase 2 must provide the deterministic rebuild contract consumed by later phases.

#### Team Evidence Experience
- **D-17:** The user-facing team evidence view leads with five- and ten-match summaries and a chronological match trace. It always shows the selected cutoff, timezone, sample size, freshness, provenance, and any limitation state beside the numbers they qualify.
- **D-18:** Users can choose or arrive from a fixture with a requested as-of instant; the server normalizes it to UTC and echoes the resolved instant. The UI never silently substitutes the current latest state for an invalid or unsupported cutoff.
- **D-19:** Weak or incomplete samples remain visible with explicit sample counts and limitation wording. Unsupported components are `null`/unavailable with a reason, never zero-filled or rolled into a misleading aggregate.
- **D-20:** Evidence details expose the inputs needed to reproduce each feature without presenting a forecast, betting recommendation, or future Phase 3 confidence score.

### the agent's Discretion
- Exact BullMQ queue names, concurrency values, retry counts, backoff constants, and circuit thresholds, provided they are configurable, bounded, tested, and preserve the priority and fail-closed contracts above.
- Exact form weighting curve, Elo starting value/K-factor, minimum sample labels, and H2H weight, provided all parameters are versioned and deterministic and research validates defensible defaults.
- Exact card/table styling and responsive layout within the established accessible fixture UI patterns.

### Deferred Ideas (OUT OF SCOPE)
- Forecast probabilities, immutable prediction snapshots, confidence composition, manual odds, and value gates — Phase 3.
- Settlement scoring, calibration, ROI/Yield, and rolling-origin backtests — Phase 4, consuming this phase's as-of contract.
- API-Football fallback, Europa/Conference League breadth, lineup/injury/odds enrichment, and TheSportsDB assistance — Phase 5.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIPE-01 | Synchronize upcoming fixtures, completed results, and standings through idempotent retryable jobs. | Three lanes, deterministic job keys, durable run ledger, transactional upsert/versioning. |
| PIPE-02 | Persist raw-source provenance and capture timestamps. | Immutable `SourceObservation` linked atomically to fact versions. |
| PIPE-03 | Reserve request budget atomically before every external call. | Extend the Phase 1 advisory-lock reservation and provider-local reset-day contract. |
| PIPE-04 | Preserve critical fixture/result headroom over optional work. | Durable policy allocation before queue/provider construction; BullMQ priority is scheduling only. |
| PIPE-05 | Bounded retry/backoff/circuit breaking and visible degradation. | Classified errors, exponential+jitter, endpoint-family circuit state, durable DLQ/run events. |
| PIPE-06 | Safe failed/historical replay without duplicates. | Dry-run plan, same logical identity by default, explicit revision, idempotency enforced in PostgreSQL. |
| PIPE-07 | Recent history plus five/ten weighted form at a cutoff. | Dual-time eligibility, stable ordering, no padding, actual samples and limitation reasons. |
| PIPE-08 | Chronological Elo/strength/goal/rest/H2H without future captures. | One pure `buildTeamEvidence(asOf, configVersion)` contract and chronological fold. |
</phase_requirements>

## Summary

Plan this phase around two independent durability planes. PostgreSQL owns observations, versioned normalized facts, job/run audit state, quota reservations, and published evidence builds; Redis/BullMQ owns delivery and coordination only. A BullMQ job ID prevents duplicate queued jobs only while the prior job remains retained, so database uniqueness and transactional write rules—not Redis—must guarantee replay safety. [CITED: https://docs.bullmq.io/guide/jobs/job-ids]

The key data-model decision is a bitemporal observation/fact split. Each raw observation is immutable and records `effectiveAt` (or event time) and `observedAt`; an as-of query requires both `<= cutoff`. Corrections add observations/fact versions. Evidence is calculated by pure functions from a query-produced, explicitly ordered eligible match sequence and published only after the requested ingestion window has a terminal completeness state. [VERIFIED: packages/database/prisma/schema.prisma:215-227] Existing provenance fields are verbatim: `provider`, `observedAt`, `sourceUpdatedAt`, `payloadHash`, `rawPayload`.

**Primary recommendation:** first extend the database and provider ports, then implement one reusable reservation-first ingestion runner and durable run ledger, then build/test the temporal query and pure feature engine, and only afterward expose replay and team-evidence API/UI.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scheduling/retries/lanes | Worker / Redis | Database | BullMQ delivers; PostgreSQL records authoritative run outcomes. |
| Provider quota/circuit gate | Worker/domain | Database | Decisions happen before provider creation/I/O; state must survive worker restarts. |
| Raw observations/fact versions | Database | Worker | Database enforces immutability, uniqueness, provenance linkage. |
| As-of eligibility and features | Domain | Database | SQL selects eligible facts; pure domain code orders/folds them. |
| Replay control | API/backend | Worker/database | Protected API creates audited replay plans; worker executes them. |
| Team evidence | API/backend | Browser/client | API echoes resolved cutoff and evidence receipt; UI renders qualified values. |

## Project Constraints (from AGENTS.md)

- Use pnpm workspaces/Turborepo, Next.js/React/TypeScript/Tailwind/TanStack Query/Recharts, NestJS, PostgreSQL/Prisma, and Redis/BullMQ.
- MVP data sources must remain free-tier with manual odds; track provider/date/endpoint request usage and protect API-Football daily allowance.
- Preserve canonical identities, provider external-reference tables, auditable matching, and immutable snapshots.
- Sync jobs must be idempotent, cached, retried with backoff, and circuit-protected.
- Backtests/features must prevent leakage and support probability-quality measurement.
- No automatic wagering, certainty claims, or hidden risk; retain region restrictions/disclosures.
- TypeScript is strict/ESM; PostgreSQL is authoritative; Redis is disposable coordination.
- No project skills were found under `.codex/skills` or `.agents/skills` this session.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bullmq` | 6.3.1 | Queue, worker, retry, priority, events | Official project and locked stack. [CITED: https://www.npmjs.com/package/bullmq] |
| Redis | existing 8.2.1 image | BullMQ coordination/cache | Already pinned in Compose. [VERIFIED: infra/docker-compose.yml] |
| Prisma ORM | existing 7.x project line | Transactions, migrations, typed persistence | Existing schema/client boundary; use SQL migration for advanced indexes. |
| PostgreSQL | existing 18.6 image | Observations, fact versions, job/audit truth | Transactional invariants and chronological queries. [VERIFIED: infra/docker-compose.yml] |
| `cockatiel` | project-pinned compatible 3.x | Circuit breaker and policy events | AGENTS stack locks Cockatiel 3.x; do not silently adopt current 4.0.0. [CITED: https://github.com/connor4312/cockatiel] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ioredis` | BullMQ-compatible line | Explicit shared Redis connections | Only if BullMQ adapter/bootstrap requires direct client ownership; BullMQ duplicates blocking worker connections. [CITED: https://docs.bullmq.io/guide/connections] |
| Vitest | existing 4.1.11 | Pure feature/unit and integration tests | Fast deterministic unit tests and PostgreSQL/Redis integration. [VERIFIED: package.json] |
| Playwright | existing 1.62.1 | Evidence UI/cutoff E2E | Validate trace, limitations, UTC echo, keyboard/mobile behavior. [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| BullMQ priorities | Three physical queues | Use physical `critical`, `standard`, `optional` queues: it gives independent concurrency/pause/rate controls and avoids optional backlog competing with critical work. This is the prescribed topology. |
| Persisted feature builds | Compute every request | Compute-on-read is useful internally, but a published build record is required to prevent partial recomputation and to supply reproducible receipts. |
| Current mutable fact row only | Append-only fact versions | Current-only rows cannot answer historical knowledge-time queries after corrections. Use versions plus optional current projection. |

**Installation:**
```bash
pnpm --filter @bet-stats/data-sync add bullmq@6 cockatiel@3
```

## Package Legitimacy Audit

| Package | Registry | Age/Downloads | Source Repo | Verdict | Disposition |
|---------|----------|---------------|-------------|---------|-------------|
| `bullmq` | npm | 7.1M/wk; latest published ~2 days before research | github.com/taskforcesh/bullmq | SUS (`too-new`) | Flagged — planner must add `checkpoint:human-verify` before install. |
| `ioredis` | npm | 26.7M/wk; current 6.0.0 | github.com/redis/ioredis | SUS (`too-new`) | Do not add directly unless required; checkpoint if installed. |
| `cockatiel` | npm | 2.0M/wk; current 4.0.0 | github.com/connor4312/cockatiel | OK | Approved, but project constraint requires compatible 3.x. |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `bullmq`, `ioredis`; registry checks found no postinstall scripts, but the seam flagged newest releases as too new.

## Architecture Patterns

### System Architecture Diagram

```text
Scheduler / protected replay request
              |
              v
 durable ReplayPlan + SyncRun (dry-run first) ----> operator impact report
              |
              v
 critical | standard | optional BullMQ lanes
              |
              v
 capability -> circuit state -> budget/headroom reservation -> cache?
       deny ----|       open ----|        deny ----------------|
              provider I/O (only after all gates)
                       |
                       v
 immutable SourceObservation -> normalize/identity validate
                       |                 |
                       |                 +--> non-retryable failure/DLQ ledger
                       v
 transaction: FactVersion + provenance link + run progress
                       |
             source window terminal?
                 no ---+--- yes
                              v
                   as-of query (effectiveAt <= cutoff AND observedAt <= cutoff)
                              v
              stable ordered matches -> pure feature fold
                              v
                 atomic EvidenceBuild publication
                              v
                 API receipt -> team evidence UI
```

### Recommended Project Structure
```text
workers/data-sync/src/
├── queues/             # lane names/options and connection ownership
├── jobs/               # fixtures, results, standings, evidence rebuild
├── ingestion/          # shared gate/fetch/persist runner
├── resilience/         # error classifier and circuit registry
└── replay/             # dry-run planner and bounded fan-out
packages/domain/src/evidence/
├── contract.ts         # cutoff/config/limitations/receipt types
├── eligibility.ts      # dual-time predicate model and ordering
├── form.ts             # 5/10 weighted form
├── elo.ts              # chronological fold
└── features.ts         # strength/goals/rest/H2H composition
apps/api/src/modules/evidence/      # cutoff-aware read + protected replay
apps/web/app/teams/[teamId]/evidence/ # summaries and match trace
```

### Pattern 1: Database-enforced idempotent consumer

Use a deterministic logical key in both BullMQ and `SyncRun`, but enforce durable uniqueness per fact/version and observation payload in PostgreSQL. Retain completed/failed BullMQ jobs long enough for operations, yet never rely on retention for correctness: official docs say a removed job ID can be added again. [CITED: https://docs.bullmq.io/guide/jobs/job-ids]

### Pattern 2: One reservation-first ingestion template

The order is capability → circuit → budget/headroom reservation → cache/provider. The existing source already places construction after durable reservation. [VERIFIED: workers/data-sync/src/jobs/fixtures.ts:24-48] Verbatim statuses returned by that job are `"denied"` and `"completed"`; reservation reasons include `"ALLOWANCE_EXHAUSTED"`. Do not reserve for a cache hit; do persist cache identity/capture metadata.

### Pattern 3: Dual-time latest-visible version

Query only completed football events whose `effectiveAt <= cutoff` and observation `observedAt <= cutoff`; within each logical fact choose the latest eligible version using deterministic ordering. Then sort matches by kickoff, selected observation time, fixture ID before all feature folds. PostgreSQL window functions support ordered row ranking. [CITED: https://www.postgresql.org/docs/current/functions-window.html]

### Pattern 4: Staged evidence build publication

Create `EvidenceBuild` in a non-public building state tied to source-window/run IDs and config version; calculate into child components; in one transaction mark it published only when all required jobs are terminal. API reads published builds or returns an explicit pending/partial limitation—not half-updated components.

### Anti-Patterns to Avoid
- **BullMQ ID as the only idempotency key:** job removal defeats deduplication.
- **Single priority number as quota policy:** BullMQ priority schedules work but cannot enforce durable provider headroom.
- **Reserve before checking cache:** wastes allowance audit entries; check cache after policy authorization but before creating a reservation/provider call.
- **Mutable result rows without versions:** corrections leak backward into historical features.
- **Elo ordered only by kickoff:** equal timestamps make replay nondeterministic; apply the locked three-part tie-break.
- **Recompute-and-overwrite:** publish versioned evidence builds and preserve source/config receipts.
- **Retry every error:** identity/validation failures require intervention and immediate classified failure.

## Data Model Recommendations

Use these conceptual tables (exact Prisma enum names remain planner discretion and therefore `[ASSUMED]` until defined):

| Model | Essential fields/invariants |
|-------|-----------------------------|
| `SourceObservation` | provider, endpoint family, external identity/window, `observedAt`, optional `sourceUpdatedAt`, payload hash, JSON/reference; unique provider+endpoint+payload hash; immutable. |
| `FixtureFactVersion` / `ResultVersion` | fixture, effective/event time, status/score, observation FK, revision/supersession, valid/current projection; append-only versions. |
| `StandingSnapshot` + rows | league/season, effective date, observation FK, complete snapshot identity; never merge rows across captures. |
| `SyncRun` / `SyncAttempt` | logical key, revision, lane, window, state, correlation ID, attempts, classified reason, terminal timestamp, parent replay plan. |
| `ProviderCircuitState` | provider+endpoint family, state, opened/next-probe times, counters, last error; durable visibility even if runtime breaker is in memory. |
| `ReplayPlan` | requested range, purpose, dry-run impact, actor, forced revision flag, original keys, audit timestamps. |
| `EvidenceBuild` | team, cutoff, config version/hash, source window/run IDs, publication state, limitations, sample bounds. |
| `EvidenceComponent` | name, nullable value, sample count, window, source observation IDs/timestamps, limitation reason. |

Indexes must begin with the equality keys used by the query, then time: fixture/team + effective time + observed time; run state + lane; provider + endpoint + reset date. Validate plans with `EXPLAIN (ANALYZE, BUFFERS)` on realistic history before locking indexes. [ASSUMED]

## Feature Contract and Defensible Defaults

Return one receipt containing `teamId`, resolved UTC `asOf`, configuration version/hash, ordered match inputs, five/ten form, Elo, venue strengths, goal rates, rest days, H2H, samples/windows/source timestamps, and per-component limitations. Values unavailable because of insufficient evidence are `null`, never `0`.

Recommended initial parameters are explicitly provisional `[ASSUMED]`: exponential form decay `weight(ageIndex)=0.85^ageIndex`; Elo start 1500, K=20 with a configurable home adjustment; H2H contribution capped at 5% of any later combined score. These are not universal truths and must be versioned, tested for determinism, and confirmed during planning. Feature implementation should expose raw components rather than inventing a Phase 3 aggregate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Durable delivery/retries | Custom Redis lists/timers | BullMQ Worker/Queue/QueueEvents | Lock renewal, stalled jobs, retry state, priorities. |
| Circuit state machine | Ad-hoc counters/timeouts | Cockatiel circuit breaker plus durable projection | Open/half-open transitions and policy events are subtle. |
| Atomic fact/provenance writes | Compensating multi-step writes | Prisma interactive transaction/PostgreSQL constraints | Guarantees normalized fact and observation linkage commit together. [CITED: https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions] |
| Temporal feature joins | Application-side “latest” filtering | Explicit PostgreSQL as-of query/window ranking | Avoids transferring/leaking ineligible versions. |
| Queue quota as truth | BullMQ limiter only | Existing PostgreSQL reservation contract | Queue limiter is throughput control, not provider reset-day accounting. |

## Common Pitfalls

### Pitfall 1: Knowledge-time leakage
**What goes wrong:** A corrected score captured tomorrow changes yesterday's evidence.
**Avoid:** constrain both effective/event time and observation time, and test with deliberately late corrections.
**Warning:** current view and historical cutoff return the same corrected row despite a post-cutoff `observedAt`.

### Pitfall 2: Retry multiplied across layers
**What goes wrong:** HTTP retry × Cockatiel retry × BullMQ attempts explodes calls/budget.
**Avoid:** use one bounded call attempt per reserved job attempt; circuit breaker blocks calls, BullMQ owns delayed retries. Record whether reservation reuse is valid for the same logical call.

### Pitfall 3: Circuit checked after reservation
**What goes wrong:** open circuits consume headroom although no I/O occurs.
**Avoid:** check provider/endpoint circuit before durable request reservation; a half-open probe must be concurrency-limited.

### Pitfall 4: Replay fan-out without bounds
**What goes wrong:** a season replay floods queues and starves scheduled continuity.
**Avoid:** dry-run counts/cost estimate, explicit date bounds, per-lane concurrency, and chunked windows; replay remains below scheduled critical work.

### Pitfall 5: Partial standings treated as a full table
**What goes wrong:** rows from captures are merged into a fictitious snapshot.
**Avoid:** version standings as capture-level snapshots with completeness metadata and atomic row publication.

### Pitfall 6: Stalled job assumed failed once
**What goes wrong:** BullMQ may reprocess stalled work; side effects duplicate.
**Avoid:** database idempotency and short transactional writes; configure/observe `maxStalledCount`. Official docs include exhausted stalled jobs among failures. [CITED: https://docs.bullmq.io/guide/retrying-failing-jobs]

## Code Examples

### Deterministic queue identity and bounded retry
```typescript
// Source: https://docs.bullmq.io/guide/jobs/job-ids and /retrying-failing-jobs
await criticalQueue.add("sync-results", payload, {
  jobId: deterministicId.replaceAll(":", "_"),
  attempts: config.maxAttempts,
  backoff: { type: "exponential", delay: config.retrySeedMs, jitter: config.retryJitter },
  removeOnComplete: false,
  removeOnFail: false,
});
```
BullMQ forbids `:` in custom IDs and numeric-only IDs; retention is operationally important because removed jobs no longer deduplicate. [CITED: https://docs.bullmq.io/guide/jobs/job-ids]

### Temporal eligibility boundary
```typescript
// Project contract; exact table/field identifiers are [ASSUMED] until schema migration defines them.
type EvidenceInput = {
  effectiveAt: Date;
  observedAt: Date;
  fixtureId: string;
};

const eligible = rows
  .filter((row) => row.effectiveAt <= cutoff && row.observedAt <= cutoff)
  .sort((a, b) =>
    a.effectiveAt.getTime() - b.effectiveAt.getTime() ||
    a.observedAt.getTime() - b.observedAt.getTime() ||
    a.fixtureId.localeCompare(b.fixtureId),
  );
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| BullMQ auto-increment IDs | Domain-derived custom job IDs plus database idempotency | Queue duplicate suppression becomes predictable but not authoritative. |
| Immediate retry | Built-in exponential backoff with configurable jitter | Reduces synchronized retry storms. [CITED: https://docs.bullmq.io/guide/retrying-failing-jobs] |
| “Latest row” analytics | Dual effective/observed-time latest-visible versions | Historical evidence remains reproducible after corrections. |
| Queue rate limiter as API quota | Durable provider-reset-day reservation plus lane headroom | Quota policy survives Redis loss and is auditable. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Proposed new model/table and enum names. | Data Model | Prisma implementation mismatch; planner must name explicitly after schema design. |
| A2 | Composite index ordering will suit production cardinalities. | Data Model | Query performance; validate with EXPLAIN and representative seed volume. |
| A3 | Form decay 0.85, Elo 1500/K20, H2H cap 5%. | Feature Defaults | Model behavior; must be treated as versioned configuration, not locked science. |
| A4 | Three physical BullMQ queues are preferable to one priority queue. | Architecture | Operational topology; locked lane semantics remain satisfied either way. |

## Open Questions

1. **Provider-local reset semantics and allowance values**
   - Known: reservation is keyed by provider-local reset date and endpoint class.
   - Unclear: football-data.org headers/reset timezone and endpoint costs under actual credentials.
   - Recommendation: define provider policy config and a contract test with captured headers; fail closed when reset metadata is unknown.
2. **Historical source coverage**
   - Known: Phase 2 requires results and standings for the initial supported competition.
   - Unclear: exact free-tier historical depth and whether standings expose source update timestamps.
   - Recommendation: add a capability/coverage probe and persist “source update unavailable” explicitly.
3. **Retention of raw payloads**
   - Known: raw payload or immutable reference is required.
   - Unclear: inline JSON retention horizon/size threshold.
   - Recommendation: inline JSON for MVP with size metrics; do not introduce object storage without measured need.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | all TS processes | ✓, wrong project major | 25.2.1 | Use Corepack/dev image pinned to required Node 24. |
| pnpm | workspace | ✓ | 10.34.5 | — |
| Docker | PostgreSQL/Redis integration | ✓ | 29.7.2 | Local installed services if configured. |
| PostgreSQL image | durable integration | configured | 18.6-alpine | — |
| Redis image | BullMQ integration | configured | 8.2.1-alpine | — |

**Missing dependencies with no fallback:** BullMQ and Cockatiel are not yet worker dependencies; plan must add them after package checkpoint.
**Missing dependencies with fallback:** Node 24 is not the active shell runtime; execution can use an approved pinned runtime/container.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 + Playwright 1.62.1 |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `pnpm test -- --runInBand` (or targeted `pnpm exec vitest run <file>`) |
| Full suite command | `pnpm test && pnpm test:integration && pnpm typecheck && pnpm test:e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-01 | jobs synchronize and rerun safely | Redis/Postgres integration | `pnpm exec vitest run tests/integration/pipeline-jobs.test.ts` | ❌ Wave 0 |
| PIPE-02 | observation/fact atomic provenance | migration/integration | `pnpm exec vitest run tests/integration/temporal-provenance.test.ts` | ❌ Wave 0 |
| PIPE-03 | reservation precedes every provider call | integration/spy | `pnpm exec vitest run tests/integration/provider-budget-order.test.ts` | ❌ Wave 0 |
| PIPE-04 | headroom rejects lower lanes | domain+integration | `pnpm exec vitest run tests/integration/quota-priority.test.ts` | ❌ Wave 0 |
| PIPE-05 | retries, DLQ, circuit visibility | fake-clock integration | `pnpm exec vitest run tests/integration/provider-resilience.test.ts` | ❌ Wave 0 |
| PIPE-06 | dry-run/replay/revision idempotency | integration | `pnpm exec vitest run tests/integration/replay.test.ts` | ❌ Wave 0 |
| PIPE-07 | as-of form and trace | unit/API/E2E | `pnpm exec vitest run tests/unit/form.test.ts tests/integration/evidence-api.test.ts` | ❌ Wave 0 |
| PIPE-08 | leakage-safe chronological features | property/unit | `pnpm exec vitest run tests/unit/chronological-features.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted Vitest file(s), under 30 seconds.
- **Per wave merge:** `pnpm test && pnpm test:integration && pnpm typecheck`.
- **Phase gate:** full suite plus evidence/replay Playwright journey and migration from empty database.

### Wave 0 Gaps
- [ ] Add Redis-backed integration harness with unique queue prefix and deterministic teardown.
- [ ] Add time builders for pre/post-cutoff corrections, equal-kickoff tie cases, DST/UTC and missing source timestamps.
- [ ] Add provider spy that throws classified 4xx validation, 429, timeout, 5xx, and open-circuit failures.
- [ ] Add property tests: replay twice produces same facts/build; adding post-cutoff observation cannot alter prior evidence; shuffled input yields identical output.
- [ ] Add migration test and representative-volume query-plan fixture.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes for operator replay | Existing operator authentication/guard; deny by default. |
| V3 Session Management | yes for operator API | Existing server-side session/token policy; no credentials in job payloads. |
| V4 Access Control | yes | Separate protected replay/status endpoints; server derives actor and allowed scope. |
| V5 Input Validation | yes | Validate provider payloads and replay ranges at boundaries; reject unbounded or invalid cutoffs. |
| V6 Cryptography | limited | TLS outbound; platform hashing for payload identity, not password/security decisions. |
| V7 Error/Logging | yes | Correlation IDs, classified reasons, redaction; no secrets/raw auth headers in job data or logs. |
| V13 API/Web Service | yes | Allowlisted provider base URL; fixed endpoint construction to reduce SSRF risk. |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized replay/resource exhaustion | Elevation/DoS | Operator guard, bounded windows, dry-run, audit actor, rate limits. |
| Job payload tampering | Tampering | Runtime schema validation; server-derived provider/queue/policy; database constraints. |
| SSRF through provider/replay parameters | Spoofing/Information disclosure | Provider clients own fixed allowlisted origins; never accept arbitrary URLs. |
| Secrets/raw payload leakage | Information disclosure | Redacted structured logs, restricted operator views, no headers/tokens in payloads. |
| Duplicate or reordered evidence | Tampering/Repudiation | Transactional uniqueness, immutable observations, stable ordering, run/correlation history. |

[CITED: https://owasp.org/www-project-application-security-verification-standard/]

## Sources

### Primary / authoritative
- https://docs.bullmq.io/guide/jobs/job-ids — custom ID scope, syntax, retention caveat.
- https://docs.bullmq.io/guide/retrying-failing-jobs — bounded attempts, backoff, jitter, stalled failures.
- https://docs.bullmq.io/guide/jobs/prioritized — priority scheduling.
- https://docs.bullmq.io/guide/jobs/deduplication — queue dedup modes.
- https://docs.bullmq.io/guide/rate-limiting — queue limiter semantics.
- https://docs.bullmq.io/guide/connections — connection reuse and blocking connections.
- https://github.com/connor4312/cockatiel — circuit breaker reuse, half-open behavior, serialized state/events.
- https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions — transactions/isolation.
- https://www.postgresql.org/docs/current/functions-window.html — ordered window functions.
- https://www.postgresql.org/docs/current/explicit-locking.html — transaction advisory locks.
- https://owasp.org/www-project-application-security-verification-standard/ — ASVS 5.0 controls.

### In-repo verified
- `packages/database/prisma/schema.prisma:91-101` — existing durable reservation key/index.
- `packages/database/prisma/schema.prisma:215-227` — existing observation/provenance fields.
- `workers/data-sync/src/jobs/fixtures.ts:24-48` — capability/reservation before provider construction.
- `workers/data-sync/src/jobs/fixtures.ts:51-92` — advisory-lock transactional fixture/provenance persistence.
- `packages/domain/src/request-budget.ts:10-40` — atomic allowance and reused reservation contract.
- `packages/football-data/src/provider.interface.ts:1-20` — current provider DTO/port values.

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — official docs/current registry checked, but latest BullMQ/ioredis releases were flagged SUS and project pins Cockatiel 3.x.
- Architecture: HIGH — locked context plus inspected Phase 1 source and database constraints.
- Temporal schema/features: MEDIUM-HIGH — dual-time semantics locked; exact schema/index and numeric defaults remain to validate.
- Pitfalls/security: MEDIUM-HIGH — official BullMQ/PostgreSQL/Prisma/OWASP guidance cross-checked.

**Research date:** 2026-08-29
**Valid until:** 2026-09-05 for package versions; temporal/architecture conclusions remain valid until context changes.
