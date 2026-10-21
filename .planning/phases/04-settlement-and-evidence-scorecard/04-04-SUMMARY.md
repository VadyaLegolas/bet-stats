---
phase: 04-settlement-and-evidence-scorecard
plan: 04
subsystem: evaluation
tags: [decimal.js, prisma, postgresql, clv, value-settlement]
requires:
  - phase: 04-02
    provides: append-only settlement receipts and correction lineage
  - phase: 03-forecast-and-manual-value-workbench
    provides: immutable value receipts and manual odds selections
provides:
  - Exact flat-one-unit P/L receipts and disclosed ROI/Yield aggregates
  - Fail-closed comparable closing-line-value receipts
  - Append-only PostgreSQL ValueSettlement facts with tamper guards
affects: [04-05, 04-07, scorecards, backtesting]
actuals:
  tokens: 345661
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [Decimal strings at persistence boundaries, current-leaf correction views, fail-closed CLV tuple]
key-files:
  created: [packages/domain/src/evaluation/financial.ts, packages/domain/src/evaluation/clv.ts, packages/database/prisma/migrations/20260908_phase04_value_settlements/migration.sql, tests/unit/financial-evaluation.test.ts, tests/integration/value-settlement.test.ts]
  modified: [packages/database/prisma/schema.prisma, packages/domain/src/index.ts, packages/database/src/generated/prisma]
key-decisions:
  - "ROI and Yield are disclosed aliases of totalProfitUnits / totalStakedUnits under flat-one-unit-v1."
  - "A manual candidate price is allowed, but CLV is available only against an explicitly labeled MARKET_CLOSE observation with an exact comparable tuple."
patterns-established:
  - "Financial corrections append linked facts; aggregate views select only unsuperseded leaves."
  - "PostgreSQL independently derives result and Decimal arithmetic from immutable source identities."
requirements-completed: [EVAL-05, EVAL-08]
coverage:
  - id: D1
    description: Frozen VALUE_CANDIDATE receipts settle under exact one-unit arithmetic with disclosed aggregates.
    requirement: EVAL-05
    verification:
      - kind: unit
        ref: tests/unit/financial-evaluation.test.ts
        status: pass
      - kind: integration
        ref: tests/integration/value-settlement.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: CLV fails closed unless fixture, market, selection, format, convention and timestamps are comparable.
    requirement: EVAL-08
    verification:
      - kind: unit
        ref: tests/unit/financial-evaluation.test.ts#fails closed
        status: pass
      - kind: integration
        ref: tests/integration/value-settlement.test.ts#rejects source/timestamp mismatch
        status: pass
    human_judgment: false
duration: 16min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 4: Financial Evidence and CLV Summary

**Exact Decimal one-unit P/L and fail-closed CLV persisted as immutable, correction-aware PostgreSQL evidence.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-09-08T21:10:00Z
- **Completed:** 2026-09-08T21:26:43Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments

- Implemented win/loss/void/pending eligibility and aggregate policy with explicit numerator, denominator, count, ROI and Yield semantics.
- Implemented a stable reason matrix for unavailable CLV and exact odds-ratio calculation only for comparable observations.
- Added immutable ValueSettlement/ClosingOddsObservation persistence, retry convergence, correction lineage, current-leaf aggregation and database tamper guards.

## Task Commits

1. **Task 1 RED:** `1321712`
2. **Task 1 GREEN:** `e9aa556`
3. **Task 2 RED:** `7d079ac`
4. **Task 2 GREEN:** `3cd8839`

## Files Created/Modified

- `packages/domain/src/evaluation/financial.ts` - flat-one-unit settlement and aggregate policy.
- `packages/domain/src/evaluation/clv.ts` - exact comparable tuple validation and CLV receipt.
- `packages/database/prisma/schema.prisma` - immutable financial evidence models and relations.
- `packages/database/prisma/migrations/20260908_phase04_value_settlements/migration.sql` - append-only guards, persistence function and current views.
- `tests/unit/financial-evaluation.test.ts` - Decimal golden cases, CLV reason matrix and responsible-language scan.
- `tests/integration/value-settlement.test.ts` - PostgreSQL retry, correction, aggregate and tamper counterexamples.

## Decisions Made

- Empty financial cohorts return zero numerator/denominator/count but unavailable (`null`) ROI and Yield.
- Manual observations are explicit candidate evidence and never inferred to be closing prices.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Exported the new domain policies and regenerated Prisma client**
- **Found during:** Task 2
- **Issue:** New policies and models would otherwise be inaccessible through package public APIs or stale generated types.
- **Fix:** Added index exports and regenerated checked-in Prisma client files.
- **Verification:** Domain/database typechecks and Prisma validation passed.
- **Committed in:** `3cd8839`

## Issues Encountered

- Vitest required execution outside the filesystem sandbox because Vite child-process startup returned `spawn EPERM`; the approved execution path passed.
- Local Node is 25.2.1 while the repository declares Node 24.x; checks passed with the package-manager engine warning recorded.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Current-leaf financial aggregates and precise CLV availability reasons are ready for scorecard/API consumption.
- No open plan blocker.

## Self-Check: PASSED

- All created source, migration and test files exist.
- Commits `1321712`, `e9aa556`, `7d079ac`, and `3cd8839` exist.

---
*Phase: 04-settlement-and-evidence-scorecard*
*Completed: 2026-09-08*
