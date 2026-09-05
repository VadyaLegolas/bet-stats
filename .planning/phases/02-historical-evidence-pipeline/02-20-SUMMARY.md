---
phase: 02-historical-evidence-pipeline
plan: 20
subsystem: replay
tags: [postgresql, prisma, bullmq, replay, provider-policy, circuit-breaker, quota]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: durable replay delivery and immutable provider-policy fingerprints from Plan 02-18
provides:
  - PostgreSQL compare-and-set ownership of durable HALF_OPEN probes
  - One policy reader and fingerprint comparison for every production replay endpoint
  - API-to-Worker boundary coverage for critical, standard, and fail-closed policy paths
affects: [replay, data-sync, provider-circuit-policy, quota-safety]
actuals:
  tokens: 11610
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [durable policy recheck before I/O, owner-scoped HALF_OPEN lease release, shared endpoint lane policy]
key-files:
  created: []
  modified:
    - workers/data-sync/src/resilience/circuits.ts
    - workers/data-sync/src/resilience/provider-policy.ts
    - workers/data-sync/src/jobs/results.ts
    - workers/data-sync/src/jobs/fixtures.ts
    - workers/data-sync/src/jobs/standings.ts
    - workers/data-sync/src/main.ts
    - tests/integration/replay-boundary.test.ts
key-decisions:
  - "API preview/status and Workers import the same default durable policy definitions: fixtures/results are critical and standings is standard."
  - "Every Worker delivery compares a fresh durable snapshot with the persisted preview fingerprint before reservation or provider construction."
  - "HALF_OPEN ownership uses a token-scoped PostgreSQL CAS lease, so only the process which acquired a probe can release it."
patterns-established:
  - "Do not pass alreadyAuthorized into replay ingestion; every delivery performs its own durable priority reservation."
  - "Use the shared replay-policy reader at a process boundary rather than reconstructing circuit or quota defaults in a Worker."
requirements-completed: [PIPE-03, PIPE-04, PIPE-05, PIPE-06]
coverage:
  - id: D1
    description: "Result replay rechecks the preview fingerprint and owns one durable HALF_OPEN probe across Worker processes."
    requirement: PIPE-03
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#uses one compare-and-set HALF_OPEN lease across independently constructed Workers"
        status: pass
      - kind: integration
        ref: "tests/integration/provider-resilience.test.ts#allows exactly one concurrent HALF_OPEN probe before reservation and provider I/O"
        status: pass
    human_judgment: false
  - id: D2
    description: "Fixtures, results, and standings use the same API-approved policy snapshot and retain D-07 critical/critical/standard lanes."
    requirement: PIPE-04
    verification:
      - kind: integration
        ref: "tests/integration/replay-boundary.test.ts#routes accepted FIXTURES/RESULTS/STANDINGS work through the production replay worker"
        status: pass
    human_judgment: false
  - id: D3
    description: "Changed OPEN, HALF_OPEN, missing, exhausted, and headroom-blocked durable policy states stop the Worker before provider construction."
    requirement: PIPE-05
    verification:
      - kind: integration
        ref: "tests/integration/replay-boundary.test.ts#stops durable policy before provider construction"
        status: pass
    human_judgment: false
  - id: D4
    description: "Replay status preserves the approved policy projection and its stable fingerprint after Worker delivery."
    requirement: PIPE-06
    verification:
      - kind: integration
        ref: "tests/integration/replay-boundary.test.ts#routes accepted work through the production replay worker"
        status: pass
    human_judgment: false
duration: 23m
completed: 2026-08-31
status: complete
---

# Phase 02 Plan 20: Shared Worker Provider Policy Summary

**Every replay Worker now rechecks the API-approved PostgreSQL provider-policy snapshot before reserving quota or constructing a provider, with one durable HALF_OPEN probe owner.**

## Performance

- **Duration:** 23m
- **Started:** 2026-08-31T15:03:00+02:00
- **Completed:** 2026-08-31T15:26:25+02:00
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Replaced process-local HALF_OPEN admission with token-scoped PostgreSQL compare-and-set leases and owner-only cleanup in `finally`.
- Made result, fixture, and standings replay handlers load and compare the persisted preview fingerprint to a fresh durable policy snapshot before reservation or provider construction.
- Centralized endpoint policies so fixtures and results use critical capacity while standings preserves critical headroom as a standard lane.
- Added real Next-to-Nest-to-BullMQ-to-Worker PostgreSQL/Redis witnesses for all selectable endpoint families and fail-closed policy changes.

## Task Commits

1. **Task 1: Run one result replay using the same snapshot approved by preview** - `e222ff1` (test), `6b606e7` (feat)
2. **Task 2: Inject the shared policy into fixture and standings replay handlers** - `5e1f119` (feat)

## Files Created/Modified

- `workers/data-sync/src/resilience/circuits.ts` - durable cross-process probe registry.
- `workers/data-sync/src/resilience/provider-policy.ts` - replay-plan fingerprint recheck at the Worker boundary.
- `workers/data-sync/src/jobs/{results,fixtures,standings}.ts` - shared policy, lane, reservation, and denial wiring.
- `workers/data-sync/src/main.ts` - one repository and registry injected into every handler.
- `packages/database/src/replay-provider-policy.ts` - central critical/critical/standard policy definitions.
- `tests/integration/replay*.test.ts` - PostgreSQL/Redis replay policy and API-to-Worker witnesses.

## Decisions Made

- A queue delivery is never an authorization exemption: it must re-read and reserve against the current durable policy.
- The persisted preview fingerprint is the Worker admission contract; a changed or malformed current snapshot fails before provider I/O.
- A process may clear only the durable probe lease token it owns, preventing a losing Worker from releasing the winner's HALF_OPEN probe.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected lane persistence against the actual SyncRun schema**

- **Found during:** Task 1 verification
- **Issue:** The replay lane column is a PostgreSQL string, not a `RequestPriorityLane` enum; the initial raw SQL cast failed in the real integration suite.
- **Fix:** Persist the validated lane string directly, preserving critical/critical/standard semantics without an invalid database cast.
- **Files modified:** `apps/api/src/modules/replay/replay.service.ts`
- **Verification:** PostgreSQL replay integration suite passed after the correction.
- **Committed in:** `6b606e7`

**Total deviations:** 1 auto-fixed (Rule 1)

## Issues Encountered

The full boundary matrix exceeds one local runner window when executed as a single command. All ten cases were completed through focused production PostgreSQL/Redis runs, including each of OPEN, HALF_OPEN, missing, exhausted, and headroom-blocked policy states.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Replay admission now has one durable API/Worker interpretation and no longer performs provider I/O on stale or denied policy. Re-run phase verification after the remaining gap plans complete.

## Self-Check: PASSED

- Required policy and boundary files exist.
- Task commits `e222ff1`, `6b606e7`, and `5e1f119` exist in git history.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-31*
