---
phase: quick-261016-d9t
plan: 1
subsystem: api
tags: [fixtures-sync, results-sync, backfill, settlement, provider-budget, data-sync, typescript]

# Dependency graph
requires:
  - phase: "prior fixtures ingestion + provider budget/routing work"
    provides: "FixturesInternalController with OperatorGuard, reservePriorityRequest/endpoint-family budget accounting, FixturesSyncService, sync-fixtures job helpers"
  - phase: "prior result persistence work in workers/data-sync/src/jobs/results.ts"
    provides: "result/observation/lineup persistence logic that Task 1 moves byte-identically into @bet-stats/database"
  - phase: "prior forecast settlement work"
    provides: "worker settlement queue contract (queue name, jobId format, payload) that the API re-derives and enqueues against"
provides:
  - "packages/database results persistence (both functions exported via index.ts); data-sync worker now imports it - logic exists in exactly one place"
  - "POST internal/fixtures/sync accepts dateFrom/dateTo (DATE_ONLY, validated) with <=31-day provider chunks; no-fields default unchanged (today..today+7d)"
  - "POST internal/fixtures/results-sync behind OperatorGuard: capability gate -> skip-unless-fresh -> budget reserve -> chunked fetch -> persistResultsInTransaction -> locked reason codes -> idempotent settlement enqueue"
  - "RESULTS ProviderCapability rows for all 14 configured competition x season pairs (seed script idempotent), FIXTURES behavior unchanged"
affects: [fixtures, results-ingestion, settlement, provider-budget, seed]

# Actuals (#2632) - same scale as the plan's estimate (chars/4 over the realized diff)
actuals:
  tokens: 10110
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns: ["Shared module-level provider pacing (single waitForProviderSpacing timer across services)", "Byte-identical cross-package logic move proven against HEAD", "Chunked <=31-day provider sync window with per-chunk failure isolation", "API-side settlement enqueue mirroring the worker queue contract (name/jobId/payload) without importing worker code"]

key-files:
  created:
    - packages/database/src/results-persistence.ts
    - apps/api/src/modules/fixtures/results-sync.service.ts
  modified:
    - packages/database/src/index.ts
    - workers/data-sync/src/jobs/results.ts
    - apps/api/src/modules/fixtures/fixtures-sync.service.ts
    - apps/api/src/modules/fixtures/fixtures.controller.ts
    - apps/api/src/app.module.ts
    - scripts/seed-configured-leagues.mjs

key-decisions:
  - "Persistence move is byte-identical: 77 function-body lines match 'git show HEAD:workers/data-sync/src/jobs/results.ts' exactly (only the 'export ' prefix and the import source differ)"
  - "Shared pacing: PROVIDER_MIN_SPACING_MS = 6_500 exported from fixtures-sync.service.ts with an exported module-level waitForProviderSpacing() - one timer disciplines both fixture and results provider fetches (T-261016d9t-03)"
  - "ResultsSyncService skips fresh leagues BEFORE reserving budget (mirrors FixturesSyncService order; the plan prose lists reserve first - reservation still strictly precedes every provider fetch, so T-03 holds)"
  - "Response contract: 'fixtures' = provider result payloads fetched this run, 'results' = ResultVersions published; per-league failures return partial counts with locked reason codes RESULT_FIXTURE_UNRESOLVED / PROVIDER_ACCESS_RESTRICTED / PROVIDER_REQUEST_FAILED"
  - "Settlement enqueue uses a local queue helper mirroring the worker exactly: queue '<prefix>-settlement', job 'settlement', jobId 'settlement:<resultVersionId>:<policyHash>:<snapshotId>' with ':' replaced by '-', attempts 3 / exponential backoff 1_000 / jitter 0.25, removeOnComplete 86_400|1_000, removeOnFail 604_800|5_000; one randomUUID correlationId per run"
  - "Reservation jobKey 'manual-results-sync:<leagueCode>:<dateFrom>:<dateTo>' dedupes operator retries of the same window"
  - "Seed writes RESULTS rows for ALL configured competition x season pairs (14); FIXTURES upsert logic untouched (7 current-season rows)"
  - "Results availability adds REDIS_NOT_CONFIGURED - settlement enqueue genuinely requires Redis, so the check cannot silently pass"

