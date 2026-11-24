---
phase: 12-calibration-layer-and-versioned-rollback
plan: 05
subsystem: worker
tags: [calibration, bullmq, daily-job, hysteresis, rollback, supersession, idempotency, redis]

requires:
  - phase: 12-calibration-layer-and-versioned-rollback
    provides: "12-02: decideCalibrationLifecycle; 12-03: calibration repository and event log; 12-04: readCalibrationFitData"
provides:
  - "runCalibrationJob: idempotent daily fit, evaluate, promote, supersede and rollback per market, closed JSON receipt"
  - "calibrationQueue, calibrationJobId, createCalibrationQueue, createCalibrationWorker, createCalibrationProcessor, calibrationIdentities, scheduleCalibrationTick"
  - "startCalibrationRuntime wired into start() beside the replay, backup and alerting runtimes"
  - "Seed numbers of the rollback-versus-supersession dynamics (section below, read by 12-07)"
affects: [12-06, 12-07]

actuals:
  tokens: 23500
  tasks: 3
  commits: 3

plan_head_before: 5c48f9d23aab006784a9243e5773e92c0beafc3b
plan_head_after: 4d2bd448bf1f0a48f5ba6fb7f2e1a47a8c4d4e24

tech-stack:
  added: []
  patterns:
    - "Job executes only actions returned by the pure lifecycle policy; no threshold literals in the worker"
    - "Per-market evaluation window = outcomes whose knownAt is later than the active calibrator's fitAsOf and later than its last eligible evaluation"
    - "Deterministic ids everywhere (calibrator content id, event id, queue job id per UTC day) make reruns and concurrent runs no-ops"

key-files:
  created:
    - workers/data-sync/src/jobs/calibration.ts
    - tests/helpers/calibration-job-seed.ts
    - tests/integration/calibration-job.test.ts
    - tests/integration/calibration-queue.test.ts
    - tests/unit/calibration-job.test.ts
  modified:
    - workers/data-sync/src/main.ts

key-decisions:
  - "The rollback series is asserted on ONE_X_TWO only: with 90-match blocks the label noise of the binary markets is comparable with the signal, so their verdicts are not decisive; all three markets run and are checked for promotion, idempotency and concurrency"
  - "Candidates are persisted on every run where data are READY (even when not promoted): a candidate with unchanged data has the same content id, so a repeat adds no row"
  - "Evaluation events use the current calibration config (version and hash) as the decision config; promotion events too"
  - "An ineligible evaluation (window under 30) does not move the window boundary: its outcomes are evaluated again with the next window; only eligible evaluations advance it"

requirements-completed: [CALIB-02, CALIB-03]

coverage:
  - id: F1
    description: "One run promotes a calibrator per market (version 1, no predecessor); a repeat of the same asOf and the next day without new data add no calibrators and no events"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-job.test.ts#one run over three markets on a real database"
        status: pass
    human_judgment: false
  - id: F2
    description: "299 outcomes give INSUFFICIENT_DATA (required 300, current 299) and no rows; a foreign identity is refused before any database access"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-job.test.ts#299 outcomes..., #refuses an invalid identity before any database access"
        status: pass
    human_judgment: false
  - id: F3
    description: "One bad window does not roll back, two do not, the third eligible WORSE does (appended ROLLED_BACK, journal checked in seq order); a good window resets the series; windows are disjoint and exclude training data"
    requirement: CALIB-03
    verification:
      - kind: integration
        ref: "tests/integration/calibration-job.test.ts#hysteresis, evaluation windows and rollback, #the series is reset by a good window"
        status: pass
    human_judgment: false
  - id: F4
    description: "A rolled-back calibrator is not promoted again (back-dated rerun rebuilds it as candidate and the job refuses it); concurrent runs write one set of rows"
    requirement: CALIB-03
    verification:
      - kind: integration
        ref: "tests/integration/calibration-job.test.ts#a back-dated rerun..., #concurrent runs of one pair"
        status: pass
    human_judgment: false
  - id: F5
    description: "Supersession needs a material holdout win and is written as SUPERSEDED plus PROMOTED in one transaction (equal xmin); rollback of the successor restores the predecessor as version 1"
    requirement: CALIB-03
    verification:
      - kind: integration
        ref: "tests/integration/calibration-job.test.ts#supersession needs a material win..."
        status: pass
    human_judgment: false
  - id: F6
    description: "Queue: deterministic colon-free job id per (model, config hash prefix, UTC day); two enqueues give one job executed once; invalid identity or payload fails with one attempt; daily tick with clamped timers; runtime wired in start()"
    requirement: CALIB-02
    verification:
      - kind: unit
        ref: "tests/unit/calibration-job.test.ts"
        status: pass
      - kind: integration
        ref: "tests/integration/calibration-queue.test.ts"
        status: pass
    human_judgment: false

