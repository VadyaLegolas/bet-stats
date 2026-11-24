---
phase: 12-calibration-layer-and-versioned-rollback
plan: 04
subsystem: database
tags: [calibration, leakage, fit-data, eligibility-census, result-lineage, mutation-proof, postgresql]

requires:
  - phase: 12-calibration-layer-and-versioned-rollback
    provides: "12-01: CalibrationSample, calibrationOutcomeIndex; 12-03: createPrismaCalibrationRepository, findActiveCalibrators"
provides:
  - "readCalibrationFitData: leakage-safe samples per market (PRODUCTION, exact identity, history at asOf, one sample per match and market, deterministic order)"
  - "readCalibrationState: per market the active calibrator of the exact identity and the eligible outcome count (basis of INSUFFICIENT_DATA)"
  - "tests/helpers/calibration-fit-seed.ts: real-shape seeds (ForecastMarket blocks, revision chain, result lineage, lineup observation)"
affects: [12-05, 12-06, 12-07]

actuals:
  tokens: 10700
  tasks: 3
  commits: 3

plan_head_before: 42f3fe0e0c57cf857836efc5f01d3ce5a57c396f
plan_head_after: 41ccb1fdd179771f6fc2a62a37543da5bad3f567

tech-stack:
  added: []
  patterns:
    - "Rules of the rho fit repeated, not rewritten: issuedAt <= asOf, cutoff < kickoff, origin PRODUCTION, lineage leaf through resolveHistoricalResultGraph"
    - "One scenario = one configHash in the leakage matrix, so scenarios cannot see each other"
    - "Guard tests proved by temporarily weakening the guarded rule (GUARD MUTATION)"

key-files:
  created:
    - packages/database/src/calibration-fit-data.ts
    - tests/helpers/calibration-fit-seed.ts
    - tests/integration/calibration-fit-data.test.ts
    - tests/integration/calibration-fit-data-parity.test.ts
  modified:
    - packages/database/src/index.ts

key-decisions:
  - "Probabilities are read from ForecastMarket rows (the table the settlement pipeline scores against), not from the ForecastSnapshot.probabilities column: both are written together by the publisher, and parity with ForecastScore is then structural"
  - "The newest revision is chosen per market, not per match: if the newest revision is unreadable only in one market, that market falls back to the previous readable pre-kickoff revision and the other markets keep the newest"
  - "sampleId is the snapshot id, so a newer revision changes the samples digest (the data really differ)"
  - "A fixture with no visible result at asOf is simply not eligible yet (not counted as skipped); only broken lineage, ambiguity, non-FINISHED status or a missing score count as skippedUnusableResults"

requirements-completed: [CALIB-02, CALIB-04]

coverage:
  - id: E1
    description: "Fit sample only from PRODUCTION ISSUED PRE_MATCH forecasts of the exact (modelVersion, configHash); BACKTEST, INITIAL, LINEUP_CONFIRMED, other model version and other config hash are excluded"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-fit-data.test.ts#origin, #kind, #identity"
        status: pass
    human_judgment: false
  - id: E2
    description: "History at asOf: forecast issued after asOf, cutoff not before kickoff, result observed after asOf and kickoff after asOf excluded; correction read at three asOf values with knownAt kept from the first version"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-fit-data.test.ts#issuedAt, #cutoff, #result and kickoff after asOf, #result correction"
        status: pass
    human_judgment: false
  - id: E3
    description: "One sample per match and market from the newest readable revision; unreadable probabilities skipped, counted, with revision fallback; deterministic order"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-fit-data.test.ts#one sample per match and market, #unreadable probabilities, #reads 12 samples..."
        status: pass
    human_judgment: false
  - id: E4
    description: "Census and state: eligibleSampleSize per market and the active calibrator of the exact identity; another identity sees neither"
    requirement: CALIB-04
    verification:
      - kind: integration
        ref: "tests/integration/calibration-fit-data.test.ts#reports the census..."
        status: pass
    human_judgment: false
  - id: E5
    description: "Outcome parity: on six scores the sample outcome names the same class as ForecastScore.outcome written by the real settlement pipeline, for all three markets"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-fit-data-parity.test.ts#outcomeIndex names the same class as ForecastScore.outcome..."
        status: pass
    human_judgment: false
  - id: E6
    description: "Reads never write: md5 and row counts of seven frozen tables plus Calibrator and CalibratorEvent unchanged by both read functions"
    requirement: CALIB-02
    verification:
      - kind: integration
        ref: "tests/integration/calibration-fit-data-parity.test.ts#reads never write..."
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-11-24
status: complete
---

