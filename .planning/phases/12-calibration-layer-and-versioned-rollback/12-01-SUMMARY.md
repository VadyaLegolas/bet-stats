---
phase: 12-calibration-layer-and-versioned-rollback
plan: 01
subsystem: domain
tags: [calibration, platt-scaling, isotonic-regression, pava, brier, pure-typescript, vitest]

requires:
  - phase: 11-dixon-coles-model-version
    provides: "MODEL_VERSIONS and forecastConfigHashFor (pinned model identity), SCORE_CLASS_ORDER/scoreCategoricalForecast (Brier unit), MODEL_COMPARISON_POLICY (materiality 0.002)"
provides:
  - "calibration-config-v1: frozen policy object with canonical sha256 hash (D-07)"
  - "fitPlatt/applyPlatt: Newton-step Platt scaler with L2 prior to the identity map"
  - "fitIsotonic/applyIsotonic: PAVA isotonic regression, monotone, clipped"
  - "assessCalibrationData: 300-outcome gate with explicit INSUFFICIENT_DATA state and chronological split"
  - "fitMarketCalibrator: per-market fit (one-vs-rest Platt for ONE_X_TWO, Platt for binary markets, isotonic only at S>=1500 with 0.002 margin)"
  - "applyCalibrator: refuses a foreign modelVersion/configHash/market and structurally corrupt parameters"
  - "calibrationSamplesDigest and calibratorContentId: deterministic digest and content id"
affects: [12-02, 12-03, 12-04, 12-05, 12-06, 12-07]

actuals:
  tokens: 17991
  tasks: 2
  commits: 2

plan_head_before: e52b02b5cc351cfa3208476f72280d120f78bc15
plan_head_after: cd0ccf238b15ccfdd5fd9d4c001966e2e9829cf6

tech-stack:
  added: []
  patterns:
    - "Pure domain module: no clock, DB, env or randomness; timestamps arrive as arguments"
    - "Coded errors via calibrationError(code): Object.assign(new Error(code), { code })"
    - "Frozen versioned policy object + canonicalSha256 hash recorded with every fit"

key-files:
  created:
    - packages/domain/src/calibration/config.ts
    - packages/domain/src/calibration/errors.ts
    - packages/domain/src/calibration/outcome.ts
    - packages/domain/src/calibration/metrics.ts
    - packages/domain/src/calibration/platt.ts
    - packages/domain/src/calibration/isotonic.ts
    - packages/domain/src/calibration/calibrator.ts
    - packages/domain/src/calibration/index.ts
    - tests/unit/calibration-platt.test.ts
    - tests/unit/calibration-calibrator.test.ts
  modified:
    - packages/domain/src/index.ts

key-decisions:
  - "Newton parameters: maxIterations 50, gradientTolerance 1e-9, stepTolerance 1e-12, priorStrength 1, maxBacktracks 40 (all inside the hashed config)"
  - "L2 prior pulls slope to 1 AND intercept to 0 (full identity map), so single-label data stays finite too"
  - "Fitted parameters carry their own epsilon; applying a calibrator never reads the current config"
  - "Calibrator is trained on the fit window only; the holdout never trains it (D-05)"
  - "Isotonic selected only when plattHoldoutBrier - isotonicHoldoutBrier >= materiality (non-strict at the threshold)"

requirements-completed: [CALIB-01, CALIB-02, CALIB-04]

