---
phase: 02-historical-evidence-pipeline
plan: 25
subsystem: api
tags: [nestjs, postgres, replay, provenance, validation]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: durable replay plans, immutable evidence receipts, and payload identity contracts
provides:
  - Logical-key idempotent replay confirmation under advisory locking
  - Disclosure-safe Nest validation responses with stable codes
  - Strict atomic parsing of persisted immutable evidence receipts
affects: [historical-replay, evidence-api, phase-02-verification]
actuals:
  tokens: 9631
  tasks: 3
  commits: 7
tech-stack:
  added: []
  patterns: [logical-key advisory locking, allowlisted HttpException bodies, exact-key immutable JSON parsing]
key-files:
  created: []
  modified:
    - apps/api/src/modules/replay/replay.service.ts
    - apps/api/src/modules/evidence/evidence.service.ts
    - packages/domain/src/evidence/contract.ts
    - tests/integration/replay.test.ts
    - tests/integration/evidence-api.test.ts
key-decisions:
  - "Equivalent replay confirmations return the latest existing logical plan unless newRevision is explicitly reasoned."
  - "Persisted evidence receipts are accepted byte-for-structure or rejected as a whole; projection never repairs or filters them."
patterns-established:
  - "Public validation errors expose only an allowlisted code through Nest HttpException responses."
  - "Immutable provenance objects use shared exact-key runtime parsers at trust boundaries."
requirements-completed: [PIPE-02, PIPE-06, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: "Fresh equivalent and concurrent replay confirmations converge on one durable logical plan."
    requirement: PIPE-06
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#treats a fresh preview with the same logical key as duplicate work"
        status: pass
    human_judgment: false
  - id: D2
    description: "Replay and evidence validation failures return disclosure-safe stable 4xx codes."
    requirement: PIPE-06
    verification:
      - kind: integration
        ref: "tests/integration/replay.test.ts#returns disclosure-safe HTTP validation codes for replay and evidence"
        status: pass
    human_judgment: false
  - id: D3
    description: "Malformed persisted evidence receipts fail closed atomically without provenance rewriting."
    requirement: PIPE-02
    verification:
      - kind: integration
        ref: "tests/integration/evidence-api.test.ts#rejects the entire immutable receipt"
        status: pass
    human_judgment: false
duration: 3d 7h
completed: 2026-09-04
status: complete
---

# Phase 02 Plan 25: Safe Replay and Provenance Boundaries Summary

**Replay confirmation now converges by logical identity, public validation is disclosure-safe, and corrupt immutable receipts are rejected atomically.**

## Performance

- **Duration:** 3d 7h elapsed (execution paused by usage limit)
- **Started:** 2026-09-01T11:27:44Z
- **Completed:** 2026-09-04T18:14:04Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Serialized replay confirmation by logical key and returned existing plans before allocating runs, deliveries, or queue work.
- Mapped replay/evidence caller errors to stable allowlisted Nest 400/409 responses without reflecting secret-bearing input.
- Added `parseEvidenceReceipt` as the shared strict runtime boundary and removed lossy receipt-input filtering.
- Added adversarial PostgreSQL, concurrency, real HTTP, and malformed-provenance integration witnesses.

## Task Commits

1. **Task 1 RED:** `7931146` — fresh-preview logical-key collision witness
2. **Task 1 GREEN:** `9302942` — logical-key idempotent confirmation
3. **Task 2 RED:** `e584381` — unsafe HTTP validation witness
4. **Task 2 GREEN:** `8fa7206` — disclosure-safe Nest exceptions
5. **Task 3 RED:** `3a2aa48` — lossy receipt projection witness
6. **Task 3 GREEN:** `262c47f` — strict atomic receipt parser and projection
7. **Verification stabilization:** `92b0b7b` — audited actors, isolated policy fixture, and Docker cleanup timeout

## Files Created/Modified

- `apps/api/src/modules/replay/replay.service.ts` — logical-key duplicate branch and stable HTTP exceptions.
- `apps/api/src/modules/evidence/evidence.service.ts` — safe client exceptions and shared receipt parser use.
- `packages/domain/src/evidence/contract.ts` — strict exported `parseEvidenceReceipt` contract.
- `tests/integration/replay.test.ts` — concurrency, durable-side-effect, real HTTP, and redaction coverage.
- `tests/integration/evidence-api.test.ts` — mixed-malformed and unexpected-structure atomic rejection coverage.

## Decisions Made

- A non-revision confirmation consumes the fresh preview but does not mutate or re-associate the immutable existing ReplayPlan.
- Exact receipt validation rejects unexpected nested or top-level members and enforces coherent temporal bounds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated replay integration callers for mandatory audit actors**
- **Found during:** Overall verification
- **Issue:** Gateway hardening made actor mandatory, while older direct service/controller tests still omitted it.
- **Fix:** Supplied explicit test actors without weakening production authorization.
- **Files modified:** `tests/integration/replay.test.ts`
- **Verification:** Full replay/evidence integration run passed 33/33.
- **Committed in:** `92b0b7b`

**2. [Rule 3 - Blocking] Removed calendar and cross-test fragility from replay fixtures**
- **Found during:** Overall verification
- **Issue:** Fixed policy dates preceded PostgreSQL creation timestamps and a reused logical input inherited an earlier preview.
- **Fix:** Moved deterministic policy fixtures forward, isolated the new witness with a unique season identity and frozen policy snapshot, and allowed Docker cleanup 30 seconds.
- **Files modified:** `tests/integration/replay.test.ts`
- **Verification:** Full replay/evidence integration run passed 33/33.
- **Committed in:** `92b0b7b`

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Test-only compatibility and determinism fixes; production scope was not widened.

## Issues Encountered

- Docker Desktop was initially stopped; it was started and the required container-backed suites were rerun successfully.
- The installed Node runtime is 25.2.1 while the workspace declares Node 24.x; typechecks passed with an engine warning.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-25 gap closures are ready for the Phase-2 verifier.
- Full targeted integration coverage passes: 33/33; domain and API typechecks pass.

## Self-Check: PASSED

- All five modified production/test files exist.
- All seven task/deviation commits exist in git history.
- Full replay/evidence integration suites pass 33/33.
- `@bet-stats/domain` and `@bet-stats/api` typechecks pass.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-09-04*