duration: ~75min
completed: 2026-11-24
status: complete
---

# Phase 12 Plan 05: Daily calibration job and worker runtime Summary

**An idempotent daily BullMQ job that fits per-market candidates on leakage-safe data, evaluates the active calibrator on a disjoint later window and executes only what the pure lifecycle policy decides (promote, supersede in one transaction, roll back after three eligible WORSE windows), with no provider calls.**

## Performance

- **Duration:** about 75 min
- **Tasks:** 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Commits (measured, `git rev-list --count 5c48f9d..HEAD` before the docs commits):** 3 (8e88a6f, 8d79574, 4d2bd44)
- **`git rev-parse HEAD` before the first edit:** `5c48f9d23aab006784a9243e5773e92c0beafc3b`
- No dependency or lockfile changes. `backup.ts`, `alerts.ts`, `settlement.ts`, `queues/index.ts` untouched (`git diff --quiet 3c5f75e..HEAD` exit 0); `main.ts` only gained the new runtime.

## Red evidence

- **Task 1:** `pnpm vitest run --project integration tests/integration/calibration-job.test.ts` with the module moved away -> `Error: Cannot find module '../../workers/data-sync/src/jobs/calibration.js' imported from .../tests/integration/calibration-job.test.ts`, `Tests no tests`. (The module was written before the test file; red was produced by removing it. First run after restoring: a seed helper mismatch (`homeTeamId` missing) was fixed in the test, then 8/8 green.)
- **Task 2:** all scenarios were green on the first full run (15 tests); one scenario (supersession then rollback of the successor) failed on the first attempt for a numerical reason, see "Deviations", and was resolved by a different fixed seed after a pure-domain experiment. The mutation proofs below were run as the plan's second branch.
- **Task 3:** `pnpm vitest run --project unit tests/unit/calibration-job.test.ts` before the implementation -> `Failed Tests 12`, first `TypeError: calibrationQueue is not a function`; `tests/integration/calibration-queue.test.ts` -> `TypeError: calibrationQueue is not a function` (0 of 4 tests ran). An earlier attempt failed on import (`Cannot find package 'bullmq'` from the root test directory): tests import bullmq through `workers/data-sync/node_modules/bullmq/dist/esm/index.js`, as `replay-boundary.test.ts` does.

## Receipt (example, ONE_X_TWO of the first run on 600 matches; no secrets or connection strings)

```json
{"version":"calibration-job-receipt-v1","identity":{"modelVersion":"dixon-coles-ensemble-v1","configHash":"sha256:ff891567ab4c5358db44e98175174b94190ad8ea321db88d6c83419ea0871a72"},"asOf":"2026-04-12T08:00:00.000Z","calibrationConfigVersion":"calibration-config-v1","skippedMalformedProbabilities":0,"skippedUnusableResults":0,"markets":{"ONE_X_TWO":{"eligibleSampleSize":600,"requiredSample":300,"data":{"state":"READY","sampleSize":600},"evaluation":null,"candidateId":"calibrator_83baf7cd...","actions":[{"type":"PROMOTE","reasonCode":"FIRST_PROMOTION","calibratorId":"calibrator_83baf7cd...","result":"WRITTEN"}],"concurrentTransition":false,"active":{"calibratorId":"calibrator_83baf7cd...","version":1}}}}
```

The real receipt carries all three markets (`ONE_X_TWO`, `OVER_UNDER_2_5`, `BTTS`); ids are shortened here. For INSUFFICIENT_DATA: `"data":{"state":"INSUFFICIENT_DATA","required":300,"current":299}`, `"candidateId":null`, `"actions":[{"type":"NO_CHANGE","reasonCode":"NO_CANDIDATE",...}]`. Action `result` is `WRITTEN`, `ALREADY_RECORDED` (deterministic id found) or `NONE` (NO_CHANGE).

## Signatures