coverage:
  - id: D1
    description: "Platt scaler recovers a known miscalibration (slope 0.6, intercept 0.25 within 0.1) and lowers independent-sample Brier by more than 0.002"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/calibration-platt.test.ts#Platt scaling by Newton steps"
        status: pass
    human_judgment: false
  - id: D2
    description: "ONE_X_TWO one-vs-rest Platt renormalised to sum 1 (tolerance 1e-12), accepted by scoreCategoricalForecast, lowers independent Brier by more than 0.002"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/calibration-calibrator.test.ts#ONE_X_TWO one-vs-rest Platt"
        status: pass
    human_judgment: false
  - id: D3
    description: "Isotonic PAVA is monotone, considered only at S>=1500 and selected only with a 0.002 holdout margin over Platt"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/calibration-calibrator.test.ts#isotonic regression (PAVA), #sample gates and chronological split"
        status: pass
    human_judgment: false
  - id: D4
    description: "Below 300 outcomes an explicit INSUFFICIENT_DATA {required: 300, current} result; chronological holdout max(60, ceil(0.2*S))"
    requirement: CALIB-04
    verification:
      - kind: unit
        ref: "tests/unit/calibration-calibrator.test.ts#sample gates and chronological split (299/300/301/1499/1500)"
        status: pass
    human_judgment: false
  - id: D5
    description: "applyCalibrator refuses another modelVersion/configHash (CALIBRATOR_MODEL_MISMATCH), another market (CALIBRATOR_MARKET_MISMATCH) and corrupt parameters (CALIBRATOR_INVALID); no silent substitution"
    requirement: CALIB-02
    verification:
      - kind: unit
        ref: "tests/unit/calibration-platt.test.ts#refuses to serve a forecast of another identity; tests/unit/calibration-calibrator.test.ts#structurally corrupt calibrators are refused"
        status: pass
    human_judgment: false
  - id: D6
    description: "calibration-config-v1 holds the D-07 values verbatim, is deep-frozen, and its hash changes with any value"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/calibration-platt.test.ts#calibration config (D-07)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-11-24
status: complete
---

# Phase 12 Plan 01: Pure calibration core Summary

**Pure-TypeScript calibration core: Newton-step Platt (one-vs-rest for 1X2), PAVA isotonic gated at 1500 outcomes with a 0.002 margin, explicit INSUFFICIENT_DATA below 300, chronological holdout, and calibrators pinned to (modelVersion, configHash) with coded refusal on mismatch.**

## Performance

- **Duration:** 10 min (2026-11-24T08:48:23Z - 08:58:27Z)
- **Tasks:** 2 (Task 1 tracer, Task 2 TDD)
- **Files:** 10 created, 1 modified (11 in the diff; no dependency or lockfile changes)
- **Commits:** 07fa49b (Task 1), cd0ccf2 (Task 2); `git rev-parse HEAD` before the first edit: e52b02b5cc351cfa3208476f72280d120f78bc15

## Accomplishments

- `calibration-config-v1` frozen with a canonical hash (`CALIBRATION_CONFIG_HASH`); values per D-07, plus Newton numerics.
- Platt by Newton steps with Armijo backtracking and an L2 prior to the identity map; separable and single-label data stay finite.
- 1X2 via three one-vs-rest scalers renormalised to sum 1; binary markets via one scaler on the positive class, output `[q, 1 - q]`.
- PAVA isotonic with strictly increasing node abscissae, non-decreasing values, edge-value extrapolation, clip to `[epsilon, 1 - epsilon]`.
- `assessCalibrationData` gates (299/300/301/1499/1500 covered) and the chronological split (ties broken by `sampleId`).
- `applyCalibrator` checks identity, market, then parameter structure, then computes; a failure never returns a vector.

## Red evidence (tests written before the implementation)

- Task 1: `pnpm vitest run --project unit tests/unit/calibration-platt.test.ts` -> `FAIL ... Error: Cannot find module '../../packages/domain/src/calibration/config.js' imported from D:/Documents/Atom/bet-stats/tests/unit/calibration-platt.test.ts` (0 tests ran).
- Task 2: `pnpm vitest run --project unit tests/unit/calibration-calibrator.test.ts` -> `FAIL ... Error: Cannot find module '../../packages/domain/src/calibration/isotonic.js' imported from D:/Documents/Atom/bet-stats/tests/unit/calibration-calibrator.test.ts` (0 tests ran).
- Both then went green (21 and 38 tests, 59 total).

## Numeric parameters chosen (Claude's Discretion, all inside the hashed `CALIBRATION_CONFIG.platt`)

