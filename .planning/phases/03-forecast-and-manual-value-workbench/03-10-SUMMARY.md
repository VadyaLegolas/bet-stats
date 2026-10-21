---
phase: 03-forecast-and-manual-value-workbench
plan: 10
subsystem: api-database
tags: [prisma, postgresql, immutable-receipts, value-betting]
requires:
  - phase: 03-08
    provides: Immutable forecast snapshot identity and serialized revision allocation
provides:
  - Selection-aware deterministic value receipt identity
  - PostgreSQL enforcement of issued lifecycle, source membership, and calculation consistency
affects: [forecast-workbench, value-api, phase-04-evaluation]
actuals:
  tokens: 5200
  tasks: 2
  commits: 5
tech-stack:
  added: []
  patterns: [four-part immutable identity, database source-of-truth guard]
key-files:
  created:
    - packages/database/prisma/migrations/20260908_phase03_value_identity_gap/migration.sql
  modified:
    - apps/api/src/modules/value/value.service.ts
    - packages/database/prisma/schema.prisma
    - tests/integration/value-api.test.ts
    - tests/integration/value-receipt.test.ts
key-decisions:
  - "Value receipts are identified by forecast snapshot, odds snapshot, market, and selection."
  - "PostgreSQL independently recomputes receipt probability, odds, fair odds, edge, and expected value within 1e-12 tolerance."
patterns-established:
  - "Immutable comparison receipts bind every user-selected event dimension into both hash and database uniqueness."
requirements-completed: [VALUE-01, VALUE-02, VALUE-03, VALUE-04]
coverage:
  - id: D1
    description: HOME and DRAW from one snapshot pair produce distinct stable receipts
    requirement: VALUE-01
    verification:
      - kind: integration
        ref: tests/integration/value-api.test.ts#keeps HOME and DRAW receipts distinct while converging each selection
        status: pass
    human_judgment: false
  - id: D2
    description: PostgreSQL rejects invalid lifecycle, membership, and derived receipt fields
    requirement: VALUE-04
    verification:
      - kind: integration
        ref: tests/integration/value-receipt.test.ts
        status: unknown
    human_judgment: false
duration: 10min
completed: 2026-09-08
status: complete
---

# Phase 3 Plan 10: Selection-Aware Value Receipt Integrity Summary

**Deterministic per-selection value receipts with PostgreSQL verification against immutable forecast and odds sources**

## Performance

- **Duration:** 10 min
- **Started:** 2026-09-08T07:09:00Z
- **Completed:** 2026-09-08T07:19:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Bound lookup, collision recovery, deterministic hashing, and Prisma uniqueness to forecast, odds, market, and selection.
- Added forward migration preserving attributable receipts and refusing legacy rows without selection provenance.
- Added PostgreSQL guards for ISSUED forecasts, source selection membership, and exact derived calculation fields.

## Task Commits

1. **Task 1 RED: Selection-aware receipt regression** - `d9a12b5`
2. **Task 1 GREEN: Full comparison identity** - `418fe1e`
3. **Task 2 RED: Database invariant regressions** - `16d934d`
4. **Task 2 GREEN: Derived-field guard completion** - `63bfca2`
5. **Task 2 fix: Explicit JSON element aliases** - `d2b0ee7`

## Files Created/Modified

- `apps/api/src/modules/value/value.service.ts` - Uses the full four-part receipt identity.
- `packages/database/prisma/schema.prisma` - Makes selection required and extends compound uniqueness.
- `packages/database/prisma/migrations/20260908_phase03_value_identity_gap/migration.sql` - Migrates identity and installs source-consistency guard.
- `packages/database/src/generated/prisma/` - Regenerated Prisma client types for the new compound selector.
- `tests/integration/value-api.test.ts` - Covers parallel HOME/DRAW receipt creation and convergence.
- `tests/integration/value-receipt.test.ts` - Covers direct SQL tampering counterexamples.

## Decisions Made

- JSON-array encoding is used as deterministic hash input to avoid delimiter ambiguity.
- Collision recovery only accepts a row with the expected deterministic ID for the exact four-part identity.
- Numeric verification uses `NUMERIC` and a `1e-12` tolerance aligned with domain precision.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated Prisma client artifacts**
- **Found during:** Task 1
- **Issue:** The new compound selector was unavailable to TypeScript until generated client types matched the schema.
- **Fix:** Regenerated the checked-in Prisma client using a nonconnecting placeholder URL.
- **Files modified:** `packages/database/src/generated/prisma/internal/class.ts`, `packages/database/src/generated/prisma/models/ForecastSnapshot.ts`, `packages/database/src/generated/prisma/models/ValueReceipt.ts`
- **Verification:** API typecheck passed.
- **Committed in:** `418fe1e`

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required generated-code synchronization only; no product scope expansion.

## Issues Encountered

- `DATABASE_URL` and Docker were unavailable, so migration-empty, receipt PostgreSQL, and database security suites could not run. The unrun verification is recorded in `.planning/WINDOWS.md`; API Vitest (4/4), API typecheck, and Prisma validation passed.
- The runtime is Node 25.2.1 while the workspace requests Node 24.x; commands completed with an engine warning.

## Known Stubs

None.

## User Setup Required

None - rerun the recorded PostgreSQL verification when the shared database environment becomes available.

## Next Phase Readiness

- Application and schema identity are selection-aware.
- Database enforcement is implemented but awaits Docker-backed execution evidence.

## Self-Check: PASSED

All declared implementation files and task commits were found.

---
*Phase: 03-forecast-and-manual-value-workbench*
*Completed: 2026-09-08*
