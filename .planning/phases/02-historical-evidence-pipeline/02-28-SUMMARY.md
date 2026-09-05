---
phase: 02-historical-evidence-pipeline
plan: 28
status: complete
completed: 2026-09-05
subsystem: replay-execution
tags: [bullmq, postgresql, fencing, leases, crash-recovery]
requires: [02-27]
provides: [recoverable-running-replays, fenced-provider-effects, atomic-replay-publication]
affects: [PIPE-01, PIPE-05, PIPE-06]
tech-stack:
  added: []
  patterns: [database-clock-execution-lease, fencing-token, attempt-specific-budget-reservation, atomic-publication]
key-files:
  created:
    - packages/database/prisma/migrations/20260904_phase02_sync_run_execution_lease/migration.sql
    - workers/data-sync/src/queues/replay-execution.ts
    - workers/data-sync/src/replay-crash-harness.ts
    - tests/integration/replay-crash-recovery.test.ts
    - tests/integration/replay-lease-upgrade.test.ts
  modified:
    - workers/data-sync/src/queues/index.ts
    - workers/data-sync/src/ingestion/runner.ts
    - workers/data-sync/src/jobs/fixtures.ts
    - workers/data-sync/src/jobs/results.ts
    - workers/data-sync/src/jobs/standings.ts
decisions:
  - PostgreSQL clock and row locks own replay execution lease decisions.
  - Every possible remote dispatch receives a distinct attempt-specific budget reservation.
  - Canonical publication and durable success commit under the same fencing-token transaction.
actuals:
  tokens: 103781
  tasks: 3
  commits: 9
metrics:
  duration: 18min
  completed_date: 2026-09-05
---

# Phase 02 Plan 28: Recoverable Replay Execution Summary

Replay execution now survives a killed BullMQ worker through a PostgreSQL-owned execution lease. Expired owners are closed as `WORKER_LEASE_EXPIRED`, replacement attempts receive a new random fencing token and database-allocated attempt number, and stale owners cannot renew, dispatch, publish, or write terminal state.

All replay endpoints carry the execution context through provider admission and publication. Each physical attempt reserves budget with its own identity before provider construction, and fixtures, results or standings publish together with `SyncAttempt` and `SyncRun` success in one transaction. An uncertain remote dispatch may be repeated by a later bounded attempt; every such dispatch remains separately charged while canonical persistence stays idempotent.

## Task Commits

- `8a3ff71` / `89cccf1` — RED/GREEN for execution lease claim, reclaim and fencing.
- `bfddb2d` / `c919581` — RED/GREEN for provider admission and atomic publication.
- `ec7c5ae` / `6dd2577` — RED/GREEN process-kill recovery witness.
- `1846581` — startup and periodic reconciliation for exhausted queue deliveries.
- `90ed454` — populated PostgreSQL 18 migration witness.

## Verification

- Prisma schema validation passed.
- Data-sync build and typecheck passed.
- Empty PostgreSQL 18 migration deploy passed.
- Populated pre-lease PostgreSQL 18 upgrade passed while preserving PENDING, RUNNING, SUCCEEDED, FAILED and existing SyncAttempt rows.
- Crash, lease, publication and upgrade integration suite passed: 8/8 tests. The crash test kills a separately built worker after its durable claim, starts the replacement before lease expiry, relies on the same stalled BullMQ delivery, and observes one replacement execution plus one terminal success.
- Tests ran on Node 25.2.1 and emitted the repository engine warning (`>=24 <25`); compilation and assertions passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added failed-delivery reconciliation**

- **Found during:** Task 3
- **Issue:** Lease reclaim alone did not guarantee a durable terminal outcome after BullMQ exhausted a delivery or the failed event was missed during restart.
- **Fix:** Inspect the owned queue's failed jobs at startup and every five seconds, then close expired or pending nonterminal runs as `QUEUE_DELIVERY_EXHAUSTED` through legal attempt transitions.
- **Files modified:** `workers/data-sync/src/queues/index.ts`
- **Commit:** `1846581`

## Known Stubs

None.

## Self-Check: PASSED

All created files and nine plan commits exist. Required migration, typecheck, empty/populated database, BullMQ redelivery and process-kill checks passed.
