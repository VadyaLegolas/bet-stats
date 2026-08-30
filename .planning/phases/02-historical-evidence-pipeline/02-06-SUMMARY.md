---
phase: 02-historical-evidence-pipeline
plan: 06
subsystem: ingestion
tags: [quota, provenance, idempotency, postgresql, bullmq]
requires:
  - phase: 02-05
    provides: validated historical result and standings provider contracts
provides:
  - reservation-first gated result ingestion with atomic observation and fact persistence
  - standard-lane standings ingestion with durable critical quota headroom
  - human-approved BullMQ 6 package lineage for the Plan 02-07 installation
affects: [02-07, provider-resilience, replay, historical-sync]
tech-stack:
  added: []
  patterns: [reservation-first ingestion template, durable lane headroom, atomic evidence persistence]
key-files:
  created:
    - workers/data-sync/src/ingestion/runner.ts
    - workers/data-sync/src/jobs/results.ts
    - workers/data-sync/src/jobs/standings.ts
  modified:
    - packages/domain/src/request-budget.ts
    - tests/integration/provider-budget-order.test.ts
    - tests/integration/quota-priority.test.ts
key-decisions:
  - "Configured quota allowance is authoritative; runtime observations cannot widen it."
  - "BullMQ 6 is approved for Plan 02-07 installation from the official taskforcesh/bullmq lineage; direct ioredis remains unapproved."
patterns-established:
  - "Capability, circuit, lane policy, cache, and durable reservation gates run before provider construction or I/O."
  - "Result facts and complete standings captures are committed atomically with immutable source observations."
requirements-completed: [PIPE-01, PIPE-02, PIPE-03, PIPE-04]
coverage:
  - id: D1
    description: "Result ingestion reserves budget before provider construction and atomically persists traceable observations and facts."
    requirement: PIPE-03
    verification:
      - kind: integration
        ref: "tests/integration/provider-budget-order.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Standard standings work cannot consume configured critical fixture and result headroom."
    requirement: PIPE-04
    verification:
      - kind: integration
        ref: "tests/integration/quota-priority.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "BullMQ 6 registry identity and official repository lineage were approved before installation."
    verification:
      - kind: manual_procedural
        ref: "approved bullmq@6; pnpm view bullmq@6 name version repository.url --json"
        status: pass
    human_judgment: true
    rationale: "The plan requires explicit human approval for the research-flagged package before installation."
duration: 14h 9min
completed: 2026-08-30
status: complete
---

# Phase 02 Plan 06: Reservation-First Historical Ingestion Summary

**Result and standings evidence now pass fail-closed quota gates before provider I/O, preserve critical-call headroom, and persist provenance atomically.**

## Performance

- **Duration:** 14h 9min elapsed across the blocking human checkpoint
- **Started:** 2026-08-29T15:32:32Z
- **Completed:** 2026-08-30T05:41:30Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added one reusable ingestion runner that orders capability, circuit, lane policy, cache, reservation, provider I/O, validation, identity, and persistence gates.
- Added idempotent result and complete-standings sync paths that commit immutable observations and normalized facts atomically.
- Added durable critical quota headroom so standard standings calls cannot starve fixture or result continuity.
- Verified `bullmq@6` resolves to the official `taskforcesh/bullmq` repository and recorded the user's explicit approval; no direct `ioredis` dependency was installed or approved.

## Task Commits

1. **Task 1 RED: Specify gated result ingestion** - `2d9dbde` (test)
2. **Task 1 GREEN: Add gated result evidence ingestion** - `bf02d7b` (feat)
3. **Task 2 RED: Specify priority standings behavior** - `59d71ec` (test)
4. **Task 2 GREEN: Preserve critical quota headroom** - `43810ec` (feat)
5. **Task 3: Verify BullMQ legitimacy before installation** - recorded in this plan summary after human approval

## Files Created/Modified

- `packages/domain/src/request-budget.ts` - Configured allowance, lane reservations, observed quota metadata, and critical headroom rules.
- `workers/data-sync/src/ingestion/runner.ts` - Shared reservation-first ingestion gate ordering.
- `workers/data-sync/src/jobs/results.ts` - Traceable, idempotent result observation and fact ingestion.
- `workers/data-sync/src/jobs/standings.ts` - Atomic complete-standings capture ingestion through the standard lane.
- `tests/integration/provider-budget-order.test.ts` - Denial, cache, circuit, reset metadata, quota widening, and atomic evidence witnesses.
- `tests/integration/quota-priority.test.ts` - Concurrent reservation and critical-headroom witnesses.

## Decisions Made

- Kept the configured allowance authoritative and stored provider response quota only as observation metadata, preventing runtime headers from silently widening policy.
- Approved only `bullmq@6` for the subsequent Plan 02-07 install after registry metadata confirmed the official GitHub lineage. Direct `ioredis` remains outside the approval.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The PowerShell `pnpm exec vitest` shim did not resolve `vitest`; verification used the installed Vitest entry point directly with Node.
- Vite helper-process creation was sandbox-blocked and required approved elevated execution.
- The shared temporal-provenance test could not start PostgreSQL because Docker Desktop was not running. The Plan 02-06 ordering and priority suites passed independently; the unrun environment-dependent suite is recorded below.
- The active shell uses Node 25 while the repository declares Node 24; targeted tests and both affected package typechecks passed.

## Known Stubs

None.

## Verification

- `tests/integration/provider-budget-order.test.ts` and `tests/integration/quota-priority.test.ts`: 13/13 passed.
- `@bet-stats/data-sync` and `@bet-stats/domain` TypeScript typechecks passed.
- `git diff --check 7a88713..HEAD` passed.
- `pnpm view bullmq@6 name version repository.url --json` passed and resolved BullMQ 6.x releases to `git+https://github.com/taskforcesh/bullmq.git`.
- `tests/integration/temporal-provenance.test.ts` was not run to completion because the Docker Desktop Linux engine was unavailable.

## User Setup Required

None for Plan 02-06. Docker Desktop must be running when the shared PostgreSQL-backed temporal integration suite is rerun.

## Next Phase Readiness

- Plan 02-07 may install `bullmq@6` and `cockatiel@3` in the data-sync workspace and build queue delivery on the proven durable ingestion gates.
- Direct `ioredis` installation remains unapproved and requires a separate legitimacy checkpoint if later found necessary.

## Self-Check: PASSED

- All six implementation and test files exist.
- Commits `2d9dbde`, `bf02d7b`, `59d71ec`, and `43810ec` exist in repository history.
- This summary exists and the Docker-dependent unrun verification is recorded in `.planning/WINDOWS.md`.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-30*