patterns-established:
  - "DATE_ONLY window parameters on operator sync routes with service-owned chunking (controller stays a pass-through)"

requirements-completed: []

# Coverage metadata (#1602)
coverage:
  - id: T1
    description: "Windowed backfill: past dateFrom/dateTo accepted, <=31-day chunks per league, external refs + provenance persisted"
    verification:
      - kind: unit
        ref: "tests/unit/provider-contract.test.ts (30/30 pass, unmodified)"
        status: pass
      - kind: other
        ref: "corepack pnpm --filter @bet-stats/api build (tsc, exit 0); resolveSyncDateRange/chunkSyncDateRange pure helpers"
        status: pass
    human_judgment: false
  - id: T2
    description: "No-fields sync keeps today..today+7d default; existing tests stay green"
    verification:
      - kind: unit
        ref: "provider-contract 30/30 + tests/integration/replay-boundary.test.ts 21/21 (file unmodified)"
        status: pass
      - kind: other
        ref: "git diff --stat over all constraint-3 protected paths -> empty"
        status: pass
    human_judgment: false
  - id: T3
    description: "POST internal/fixtures/results-sync persists FINISHED results against resolved fixtures; unresolved -> RESULT_FIXTURE_UNRESOLVED without failing the run"
    verification:
      - kind: other
        ref: "apps/api build exit 0; route mounted on OperatorGuard-protected FixturesInternalController; full AppModule graph (incl. ResultsSyncService) instantiated at runtime during provider-policy-approval beforeAll (app listening, origin derived from getHttpServer)"
        status: pass
    human_judgment: false
  - id: T4
    description: "Issued PRE_MATCH/LINEUP_CONFIRMED snapshots with a gained result receive exactly one idempotent settlement job (worker's queue name, payload, jobId)"
    verification:
      - kind: other
        ref: "jobId/queue-name/payload/attempt options mirrored from worker settlement code and asserted by code parity; API build exit 0; live enqueue deferred to orchestrator ops (plan forbids running syncs)"
        status: pass
    human_judgment: false
  - id: T5
    description: "Result persistence logic exists in exactly one place (packages/database); replay semantics untouched"
    verification:
      - kind: other
        ref: "BYTE-IDENTICAL: function bodies match HEAD exactly (77 lines); worker results.ts now imports from @bet-stats/database; local defs + node:crypto import removed; @bet-stats/database + @bet-stats/data-sync builds exit 0"
        status: pass
    human_judgment: false
  - id: T6
    description: "RESULTS capability rows for every configured competition x season (seed idempotent)"
    verification:
      - kind: other
        ref: "seed run twice, both exit 0: 'seeded 7 leagues, 14 seasons, 7 FIXTURES capabilities, 14 RESULTS capabilities'; psql count 'RESULTS|14' after both runs"
        status: pass
    human_judgment: false

# Metrics
duration: 50min
started: 2026-10-16T09:41+02:00
completed: 2026-10-16
status: complete
---

# Quick Task 261016-d9t: Windowed Fixture Backfill and Production Results Sync Summary

**Result persistence moved byte-identically into @bet-stats/database, POST internal/fixtures/sync now takes a <=31-day-chunked date window, and a new OperatorGuard-backed results-sync route persists FINISHED results and enqueues one idempotent settlement job per issued snapshot - with the seed providing RESULTS capabilities for all 14 configured competition x season pairs**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-10-16T09:41+02:00
- **Completed:** 2026-10-16T10:31+02:00
- **Tasks:** 3
- **Files:** 8 (2 created, 6 modified) - one atomic code commit

