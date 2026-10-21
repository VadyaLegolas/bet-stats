---
phase: 04-settlement-and-evidence-scorecard
plan: 02
subsystem: evaluation
tags: [brier-score, log-loss, prisma, postgresql, immutable-evidence]
requires:
  - phase: 04-01
    provides: exact frozen settlement receipts and correction lineage
provides:
  - versioned categorical Brier-sum-v1 and LogLoss-v1 scoring
  - immutable ForecastScore facts with current-leaf cohort aggregation
affects: [04-03, 04-04, 04-06, evidence-scorecard]
tech-stack:
  added: []
  patterns: [pure golden-vector scoring, append-only score lineage, database formula guard]
key-files:
  created:
    - packages/domain/src/evaluation/scoring.ts
    - packages/database/prisma/migrations/20260908_phase04_z_score_facts/migration.sql
    - packages/database/src/generated/prisma/models/ForecastScore.ts
    - tests/unit/evaluation.test.ts
    - tests/integration/forecast-scoring.test.ts
  modified:
    - packages/domain/src/index.ts
    - packages/database/prisma/schema.prisma
decisions:
  - "Use the unscaled categorical Brier sum in [0,2] and natural Log Loss clipped at epsilon 1e-15."
  - "Persist score corrections as linked rows and expose only leaf facts through current_forecast_scores."
metrics:
  duration: 18min
  completed: 2026-09-08
actuals:
  tokens: 204084
  tasks: 2
  commits: 4
status: complete
---

# Phase 4 Plan 2: Proper Score Facts Summary

Versioned Brier and Log Loss evidence now binds exact frozen forecast vectors to append-only settlement revisions, with PostgreSQL-enforced formula integrity and reproducible cohort dimensions.

## Performance

- **Duration:** 18 min
- **Tasks:** 2
- **Files modified:** 18 (including generated Prisma client)

## Accomplishments

- Locked market class order, unscaled Brier convention, natural-log epsilon, and golden values for all supported categorical markets.
- Added immutable `ForecastScore` facts containing exact source IDs, model/competition/market/UTC dimensions, formula identity, raw and clipped probabilities, metrics, and counts.
- Added idempotent persistence, correction lineage, indexed inclusive-exclusive cohort queries, and a current-leaf view.
- PostgreSQL rejects source mismatches, mutations, forged outcomes, formula receipts, copied probabilities, and inconsistent metrics.

## Task Commits

1. **Task 1 RED:** `cb29de1` — failing categorical score contract tests
2. **Task 1 GREEN:** `aa7bb9c` — versioned pure scoring implementation
3. **Task 2 RED:** `de75601` — failing immutable persistence and aggregation tests
4. **Task 2 GREEN:** `79c65bf` — guarded ForecastScore storage and generated Prisma client

## Decisions Made

- Raw chosen probability remains disclosed; clipping applies only inside Log Loss.
- Formula convention is persisted as version, SHA-256 identity, class order, epsilon, and receipt.
- Aggregates count fixture, score, and event denominators separately and include only correction leaves.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved the new migration after its settlement dependency**
- **Found during:** Task 2 GREEN
- **Issue:** The planned directory name sorted before `20260908_phase04_settlement_receipts`, so a fresh deploy attempted to reference a table not yet created.
- **Fix:** Renamed the new append-only migration to `20260908_phase04_z_score_facts` without changing prior migrations.
- **Verification:** Fresh PostgreSQL `prisma migrate deploy` completed in the integration suite.
- **Commit:** `79c65bf`

**2. [Rule 1 - Test bug] Corrected the DRAW golden Brier assertion**
- **Found during:** Task 2 GREEN
- **Issue:** The test expected `0.98`; the unscaled Brier sum for `[0.5,0.3,0.2]` with DRAW is `0.78`.
- **Fix:** Corrected the expected value while retaining independent database recomputation.
- **Verification:** Integration suite passes 3/3.
- **Commit:** `79c65bf`

## Issues Encountered

- The environment runs Node 25.2.1 while the repository requests Node 24.x; checks passed with the existing known engine warning.

## User Setup Required

None. The integration test owns and removes its disposable PostgreSQL container.

## Verification

- Unit scoring: 10/10 passed.
- PostgreSQL integration: 3/3 passed on a fresh migration deployment.
- Prisma schema validation: passed.
- Domain and database TypeScript typechecks: passed.

## Next Phase Readiness

- EVAL-03 score facts are ready for calibration buckets and scorecard APIs.
- No open stubs, skipped tests, or unrun verification remain.

## Self-Check: PASSED

- All declared source, migration, tests, and generated Prisma files exist.
- Commits `cb29de1`, `aa7bb9c`, `de75601`, and `79c65bf` exist in history.

---
*Phase: 04-settlement-and-evidence-scorecard*
*Completed: 2026-09-08*
