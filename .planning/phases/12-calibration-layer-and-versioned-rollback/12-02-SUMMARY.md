---
phase: 12-calibration-layer-and-versioned-rollback
plan: 02
subsystem: domain
tags: [calibration, lifecycle, rollback-hysteresis, promotion-gate, market-calibration-view, pure-typescript, vitest]

requires:
  - phase: 12-calibration-layer-and-versioned-rollback
    provides: "12-01: CALIBRATION_CONFIG, fitMarketCalibrator, applyCalibrator, FittedCalibrator, categoricalBrier"
provides:
  - "calibrationVerdict / isPromotable / evaluateCalibrator: promotion gate (D-05) and evaluation verdict (D-07) as pure functions"
  - "decideCalibrationLifecycle: first promotion, supersession, 3-in-a-row hysteresis rollback, rollback target (D-07, D-09, D-10)"
  - "resolveMarketCalibration / resolveForecastCalibration / unavailableMarketCalibration: CALIBRATED | INSUFFICIENT_DATA | UNAVAILABLE with closed reason codes (D-06, D-11, CALIB-04)"
  - "parseMarketCalibrationMap: strict parser of the marketCalibration map, separate from the frozen receipt parser (D-08)"
  - "tests/helpers/calibration-samples.ts: deterministic synthetic sample generator for later plans"
affects: [12-03, 12-04, 12-05, 12-06, 12-07]

actuals:
  tokens: 17700
  tasks: 3
  commits: 3

plan_head_before: 4ceb658d114fb68132b888948ee0f880c105a53b
plan_head_after: 444dc77399f740a4d13c78ebd5e41b8eb02f6372

tech-stack:
  added: []
  patterns:
    - "Decision function over facts recoverable from the event log; eligibility and verdict of the current evaluation re-derived from numbers and the config in the input, never from caller flags"
    - "Closed vocabularies (states, reason codes) as const arrays plus a strict exact-key parser"
    - "Optional response fields are absent keys, never undefined (exactOptionalPropertyTypes)"

key-files:
  created:
    - packages/domain/src/calibration/lifecycle.ts
    - packages/domain/src/calibration/view.ts
    - tests/helpers/calibration-samples.ts
    - tests/unit/calibration-lifecycle.test.ts
    - tests/unit/calibration-view.test.ts
  modified:
    - packages/domain/src/calibration/index.ts
    - packages/domain/src/calibration/errors.ts

key-decisions:
  - "Promotion gate is strict: promotable only when holdout delta (calibrated minus raw) < 0.002, aligned with the inclusive WORSE boundary; a calibrator that would be judged WORSE is never promoted (refinement of the D-05 wording)"
  - "Evaluations that are not eligible (sample < 30) are skipped in the rollback series: they neither extend nor reset it; an eligible non-WORSE evaluation resets it; rollback needs the CURRENT evaluation to be eligible"
  - "View blocks carry method, holdoutBrierRaw, holdoutBrierCalibrated beyond the D-11 field list so the UI can name the method and show holdout numbers honestly (D-12, Claude's Discretion)"
  - "Empty evaluation window yields null numbers and verdict (nothing measured) rather than zeros"
  - "Missing Brier of the active calibrator on the candidate holdout fails closed to CANDIDATE_NOT_BETTER_THAN_ACTIVE"

requirements-completed: [CALIB-01, CALIB-03, CALIB-04]