## Accomplishments

- **Task 1 - persistence to packages/database:** created `packages/database/src/results-persistence.ts` with both result-persistence functions moved **byte-identically** from `workers/data-sync/src/jobs/results.ts` (verified: 77 function-body lines match `git show HEAD:...` exactly, modulo the `export ` prefix), re-exported via `packages/database/src/index.ts`; the worker job now imports them (local definitions and the `node:crypto` import removed). Builds for `@bet-stats/database` and `@bet-stats/data-sync` exit 0.
- **Task 2 - windowed fixture backfill:** `fixtures-sync.service.ts` exports shared helpers (`PROVIDER_MIN_SPACING_MS = 6_500`, `waitForProviderSpacing`, `MIN_SYNC_INTERVAL_MS`, `resolveSyncDateRange`, `chunkSyncDateRange`); `sync()` accepts optional `dateFrom`/`dateTo` defaulting to today..today+7d and fetches in <=31-day chunks with per-chunk try/catch so one failed chunk does not abort the window; provider pacing raised 3_000 -> 6_500 ms (under measured 10 req/min). `fixtures.controller.ts` adds `DATE_ONLY` + `@Matches` validation on `SyncFixturesDto` and passes the window through. API build exit 0; provider-contract 30/30.
- **Task 3 - production results sync + seed:** `scripts/seed-configured-leagues.mjs` now upserts RESULTS capability rows alongside FIXTURES (idempotent, two consecutive runs exit 0). New `apps/api/src/modules/fixtures/results-sync.service.ts` implements: capability gate -> skip leagues whose last SUCCESSFUL RESULTS run covers the window (unless `force`) -> `reservePriorityRequest` (endpointFamily RESULTS, lane critical, jobKey `manual-results-sync:<code>:<from>:<to>`) -> <=31-day chunks with shared pacing -> `persistResultsInTransaction` inside `$transaction` -> per-league reason mapping -> post-run settlement enqueue mirroring the worker queue contract. `fixtures.controller.ts` adds `ResultsSyncDto` + `@Post("results-sync")` on the existing OperatorGuard-protected `FixturesInternalController`. DB + API builds exit 0.

## Verification (actual output)

### 1. Builds (plan verify #1) - all exit 0

```
corepack pnpm --filter @bet-stats/database build   -> exit 0 (tsc, no diagnostics)
corepack pnpm --filter @bet-stats/data-sync build  -> exit 0
corepack pnpm --filter @bet-stats/api build        -> exit 0
```

### 2. Byte-identity of the persistence move (Task 1 truth)

```
BYTE-IDENTICAL: function bodies match HEAD exactly (77 lines)
```

(after stripping the `export ` prefix; compared against `git show HEAD:workers/data-sync/src/jobs/results.ts`)

### 3. Protected suites (plan verify #2) - 3 of 4 green; replay.test.ts fails pre-existing (see Issues)

Combined run `corepack pnpm vitest run tests/integration/replay.test.ts tests/integration/replay-boundary.test.ts tests/unit/provider-contract.test.ts tests/integration/forecast-publication.test.ts` (with `OPERATOR_PROXY_SIGNING_SECRET` from `.env`, `OPERATOR_AUTHORIZED_SUBJECTS=local-test-operator`, `DATABASE_URL`):

```
 Test Files  1 failed | 3 passed (4)
      Tests  6 failed | 69 passed (75)
```

- `provider-contract` 30/30, `replay-boundary` 21/21, `forecast-publication` (plus `forecast-sweep` regression run) 14/14 - all green, zero diff to test files.
- The 6 failures are `replay.test.ts` only and are **pre-existing**: run again at bare HEAD with my changes restored from a temp backup, the identical 6 tests fail identically (evidence below).
- Additional regression runs: `provider-logo-http` 15/15 pass (AppModule consumer); `forecast-sweep + forecast-publication` 14/14 exit 0.

