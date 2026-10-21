---
phase: 02-historical-evidence-pipeline
plan: 17
subsystem: replay
tags: [postgresql, prisma, bullmq, redis, transactional-outbox, leases]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: guarded SyncRun lifecycle, deterministic replay identity, and production replay handlers from Plan 02-16
provides:
  - One transactional replay-delivery obligation for every committed SyncRun
  - Leased idempotent BullMQ dispatcher with partial-failure and process-restart recovery
  - Safe separate delivery and Worker execution projections in replay status
  - Durable ProviderCircuitState probe-lease schema owned ahead of Plan 02-18
affects: [02-18, replay, data-sync, operations, provider-circuit-policy]
actuals:
  tokens: 110095
  tasks: 2
  commits: 5
tech-stack:
  added: []
  patterns: [transactional outbox, skip-locked leased claim, deterministic queue delivery, conditional acknowledgement]
key-files:
  created:
    - apps/api/src/modules/replay/replay-delivery.service.ts
    - packages/database/prisma/migrations/20260831_phase02_replay_delivery/migration.sql
  modified:
    - apps/api/src/modules/replay/replay.service.ts
    - packages/database/prisma/schema.prisma
    - tests/integration/replay.test.ts
    - tests/integration/replay-boundary.test.ts
    - tests/integration/migration-empty.test.ts
key-decisions:
  - "PostgreSQL creates one ReplayDelivery row in the same transaction as each SyncRun; Redis/BullMQ never becomes replay delivery truth."
  - "Dispatch claims one row at a time with FOR UPDATE SKIP LOCKED, enqueues outside the transaction, then acknowledges only the matching lease token."
  - "A replay delivery reuses logicalId-revision as its immutable BullMQ job ID, so uncertain delivery and restart recovery cannot duplicate canonical work."
patterns-established:
  - "Outbox transition pattern: PENDING/RETRYABLE/expired CLAIMED -> CLAIMED -> DELIVERED|RETRYABLE, guarded in PostgreSQL."
  - "Operational status reports delivery and execution independently and exposes classified reasons and lease expiry but never lease tokens or raw infrastructure errors."
requirements-completed: [PIPE-05, PIPE-06]
coverage:
  - id: D1
    description: "Every committed replay unit has exactly one durable delivery obligation before any BullMQ call can fail."
    requirement: PIPE-06
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#atomically creates versioned runs, consumes once, and reconstructs status"
        status: pass
      - kind: integration
        ref: "tests/integration/migration-empty.test.ts#creates canonical tables and immutable reconciliation audit relations"
        status: pass
    human_judgment: false
  - id: D2
    description: "Partial enqueue, concurrent dispatch, and expired-lease restart recovery deliver each deterministic BullMQ unit without duplicate execution."
    requirement: PIPE-05
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#recovers only the undelivered BullMQ unit after partial enqueue and service restart"
        status: pass
      - kind: integration
        ref: "tests/integration/replay.test.ts#serializes concurrent dispatchers and reclaims an expired delivery lease"
        status: pass
      - kind: integration
        ref: "tests/integration/replay-boundary.test.ts#crosses Next proxy, guarded Nest, BullMQ Worker and durable PostgreSQL terminal state"
        status: pass
    human_judgment: false
duration: 17min
completed: 2026-08-31
status: complete
---

# Phase 02 Plan 17: Transactional Replay Delivery Summary

**Transactional per-run outbox with leased deterministic BullMQ dispatch, restart recovery, and separate delivery/execution observability**

## Performance

- **Duration:** 17 min
- **Started:** 2026-08-31T08:19:38Z
- **Completed:** 2026-08-31T08:36:38Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments

- Added a PostgreSQL-guarded `ReplayDelivery` ledger created atomically beside every `SyncRun`, including immutable job identity, attempt count, safe failure classification, bounded lease, and terminal delivery timestamps.
- Replaced direct post-commit enqueue loops with a one-row leased dispatcher that recovers partial queue failure, duplicate confirmation, concurrent dispatch, and expired process leases while reusing the same BullMQ job ID.
- Extended replay status with independent delivery and Worker execution projections and added real PostgreSQL 18/Redis 8 witnesses proving no duplicate canonical execution after restart.
- Added nullable circuit probe-lease token/expiry fields and a CAS-supporting index without changing the existing D-13 circuit state semantics.

