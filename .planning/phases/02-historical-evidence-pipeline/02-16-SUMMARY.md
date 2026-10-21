---
phase: 02-historical-evidence-pipeline
plan: 16
subsystem: replay
tags: [postgresql, prisma, bullmq, redis, lifecycle, fixtures]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: durable replay plans, SyncRuns, attempts, and production boundary from Plans 02-13 and 02-15
provides:
  - Forward-only PostgreSQL guards for SyncAttempt and SyncRun lifecycle transitions
  - Locked conditional Worker claims and terminal writes with terminal redelivery no-ops
  - Production FIXTURES replay routing with canonical identity, bounded scope, and provenance
affects: [phase-03, replay, ingestion, evidence-publication, operations]
actuals:
  tokens: 17854
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [database-guarded state machine, row-locked conditional worker claim, production endpoint completeness matrix]
key-files:
  created:
    - packages/database/prisma/migrations/20260831_phase02_replay_lifecycle/migration.sql
  modified:
    - packages/database/prisma/schema.prisma
    - packages/database/src/generated/prisma
    - workers/data-sync/src/queues/index.ts
    - workers/data-sync/src/jobs/fixtures.ts
    - workers/data-sync/src/main.ts
    - tests/integration/replay.test.ts
    - tests/integration/replay-boundary.test.ts
key-decisions:
  - "Only a locked PENDING SyncRun may claim provider I/O; RUNNING concurrent deliveries and terminal redeliveries are no-ops."
  - "SyncAttempt identity, links, and start time never change; a RUNNING attempt receives exactly one classified terminal outcome."
  - "Fixture replay reuses canonical provider references and deterministic logical identity while filtering persistence to the durable replay unit window."
patterns-established:
  - "Worker lifecycle writes lock SyncRun, then use conditional affected-row counts before creating or completing an attempt."
  - "Every replay endpoint accepted by the API is enumerated through startReplayWorker in a real PostgreSQL/Redis boundary test."
requirements-completed: [PIPE-01, PIPE-05, PIPE-06]
coverage:
  - id: D1
    description: "Replay attempts and runs reach truthful terminal states without terminal revival or duplicate provider execution."
    requirement: PIPE-01
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#durable bounded replay"
        status: pass
    human_judgment: false
  - id: D2
    description: "FIXTURES, RESULTS, and STANDINGS all execute production replay handlers and finish through the guarded lifecycle."
    requirement: PIPE-06
    verification:
      - kind: integration
        ref: "tests/integration/replay-boundary.test.ts#routes accepted endpoint work through the production replay worker"
        status: pass
    human_judgment: false
duration: 21min
completed: 2026-08-31
status: complete
---

# Phase 02 Plan 16: Guarded Replay Lifecycle Summary

**Forward-only PostgreSQL replay state transitions with locked BullMQ execution and a provenance-preserving production FIXTURES handler**

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-31T07:51:49Z
- **Completed:** 2026-08-31T08:12:11Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Replaced the blanket attempt trigger with a narrow PostgreSQL contract that allows one RUNNING-to-terminal transition while keeping attempt identity, start data, links, and terminal rows immutable.
- Guarded SyncRun transitions in PostgreSQL and made the BullMQ Worker claim and finish work through row locks plus conditional affected-row checks, so FAILED, CANCELLED, and SUCCEEDED redeliveries perform no I/O and create no attempt.
- Added a replay-specific fixture adapter and production dispatch for all API-accepted endpoint families, with canonical competition/season lookup, deterministic job identity, bounded fixture filtering, budget reservation, and raw provenance persistence.

## Task Commits

1. **Task 1 RED: Expose replay lifecycle violations** — `7e874d7`
2. **Task 1 GREEN: Guard replay terminal lifecycle** — `830e51d`
3. **Task 2 RED: Expose missing replay endpoint handlers** — `1d595dc`
4. **Task 2 GREEN: Route fixture replay to production sync** — `c057a85`

## Files Created/Modified

- `packages/database/prisma/migrations/20260831_phase02_replay_lifecycle/migration.sql` — forward-only attempt/run transition guards.
- `packages/database/prisma/schema.prisma` and generated client — documented guarded lifecycle contract.
- `workers/data-sync/src/queues/index.ts` — locked claims, conditional terminal writes, bounded retry return to PENDING, and terminal no-ops.
- `workers/data-sync/src/jobs/fixtures.ts` — replay fixture adapter with canonical reference resolution and bounded provenance persistence.
- `workers/data-sync/src/main.ts` — production FIXTURES/RESULTS/STANDINGS dispatch.
- `tests/integration/replay.test.ts` — real terminal lifecycle, mutation guard, retry/dead-letter, and redelivery witnesses.
- `tests/integration/replay-boundary.test.ts` — production handler completeness matrix and fixture provenance witness.

## Decisions Made

- Provider work starts only after a transaction locks the run and changes exactly one PENDING row to RUNNING; observing RUNNING means another delivery owns the work.
- Retryable failures complete their attempt as FAILED and return only the run to PENDING; the third failed delivery atomically moves the run to terminal FAILED.
- A PENDING run may only receive the existing delivery-retry marker without changing its declared work; all terminal run mutations are rejected.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Vitest could not spawn its config helper inside the Windows sandbox (`spawn EPERM`); the approved out-of-sandbox run completed normally.
- The package-local Prisma CLI was not exposed through pnpm exec. Generation used the checked-in `packages/database/node_modules/prisma/build/index.js` entrypoint with a non-secret local validation URL.
- The host runs Node 25 while the workspace pins Node 24; pnpm emitted the existing engine warning, but all requested checks passed.

## TDD Gate Compliance

- RED commits `7e874d7` and `1d595dc` captured the expected lifecycle and missing-handler failures before implementation.
- GREEN commits `830e51d` and `c057a85` followed them and passed the same real PostgreSQL/Redis witnesses.

## Known Stubs

None.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/integration/replay.test.ts tests/integration/replay-boundary.test.ts --project integration` — 2 files, 14 tests passed.
- `node packages/database/node_modules/prisma/build/index.js validate --config packages/database/prisma.config.ts` — schema valid.
- `pnpm --filter @bet-stats/database typecheck` — passed.
- `pnpm --filter @bet-stats/data-sync typecheck` — passed.

## Next Phase Readiness

- PIPE-01 replay attempts now terminate truthfully, terminal source work cannot revive, and every accepted replay endpoint has a production handler.
- Later replay-policy gap plans can build on a fail-closed operational ledger without weakening append-only football evidence.

## Self-Check: PASSED

- All key lifecycle, fixture handler, and integration-test files exist.
- Task commits `7e874d7`, `830e51d`, `1d595dc`, and `c057a85` exist in git history.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-31*