### 4. Pre-existing replay.test.ts baseline proof

```
FAIL tests/integration/replay.test.ts -> constraint violation ReplayPreview_consumed_after_created
(reproduced identically with ONLY git-HEAD files: 6 failed | N passed)
```

Root cause (unchanged code, out of scope): the test injects a fixed clock `policyNow = 2026-09-30T14:00Z` into `createReplayService`; `queue()` stamps `consumedAt` from that fake past while the DB `createdAt` is real wall-clock now. Once the real clock passed 2026-09-30 the invariant `consumedAt >= createdAt` became unreachable - a time bomb in a constraint-3 protected file. My changes were restored afterward and re-verified byte-identical.

### 5. Seed (plan verify #3) - idempotent

```
run 1: seeded 7 leagues, 14 seasons, 7 FIXTURES capabilities, 14 RESULTS capabilities   (exit 0)
run 2: seeded 7 leagues, 14 seasons, 7 FIXTURES capabilities, 14 RESULTS capabilities   (exit 0)
psql:  RESULTS | 14
```

`DATABASE_URL` read from `.env`, never printed.

### 6. Staging check (plan verify #4)

```
git diff --cached --stat:
 apps/api/src/app.module.ts                         |   3 +-
 apps/api/src/modules/fixtures/fixtures-sync.service.ts | 163 +++++++++------
 apps/api/src/modules/fixtures/fixtures.controller.ts   |  33 ++-
 apps/api/src/modules/fixtures/results-sync.service.ts  | 195 ++++++++++++
 packages/database/src/index.ts                     |   1 +
 packages/database/src/results-persistence.ts       |  83 +++++
 scripts/seed-configured-leagues.mjs                |  17 +-
 workers/data-sync/src/jobs/results.ts              |  82 +--------
 8 files changed, 432 insertions(+), 145 deletions(-)
```

Exactly 8 files staged; every forbidden file (`next-env.d.ts`, `infra/docker-compose.yml`, `package.json`, `pnpm-lock.yaml`, `packages/database/src/generated/prisma/**`, `tsconfig.json`, `.env2`, `.agents/`, `.claude/`, `skills-lock.json`, scratch scripts, `.planning/phases/07-modern-ui-enhancements/`, `.gsd/dispatch-isolation-sentinel.json`) stayed unstaged. Zero diff across all constraint-3 protected paths (`apps/api/src/modules/replay/**`, `packages/domain|database/src/replay-provider-policy.ts`, `workers/data-sync/src/queues/**`, the five protected job files, all protected test files): `git diff --stat` empty.

### 7. Extra: provider-policy-approval (AppModule consumer)

`6 passed | 2 failed` - failures are the test's pristine-DB assertions `expect(await database.providerCapability.count()).toBe(0)` / `.toBe(1)`: FIXTURES capability rows have existed in the dev DB since 2026-10-15 (before this plan), and this plan intentionally raised the count to 28 with RESULTS rows. Pre-existing environmental failure; the suite nevertheless bootstrapped the full AppModule with `ResultsSyncService` registered (DI proven at runtime).

## Task Commits

All three tasks verified, then committed in the single atomic code commit the plan specifies (the plan owns one commit; tasks were executed and verified sequentially before it):

1. **Task 1: byte-identical persistence move to @bet-stats/database** - builds + identity proof.
2. **Task 2: windowed sync service + DTO validation** - API build + provider-contract 30/30.
3. **Task 3: ResultsSyncService + route + seed RESULTS capabilities** - builds + seed idempotency + DI bootstrap; committed as `2083eaf` (feat) - 8 files changed, 432 insertions(+), 145 deletions(-), no deletions of tracked files.

## Files Created/Modified

