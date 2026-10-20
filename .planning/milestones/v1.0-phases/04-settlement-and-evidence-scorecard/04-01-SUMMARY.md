---
phase: 04-settlement-and-evidence-scorecard
plan: 01
subsystem: evaluation
tags: [typescript, prisma, postgresql, settlement, audit]
requires:
  - phase: 03-forecast-and-manual-value-workbench
    provides: immutable issued forecast snapshots and result revisions
provides:
  - closed versioned settlement lifecycle policy
  - exact frozen forecast eligibility contract
  - append-only PostgreSQL settlement revision ledger
affects: [evaluation-metrics, calibration, financial-scorecard, backtesting]
actuals:
  tokens: 181190
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [pure fail-closed policy resolver, transaction advisory lock, append-only linked revisions]
key-files:
  created:
    - packages/domain/src/evaluation/contract.ts
    - packages/domain/src/evaluation/settlement.ts
    - packages/database/prisma/migrations/20260908_phase04_settlement_receipts/migration.sql
    - tests/unit/settlement-policy.test.ts
    - tests/integration/settlement.test.ts
  modified:
    - packages/domain/src/index.ts
    - packages/database/prisma/schema.prisma
key-decisions:
  - "Settlement identity is the exact ResultVersion, ForecastSnapshot, and policy hash tuple."
  - "Corrections append one linked revision under a fixture-scoped PostgreSQL advisory lock."
patterns-established:
  - "Settlement inputs fail closed unless exactly one caller-selected pre-kickoff ISSUED PRE_MATCH or LINEUP_CONFIRMED snapshot is supplied."
  - "PostgreSQL verifies receipt JSON claims against immutable relational identity before insertion."
requirements-completed: [EVAL-01, EVAL-02]
coverage:
  - id: D1
    description: "Every recognized result lifecycle resolves through settlement-policy-v1 with explicit score and financial states."
    requirement: EVAL-01
    verification:
      - kind: unit
        ref: "tests/unit/settlement-policy.test.ts#settlement-policy-v1"
        status: pass
    human_judgment: false
  - id: D2
    description: "Settlement receipts bind an exact frozen forecast and retain immutable correction history."
    requirement: EVAL-02
    verification:
      - kind: integration
        ref: "tests/integration/settlement.test.ts#append-only settlement revisions"
        status: pass
    human_judgment: false
duration: 16min
completed: 2026-09-08
status: complete
---

# Phase 4 Plan 1: Settlement Tracer Summary

**Versioned settlement receipts now bind each result revision to one exact frozen forecast, with PostgreSQL-enforced immutable correction lineage.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-09-08T17:04:00Z
- **Completed:** 2026-09-08T17:20:00Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments

- Implemented the complete FINISHED, POSTPONED, CANCELLED, ABANDONED, and VOID lifecycle under `settlement-policy-v1`.
- Rejected INITIAL, ambiguous, mismatched, non-issued, and post-kickoff forecast inputs with stable fail-closed reason codes.
- Added append-only settlement persistence with deterministic retry convergence, linked result corrections, immutable source guards, and current-leaf audit queries.

## Task Commits

1. **Task 1 RED: settlement policy contract tests** — `6ea2202`
2. **Task 1 GREEN: exact snapshot settlement policy** — `149eb0f`
3. **Task 2 RED: PostgreSQL settlement persistence tests** — `c3d4884`
4. **Task 2 GREEN: append-only settlement revisions** — `366c45c`

## Files Created/Modified

- `packages/domain/src/evaluation/contract.ts` — strict settlement command and lifecycle source contract.
- `packages/domain/src/evaluation/settlement.ts` — pure versioned policy resolver and canonical policy hash.
- `packages/database/prisma/schema.prisma` — SettlementReceipt model and immutable source relations.
- `packages/database/prisma/migrations/20260908_phase04_settlement_receipts/migration.sql` — table, guards, advisory-lock persistence function, and revision chain.
- `tests/unit/settlement-policy.test.ts` — lifecycle and hostile exact-snapshot matrix.
- `tests/integration/settlement.test.ts` — fresh PostgreSQL retry, correction, lineage, current-leaf, and tampering witnesses.
- `packages/database/src/generated/prisma/` — regenerated Prisma client for SettlementReceipt.

## Decisions Made

- Kept settlement selection entirely caller-driven; the domain has no latest-snapshot lookup or forecast-generation fallback.
- Used a fixture-scoped transaction advisory lock so concurrent correction allocation is serialized without a mutable counter.
- Preserved the one-way D-01 migration: corrections append and link rather than modifying prior evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed an unrelated empty migration directory after containment verification**
- **Found during:** Task 2 PostgreSQL RED/GREEN runs
- **Issue:** Prisma returned P3015 because an empty untracked `20260908_phase03_value_receipt_guard_compatibility` directory existed.
- **Fix:** Verified it was empty, untracked, and inside `packages/database/prisma/migrations`, then removed only that directory.
- **Files modified:** none
- **Verification:** Fresh `prisma migrate deploy` completed inside the settlement integration suite.
- **Committed in:** not applicable

**2. [Rule 1 - Bug] Corrected integration helper placeholder and gap fixture**
- **Found during:** Task 2 GREEN
- **Issue:** The test helper omitted its seventh SQL placeholder, and the revision-gap assertion reused an already-converged deterministic tuple.
- **Fix:** Bound the requested revision parameter and seeded a third result correction for the gap counterexample.
- **Files modified:** `tests/integration/settlement.test.ts`
- **Verification:** PostgreSQL suite passes 2/2.
- **Committed in:** `366c45c`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes were required to execute the planned PostgreSQL proof; no product scope was added.

## Issues Encountered

- The repository currently runs Node 25.2.1 while package metadata requests Node 24.x; verification completed with the existing environment and emitted only the known engine warning.

## User Setup Required

None - the PostgreSQL integration suite provisions and removes its own Docker container.

## Next Phase Readiness

- EVAL-03 and later metrics can reference stable SettlementReceipt identities and current-leaf revisions.
- No blockers remain for dependent Phase 4 plans.

## Self-Check: PASSED

- All created source, migration, test, and generated Prisma files exist.
- Commits `6ea2202`, `149eb0f`, `c3d4884`, and `366c45c` are present.
- Unit suite: 18/18 passed; PostgreSQL integration suite: 2/2 passed.

---
*Phase: 04-settlement-and-evidence-scorecard*
*Completed: 2026-09-08*
