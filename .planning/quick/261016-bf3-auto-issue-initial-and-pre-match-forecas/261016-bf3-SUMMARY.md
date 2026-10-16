---
phase: quick-261016-bf3
plan: 01
subsystem: worker
tags: [data-sync, forecast-sweep, evidence-rebuild, forecast-issuance, typescript]

# Dependency graph
requires:
  - phase: "05 (forecast publication planner + evidence rebuild helpers)"
    provides: "planForecastPublication / runForecastPublicationJob (jobs/forecasts.ts), runEvidenceRebuild (jobs/evidence-rebuild.ts), schedulePublishedFixtures (jobs/fixtures.ts)"
provides:
  - "Opt-in forecastSweep input on startReplayWorker: guarded 60s periodic sweep auto-issues INITIAL (kickoff-24h) and PRE_MATCH (kickoff-6h) forecasts from team-statistics evidence"
  - "ensureTeamEvidence: builds evidence at EXACTLY the forecast cutoff for either team, so the ForecastOrchestrator exact-equality gate passes"
  - "issueLineupForecast wrapper (flag-present only) ensures evidence at the exact cutoff before the unchanged orchestrator call"
affects: [forecast-issuance, enrichment, evidence]

# Actuals (#2632) — same scale as the plan's estimate (chars/4 over the realized diff)
actuals:
  tokens: 5493
  tasks: 3
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns: ["Opt-in background sweep: setTimeout first tick (5s) + setInterval with in-flight guard, timers cleared in close(); kickoff-anchored cutoffs so ticks never mint new cutoffs; evidence built at exactly the forecast cutoff via runEvidenceRebuild idempotency"]

key-files:
  created:
    - workers/data-sync/src/jobs/forecast-sweep.ts
    - tests/unit/forecast-sweep.test.ts
  modified:
    - workers/data-sync/src/main.ts

key-decisions:
  - "computeDueKinds/computeInitialCutoff are pure (ISO strings in/out) — INITIAL due at kickoff-24h, PRE_MATCH at kickoff-6h, ISSUED kinds excluded; initial cutoff = max(kickoff-24h, now) for late-discovered fixtures"
  - "main.ts extracts the original orchestrator invocation into issueLineupForecastBase (byte-identical body); the conditional wrapper only exists when input.forecastSweep is present, so all existing test callers keep today's behavior"
  - "Sweep queries only UUID-shaped fixture ids (excludes test artifacts like live-workbench-fixture-*) within the next 14 days; per-fixture try/catch logs forecast.sweep.fixture_failed and continues"
  - "ensureTeamEvidence prefers the latest SUCCEEDED RESULTS SyncRun, falls back to any SUCCEEDED run, else returns null and the tick defers (skipped counter) instead of crashing"

patterns-established:
  - "Periodic sweep scheduling with in-flight guard + tick_failed logging behind an opt-in input flag"

requirements-completed: []

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Due INITIAL/PRE_MATCH kinds computed purely from kickoff/now/issuedKinds, and INITIAL cutoff is max(kickoff-24h, now)"
    verification:
      - kind: unit
        ref: "tests/unit/forecast-sweep.test.ts (10 pure tests: boundaries at -24h/-6h, issued exclusion, late discovery, invalid kickoff, hash value)"
        status: pass
      - kind: other
        ref: "corepack pnpm --filter @bet-stats/data-sync build (tsc, exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Flag-absent callers (replay-boundary) stay byte-identical: no timers, issueLineupForecast body unchanged"
    verification:
      - kind: other
        ref: "corepack pnpm vitest run tests/integration/replay-boundary.test.ts (21/21 pass, file unmodified in git diff)"
        status: pass
      - kind: other
        ref: "git diff --stat on replay-boundary.test.ts, live-provider-stack.ts, forecasts.ts, evidence-rebuild.ts, fixtures.ts -> empty"
        status: pass
    human_judgment: false
  - id: D3
    description: "Planner contract untouched: forecast-publication integration suite green after new module"
    verification:
      - kind: other
        ref: "corepack pnpm vitest run tests/integration/forecast-publication.test.ts (part of 3-file run, all pass)"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
started: 2026-10-16T08:34+02:00
completed: 2026-10-16
status: complete
---

# Quick Task 261016-bf3: Auto-issue INITIAL and PRE_MATCH Forecasts Summary