```ts
// workers/data-sync/src/jobs/calibration.ts
runCalibrationJob(input: { database: PrismaClient; modelVersion: string; configHash: string; asOf: string; log?: (event) => void }): Promise<CalibrationJobReceipt>
//   throws { code: "CALIBRATION_IDENTITY_INVALID" } before any database access; { code: "INVALID_CALIBRATION_JOB" } for an unreadable asOf
calibrationQueue(prefix = "bet-stats"): string                       // `${prefix}-calibration`; prefix must match /^[a-zA-Z0-9_-]+$/
calibrationJobId(data: { modelVersion; configHash; asOf }): string   // calibration-<modelVersion>-<first 12 hex of the config hash>-<UTC yyyy-mm-dd>
calibrationIdentities(): CalibratorIdentity[]                        // every MODEL_VERSIONS entry with forecastConfigHashFor
createCalibrationQueue({ redisUrl, prefix?, queueFactory? }): { enqueue(data), close() }   // attempts 3, exponential backoff 1000 ms jitter 0.25, removeOnComplete {86400, 1000}, removeOnFail {604800, 5000}
createCalibrationProcessor(execute): (job) => Promise<T>             // UnrecoverableError("INVALID_CALIBRATION_JOB" | "CALIBRATION_IDENTITY_INVALID")
createCalibrationWorker({ redisUrl, prefix?, execute, workerFactory? })                   // concurrency 1, lockDuration 60000
scheduleCalibrationTick({ enqueue, now?, setTimeout?, clearTimeout?, onError?, startDelayMs = 5000, intervalMs = cadence.intervalHours * 3600000, retryMs = 60000 }): { close() }
// workers/data-sync/src/main.ts
startCalibrationRuntime({ databaseUrl, redisUrl, prefix?, log?, dependencies?: { database; queue }, now?, setTimeout?, clearTimeout? }): { close(): Promise<void> }
```

`start()` calls `startCalibrationRuntime` inside the existing `DATABASE_URL`/`REDIS_URL`/provider-token check (with the same `QUEUE_PREFIX` as alerting) and closes it with the other runtimes. It logs `calibration.armed` (queue name, identity count) and `calibration.tick_failed` without secrets; the job logs `calibration.job.completed`.

## Seed numbers for plan 12-07 (rollback versus supersession dynamics)

Generator (`tests/helpers/calibration-job-seed.ts`): expected goals `lambdaHome = 0.5 + 2.3u`, `lambdaAway = 0.4 + 1.8u`, independent Poisson scores, true market probabilities from the Poisson grid, raw forecast = true vector to the power `gamma`, renormalised (`gamma > 1` over-confident, `gamma = 1` calibrated); kickoffs four hours apart from 2026-01-01T12:00Z, results observed two hours after kickoff; each run's `asOf` is the last kickoff plus one day; the next block starts one hour after the previous `asOf`. All numbers below are ONE_X_TWO.

| Scenario | Seeds | Deltas (calibrated Brier minus raw Brier) | Outcome |
|---|---|---|---|
| Base calibrator C | 1200 matches, seed 7, gamma 2.5 (Platt; below the 1500 isotonic threshold) | holdout gain large | PROMOTE/FIRST_PROMOTION, version 1 |
| Regression, bad windows (gamma 1, 90 matches each) | seeds 207, 214, 225 | +0.0305, +0.0354, +0.0312 (all WORSE, windows of 90, each eligible) | runs 1 and 2: RECORD_EVALUATION + NO_CHANGE/CANDIDATE_NOT_BETTER_THAN_ACTIVE; run 3: RECORD_EVALUATION + ROLL_BACK; active none (C had no predecessor) |
| Series reset | bad 207 (+0.0305), good (gamma 2.5, seed 1202) (-0.0591 BETTER), bad 214 (+0.0354), bad 225 (+0.0312, NO_CHANGE/CANDIDATE_NOT_PROMOTABLE), bad 230 (+0.0288) | | no rollback after bad, good, bad, bad (series 2); rollback on the next bad window (3 in a row) |
| Broader data after rollback | 400 matches, seed 1201, gamma 2.5 | | candidate promotes as a different calibrator, version 2 |
| Supersession | C1: 400 matches, seed 31, gamma 1.5 (Platt). Then 1500 matches, seed 33, gamma 3.5 | evaluation of C1 on the 1500 window: -0.0430 (BETTER); candidate holdout Brier 0.5378 versus C1's 0.5976 on the same holdout, gain 0.0598 (threshold 0.002) | SUPERSEDED(C1) + PROMOTED(C2, predecessor C1) in one transaction (same `xmin`); C2 is ISOTONIC (1900 outcomes); version 2 |
| Rollback of the successor | gamma 1, 90 matches, seeds 207, 214, 225 | +0.0139, +0.0195, +0.0306 | third run: ROLL_BACK to C1; `findActiveCalibrator` = C1, version 1, `activatedBy` ROLLED_BACK |