| Key | Value |
|-----|-------|
| `maxIterations` | 50 |
| `gradientTolerance` | 1e-9 (max abs gradient, sum scale) |
| `stepTolerance` | 1e-12 (stagnation stop, counted as converged) |
| `priorStrength` | 1 (objective = NLL + 0.5 * priorStrength * ((slope - 1)^2 + intercept^2)) |
| `maxBacktracks` | 40 (step halving, Armijo c = 1e-4 with a 1e-12 relative rounding allowance) |

## Contract for plans 02-07

`FittedCalibrator = FittedCalibratorBase & CalibratorModel` with fields:

- Base: `identity {modelVersion, configHash}`, `market`, `fitSampleSize`, `holdoutSampleSize`, `fitFrom`, `fitTo`, `holdoutFrom`, `holdoutTo` (kickoff ISO UTC of first/last sample in each window), `holdoutBrierRaw`, `holdoutBrierCalibrated`, optional `plattHoldoutBrier` and `isotonicHoldoutBrier` (present only when isotonic was considered, i.e. S >= 1500), `samplesDigest`, `calibrationConfigVersion`, `calibrationConfigHash`, `fittedAsOf`.
- Model (discriminated on `method`): `{ method: "PLATT", parameters: { epsilon, scalers: PlattParameters[] } }` where `PlattParameters = {slope, intercept, iterations, converged}`, or `{ method: "ISOTONIC", parameters: { epsilon, scalers: IsotonicModel[] } }` where `IsotonicModel = { nodes: {x, value}[] }`. `scalers` has 3 entries for ONE_X_TWO (class order HOME, DRAW, AWAY) and 1 entry (positive class: OVER_2_5 / YES) for binary markets. `parameters` is the JSON to persist in plan 03.

Signatures:

```ts
fitMarketCalibrator(input: { identity: CalibratorIdentity; market: ScoreMarket; samples: readonly CalibrationSample[]; asOf: string; config: CalibrationConfig }):
  { state: "INSUFFICIENT_DATA"; required: number; current: number } | { state: "FITTED"; calibrator: FittedCalibrator }
applyCalibrator(calibrator: FittedCalibrator, forecastIdentity: CalibratorIdentity, market: ScoreMarket, probabilities: readonly number[]): number[]
assessCalibrationData(samples: readonly CalibrationSample[], config: CalibrationConfig):
  { state: "INSUFFICIENT_DATA"; required; current } | { state: "READY"; sampleSize; fit; holdout; fitFrom; fitTo; holdoutFrom; holdoutTo }
calibratorContentId(calibrator: FittedCalibrator): string   // "calibrator_" + 64 hex; excludes fittedAsOf
calibrationSamplesDigest(samples: readonly CalibrationSample[]): string   // "sha256:" + 64 hex; order-independent
assertCalibratorStructure(calibrator: unknown): asserts calibrator is FittedCalibrator   // throws CALIBRATOR_INVALID; use after reading parameters from the DB
calibrationOutcomeIndex(market, homeGoals, awayGoals): number
```

`CalibrationSample = { sampleId, kickoffUtc, knownAt, probabilities (SCORE_CLASS_ORDER order), outcomeIndex }`. Error codes (all `Error & { code }`): `CALIBRATION_FIT_FAILED`, `INVALID_CALIBRATION_SAMPLE`, `INVALID_CALIBRATION_INPUT`, `CALIBRATOR_MODEL_MISMATCH`, `CALIBRATOR_MARKET_MISMATCH`, `CALIBRATOR_INVALID`.

Notes for consumers: samples are validated before any fit, including when below the 300 minimum (duplicate `sampleId` is rejected); `knownAt` participates in the digest but is NOT checked against `asOf`, so leakage filtering at `asOf` (D-04) remains the reader's job in plan 02. The fit window holds the older samples and the holdout the newest; the calibrator never trains on the holdout.

## Task Commits