**Data-sync worker now auto-issues INITIAL (kickoff−24h) and PRE_MATCH (kickoff−6h) forecasts from team-statistics evidence via an opt-in 60s sweep, and the LINEUP_CONFIRMED enrichment path ensures evidence at its exact cutoff — wired with zero diff to the existing planner/evidence/fixture helpers**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-10-16T08:34+02:00
- **Completed:** 2026-10-16T09:09+02:00
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Created `workers/data-sync/src/jobs/forecast-sweep.ts` exporting `runForecastPublicationSweep`, `ensureTeamEvidence`, `computeDueKinds`, `computeInitialCutoff`, `EVIDENCE_CONFIG_HASH` (sha256 of `evidence-v1`, computed with `node:crypto` — no new dependencies). The sweep queries the next 14 days of UUID-shaped fixtures, keeps enrichment scheduled via `schedulePublishedFixtures`, builds evidence at EXACTLY each due cutoff via `runEvidenceRebuild` (PENDING gate and idempotency live there), and issues only plan jobs whose kind is in the due set — `LINEUP_CONFIRMED` stays owned by the enrichment path.
- Wired `main.ts` four ways: optional `forecastSweep?: { intervalMs?: number }` on `startReplayWorker`; guarded first tick at 5s then `setInterval` (default 60_000) with in-flight skip, `forecast.sweep.tick_failed` logging, and timer cleanup in `close()`; `issueLineupForecast` wrapper (flag-present only) that fetches home/away team ids, awaits `ensureTeamEvidence` at the exact cutoff, logs `forecast.sweep.lineup_evidence_missing` when either is null and STILL calls the unchanged orchestrator; `start()` passes `forecastSweep: { intervalMs: 60_000 }`.
- Extracted the original orchestrator invocation into `issueLineupForecastBase` with a byte-identical body, so with the flag absent (every existing test caller) behavior is unchanged — proven by replay-boundary 21/21 passing against an unmodified test file.
- `git diff` confirms zero changes to `jobs/forecasts.ts`, `jobs/evidence-rebuild.ts`, `jobs/fixtures.ts`, `tests/integration/replay-boundary.test.ts`, `tests/integration/forecast-publication.test.ts`, `tests/e2e/live-provider-stack.ts`.

## Verification (actual output)

### 1. Task 1: `corepack pnpm vitest run tests/unit/forecast-sweep.test.ts tests/integration/forecast-publication.test.ts`

```
 Test Files  2 passed (2)
      Tests  14 passed (14)
```
(exit 0)

### 2. Task 2: `corepack pnpm vitest run tests/integration/replay-boundary.test.ts tests/unit/forecast-sweep.test.ts`

```
 Test Files  2 passed (2)
      Tests  31 passed (31)
   Duration  57.99s
```
(exit 0)

### 3. Task 3 full set: `corepack pnpm vitest run tests/unit/forecast-sweep.test.ts tests/integration/forecast-publication.test.ts tests/integration/replay-boundary.test.ts`

```
 Test Files  3 passed (3)
      Tests  35 passed (35)
   Start at  09:07:20
   Duration  61.77s (transform 4.42s, setup 0ms, import 10.64s, tests 49.72s, environment 1ms)
```
(exit 0)

### 4. `corepack pnpm --filter @bet-stats/data-sync build`

```
> @bet-stats/data-sync@0.0.0 build D:\Documents\Atom\bet-stats\workers\data-sync
> tsc -p tsconfig.json
```
(exit 0, no diagnostics — clean under `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`)

### 5. Staging check

```
git diff --cached --stat:
 tests/unit/forecast-sweep.test.ts            |  65 ++++++++++
 workers/data-sync/src/jobs/forecast-sweep.ts | 176 +++++++++++++++++++++++++++
 workers/data-sync/src/main.ts                |  34 +++++-
 3 files changed, 271 insertions(+), 4 deletions(-)
```
Exactly 3 files staged; `git show --stat HEAD` matches; `git diff --diff-filter=D HEAD~1 HEAD` → no deletions.

## Task Commits

Each task was verified, then committed atomically per the plan (Task 3 owns the single commit of all three named files):

1. **Task 1: forecast-sweep module + pure unit tests** — verified (14 tests + clean build), committed together with Task 2 in Task 3's atomic commit per plan spec.
2. **Task 2: main.ts opt-in wiring** — verified (31 tests + clean build), same commit.
3. **Task 3: full verification + atomic commit** — `42c0761` (feat) — 3 files changed, 271 insertions(+), 4 deletions(-)

## Files Created/Modified

- `workers/data-sync/src/jobs/forecast-sweep.ts` — new module: due-kind/cutoff pure helpers, `ensureTeamEvidence`, `runForecastPublicationSweep` (created)
- `tests/unit/forecast-sweep.test.ts` — 10 pure vitest tests, no database/timers (created)
- `workers/data-sync/src/main.ts` — optional `forecastSweep` input, guarded sweep timers, evidence-ensure wrapper around `issueLineupForecast`, `start()` enables the sweep (modified, +30/−4)

