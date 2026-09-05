---
phase: 03-forecast-and-manual-value-workbench
plan: 01
subsystem: domain
tags: [typescript, decimal.js, poisson, odds, value-betting]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: cutoff-correct evidence projections and source receipts
provides:
  - Deterministic 0:0-7:7 Poisson forecast with coherent 1X2, O/U 2.5, and BTTS markets
  - Strict complete-book manual odds normalization with decimal-safe boundaries
  - Exact-pair value, no-value, and insufficient-evidence receipts
affects: [03-02, 03-03, 03-04, forecast-persistence, workbench-api]
actuals:
  tokens: 8591
  tasks: 2
  commits: 4
tech-stack:
  added: [decimal.js@10.6.0]
  patterns: [single score matrix market derivation, tagged abstention results, exact-key boundary parsing, canonical receipt hashing]
key-files:
  created: [packages/domain/src/forecast/model.ts, packages/domain/src/forecast/config.ts, packages/domain/src/forecast/confidence.ts, packages/domain/src/odds/contract.ts, packages/domain/src/odds/normalize.ts, packages/domain/src/value/contract.ts, packages/domain/src/value/decision.ts, tests/unit/forecast-value-tracer.test.ts]
  modified: [packages/domain/package.json, pnpm-lock.yaml]
key-decisions:
  - "Normalize all supported markets from one retained 64-cell score matrix and disclose tail mass separately."
  - "Treat evidence and confidence failures as ordered tagged abstentions while reserving exceptions for malformed calculation contracts."
patterns-established:
  - "Decimal boundaries: decimal odds, implied probability, no-vig probability, fair odds, edge, and EV use canonical decimal strings."
  - "Receipt identity: sorted evidence build IDs and source refs feed canonical SHA-256 hashes."
requirements-completed: [PRED-01, PRED-02, PRED-03, PRED-05, ODDS-01, ODDS-03, VALUE-01, VALUE-02, VALUE-03, VALUE-04]
coverage:
  - id: D1
    description: One cutoff-correct evidence pair produces coherent probabilities and disclosed tail mass from one score matrix.
    requirement: PRED-01
    verification:
      - kind: unit
        ref: tests/unit/forecast-value-tracer.test.ts#derives every market from one 64-cell matrix and produces a reproducible value receipt
        status: pass
    human_judgment: false
  - id: D2
    description: Complete manual odds books normalize to no-vig probabilities with decimal-safe overround.
    requirement: ODDS-03
    verification:
      - kind: unit
        ref: tests/unit/forecast-value-tracer.test.ts#derives every market from one 64-cell matrix and produces a reproducible value receipt
        status: pass
    human_judgment: false
  - id: D3
    description: Exact forecast and odds pairs produce auditable candidate, no-value, or insufficient-evidence outcomes.
    requirement: VALUE-04
    verification:
      - kind: unit
        ref: tests/unit/forecast-value-tracer.test.ts#forecast to manual value tracer
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-09-05
status: complete
---

# Phase 3 Plan 1: Forecast and Value Tracer Summary

**A deterministic Poisson forecast, complete-book decimal normalization, and exact-pair value gate now produce reproducible candidate and abstention receipts.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-05T18:54:00Z
- **Completed:** 2026-09-05T19:03:12Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Derived normalized 1X2, O/U 2.5, and BTTS markets from one disclosed 64-cell Poisson score matrix.
- Added strict complete-book parsing and multiplicative no-vig normalization using canonical decimal strings.
- Added ordered data-quality, confidence, edge, and EV gates with complete receipt provenance and three tagged outcomes.

## Task Commits

Each task followed RED/GREEN TDD commits:

1. **Task 1 RED: Forecast/value tracer behavior** - `1c6cbe8` (test)
2. **Task 1 GREEN: Production tracer** - `01791d2` (feat)
3. **Task 2 RED: Boundary invariants** - `c482105` (test)
4. **Task 2 GREEN: Strict public contracts** - `d7a7b31` (feat)

## Files Created/Modified

- `packages/domain/src/forecast/model.ts` - Expected-goal adjustment, Poisson matrix, market probabilities, hashes, and forecast receipt data.
- `packages/domain/src/forecast/config.ts` - Frozen forecast-config-v1 numeric policy and safe fair-odds conversion.
- `packages/domain/src/forecast/confidence.ts` - Separate confidence-v1 component aggregation.
- `packages/domain/src/odds/contract.ts` - Exact-key complete-book boundary parser.
- `packages/domain/src/odds/normalize.ts` - Multiplicative no-vig normalization and overround.
- `packages/domain/src/value/contract.ts` - Strict exact-pair command parser and market/selection invariant.
- `packages/domain/src/value/decision.ts` - Full-precision edge/EV gates and reproducible tagged receipt.
- `tests/unit/forecast-value-tracer.test.ts` - End-to-end tracer, abstention, malformed-input, policy, and permutation coverage.
- `packages/domain/package.json` - Exact decimal.js dependency.
- `pnpm-lock.yaml` - Frozen decimal.js resolution and integrity.

## Decisions Made

- Applied forecast-config-v1 defaults from Phase 3 research as transparent starting policy, explicitly pending Phase 4 calibration.
- Kept probability and confidence separate; confidence participates only as a decision gate.
- Canonicalized selection, source, and evidence-build order before output and hashing so input permutation cannot change receipts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repaired initial phase state position**
- **Found during:** Plan metadata update
- **Issue:** `state.advance-plan` could not parse the pre-execution `Current Plan: Not started` value.
- **Fix:** Recorded Plan 01 and Phase 3 in-progress position directly after all other SDK state updates succeeded.
- **Files modified:** `.planning/STATE.md`
- **Verification:** STATE, ROADMAP, and on-disk summary consistently report 1/7 plans complete.
- **Committed in:** Plan metadata commit

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Metadata-only compatibility repair; implementation scope is unchanged.

## Issues Encountered

- pnpm initially selected a workspace-local store incompatible with existing node_modules links; execution reused the established `D:\.pnpm-store\v10` store and installed the exact audited package.
- The local runtime is Node 25.2.1 while the repository declares Node 24 LTS. This produced an engine warning only; all tests and typechecks passed.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/unit --project unit` — 9 files, 89 tests passed.
- `corepack pnpm --filter @bet-stats/domain typecheck` — passed.

## Next Phase Readiness

- Forecast, odds, and value calculation seams are ready for immutable persistence and later transport publication.
- No blocking issues remain for dependent Phase 3 plans.

## Self-Check: PASSED

- All eight created modules/tests and both modified dependency files exist.
- Commits `1c6cbe8`, `01791d2`, `c482105`, and `d7a7b31` exist in repository history.

---
*Phase: 03-forecast-and-manual-value-workbench*
*Completed: 2026-09-05*