Materiality 0.002, rollback series 3, minimum evaluation sample 30, minimum holdout 60 are the `CALIBRATION_CONFIG` values; the tests contain no copies of them except the assertion `delta >= 3 * 0.002` on the first bad window.

Experiment that fixed the numbers (not committed): with gamma 1.6 and the narrower expected-goals ranges hardly any signal was left (block deltas of both signs, `BETTER` on gamma-1 blocks), so the lambda ranges were widened and gamma 2.5 chosen (gamma 3.5 was also tried and gave larger deficits); among seeds 200-231 most gamma-1 blocks give a ONE_X_TWO delta of +0.01 to +0.07 (three of 32 were below +0.006 or negative), and seeds 207, 214, 225, 230, 220 were taken from the decisive ones; a pure-domain simulation of the supersession chain over strong seeds 32-37 and four bad-seed orders showed that with strong seed 32 the mixed-data candidate itself supersedes C2 on the second bad window (gain +0.0027 to +0.0039 on an ISOTONIC candidate), which the real job reproduced; seed 33 gives gains below +0.0011 in every later step.

## GUARD MUTATION lines

- `GUARD MUTATION: evaluation window without the "knownAt after fitAsOf" boundary -> 9 of 19 failed, first "a repeat of the same run adds neither calibrators nor events"; also "one bad window records EVALUATED/WORSE ... the evaluation window holds only the new block" and "windows do not overlap and exclude training data"`
- `GUARD MUTATION: promotion without the hasBeenRolledBack check (everRolledBack forced to false) -> "a back-dated rerun rebuilds the rolled-back calibrator as candidate and refuses it without writing"` (the database trigger would still refuse the event with CALIBRATOR_TRANSITION_REJECTED, but the receipt then reports a concurrent transition instead of CANDIDATE_PREVIOUSLY_ROLLED_BACK)
- `GUARD MUTATION: ROLL_BACK executed at series 1 (a single eligible WORSE window) -> 7 of 19 failed, first "one bad window records EVALUATED/WORSE and does not roll back"`

## Verification run

- `calibration-job.test.ts` three consecutive runs: 19/19 each. Together with the neighbours: `pnpm vitest run --project integration tests/integration/calibration-job.test.ts tests/integration/calibration-queue.test.ts tests/integration/calibration-fit-data.test.ts tests/integration/calibration-transitions.test.ts` -> 4 files, 53 tests passed. `calibration-queue.test.ts` run twice more: 4/4 each.
- `pnpm vitest run --project unit tests/unit/calibration-job.test.ts tests/unit/calibration-lifecycle.test.ts tests/unit/calibration-view.test.ts tests/unit/alerts-composition.test.ts tests/unit/backup-job.test.ts tests/unit/worker-entry-guard.test.ts` -> 6 files, 167 tests passed.
- `pnpm --filter @bet-stats/data-sync typecheck` and `lint` clean; `pnpm typecheck` 7 successful; root `tsc -p tsconfig.json --noEmit` reports nothing under `calibration`.
- Invariants: `git diff --quiet 3c5f75e..HEAD -- workers/data-sync/src/jobs/backup.ts workers/data-sync/src/jobs/alerts.ts workers/data-sync/src/jobs/settlement.ts workers/data-sync/src/queues/index.ts` exit 0; `package.json`, `pnpm-lock.yaml`, `workers/data-sync/package.json` unchanged. `grep -c "decideCalibrationLifecycle"` in the job = 3, `startCalibrationRuntime` in `main.ts` = 2.
- Source check in the unit suite: the job module (code lines, comments excluded) has no `@bet-stats/football-data`, `fetch(`, provider names, `undici`/`axios`/`node:http(s)`, provider secrets, no policy literals (0.002, 300, 1500) and no frozen-table accessors.
- Throwaway containers (`bet-stats-calibration-job-*`, `bet-stats-calibration-redis-*`) removed with `docker rm --force --volumes`; only the two pre-existing development containers remain; the development database and `.env*` were not touched. Sequential runs only; no SQLSTATE 40001 appeared.