## Decisions Made

- **Kickoff-anchored cutoffs, not tick-anchored:** `computeDueKinds` derives due-ness from `kickoffUtc` vs `now`, so a minute-by-minute tick can never mint a new cutoff per tick (threat T-quick-bf3-02); `computeInitialCutoff = max(kickoff−24h, now)` handles late-discovered fixtures with freshly ingested statistics.
- **Evidence at exactly the cutoff:** `ensureTeamEvidence` passes the same cutoff string to `runEvidenceRebuild` that the orchestrator receives, satisfying the exact-equality gate; `LATEST_VISIBLE_RESULT_SQL` only exposes observations ≤ cutoff.
- **Defer, don't crash:** no SUCCEEDED SyncRun or evidence not yet PUBLISHED → `ensureTeamEvidence` returns null → the plan defers the kind → `skipped` counter → retried on a later tick.
- **Flag-gated wrapper:** the `issueLineupForecast` evidence-ensure wrapper and sweep timers exist only when `input.forecastSweep` is present; the extracted `issueLineupForecastBase` body is byte-identical to the previous inline lambda (T-quick-bf3-03: opt-in isolation).
- **Threat mitigations from the plan's register applied as specified:** exact-cutoff evidence (T-01), ISSUED-kind exclusion + idempotent publication identity (T-02), in-flight guard / per-fixture try-catch / timer cleanup (T-03), single-line JSON logging with no payloads (T-04), `sweep:` correlationIds (T-05); no package installs (T-SC).

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0
**Impact on plan:** none

## Issues Encountered

- **replay-boundary suite failed on first two runs for environment reasons only (no code impact):**
  1. Run 1: all 21 tests failed with `Error: OPERATOR_PROXY_SIGNING_SECRET must be supplied by the test process` — the test requires the secret in the process env and vitest does not auto-load `.env`. Fixed by exporting the value from `.env` (64 chars) in the run environment.
  2. Run 2: 20 failed with `expected 404 to be 201` / `{"message":"Not found"}` from the Next replay proxy — `verifyIngressReplayRequest` rejected because `.env` authorizes subject `bet-stats-operator` while the test signs as `local-test-operator`. `scripts/verify-release-integration.mjs` defaults `OPERATOR_AUTHORIZED_SUBJECTS` to `local-test-operator` for exactly this purpose; re-running with `$env:OPERATOR_AUTHORIZED_SUBJECTS = 'local-test-operator'` produced 31/31 green (run 3) and 35/35 green (run 4).
  No test was weakened or modified; `tests/integration/replay-boundary.test.ts` has zero diff. Exact errors reported as required.
- The root `package.json` `test:integration` / release harness normally supplies these variables; the direct vitest invocation from the plan's `<verify>` commands does not. Passing the harness-equivalent environment is the documented supported path.

## Known Stubs

None - no stubs, placeholders, or TODOs introduced; no skipped tests; no unrun verifies.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or schema changes beyond the plan's `<threat_model>` (T-quick-bf3-01..05/SC cover this change).

## Next Phase Readiness

- With results ingestion (0 `ResultVersion` in dev DB) as a later OPS step: `ensureTeamEvidence` will defer cleanly (null → skipped) until a SUCCEEDED SyncRun exists; after ingestion, the sweep will publish forecasts at exact cutoffs — empty-history fixtures publish via the EMPTY receipt with degraded confidence.
- Production start (`start()`) enables the sweep at 60s; existing test callers are untouched (flag absent).
- Deferred pre-existing out-of-scope modifications left untouched: `apps/web/next-env.d.ts`, `infra/docker-compose.yml`, `package.json`, `pnpm-lock.yaml`, `packages/database/src/generated/prisma/**`, `tsconfig.json`, `.env2`, `.agents/`, `.claude/`, `skills-lock.json`, root scratch scripts, `.planning/phases/07-modern-ui-enhancements/`, `.gsd/dispatch-isolation-sentinel.json`.

---
*Phase: quick-261016-bf3*
*Completed: 2026-10-16*

## Self-Check: PASSED

- FOUND: workers/data-sync/src/jobs/forecast-sweep.ts (created)
- FOUND: tests/unit/forecast-sweep.test.ts (created)
- FOUND: workers/data-sync/src/main.ts (modified)
- FOUND: 42c0761 in git log (exactly the 3 named files, 271 insertions, 4 deletions, no deletions of tracked files)
- FOUND: SUMMARY.md written to the plan's output path