1. **Task 1 (tracer): Platt calibration for binary markets with pinned identity** - `07fa49b` (feat)
2. **Task 2 (tdd): 1X2 one-vs-rest, isotonic, gates, split, digest** - `cd0ccf2` (feat)

## Verification run

- `pnpm vitest run --project unit tests/unit/calibration-platt.test.ts tests/unit/calibration-calibrator.test.ts` -> 2 files, 59 tests passed.
- `pnpm vitest run --project unit tests/unit/model-comparison.test.ts tests/unit/forecast-v1-regression.test.ts tests/unit/model-card.test.ts` -> 3 files, 23 tests passed.
- `pnpm --filter @bet-stats/domain typecheck` and `lint` -> clean.
- `pnpm typecheck` (turbo, 7 packages) -> 7 successful; `tsc -p tsconfig.json --noEmit` at the root (which also covers `tests/`) reports no calibration errors.
- Invariants: `git diff --quiet 3c5f75e..HEAD -- package.json pnpm-lock.yaml packages/domain/package.json` -> exit 0; `git diff --quiet 3c5f75e..HEAD -- packages/domain/src/evaluation packages/domain/src/forecast` -> exit 0.
- `grep -c calibration packages/domain/src/index.ts` -> 1; `grep -c calibration-config-v1 packages/domain/src/calibration/config.ts` -> 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] L2 prior also on the intercept**
- **Found during:** Task 1 (design of the Newton fit, threat T-12-02)
- **Issue:** A prior on the slope only leaves the intercept unbounded on single-label data (all outcomes positive): the minimiser diverges to infinity.
- **Fix:** Prior pulls both coordinates to the identity map (slope 1, intercept 0); config key is `priorStrength` (plan text said slope prior). Bias on real samples is negligible (about 0.005 on the intercept at n = 240).
- **Files modified:** packages/domain/src/calibration/config.ts, platt.ts
- **Verification:** test "keeps a degenerate sample (one probability, one label) finite"
- **Commit:** 07fa49b

**2. [Rule 3 - Blocking/structure] Extra file `errors.ts`**
- **Found during:** Task 1
- **Issue:** The coded-error helper is shared by outcome, metrics, platt, isotonic and calibrator; placing it in `calibrator.ts` would create import cycles.
- **Fix:** `packages/domain/src/calibration/errors.ts` (not listed in `files_modified`), re-exported from the calibration index.
- **Commit:** 07fa49b

**3. [Rule 2 - Missing critical functionality] Additional error code and parameter fields**
- **Issue:** Applying a calibrator to a malformed input vector needed a distinct code, and applying must not depend on the current config.
- **Fix:** Added `INVALID_CALIBRATION_INPUT`; `parameters.epsilon` is stored inside the calibrator; added `isotonicHoldoutBrier` next to `plattHoldoutBrier` (only when isotonic was considered) so the selection margin is auditable and testable at the exact threshold.
- **Commit:** 07fa49b, cd0ccf2

**Total deviations:** 3 auto-fixed (2 Rule 2, 1 Rule 3). **Impact:** none on scope; additions are in the new calibration directory only, no frozen module or dependency touched.

## Authentication Gates

None.

## Issues Encountered

None. Both test files passed on their first green run; the synthetic seeds were fixed up front and not tuned.

## Known Stubs

None.

## Threat Flags

None. The module is pure; no new endpoints, auth paths, file access or schema.

## Not verified / out of scope

- Numerical behavior on real production data: only synthetic fixtures were used (real data holds about 110 usable snapshots, so INSUFFICIENT_DATA is the expected live state).
- Database constraints, repository reads, worker job, API and UI belong to plans 02-07.

## Next Phase Readiness

Ready for 12-02 (data reader at `asOf`) and 12-03 (tables); both can import the contract above from `@bet-stats/domain`.

## Self-Check: PASSED

- Files: all 10 created files and the modified `packages/domain/src/index.ts` exist.
- Commits: 07fa49b and cd0ccf2 are ancestors of HEAD.
