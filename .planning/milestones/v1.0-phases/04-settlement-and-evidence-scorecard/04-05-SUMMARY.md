---
phase: 04-settlement-and-evidence-scorecard
plan: 05
subsystem: evaluation
tags: [rolling-origin, backtest, forecast-orchestrator, prisma, bullmq]
requires:
  - phase: 04-08
    provides: production settlement pipeline
  - phase: 03-forecast-and-manual-value-workbench
    provides: immutable forecast publication and as-of evidence
provides:
  - One shared production/backtest ForecastOrchestrator.run path
  - Fail-closed post-cutoff leakage detection
  - Bounded deterministic rolling-origin plan and window receipts
affects: [04-06, 04-07, backtesting, forecast-publication]
actuals:
  tokens: 218154
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [shared as-of orchestration, deterministic backtest identity, append-only receipt lineage]
key-files:
  created: [packages/domain/src/evaluation/backtest.ts, packages/domain/src/evaluation/forecast-orchestrator.ts, workers/data-sync/src/jobs/backtests.ts, packages/database/prisma/migrations/20260908_phase04_backtest_receipts/migration.sql, tests/integration/backtest-origin.test.ts]
  modified: [apps/api/src/modules/forecasts/forecasts.service.ts, packages/domain/src/index.ts, packages/database/prisma/schema.prisma, packages/database/src/generated/prisma]
key-decisions:
  - "Production and backtest callers use the same ForecastOrchestrator.run contract; initiator metadata cannot change forecast identity."
  - "Any evidence source timestamp after the exact cutoff rejects publication with LEAKAGE_DETECTED."
  - "rolling-origin-v1 caps spans at 366 days, windows at 500, and concurrency at 4 while rejecting random split vocabulary."
requirements-completed: [EVAL-06]
duration: 12min
completed: 2026-09-09
status: complete
---

# Phase 4 Plan 5: Leakage-Safe Rolling-Origin Backtests Summary

**Production and historical evaluation now share one immutable as-of forecast path, with hostile future evidence rejected before publication.**

## Performance

- **Duration:** 12 min
- **Completed:** 2026-09-09
- **Tasks:** 2
- **Commits:** 4

## Accomplishments

- Extracted forecast evidence resolution, validation, model execution, identity derivation and publication into `ForecastOrchestrator.run`.
- Refactored `ForecastsService` and the rolling-origin worker adapter to invoke that exact shared contract.
- Added call-trace and receipt-identity parity witnesses plus fail-closed `LEAKAGE_DETECTED` counterexamples.
- Added bounded chronological plan admission, deterministic job/window identities, retry convergence, immutable Prisma receipts and PostgreSQL guards.

## Task Commits

1. **Task 1 RED:** `93df937`
2. **Task 1 GREEN:** `dcabe00`
3. **Task 2 RED:** `3e1da8e`
4. **Task 2 GREEN:** `1697a6e`

## Verification

- `tests/integration/backtest-origin.test.ts`: 4/4 passed.
- Forecast API/publication regression tests: 10/10 passed.
- Empty-database migration smoke: 1/1 passed.
- Domain, API, worker and database typechecks passed.
- Prisma schema validation and client generation passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Exported shared orchestration contracts and regenerated Prisma Client**
- **Found during:** Tasks 1 and 2
- **Issue:** Worker/API imports and new receipt models would otherwise use stale package boundaries and generated types.
- **Fix:** Added domain barrel exports and regenerated checked-in Prisma Client artifacts.
- **Committed in:** `dcabe00`, `1697a6e`

## Known Stubs

None.

## User Setup Required

None.

## Self-Check: PASSED

- All source, migration, generated model and test artifacts exist.
- Commits `93df937`, `dcabe00`, `3e1da8e`, and `1697a6e` exist.

---
*Phase: 04-settlement-and-evidence-scorecard*
*Completed: 2026-09-09*