## Task Commits

1. **Task 1 RED: Expose missing replay delivery ledger** — `71e1913`
2. **Task 1 GREEN: Persist replay delivery obligations** — `5f5095f`
3. **Task 2 RED: Expose replay delivery recovery gaps** — `33c204b`
4. **Task 2 GREEN: Recover leased replay delivery** — `db4c3d7`
5. **Task 2 verification repair: Remove SHA ordering assumption** — `fd28296`

## Files Created/Modified

- `packages/database/prisma/migrations/20260831_phase02_replay_delivery/migration.sql` — durable delivery state machine, restrictive checks/triggers, and provider probe-lease columns/index.
- `packages/database/prisma/schema.prisma` and generated Prisma client — typed `ReplayDelivery` relation/state plus probe-lease fields.
- `apps/api/src/modules/replay/replay-delivery.service.ts` — transactional `SKIP LOCKED` claim, outside-transaction enqueue, conditional acknowledgement, retry classification, and lease recovery.
- `apps/api/src/modules/replay/replay.service.ts` — atomic outbox creation, duplicate-confirmation repair, callable dispatcher recovery, deterministic production enqueue, and safe status projection.
- `tests/integration/replay.test.ts` — partial real Redis enqueue, reconstruction, concurrent dispatcher, expired lease, deterministic job, and no-duplicate-execution witnesses.
- `tests/integration/replay-boundary.test.ts` — production boundary assertion for distinct delivery/execution terminal state.
- `tests/integration/migration-empty.test.ts` — fresh PostgreSQL schema witness for the outbox, guarded trigger, and circuit probe lease.

## Decisions Made

- The dispatcher claims only one delivery per transaction. This bounds failure impact: a failed enqueue leaves that row `RETRYABLE` and does not strand a batch of unrelated active leases.
- `ReplayDelivery` stores the immutable BullMQ job ID but reconstructs payload from durable `SyncRun`, `ReplayPlan`, and consumed `ReplayPreview`, avoiding a second mutable copy of canonical replay work.
- Lease tokens remain internal compare-and-set credentials. Status exposes lease expiry and classified reason only, preventing raw Redis/database errors or ownership tokens from crossing the operator boundary.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Vitest config loading hit the known Windows sandbox `spawn EPERM`; the approved out-of-sandbox Docker runs completed normally.
- The first migration draft needed parentheses around a PL/pgSQL inline `CASE`; the fresh-database witness caught it before commit.
- The combined final suite exposed a test-only SHA job-order assumption. Recovery had the correct attempt-count set `{1,2}`; the assertion was corrected to verify the invariant independently of hash ordering.
- The host runs Node 25 while the workspace pins Node 24. pnpm emitted the existing engine warning; Prisma validation and both TypeScript typechecks passed.

## TDD Gate Compliance

- RED commits `71e1913` and `33c204b` failed for the intended missing outbox, missing dispatcher/error classification, and absent status projections before production changes.
- GREEN commits `5f5095f` and `db4c3d7` followed the RED gates and passed the same real PostgreSQL/Redis witnesses.

## Known Stubs

None.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/integration/replay.test.ts tests/integration/replay-boundary.test.ts tests/integration/migration-empty.test.ts --project integration` — 3 files, 17 tests passed.
- `node packages/database/node_modules/prisma/build/index.js validate --config packages/database/prisma.config.ts` — schema valid.
- `pnpm --filter @bet-stats/database typecheck` — passed.
- `pnpm --filter @bet-stats/api typecheck` — passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-18 can use the durable `ProviderCircuitState` probe-lease columns without competing for schema ownership.
- Replay confirmation now has a recoverable delivery boundary; later startup/scheduled orchestration can call `dispatchDeliveries()` without introducing another source of truth.

## Self-Check: PASSED

- All seven key implementation, migration, test, and summary files exist.
- Task commits `71e1913`, `5f5095f`, `33c204b`, `db4c3d7`, and `fd28296` exist in git history.
- `STATE.md` and `ROADMAP.md` have no working-tree changes.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-31*
