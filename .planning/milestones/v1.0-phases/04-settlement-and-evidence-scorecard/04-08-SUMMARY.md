---
phase: 04-settlement-and-evidence-scorecard
plan: 08
subsystem: evaluation-pipeline
tags: [postgresql, prisma, bullmq, settlement, idempotency, corrections]
requires:
  - phase: 04-01
    provides: immutable settlement receipts
  - phase: 04-02
    provides: immutable proper-score facts
  - phase: 04-04
    provides: immutable value settlements
provides:
  - shared ResultVersion-to-evaluation application service
  - deterministic settlement BullMQ producer and consumer
  - correction-aware transactional score and value fan-out
affects: [scorecards, result-ingestion, phase-04-verification]
tech-stack:
  added: []
  patterns: [serializable transaction retry, fixture advisory lock, deterministic job identity, recursive correction lineage]
key-files:
  created:
    - packages/database/src/evaluation/settlement-pipeline.ts
    - workers/data-sync/src/jobs/settlement.ts
    - tests/integration/settlement-pipeline.test.ts
  modified:
    - packages/database/src/index.ts
    - workers/data-sync/src/jobs/results.ts
    - workers/data-sync/src/queues/index.ts
    - workers/data-sync/src/main.ts
key-decisions:
  - "Result publication enqueues every explicit eligible frozen snapshot instead of selecting an implicit latest forecast."
  - "Correction processing materializes missing ancestors under one fixture lock before appending the requested revision."
actuals:
  tokens: 12490
  tasks: 3
  commits: 6
duration: 16min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 8: Production Settlement Pipeline Summary

**Result publication now drives one idempotent PostgreSQL pipeline from exact result and forecast identities through immutable settlement, score, and flat-unit value facts.**

## Accomplishments

- Added a shared database-package service that validates exact source identity, resolves the versioned policy, and persists the complete receipt chain in a short serializable transaction.
- Wired the real result replay publication path to a dedicated BullMQ settlement queue with deterministic identity, bounded exponential retry, correlation IDs, and strict payload/policy validation.
- Added correction fan-out that preserves prior rows, links replacement settlement/score/value facts, survives duplicate and concurrent delivery, and rolls back forced partial failures.
- Terminal pending/non-scored lifecycles retain their explicit reason receipt without creating score or financial facts.

## Task Commits

1. **Task 1 RED:** `96f4213`
2. **Task 1 GREEN:** `35df8b6`
3. **Task 2 RED:** `d8d2dc5`
4. **Task 2 GREEN:** `e0bc19d`
5. **Task 3 RED:** `fbafda1`
6. **Task 3 GREEN:** `ccc8d7b`

## Verification

- `corepack pnpm exec vitest run tests/integration/settlement-pipeline.test.ts --project integration` — 5/5 passed against fresh migrated PostgreSQL 18.
- `corepack pnpm --filter @bet-stats/database typecheck` — passed.
- `corepack pnpm --filter @bet-stats/data-sync typecheck` — passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used a BullMQ-safe stored job ID while retaining the canonical audit identity**
- **Found during:** Task 2
- **Issue:** BullMQ reserves colon separators in custom job IDs, while the plan specifies a colon-delimited canonical identity.
- **Fix:** `createSettlementJobId` exposes the exact required identity; queue storage replaces separators deterministically without changing payload identity or deduplication semantics.
- **Files modified:** `workers/data-sync/src/queues/index.ts`
- **Commit:** `e0bc19d`

**2. [Rule 2 - Missing Critical] Added transactional fault injection seam**
- **Found during:** Task 3
- **Issue:** A real partial-failure rollback could not be proven deterministically without a failure point inside the transaction.
- **Fix:** Added an optional post-receipt hook used only by integration tests; thrown failures roll back the entire receipt chain.
- **Files modified:** `packages/database/src/evaluation/settlement-pipeline.ts`
- **Commit:** `ccc8d7b`

## Known Stubs

None.

## Threat Flags

None. The asynchronous trust boundary was included in the plan threat model and is protected by exact validated IDs, policy hash validation, bounded retries, database uniqueness, and append-only lineage.

## Issues Encountered

- The local runtime is Node 25.2.1 while package metadata requests Node 24.x; all checks passed with the known engine warning.

## Self-Check: PASSED

- All seven planned implementation/test files exist.
- All six RED/GREEN commits exist in Git history.
- No generated or runtime files from the test remain tracked or untracked by this plan.