## Deviations from Plan

### Auto-fixed Issues

None in production code: no scenario exposed a defect in the job, the repository or the policy.

### Plan variations

**1. [Test scope] The hysteresis series is asserted on ONE_X_TWO**
- Plan item "режим регресса" is written for the job as a whole; with 80-100 match blocks the binary markets (OVER_UNDER_2_5, BTTS) have verdicts of both signs on the same bad blocks (label noise is as large as the effect, see the experiment), so they cannot be made decisive without larger blocks. All three markets run in every job call and are asserted for promotion, idempotency and concurrency; the series, rollback, reset, supersession and restoration assertions use ONE_X_TWO. No policy or job behaviour differs per market.

**2. [Seed choice] Supersession seeds**
- The first attempt used strong seed 32 and failed: on the second bad window the mixed-data (isotonic) candidate itself superseded C2 by +0.0027. That is the correct policy, not a defect; the seed was changed to 33 after a pure-domain simulation (see above). The numbers are recorded for 12-07.

**3. [Additions beyond files_modified]**
- `tests/helpers/calibration-job-seed.ts` (deterministic Poisson generator and mass seeding, shared by the job suite and available to later plans); the plan said to define the seed helper in the test file.
- Each scenario group of `calibration-job.test.ts` works in its own database inside the file's container (the pair modelVersion/configHash is fixed by the forecast stack, so identity cannot isolate state).
- A back-dated rerun test, to make the `hasBeenRolledBack` guard reachable by a job-level test (the plan's mutation (б) otherwise had no failing `it`).
- Tests import bullmq through `workers/data-sync/node_modules/bullmq/dist/esm/index.js`; error classes are compared by `name` because the worker and the test resolve two copies of the library.

**4. [Design notes]**
- `createCalibrationQueue(...).enqueue` is `async`, so an invalid `asOf` rejects instead of throwing synchronously.
- The module defines its own `connection()` instead of importing `redisConnection` from `queues/index.ts`, so it does not pull the replay and provider code into the job module.

**Total deviations:** 0 auto-fixes, 4 plan variations. **Impact:** none on scope.

## Authentication Gates

None.

## Issues Encountered

- Several shell heredocs with mixed quotes failed to parse (nothing written); files were produced with the Write tool and appended. A first draft of the "frozen tables" assertion compared against digests taken before the V1 seeds and was rewritten as a before/after pair around one job run.
- Long mutation runs were moved to the background by the tool; the mutated source was restored with `git checkout -- <file>` after each mutation and `git status` confirmed a clean `workers/` tree before the commit.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-12-16 (identity refusal before any database access, proxy counter test), T-12-17 (deterministic ids, concurrent runs), T-12-18 (series, disjoint windows, no re-promotion), T-12-19 (window boundary and mutation), T-12-20 (source check: no provider access), T-12-SC (no dependencies).

## Not verified / limits

- The job was not run against the live database or the real queue of a deployed worker; `start()` was checked by source inspection and by a runtime test with injected dependencies, not by launching the process.
- Rollback and supersession dynamics are proven on one synthetic generator (Poisson scores, tempered probabilities); real forecasts will not behave like it, and real data will sit in INSUFFICIENT_DATA for a long time.
- A same-day rerun after a rollback can promote another candidate as a first promotion if that candidate is promotable on the same data (for the seeds used it was not promotable, so no event was written); the policy only pauses promotion inside the rolling-back run.
- Candidates are persisted every run with new data (one row per market per day when data change); there is no pruning of unpromoted candidates.
- `ineligible` evaluations (window under 30) do not advance the window boundary, so small daily increments are re-evaluated together until they reach 30; a day with a single eligible window evaluates everything since the last eligible one.
- Only ONE_X_TWO dynamics are asserted for rollback (see variation 1).

## Next Phase Readiness

Ready for 12-06 (API reads through `findActiveCalibrators` and `readCalibrationState`) and 12-07 (UI numbers from the section above). The job's writes are the only source of calibrators; the API must not write.

## Self-Check: PASSED

- Files: `calibration.ts`, `main.ts`, `calibration-job-seed.ts`, `calibration-job.test.ts`, `calibration-queue.test.ts`, `calibration-job.test.ts` (unit) exist.
- Commits: 8e88a6f, 8d79574 and 4d2bd44 are ancestors of HEAD.
