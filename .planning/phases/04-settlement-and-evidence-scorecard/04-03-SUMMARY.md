---
phase: 04-settlement-and-evidence-scorecard
plan: 03
subsystem: evaluation
tags: [typescript, reliability, calibration, cohort-health, tdd]
requires:
  - phase: 04-settlement-and-evidence-scorecard
    provides: immutable categorical ForecastScore facts from plan 04-02
provides:
  - Versioned deterministic reliability buckets with visible population and direction
  - Selection-level binary forecast events derived from categorical score facts
  - Honest UNAVAILABLE, LIMITED, and AVAILABLE cohort evidence gates
  - Exact cohort aggregation with separate fixture, forecast, event, and value denominators
affects: [04-scorecard-api, 04-scorecard-ui, calibration, backtesting]
actuals:
  tokens: 4871
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [pure versioned statistical policies, content-addressed policy identity, exact cohort filtering]
key-files:
  created:
    - packages/domain/src/evaluation/reliability.ts
    - packages/domain/src/evaluation/cohort-health.ts
    - tests/unit/reliability.test.ts
    - tests/integration/reliability-aggregation.test.ts
  modified:
    - packages/domain/src/index.ts
key-decisions:
  - "Reliability expands each categorical score into one binary event per selection before bucket aggregation."
  - "Only populated buckets participate in the minimum-bucket health gate; empty buckets remain visible as insufficient evidence."
  - "Cohort policy identities are derived from exact serialized thresholds so changed gates cannot silently relabel evidence."
patterns-established:
  - "Reliability policy: integer bucket assignment with an explicitly closed final edge."
  - "Cohort evidence: exact dimensions and inclusive-exclusive UTC periods, with no silent widening."
requirements-completed: [EVAL-04, EVAL-07]
coverage:
  - id: D1
    description: Deterministic reliability buckets expose mean forecast, observed frequency, count, gap, direction, and policy identity.
    requirement: EVAL-04
    verification:
      - kind: unit
        ref: tests/unit/reliability.test.ts#reliability-policy-v1
        status: pass
    human_judgment: false
  - id: D2
    description: Empty and weak cohorts expose honest health states and all sample denominators without silent filter widening.
    requirement: EVAL-07
    verification:
      - kind: unit
        ref: tests/unit/reliability.test.ts#cohort-health-v1
        status: pass
      - kind: integration
        ref: tests/integration/reliability-aggregation.test.ts#reliability cohort aggregation
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-09-08
status: complete
---

# Phase 04 Plan 03: Reliability and Cohort Health Summary

**Versioned calibration buckets and exact-cohort health gates preserve every denominator while withholding claims from sparse evidence.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-08T21:11:00Z
- **Completed:** 2026-09-08T21:20:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Expanded complete categorical scores into selection-level binary observations and assigned exact probability edges deterministically.
- Added five, ten, and twenty-bucket sensitivity coverage proving population and weighted-mean preservation.
- Added versioned cohort health decisions with explicit reasons and fixture, forecast, event, and value denominators.
- Proved aggregation respects the requested league, model, market, and inclusive-exclusive UTC period without widening.

## Task Commits

1. **Task 1 RED: reliability contract tests** — `c5a8337`
2. **Task 1 GREEN: versioned reliability buckets** — `6405192`
3. **Task 2 RED: cohort health and exact aggregation tests** — `4122241`
4. **Task 2 GREEN: cohort health gates and aggregation** — `a67138e`

## Files Created/Modified

- `packages/domain/src/evaluation/reliability.ts` — binary event expansion, policy identity, bucket assignment, direction, and aggregation.
- `packages/domain/src/evaluation/cohort-health.ts` — health policy, reasons, denominators, and exact cohort aggregation.
- `packages/domain/src/index.ts` — exports both evaluation contracts.
- `tests/unit/reliability.test.ts` — boundary, sensitivity, direction, identity, and health-state coverage.
- `tests/integration/reliability-aggregation.test.ts` — exact persisted-event cohort filtering and empty-result behavior.

## Decisions Made

- Signed gap is `observed frequency - mean forecast`: positive is under-confident, negative is over-confident, and absolute gaps through 0.02 are aligned.
- Empty buckets remain serialized with zero population and `INSUFFICIENT`; they are not dropped and do not themselves disqualify a sufficiently populated cohort.
- LIMITED and UNAVAILABLE results always carry `performanceClaim: null`; only AVAILABLE evidence receives a qualified evidence marker.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test bug] Used tolerance assertions for floating-point bucket arithmetic**
- **Found during:** Task 1 GREEN
- **Issue:** Exact equality rejected mathematically correct IEEE-754 sums such as `0.5999999999999999`.
- **Fix:** Kept exact assertions for discrete fields and used twelve-decimal tolerance for means and gaps.
- **Files modified:** `tests/unit/reliability.test.ts`
- **Verification:** Reliability unit suite passes 9/9.
- **Committed in:** `6405192`

**2. [Rule 1 - Policy identity] Canonicalized policy inputs before hashing**
- **Found during:** Task 2 GREEN
- **Issue:** Reusing a full policy object could otherwise include its existing identity in the next serialized receipt.
- **Fix:** Hash only the declared version and threshold fields for stable, replayable identity.
- **Files modified:** `packages/domain/src/evaluation/reliability.ts`, `packages/domain/src/evaluation/cohort-health.ts`
- **Verification:** Threshold identity and full aggregation suites pass.
- **Committed in:** `a67138e`

**Total deviations:** 2 auto-fixed Rule 1 issues.
**Impact on plan:** Both fixes preserve deterministic statistical evidence without expanding scope.

## Issues Encountered

- The repository requests Node 24.x while the environment runs Node 25.2.1; all checks passed with the existing engine warning.

## User Setup Required

None.

## Verification

- `corepack pnpm exec vitest run tests/unit/reliability.test.ts tests/integration/reliability-aggregation.test.ts --project unit --project integration` — 11/11 passed.
- `corepack pnpm --filter @bet-stats/domain typecheck` — passed.
- Stub scan across all plan source and test files — no TODO, FIXME, placeholder, or coming-soon markers.

## Next Phase Readiness

- Scorecard APIs can consume versioned reliability results without reconstructing chart arithmetic.
- UI layers receive explicit health, reasons, policy identity, and denominators for honest limited-data presentation.

## Self-Check: PASSED

- All five declared source and test files exist.
- Commits `c5a8337`, `6405192`, `4122241`, and `a67138e` exist in history.

---
*Phase: 04-settlement-and-evidence-scorecard*
*Completed: 2026-09-08*