coverage:
  - id: D1
    description: "Promotion gate: holdout 59 refused, 60 accepted; Brier delta 0.00199 accepted, exactly 0.002 refused (HOLDOUT_WORSE_THAN_RAW); better-than-raw accepted"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/calibration-lifecycle.test.ts#isPromotable (D-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Evaluation verdict WORSE at delta >= 0.002, BETTER at <= -0.002, else NEUTRAL; sample 29 ineligible, 30 eligible; empty window safe; fresh window of 60 scores BETTER for a fitted miscalibrated candidate"
    requirement: CALIB-03
    verification:
      - kind: unit
        ref: "tests/unit/calibration-lifecycle.test.ts#calibrationVerdict (D-07), #evaluateCalibrator (D-07), #end to end"
        status: pass
    human_judgment: false
  - id: D3
    description: "Rollback only after three consecutive eligible WORSE evaluations (current included); one bad window, two in a row, NEUTRAL/BETTER resets and ineligible skips behave as specified"
    requirement: CALIB-03
    verification:
      - kind: unit
        ref: "tests/unit/calibration-lifecycle.test.ts#rollback hysteresis (D-07, D-10)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Rollback target is the previous promoted calibrator or null (raw only); a rolled-back calibrator is never re-promoted; a rolling-back run promotes nothing; supersession needs a 0.002 holdout win"
    requirement: CALIB-03
    verification:
      - kind: unit
        ref: "tests/unit/calibration-lifecycle.test.ts#rollback target (D-09), #candidate eligibility, #supersession"
        status: pass
    human_judgment: false
  - id: D5
    description: "Thresholds come from CALIBRATION_CONFIG: swapping the config (series 2, eligibility 10, holdout 10, materiality 0.5, platt 50, servedKinds) changes behaviour"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/calibration-lifecycle.test.ts#thresholds come from the config; tests/unit/calibration-view.test.ts#takes the threshold from the config"
        status: pass
    human_judgment: false
  - id: D6
    description: "Per-market state resolver: CALIBRATED only for a matching identity/market/valid parameters; INITIAL is KIND_NOT_COVERED; foreign identity, market or corrupt parameters give UNAVAILABLE with a closed code; below 300 outcomes INSUFFICIENT_DATA carries sampleSize 0/1/299 and requiredSample 300; at 300+ without a calibrator NO_PROMOTED_CALIBRATOR"
    requirement: CALIB-04
    verification:
      - kind: unit
        ref: "tests/unit/calibration-view.test.ts#resolveMarketCalibration (CALIBRATED / UNAVAILABLE / INSUFFICIENT_DATA)"
        status: pass
    human_judgment: false
  - id: D7
    description: "marketCalibration map parser is strict (extra/missing keys, unknown state, unclosed reason code, missing required fields, undefined values, inconsistent state/reason pairs all rejected) and parseForecastResponse still rejects an extra marketCalibration key"
    requirement: CALIB-04
    verification:
      - kind: unit
        ref: "tests/unit/calibration-view.test.ts#parseMarketCalibrationMap is strict, #the frozen forecast receipt stays strict (D-08)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-24
status: complete
---

# Phase 12 Plan 02: Calibrator lifecycle policy and market calibration state Summary

**Pure promotion/evaluation/rollback policy (strict 0.002 gate, three-in-a-row hysteresis, rollback target, no re-promotion, materiality-gated supersession) plus a per-market CALIBRATED / INSUFFICIENT_DATA / UNAVAILABLE resolver with a closed reason-code set and a strict response parser that leaves the frozen forecast receipt untouched.**

## Performance

- **Duration:** 12 min (2026-11-24T09:01Z - 09:13Z, start approximated from the first plan commit window)
- **Tasks:** 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Files:** 5 created, 2 modified; no dependency or lockfile changes
- **Commits:** fbac58b (Task 1), 2a93acb (Task 2), 444dc77 (Task 3); `git rev-parse HEAD` before the first edit: 4ceb658d114fb68132b888948ee0f880c105a53b

## Red evidence (tests written before the implementation)

- Task 1: `pnpm vitest run --project unit tests/unit/calibration-lifecycle.test.ts` -> `FAIL ... Error: Cannot find module '../../packages/domain/src/calibration/lifecycle.js' imported from D:/Documents/Atom/bet-stats/tests/unit/calibration-lifecycle.test.ts` (0 tests ran). Green afterwards: 26 tests.
- Task 2: same command with the new hysteresis/rollback/supersession blocks against the Task 1 implementation -> `Failed Tests 25`; first line `AssertionError: expected { type: 'NO_CHANGE', ...(1) } to match object { type: 'RECORD_EVALUATION', ...(4) }` (the Task 1 decision function only knew the first promotion). Green afterwards: 64 tests.
- Task 3: `pnpm vitest run --project unit tests/unit/calibration-view.test.ts` -> `Error: Cannot find module '../../packages/domain/src/calibration/view.js' imported from D:/Documents/Atom/bet-stats/tests/unit/calibration-view.test.ts` (0 tests ran). Green afterwards: 57 tests (121 together with the lifecycle file).

## Accomplishments

- `calibrationVerdict`, `isPromotable`, `evaluateCalibrator` with every threshold from `CALIBRATION_CONFIG`; boundaries 59/60, 0.00199/0.002, 29/30 and empty window covered.
- `decideCalibrationLifecycle`: one deterministic function over facts recoverable from the `CalibratorEvent` log.
- `resolveMarketCalibration` never returns CALIBRATED for a foreign identity, a foreign market, corrupt parameters, a non-positive version or non-normalised output.
- `parseMarketCalibrationMap` is strict and deliberately not connected to `parseForecastResponse`.
- Shared deterministic generator `makeCalibrationSamples` for plans 03-07.

## Contract for plans 03-07

`decideCalibrationLifecycle(input: LifecycleInput): { actions: readonly LifecycleAction[] }`

