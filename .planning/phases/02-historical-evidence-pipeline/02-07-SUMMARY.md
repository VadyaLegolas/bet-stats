---
phase: 02-historical-evidence-pipeline
plan: 07
subsystem: ingestion
tags: [bullmq, cockatiel, retries, circuits, replay]
requires:
  - phase: 02-06
    provides: reservation-first result and standings ingestion plus approved BullMQ lineage
provides:
  - isolated critical, standard, and optional sync queue identities
  - bounded single-layer provider recovery with safe circuit projections
  - dry-run-first bounded and idempotent historical replay
affects: [02-08, historical-sync, operations, evidence-builds]
actuals:
  tokens: 60696
  tasks: 3
  commits: 3
tech-stack:
  added: [bullmq 6.0.0, cockatiel 3.2.1]
  patterns: [deterministic logical job identity, BullMQ-only retries, server-bounded replay previews]
key-files:
  created:
    - workers/data-sync/src/queues/index.ts
    - workers/data-sync/src/resilience/circuits.ts
    - workers/data-sync/src/replay/service.ts
  modified:
    - workers/data-sync/package.json
    - workers/data-sync/src/main.ts
key-decisions:
  - "BullMQ owns retry attempts and Cockatiel owns only circuit transitions, preventing multiplied retries."
  - "Replay previews derive allowlists, daily chunks, counts, and version tokens on the server before any work is queued."
patterns-established:
  - "Critical fixture and result handlers share deterministic identity and bounded exponential backoff options."
  - "Replay confirmation is stale-safe and idempotent; forced revisions require an explicit reason."
requirements-completed: [PIPE-01, PIPE-04, PIPE-05, PIPE-06]
coverage:
  - id: D1
    description: "Fixture continuity and results are registered as bounded critical-lane work with deterministic identities."
    requirement: PIPE-04
    verification:
      - kind: integration
        ref: "tests/integration/pipeline-jobs.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Provider failures are safely classified, circuit-gated before reservation, and retried by one layer only."
    requirement: PIPE-05
    verification:
      - kind: integration
        ref: "tests/integration/provider-resilience.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Replay is dry-run-first, bounded, stale-safe, idempotent, and observation-immutable."
    requirement: PIPE-06
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts"
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-08-30
status: complete
---

# Phase 02 Plan 07: Bounded Queue Recovery and Replay Summary

**Critical evidence sync now uses deterministic BullMQ work identities, Cockatiel circuit transitions without nested retries, and dry-run-first replay with bounded server-derived scope.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-30T05:43:00Z
- **Completed:** 2026-08-30T05:52:14Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added isolated critical, standard, and optional queue names plus explicit critical fixture/result worker registration and shared bounded retry options.
- Added safe provider error classification and provider+endpoint Cockatiel circuit state with one half-open probe and no internal retry loop.
- Added bounded UTC replay previews, server allowlists, stable logical job reuse, stale-token rejection, idempotent confirmation, and auditable forced revisions.

## Task Commits

1. **Task 1: Register critical sync queues** - `aa42a25` (feat)
2. **Task 2: Add provider resilience policy** - `3c4e4bc` (feat)
3. **Task 3: Add bounded replay service** - `ff960f3` (feat)

## Files Created/Modified

- `workers/data-sync/src/jobs/pipeline.ts` - Deterministic D-08 logical job IDs and queue namespaces.
- `workers/data-sync/src/queues/index.ts` - Lane identities, bounded BullMQ options, and critical handler registration.
- `workers/data-sync/src/resilience/errors.ts` - Safe terminal/transient provider error classification.
- `workers/data-sync/src/resilience/circuits.ts` - Cockatiel circuit registry and bounded half-open probing.
- `workers/data-sync/src/resilience/provider-policy.ts` - One-attempt provider execution and sanitized attempt/DLQ outcomes.
- `workers/data-sync/src/replay/service.ts` - Dry-run replay preview and confirmation service.
- `tests/integration/*.test.ts` - Queue, resilience, and replay contract witnesses.

## Decisions Made

- Kept transient attempt scheduling exclusively in BullMQ. The provider policy performs one call and returns retry/dead-letter classification from the current BullMQ attempt number.
- Used server-owned provider, competition, and endpoint allowlists and a 31-day maximum replay window.
- Chunked replay fan-out one job per chunk, below the critical worker concurrency of two.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Redirected verification temporary files from a full system drive**
- **Found during:** Task 2 verification
- **Issue:** The system TEMP drive had zero free bytes, causing Vitest to fail with `ENOSPC` before loading tests.
- **Fix:** Used a task-local temporary directory on D: for Vitest and removed it after verification.
- **Files modified:** None
- **Verification:** All three targeted suites passed together after redirection.
- **Committed in:** No code change required

---

**Total deviations:** 1 auto-fixed (1 Rule 3)
**Impact on plan:** Verification environment only; production behavior and scope were unchanged.

## Issues Encountered

- The active shell uses Node 25 while the repository requires Node 24. The targeted suites and worker typecheck passed; no Node-25-specific behavior was introduced.

## Known Stubs

None.

## Verification

- Queue, resilience, and replay suites: 3 files and 10 tests passed.
- `@bet-stats/data-sync` TypeScript typecheck passed.
- `git diff --check cb9156d..HEAD` passed.
- Stub scan found no TODO, FIXME, placeholder, coming-soon, or not-available markers in changed implementation and tests.

## User Setup Required

None. Direct `ioredis` was not installed.

## Next Phase Readiness

- Later operator APIs can call the bounded replay service behind the planned OperatorGuard boundary.
- Queue runtime composition can provide Redis-backed BullMQ registration without changing deterministic work identity or retry ownership.

## Self-Check: PASSED

- All created implementation and test files exist.
- Commits `aa42a25`, `3c4e4bc`, and `ff960f3` exist in repository history.
- Fresh combined verification passed 10/10 tests and the scoped typecheck.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-30*
