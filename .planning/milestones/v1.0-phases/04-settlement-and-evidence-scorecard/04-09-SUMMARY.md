---
phase: 04-settlement-and-evidence-scorecard
plan: 09
subsystem: evaluation
tags: [postgresql, prisma, bullmq, backtest, settlement]
requires:
  - phase: 04-05
    provides: rolling-origin forecast orchestration
  - phase: 04-08
    provides: settlement and score persistence
provides:
  - durable scored rolling-origin plans executed through BullMQ
  - append-only evaluation correction lineage bounded by evaluationAsOf
  - matched persisted model comparison with explicit unavailable reasons
affects: [phase-04-verification, evidence-scorecard]
actuals:
  tokens: 33000
  tasks: 3
  commits: 4
tech-stack:
  added: []
  patterns: [durable-before-enqueue, compact-hash-verified-jobs, append-only-evaluation-revisions]
key-files:
  created: [packages/database/src/evaluation/backtest-repository.ts, tests/integration/backtest-production.test.ts]
  modified: [packages/database/prisma/schema.prisma, workers/data-sync/src/jobs/backtests.ts, workers/data-sync/src/queues/index.ts]
key-decisions:
  - "Forecast evidence uses forecastCutoff while result knowledge independently uses evaluationAsOf."
  - "BullMQ carries only plan identity and hash; workers reconstruct immutable work from PostgreSQL."
patterns-established:
  - "Historical result resolution builds and validates only the graph visible at evaluationAsOf."
  - "Corrections append current-leaf evaluation receipts without deleting prior score IDs."
requirements-completed: [EVAL-06]
coverage:
  - id: D1
    description: Durable production backtests score exact as-of results and preserve correction lineage.
    requirement: EVAL-06
    verification:
      - kind: integration
        ref: tests/integration/backtest-production.test.ts#persists and scores one exact rolling-origin window
        status: pass
    human_judgment: false
  - id: D2
    description: BullMQ delivery retries converge and compatible persisted plans produce matched comparisons.
    requirement: EVAL-06
    verification:
      - kind: integration
        ref: tests/integration/backtest-production.test.ts#reconciles durable queue delivery and compares current corrected leaves
        status: pass
    human_judgment: false
duration: 18min
completed: 2026-09-09
status: complete
---

# Phase 4 Plan 9: Scored Production Backtests Summary

**PostgreSQL-backed rolling-origin plans now survive delivery retries, score exact historical result leaves, retain correction history, and compare matched cohorts through the production BullMQ path.**

## Performance

- **Duration:** 18 min
- **Completed:** 2026-09-09
- **Tasks:** 3
- **Files modified:** 22

## Accomplishments

- Added durable plan/window/evaluation receipts with independent forecast and result knowledge boundaries.
- Shared the exact Prisma forecast repository between Nest API and data-sync worker.
- Added bounded BullMQ producer/consumer delivery, reconciliation, score-leaf comparison, and fresh PostgreSQL/Redis tests.

## Task Commits

1. **Persist and score exact rolling-origin windows** — `5f56587`
2. **Share production forecast repository** — `e15bd93`
3. **Enqueue, reconcile and consume durable plans** — `7488efd`
4. **Regenerate Prisma Client** — `ecc27f0`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected settlement policy identity**
- **Found during:** Task 1 production integration test
- **Issue:** The new repository passed a non-existent `settlement-v1` policy and every scored window failed closed.
- **Fix:** Reused the domain-owned `SETTLEMENT_POLICY_VERSION` constant.
- **Verification:** Both rolling-origin suites pass, 7/7 tests.
- **Committed in:** `5f56587`

**2. [Rule 3 - Blocking] Regenerated Prisma Client**
- **Found during:** Typecheck
- **Issue:** Generated types did not contain the new evaluation and delivery schema.
- **Fix:** Regenerated the checked-in Prisma 7 client.
- **Verification:** Database, API and data-sync typechecks pass.
- **Committed in:** `ecc27f0`

## Verification

- `tests/integration/backtest-production.test.ts` and `backtest-origin.test.ts`: 7 passed.
- `@bet-stats/database`, `@bet-stats/api`, `@bet-stats/data-sync` typechecks: passed.
- Tests provisioned fresh PostgreSQL 18 and Redis 8 containers and removed them afterward.

## Known Stubs

None.

## Self-Check: PASSED

All required artifacts and commits exist. No plan blocker remains.