```ts
LifecycleInput = {
  config: CalibrationConfig;
  active: { calibratorId: string; restoreTargetId: string | null;
            priorEvaluations: readonly { eligible: boolean; verdict: "BETTER"|"NEUTRAL"|"WORSE"|null }[] /* since activation, oldest first */ } | null;
  evaluation: CalibratorEvaluation | null;   // evaluateCalibrator result on the newest window
  candidate: { calibratorId: string; promotion: { promotable: boolean; reasonCode: "OK"|"HOLDOUT_TOO_SMALL"|"HOLDOUT_WORSE_THAN_RAW" };
               everRolledBack: boolean; holdoutBrierCandidate: number; holdoutBrierActive: number | null } | null;
}
CalibratorEvaluation = { sampleSize; brierRaw|null; brierCalibrated|null; delta|null; verdict|null; eligible }
LifecycleAction =
  | { type: "RECORD_EVALUATION"; calibratorId; sampleSize; eligible; verdict|null; brierRaw|null; brierCalibrated|null; delta|null }
  | { type: "ROLL_BACK"; calibratorId; restoreCalibratorId: string|null; reasonCode: "HOLDOUT_REGRESSION"; consecutiveWorse: number }
  | { type: "PROMOTE"; calibratorId; predecessorCalibratorId: string|null; reasonCode: "FIRST_PROMOTION"|"SUPERSEDES_ACTIVE" }
  | { type: "NO_CHANGE"; reasonCode: "NO_CANDIDATE"|"CANDIDATE_NOT_PROMOTABLE"|"CANDIDATE_PREVIOUSLY_ROLLED_BACK"|"CANDIDATE_IS_ACTIVE"|"CANDIDATE_NOT_BETTER_THAN_ACTIVE" }
```

Order is fixed: `RECORD_EVALUATION` (only when both an active calibrator and an evaluation exist), then either `ROLL_BACK` (nothing else follows) or exactly one of `PROMOTE` / `NO_CHANGE`. The current evaluation's eligibility and verdict are recomputed from `sampleSize`/`delta` and `input.config`, so the recorded `RECORD_EVALUATION` is authoritative; the worker should persist that action, not `evaluation.eligible`.

View module: `resolveMarketCalibration({ forecast, market, active: ActiveCalibrator|null, eligibleSampleSize, config }): MarketCalibrationView`; `resolveForecastCalibration({ forecast, active: Record<ForecastMarket, ActiveCalibrator|null>, eligibleSampleSize: Record<ForecastMarket, number>, config })`; `unavailableMarketCalibration({ forecast, market, reasonCode? })` (default `CALIBRATION_READ_FAILED`); `parseMarketCalibrationMap(value)`.

Reason codes (closed): `INSUFFICIENT_SETTLED_OUTCOMES`, `NO_PROMOTED_CALIBRATOR`, `KIND_NOT_COVERED`, `CALIBRATOR_MODEL_MISMATCH`, `CALIBRATOR_MARKET_MISMATCH`, `CALIBRATOR_INVALID`, `CALIBRATION_READ_FAILED`. Allowed state/reason pairs (enforced by the parser): CALIBRATED carries no reason code; INSUFFICIENT_DATA carries exactly `INSUFFICIENT_SETTLED_OUTCOMES` and `sampleSize < requiredSample`; UNAVAILABLE carries any other code. `rawProbabilities` and `calibratedProbabilities` are plain number arrays in `SCORE_CLASS_ORDER[market]` order.

Notes for consumers: `resolveMarketCalibration` and `unavailableMarketCalibration` throw `INVALID_CALIBRATION_INPUT` only if the forecast's own market block does not match the class order (a caller bug; the receipt is parsed upstream). Calibrator, version and count problems never throw. `holdoutBrierActive` must be computed by the worker with `applyCalibrator` on the candidate's holdout window.

## Task Commits

1. **Task 1 (tracer): promotion gate, evaluation verdict, first promotion, sample helper** - `fbac58b` (feat)
2. **Task 2 (tdd): rollback hysteresis, rollback target, supersession** - `2a93acb` (feat)
3. **Task 3 (tdd): market calibration state resolver and strict parser** - `444dc77` (feat)

Tracer gate (type="tracer", auto human-verify mode `end-of-phase`, automated-only `<verify>`): the Task 1 verify (unit file + domain typecheck) was already green at commit; Task 2 followed.

## Verification run