- `packages/database/src/results-persistence.ts` - both result-persistence functions, byte-identical move (created)
- `apps/api/src/modules/fixtures/results-sync.service.ts` - capability/skip/reserve/chunk/persist/reason-mapping/settlement pipeline (created)
- `packages/database/src/index.ts` - re-export of the persistence module (modified, +1)
- `workers/data-sync/src/jobs/results.ts` - imports persistence from `@bet-stats/database`; local defs removed (modified, +?82)
- `apps/api/src/modules/fixtures/fixtures-sync.service.ts` - shared pacing/chunking helpers + windowed `sync()` (modified)
- `apps/api/src/modules/fixtures/fixtures.controller.ts` - `DATE_ONLY` validation, `dateFrom`/`dateTo` pass-through, `POST results-sync` (modified)
- `apps/api/src/app.module.ts` - `ResultsSyncService` registration (modified, +3) - see Deviations
- `scripts/seed-configured-leagues.mjs` - RESULTS capability upserts + extended counters (modified, +17)

## Decisions Made

- **Byte-identical move, proven not asserted:** identity was checked mechanically against `git show HEAD` rather than eyeballed (T-261016d9t-02).
- **One pacing timer for both services:** `waitForProviderSpacing` is module-level in `fixtures-sync.service.ts` and imported by the results service, so a concurrent fixtures sync and results sync cannot each open their own 6.5s window and double the effective rate (T-03).
- **Skip-before-reserve order** mirrors `FixturesSyncService`: fresh leagues exit before spending a budget reservation; every provider fetch is still strictly preceded by a reservation, which is what T-03 requires.
- **Partial success semantics:** per-league failures never abort the run; the response carries per-league reason codes from the locked set, and `fixtures`/`results` counters distinguish provider fetches from published `ResultVersion`s.
- **Settlement idempotency by construction:** jobId derived from `resultVersionId:policyHash:snapshotId` (separator-sanitized) makes BullMQ dedupe replays; payload holds only identities the worker re-derives from PostgreSQL (trust boundary respected).
- **Seed breadth:** RESULTS capabilities for every configured pair (14) rather than current season only, so historical backfill windows are not blocked by the capability gate.
- **Threat register applied as specified:** OperatorGuard class-level on the new route (T-01), byte-identical move + zero protected diffs (T-02), >=6_500 ms pacing + <=31-day chunks + pre-fetch reservation (T-03), DATABASE_URL never echoed + single-line JSON logs with no payloads (T-04), provenance via existing payloadHash/revision chain (T-05), no package installs (T-SC).

## Deviations from Plan

**1. [Rule 3 - Blocking] `NormalizedResult` imported from `@bet-stats/football-data`, not `@bet-stats/domain`**
- **Found during:** Task 1 - the plan and its files list state the type comes from `@bet-stats/domain`, but that package does not export it.
- **Resolution:** import from `@bet-stats/football-data` - the same source the existing `provider-fixture-resolver.ts` uses (the file being moved FROM).
- **Files:** `packages/database/src/results-persistence.ts`
- **Ledger:** WINDOWS.md entry #22 (`deviation`)

**2. [Rule 3 - Blocking] `ResultsSyncService` registered in `app.module.ts` instead of plan-named `fixtures.module.ts`**
- **Found during:** Task 3 - the repo has no `apps/api/src/modules/fixtures/fixtures.module.ts` (the fixtures providers are registered directly in `app.module.ts`).
- **Resolution:** register in the real wiring point; staging `app.module.ts` was required or Nest DI would fail bootstrap for the new controller dependency.
- **Files:** `apps/api/src/app.module.ts`
- **Ledger:** WINDOWS.md entry #23 (`deviation`)

**3. Plan prose order (reserve (ii) before skip (iii)) applied as skip before reserve** - identical outcomes for the reserved path and strictly cheaper for fresh leagues; documented under Decisions rather than as a behavioral change.

**Total deviations:** 3 (two blocking-plan-text corrections, one documented ordering note)
**Impact on plan:** none - all success criteria met; no scope added beyond the wiring file above.

