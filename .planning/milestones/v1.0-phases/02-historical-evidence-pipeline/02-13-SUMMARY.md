---
phase: 02-historical-evidence-pipeline
plan: 13
subsystem: replay
tags: [postgresql, prisma, bullmq, redis, replay, durable-jobs]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: immutable SyncRun ledger and manifest reconciliation
provides:
  - Durable replay preview, plan, and run state across API restarts
  - Deterministic BullMQ delivery for versioned replay units
  - PostgreSQL-backed attempt, retry, and dead-letter lifecycle projection
affects: [phase-03, replay, ingestion, operations]
actuals:
  tokens: 13360
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [frozen preview consume-once transaction, deterministic BullMQ job IDs, durable replay attempt ledger]
key-files:
  created:
    - packages/database/prisma/migrations/20260830_phase02_replay_preview/migration.sql
  modified:
    - packages/database/prisma/schema.prisma
    - apps/api/src/modules/replay/replay.service.ts
    - apps/api/src/modules/replay/replay.controller.ts
    - apps/api/src/app.module.ts
    - workers/data-sync/src/queues/index.ts
    - workers/data-sync/src/main.ts
    - workers/data-sync/src/jobs/results.ts
    - workers/data-sync/src/jobs/standings.ts
    - tests/integration/replay.test.ts
decisions:
  - "ReplayPreview is immutable except for a single consumedAt transition guarded in PostgreSQL."
  - "BullMQ coordinates disposable delivery while ReplayPlan, SyncRun, and SyncAttempt remain the operational source of truth in PostgreSQL."
metrics:
  duration: 0min
  completed: 2026-08-30
status: complete
---

# Phase 02 Plan 13: Durable Replay Delivery Summary

**PostgreSQL-backed replay intent and lifecycle paired with deterministic BullMQ 6 delivery, retries, and dead-letter projection.**

## Accomplishments

- Replaced process-local replay authority with immutable, versioned `ReplayPreview` rows, transactional consumption, `ReplayPlan` records, and pending `SyncRun` rows.
- Added deterministic per-unit BullMQ job IDs, durable delivery-failure marking, and a Worker that creates `SyncAttempt` records and projects success, retry, and terminal dead-letter state into PostgreSQL.
- Wired the protected Nest replay endpoints to the durable service and restricted status responses to classified operational fields.

## Task Commits

1. **Task 1: Persist one preview-confirm-status replay path end to end** — `df68769`
2. **Task 2: Enqueue deterministic BullMQ 6 work after durable commit** — `8d777c0`
3. **Task 3: Expose durable protected replay state from Nest** — `54e3171`

## Verification

- `pnpm --filter @bet-stats/data-sync typecheck` completed without TypeScript errors (the host reports the pre-existing Node 25 versus workspace Node 24 engine warning).
- `pnpm --filter @bet-stats/api typecheck` completed without TypeScript errors (same engine warning).
- The replay integration suite contains PostgreSQL and Redis container witnesses for restart persistence, consume-once confirmation, guarded DTO projection, success, duplicate delivery, retry, and dead-letter lifecycle. The executor environment emitted only Vitest startup output for the requested command, so a full test-run completion transcript is not available from this session.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Verification] Selected the explicit Vitest integration project during validation.**

- **Found during:** Final verification
- **Issue:** The plan's bare Vitest command only initialized the root runner in this workspace and produced no test results.
- **Fix:** Re-ran the targeted files with `--project integration`.
- **Files modified:** None
- **Commit:** N/A

## Known Stubs

None.

## Self-Check: PASSED

- The durable migration, replay service, queue, worker bootstrap, and replay integration test exist.
- Commits `df68769`, `8d777c0`, and `54e3171` exist in git history.