- `pnpm vitest run --project unit tests/unit/calibration-platt.test.ts tests/unit/calibration-calibrator.test.ts tests/unit/calibration-lifecycle.test.ts tests/unit/calibration-view.test.ts` -> 4 files, 180 tests passed.
- `pnpm vitest run --project unit tests/unit/forecast-model-version.test.ts tests/unit/forecast.test.ts tests/unit/model-comparison.test.ts` -> 3 files, 72 tests passed.
- `pnpm --filter @bet-stats/domain typecheck` and `lint` -> clean. `pnpm typecheck` (turbo) -> 7 successful. Root `tsc -p tsconfig.json --noEmit` reports no errors in `calibration`/`helpers` paths.
- Invariants: `git diff --quiet 3c5f75e..HEAD -- packages/domain/src/forecast packages/domain/src/evaluation` -> exit 0; `git diff --quiet 3c5f75e..HEAD -- package.json pnpm-lock.yaml packages/domain/package.json` -> exit 0.
- Purity: `grep -c "Date\|Math.random\|process\.\|prisma"` on `lifecycle.ts` and `view.ts` -> 0 / 0.
- Acceptance greps: `decideCalibrationLifecycle` in lifecycle.ts >= 1; `consecutiveWorse` in lifecycle.ts = 4; `marketCalibration` in view.ts = 6.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two additional error codes in `errors.ts`**
- **Found during:** Task 1 and Task 3
- **Issue:** The plan requires exceptions `INVALID_CALIBRATION_EVALUATION` (non-finite delta) and `INVALID_MARKET_CALIBRATION` (strict parser); `calibrationError` only accepts members of the `CalibrationErrorCode` union from plan 01.
- **Fix:** Added both codes to the union in `packages/domain/src/calibration/errors.ts` (not listed in `files_modified`).
- **Commits:** fbac58b, 444dc77

**2. [Rule 2 - Missing critical functionality] Extra safeguards beyond the plan text**
- **Issue:** The plan did not say what to do with an unreadable outcome count, a non-positive calibrator version, non-normalised calibrated output, undefined optional values in the response, or contradictory state/reason pairs.
- **Fix:** Resolver returns UNAVAILABLE (`CALIBRATION_READ_FAILED` / `CALIBRATOR_INVALID`) for them; the parser rejects undefined values and enforces the state/reason matrix and `sampleSize < requiredSample` for INSUFFICIENT_DATA. All covered by tests.
- **Commit:** 444dc77

**3. [Plan refinement] Strict promotion boundary and additional action codes**
- D-05 says "not worse than raw by more than the threshold"; the plan itself refines it to a strict bound (delta < 0.002) aligned with WORSE (delta >= 0.002). Implemented as the plan specifies; recorded here as a decision.
- Additional NO_CHANGE code `CANDIDATE_NOT_BETTER_THAN_ACTIVE` also covers an unknown active Brier (fail closed). The Task 1 interim code `ACTIVE_CALIBRATOR_PRESENT` existed only in commit fbac58b and was replaced in Task 2.

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 2) plus one documented refinement. **Impact:** none on scope; changes confined to the calibration directory and tests; no frozen module or dependency touched.

## Authentication Gates

None.

## Issues Encountered

- A first attempt to append the Task 2 tests with a shell heredoc failed to parse (nothing was written); the tests were then added with the Edit tool. No effect on the repository state.
- Synthetic seeds (101, 202, 303, 404 and 11/12/13 in the view tests) and the miscalibration (slope 0.5, intercept 0.3) were fixed up front and not tuned; the end-to-end "fresh window of 60 is BETTER" check passed on the first run.

## Known Stubs

None.

## Threat Flags

None. All new code is pure; no endpoints, auth paths, file access or schema changes. Mitigations T-12-04 (hysteresis, eligibility, strict gate, no re-promotion, pause after rollback), T-12-05 (identity passed to `applyCalibrator` inside the resolver; exceptions become UNAVAILABLE) and T-12-06 (closed sets and strict parser) are covered by tests. T-12-SC: no dependency changes.

## Not verified / out of scope

- Behaviour on real production data: only synthetic fixtures; real data is expected to be in INSUFFICIENT_DATA for a long time.
- Reading `CalibratorEvent` and building `LifecycleInput` from it (plan 03/05), the worker job (plan 05), API wiring (plan 06) and UI (plan 07) are not part of this plan.
- No integration test was run; this plan adds none (no database access).

## Next Phase Readiness

Ready for 12-03 (tables, event log). The `LifecycleInput` fields above define what the event log must be able to reproduce: active calibrator record, evaluations since activation (eligible flag and verdict), restore target, and a "ever rolled back" flag per calibrator.

## Self-Check: PASSED

- Files: lifecycle.ts, view.ts, calibration-samples.ts, calibration-lifecycle.test.ts, calibration-view.test.ts, index.ts and errors.ts all exist.
- Commits: fbac58b, 2a93acb and 444dc77 are ancestors of HEAD.