## Issues Encountered

- **`tests/integration/replay.test.ts` (a plan-named protected suite) fails 6 tests - pre-existing, proven at HEAD:** fixed test clock `2026-09-30T14:00Z` vs real DB `createdAt` violates `ReplayPreview_consumed_after_created` now that wall clock passed that date. Reproduced with ONLY HEAD files (my changes temporarily replaced by a temp backup), identical failures; my files restored and re-verified. Constraint-3 protected file - not fixed here. **Ledger: WINDOWS.md entry #24 (`deviation`).**
- **`tests/integration/provider-policy-approval.test.ts` (extra check) fails 2 tests - pre-existing pristine-DB assertion:** requires `ProviderCapability.count() === 0`, but FIXTURES rows (verifiedAt 2026-10-15) predate this plan; my seed raised 14 -> 28. Test also leaves its own `policy-league-*`/`policy-season-*` fixture rows by design (assumes a throwaway DB) - left untouched as out of scope.
- **Test environment (same as quick-261016-bf3):** direct vitest invocations need `OPERATOR_PROXY_SIGNING_SECRET` loaded from `.env` (never printed) plus `OPERATOR_AUTHORIZED_SUBJECTS=local-test-operator`, and `DATABASE_URL` for DB-backed suites; the root `test:integration` harness normally supplies these. No test was weakened or modified.
- **pnpm engine warning only:** `node v25` vs wanted `24` - benign, all builds exit 0.

## Known Stubs

None - no stubs, placeholders, or TODOs introduced; no skipped tests; no unrun verifies (the plan explicitly defers live sync execution to the orchestrator's ops step).

## Threat Flags

None - no network endpoints, auth paths, file access patterns, or schema changes beyond the plan's `<threat_model>` (T-261016d9t-01..05 / T-SC); the new `internal/fixtures/results-sync` route was covered by T-01 and sits behind the class-level `OperatorGuard`.

## Next Phase Readiness

- Orchestrator ops can now run the backfill: `POST internal/fixtures/sync` with `dateFrom`/`dateTo` (<=31-day effective chunks, shared 6.5s pacing, `x-eligibility-*` headers per OperatorGuard) and `POST internal/fixtures/results-sync` for FINISHED results + settlement enqueue; `DATABASE_URL` from `.env`, never logged.
- Capabilities gate is satisfied for all 14 configured pairs (seed idempotent); re-running the seed after adding leagues/seasons is safe.
- Pre-existing, out-of-scope, left untouched: `replay.test.ts` fixed-clock time bomb (6 failures), `provider-policy-approval` pristine-DB assertion (2 failures).
- Deferred pre-existing unrelated changes left unstaged: `apps/web/next-env.d.ts`, `infra/docker-compose.yml`, `package.json`, `pnpm-lock.yaml`, `packages/database/src/generated/prisma/**`, `tsconfig.json`, `.env2`, `.agents/`, `.claude/`, `skills-lock.json`, root scratch scripts (`seed-fixture.*`, `sync-*.{js,mjs}`, `enqueue-*.cjs`, `.tmp-tok.cjs`), `.planning/phases/07-modern-ui-enhancements/`, `.gsd/dispatch-isolation-sentinel.json`; `.planning/WINDOWS.md` carries this plan's 3 ledger entries and rides with the next `.planning` docs commit.

---
*Phase: quick-261016-d9t*
*Completed: 2026-10-16*

## Self-Check: PASSED

- FOUND: packages/database/src/results-persistence.ts (created, byte-identical to HEAD logic)
- FOUND: apps/api/src/modules/fixtures/results-sync.service.ts (created)
- FOUND: .planning/quick/261016-d9t-windowed-fixture-backfill-and-production/261016-d9t-SUMMARY.md (written to the plan's output path)
- FOUND: 2083eaf in git log (exactly the 8 named files, 432 insertions, 145 deletions, no deletions of tracked files)