# Phase 12 Plan 04: Leakage-safe calibration fit data Summary

**A read-only module that returns, per market, calibration samples from PRODUCTION forecasts of one exact (modelVersion, configHash) as the history looked at `asOf`, plus a state function that pairs the eligible-outcome census with the active calibrator; leakage guards are proved by mutation and outcomes by parity with the real settlement pipeline.**

## Performance

- **Duration:** about 35 min
- **Tasks:** 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Commits (measured, `git rev-list --count 42f3fe0..HEAD` before the docs commits):** 3 (7394493, 1bcbcb1, 41ccb1f)
- **`git rev-parse HEAD` before the first edit:** `42f3fe0e0c57cf857836efc5f01d3ce5a57c396f`
- No dependency or lockfile changes; no migrations; `packages/database/src/evaluation`, `dixon-coles-repository.ts` and `resolveHistoricalResultGraph` untouched.

## Red evidence

- **Task 1:** `pnpm vitest run --project integration tests/integration/calibration-fit-data.test.ts` with `calibration-fit-data.ts` moved away -> `FAIL ... Error: Cannot find module './calibration-fit-data.js' imported from D:/Documents/Atom/bet-stats/packages/database/src/index.ts`, `Tests no tests`. (The module had been written before the test file, so the red state was produced by temporarily removing the module; the test was then green on the first run: 5 tests.)
- **Task 2:** no red state: all ten matrix scenarios were green on the first run against the Task 1 implementation, so the mutation proofs below were run (the plan's second branch). 15 tests in the file.
- **Task 3:** green on the first run (3 tests); the mutation proof below shows it can fail.

## GUARD MUTATION lines

Each line: a temporary weakening of the guarded rule (restored with `git checkout -- <file>` before any commit), then the failing `it` names.

- `GUARD MUTATION: origin (remove origin: "PRODUCTION") -> "origin: a BACKTEST snapshot is excluded while the same shape as PRODUCTION on another fixture is included"`
- `GUARD MUTATION: issuedAt <= asOf (remove the issuedAt filter) -> "issuedAt: a forecast issued after asOf is excluded, and included when read at a later asOf"`
- `GUARD MUTATION: observedAt/effectiveAt <= asOf (remove the result query filter and let the resolver look at an infinite boundary) -> "result and kickoff after asOf: such matches are excluded" and "result correction: reads the lineage leaf at asOf (before, between, after) and keeps the first knownAt"`
- `GUARD MUTATION: lineage leaf at asOf (take the root version instead of the leaf) -> "result correction: reads the lineage leaf at asOf (before, between, after) and keeps the first knownAt"`
- `GUARD MUTATION: exact identity, configHash (remove the configHash filter) -> 11 of 15 tests failed, first "reports the census without a calibrator, then with the promoted one, and nothing for another identity" (and every matrix scenario that shares the base with another hash)`
- `GUARD MUTATION: exact identity, modelVersion (remove the modelVersion filter) -> "identity: V1 and DC forecasts of one match give independent samples; another configHash is excluded"`
- `GUARD MUTATION: outcome rule (OVER/UNDER threshold in outcome.ts changed from >= 3 to >= 4) -> "outcomeIndex names the same class as ForecastScore.outcome for every match and market" (calibration-fit-data-parity.test.ts)`

Remark on the observedAt rule: `resolveHistoricalResultGraph` also filters by `asOf` internally, so removing only the query filter would be compensated (defence in depth, no failing test). The mutation therefore weakens both layers, which is what a real regression of the rule would look like.

Not mutated: the kickoff bound (`kickoffUtc <= asOf`) and the strict cutoff bound at the query level. A fixture kicked off after `asOf` has no result visible at `asOf`, so the kickoff filter is subsumed by result visibility; the cutoff rule is checked in code as well as in the query (the `cutoff` test passes through the in-code check). They are kept as stated in the plan.

## API for plans 05 and 06

```ts
// @bet-stats/database (packages/database/src/calibration-fit-data.ts)
interface CalibrationFitDataInput extends CalibratorIdentity { readonly asOf: string }   // modelVersion, configHash, asOf (ISO-8601)

interface CalibrationFitData {
  readonly identity: CalibratorIdentity;
  readonly asOf: string;                                                                 // normalised ISO
  readonly samples: Readonly<Record<ScoreMarket, readonly CalibrationSample[]>>;         // ordered by (kickoffUtc, sampleId); probabilities in SCORE_CLASS_ORDER order; sampleId = snapshot id
  readonly skippedMalformedProbabilities: number;   // snapshot markets with unreadable probabilities (an older revision was then tried)
  readonly skippedUnusableResults: number;          // fixtures with broken/ambiguous lineage, non-FINISHED status or a missing score
}

readCalibrationFitData(client: PrismaClient, input: CalibrationFitDataInput): Promise<CalibrationFitData>;

interface MarketCalibrationCensus { readonly active: ActiveCalibratorState | null; readonly eligibleSampleSize: number }
type CalibrationState = Readonly<Record<ScoreMarket, MarketCalibrationCensus>>;
readCalibrationState(client: PrismaClient, input: CalibrationFitDataInput): Promise<CalibrationState>;
```

- `CalibrationFitData.samples[market]` goes straight into `fitMarketCalibrator({ samples, ... })`; `knownAt` is the first visible result observation of the match.
- `CalibrationState[market]` maps to the resolver input of plan 02: `active` (an `ActiveCalibratorState` is assignable to the domain `ActiveCalibrator`) and `eligibleSampleSize`.
- An unreadable `asOf` throws an error with `code: "INVALID_CALIBRATION_AS_OF"`.
- `readCalibrationState` performs one fit-data read plus one `findActiveCalibrators(identity)`; there is no caching (plan 06 caches within a request).
- Snapshot query `select` (no `receipt`): `id`, `fixtureId`, `cutoff`, `revision`, `fixture.kickoffUtc`, `markets.{market, probabilities}`. Result query `select`: `id`, `fixtureId`, `observedAt`, `effectiveAt`, `supersedesResultVersionId`, `status`, `homeGoals`, `awayGoals`, in batches of at most 1000 fixtures.
- Skip counters seen in the matrix: `skippedUnusableResults = 2` (POSTPONED result and a missing score), `skippedMalformedProbabilities = 3` (wrong class order, probabilities summing to 0.9, unreadable newest revision with fallback).

## Verification run

- `pnpm vitest run --project integration tests/integration/calibration-fit-data.test.ts` three runs in a row: 15/15 each.
- `pnpm vitest run --project integration tests/integration/calibration-fit-data-parity.test.ts tests/integration/calibration-fit-data.test.ts tests/integration/settlement-pipeline.test.ts tests/integration/settlement-multi-forecast.test.ts tests/integration/dixon-coles-rho.test.ts tests/integration/calibration-schema.test.ts` -> 6 files, 55 tests passed.
- `pnpm --filter @bet-stats/database typecheck` and `lint` clean; `pnpm typecheck` 7 successful; root `tsc -p tsconfig.json --noEmit` reports nothing under `calibration`/`helpers`.
- Invariants: `git diff --quiet 3c5f75e..HEAD -- packages/database/src/evaluation packages/database/src/dixon-coles-repository.ts` exit 0; `git diff --quiet 3c5f75e..HEAD -- package.json pnpm-lock.yaml packages/database/package.json` exit 0.
- Throwaway containers `bet-stats-calibration-*` were removed in `afterAll`; only the two pre-existing development containers remain. The development database was not used. Settlement of the six parity matches ran strictly sequentially; no SQLSTATE 40001 appeared.

## Deviations from Plan

### Auto-fixed Issues

None required fixing: no scenario was red on first run and no outcome mismatch with the settlement pipeline was found (no change to `outcome.ts` or to the pipeline).

### Plan variations

**1. [Design choice] Probabilities from `ForecastMarket`, not the snapshot column**
- The plan lists `probabilities` in the snapshot `select`. The settlement pipeline scores from `ForecastMarket`; reading the same table makes parity structural, and seeds in older tests leave `ForecastSnapshot.probabilities = {}`. The publisher writes both from the same object (`forecast-repository.ts`), so production data are identical.

**2. [Addition] Shared seed helper**
- `tests/helpers/calibration-fit-seed.ts` (not in the plan's `files_modified`) builds fixtures, result lineages, snapshot revisions (sequential `create`, so the revision-chain trigger sees each predecessor) and LINEUP_CONFIRMED lineup observations; used by both suites.

**3. [Addition] Seventh mutation line**
- The plan asks for six lines in the output spec and five in Task 2's acceptance; the identity rule was proved in two halves (configHash and modelVersion), giving six in Task 2 plus the outcome-rule line from Task 3.

**4. [Test structure] One container per file**
- `calibration-fit-data.test.ts` creates its container in a file-level `beforeAll`, shared by the identity-path block and the matrix block; matrix scenarios are isolated by a per-scenario `configHash`.

**Total deviations:** 0 auto-fixes, 4 plan variations. **Impact:** none on scope.

## Authentication Gates

None.

## Issues Encountered

- A shell heredoc containing mixed quotes failed to append the matrix tests (nothing was written); the block was written with the Write tool to a scratch file and appended. A first draft of the "unreadable probabilities" assertion was convoluted and was rewritten with explicit expected id lists before it ran.

## Known Stubs

None.

## Threat Flags

None. The module only reads. T-12-12 (leakage) is covered by the matrix and six mutation proofs, T-12-13 (identity mixing) by the V1/DC test and the two identity mutations, T-12-14 (reads writing) by the md5 test over nine tables, T-12-15 accepted as in the plan, T-12-SC no dependency changes.

## Not verified / limits

- Real production volumes: seeds hold 12 to 20 fixtures; the 1000-fixture batching boundary was not exercised with more than one batch.
- The `kickoffUtc <= asOf` filter is not independently proved by a failing test (subsumed by result visibility, see above).
- Time zone and sub-millisecond behaviour: timestamps are `TIMESTAMPTZ(3)` and ISO strings carry milliseconds; instants closer than a millisecond are not distinguished.
- Probability readability uses a sum tolerance of 1e-9, matching the fit's own input check; real forecasts rounded more coarsely would be skipped and counted (visible in `skippedMalformedProbabilities`), which has not been observed on real data because none was read.
- `readCalibrationState` loads the whole fit sample on each call; plan 06 must cache per request.

## Next Phase Readiness

Ready for 12-05: the daily job can call `readCalibrationFitData` with the identity and `asOf`, fit per market, and use `readCalibrationState`/the repository for the lifecycle input.

## Self-Check: PASSED

- Files: `calibration-fit-data.ts`, `calibration-fit-seed.ts`, `calibration-fit-data.test.ts`, `calibration-fit-data-parity.test.ts` exist.
- Commits: 7394493, 1bcbcb1 and 41ccb1f are ancestors of HEAD.
