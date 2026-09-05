---
phase: 02-historical-evidence-pipeline
plan: 18
subsystem: replay
tags: [postgresql, prisma, replay, provider-policy, circuit-breaker, quota]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: durable replay delivery and ProviderCircuitState persistence from Plan 02-17
provides:
  - Durable, validated provider-policy snapshots with stable semantic fingerprints
  - Replay preview, confirmation, and status projections that share one fail-closed policy reader
  - Persisted approved/current policy comparison for stale replay prevention
affects: [02-20, replay, data-sync, provider-circuit-policy, quota-safety]
actuals:
  tokens: 71164
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [durable policy snapshot, semantic fingerprint, fail-closed replay admission, safe status projection]
key-files:
  created:
    - packages/domain/src/replay-provider-policy.ts
    - packages/database/src/replay-provider-policy.ts
  modified:
    - apps/api/src/modules/replay/replay.service.ts
    - packages/domain/src/index.ts
    - packages/database/src/index.ts
    - tests/integration/replay.test.ts
key-decisions:
  - "Replay fingerprints cover policy semantics but exclude observedAt, which is telemetry for the read rather than admission policy."
  - "Replay confirmation must match the persisted approved fingerprint to a fresh durable snapshot before creating delivery obligations."
  - "Replay status returns classified approved/current snapshots, never an inferred CLOSED or available provider state."
patterns-established:
  - "Persist the policy snapshot in immutable preview impact data alongside its canonical fingerprint."
  - "Treat missing, malformed, stale, OPEN, exhausted, and critical-headroom policy states as pre-delivery denials."
requirements-completed: [PIPE-03, PIPE-04, PIPE-05, PIPE-06]
coverage:
  - id: D1
    description: "Replay previews persist and expose the exact durable provider-policy snapshot approved for the plan."
    requirement: PIPE-03
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#persists the exact approved policy and classifies durable policy changes in status"
        status: pass
    human_judgment: false
  - id: D2
    description: "OPEN, unavailable reset, exhausted allowance, and critical headroom deny replay preview before delivery."
    requirement: PIPE-04
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#rejects every fail-closed provider policy before queue delivery"
        status: pass
    human_judgment: false
  - id: D3
    description: "Replay status compares the approved snapshot with the current durable policy without exposing assumed infrastructure state."
    requirement: PIPE-05
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#persists the exact approved policy and classifies durable policy changes in status"
        status: pass
    human_judgment: false
duration: 4h 13m
completed: 2026-08-31
status: complete
---

# Phase 02 Plan 18: Durable Replay Provider Policy Summary

**Replay now persists, rechecks, and safely projects one PostgreSQL-backed provider-policy snapshot instead of assuming quota or circuit availability.**

## Performance

- **Duration:** 4h 13m
- **Started:** 2026-08-31T10:47:30+02:00
- **Completed:** 2026-08-31T15:00:58+02:00
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added a shared domain/database provider-policy snapshot contract with reset semantics, lane headroom, reservations, circuit state, and canonical fingerprinting.
- Replaced replay service quota/circuit defaults with durable preview admission, confirmation revalidation, persisted approved snapshots, and classified status output.
- Added PostgreSQL integration witnesses for exact snapshots, changed-policy stale confirmation, and fail-closed API admission before any queue delivery.

## Task Commits

1. **Task 1 RED: Read one durable provider-policy snapshot and freeze its fingerprint** — `111d4d9`
2. **Task 1 GREEN: Read one durable provider-policy snapshot and freeze its fingerprint** — `80354f8`
3. **Task 2: Make replay preview and status use the shared durable snapshot** — `6d83c19`

## Files Created/Modified

- `packages/domain/src/replay-provider-policy.ts` — immutable policy contract, denial semantics, and semantic fingerprint.
- `packages/database/src/replay-provider-policy.ts` — PostgreSQL policy projection over circuit state and durable reservations.
- `apps/api/src/modules/replay/replay.service.ts` — durable preview/confirmation/status policy integration.
- `tests/integration/replay.test.ts` — PostgreSQL witnesses for policy persistence, status changes, and pre-delivery denials.

## Decisions Made

- `observedAt` is excluded from the fingerprint because it records when the snapshot was read, not a policy change; including it made every normal confirmation falsely stale.
- A confirmation must see the same fingerprint and an allowed current decision; a changed policy always requires a new preview.
- Status reports only the durable approved/current policy projections and their classification, without raw connection data or synthetic provider availability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stabilized policy fingerprints across normal reads**
- **Found during:** Task 2: Make replay preview and status use the shared durable snapshot
- **Issue:** The Task 1 fingerprint included `observedAt`, so a fresh read of unchanged policy always differed from the approved preview and blocked confirmation as stale.
- **Fix:** Excluded the read timestamp from canonical fingerprint input while retaining it in the persisted and returned snapshot.
- **Files modified:** `packages/domain/src/replay-provider-policy.ts`, `tests/integration/replay.test.ts`
- **Verification:** Replay lifecycle, changed-policy, and fail-closed PostgreSQL integration witnesses pass.
- **Committed in:** `6d83c19`

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** Required for correct stale-preview behavior; no scope expansion.

## Issues Encountered

- The Windows sandbox blocks Vitest config startup with `spawn EPERM`; the same PostgreSQL/Redis tests passed with the approved external test environment.
- The host reports Node 25 while the workspace pins Node 24; TypeScript checks passed with the existing engine warning.

## TDD Gate Compliance

- Task 1 RED commit `111d4d9` preceded its GREEN commit `80354f8`.
- Task 2 API-level witnesses were written before the service integration and pass against the final implementation.

## Known Stubs

None.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/integration/replay.test.ts --project integration --testNamePattern "persists the exact|rejects every fail-closed|requires audited" --reporter verbose` — 3 passed.
- `node node_modules/vitest/vitest.mjs run tests/integration/provider-resilience.test.ts --project integration --reporter verbose` — 7 passed.
- `pnpm --filter @bet-stats/api typecheck` — passed.
- `pnpm --filter @bet-stats/domain typecheck` — passed.
- `pnpm --filter @bet-stats/database typecheck` — passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-20 can consume the same durable snapshot/fingerprint before constructing every replay provider handler.
- Replay admission and status no longer silently widen availability from fixed service options.

## Self-Check: PASSED

- Durable policy domain/database/API/test files exist.
- Task commits `111d4d9`, `80354f8`, and `6d83c19` exist in git history.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-31*
