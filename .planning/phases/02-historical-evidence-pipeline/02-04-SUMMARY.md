---
phase: 02-historical-evidence-pipeline
plan: 04
subsystem: database
tags: [postgresql, prisma, bitemporal, provenance, replay, audit]
requires:
  - phase: 02-03
    provides: endpoint coverage contract
provides:
  - immutable source observations and append-only result versions
  - dual effectiveAt/observedAt cutoff indexes
  - standing, sync, circuit, replay, and evidence-build ledgers
affects: [02-05, 02-06, 02-07, 02-08, predictions, evaluation]
actuals:
  tokens: 279263
  tasks: 3
  commits: 5
tech-stack:
  added: []
  patterns: [append-only PostgreSQL ledgers, restrictive provenance foreign keys, bitemporal cutoff queries]
key-files:
  created:
    - packages/database/prisma/migrations/20260829_historical_evidence/migration.sql
    - .planning/phases/02-historical-evidence-pipeline/02-04-D02-APPROVAL.md
  modified:
    - packages/database/prisma/schema.prisma
    - tests/integration/temporal-provenance.test.ts
    - tests/integration/migration-empty.test.ts
key-decisions:
  - "Developer explicitly approved D-02: both effectiveAt and observedAt must be at or before an as-of cutoff."
  - "The one-way consequence is accepted: changing D-02 requires historical feature rebuilds and may invalidate downstream snapshots/evaluations."
patterns-established:
  - "Corrections append observations and fact versions; previously visible evidence cannot be updated or deleted."
  - "Only PostgreSQL uniqueness, restrictive foreign keys, and triggers are authoritative for replay safety."
requirements-completed: [PIPE-02, PIPE-03, PIPE-05, PIPE-06, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: Immutable, duplicate-safe source observations and dual-time result versions
    requirement: PIPE-02
    verification:
      - kind: integration
        ref: tests/integration/temporal-provenance.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Empty PostgreSQL 18 database migrates with all evidence control ledgers and constraints
    requirement: PIPE-06
    verification:
      - kind: integration
        ref: tests/integration/migration-empty.test.ts
        status: pass
    human_judgment: false
duration: 16min
completed: 2026-08-29
status: complete
---

# Phase 02 Plan 04: Historical Evidence Ledger Summary

**PostgreSQL bitemporal evidence ledger with immutable raw observations, append-only corrections, replay audit state, and atomic published-build foundations.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-29T15:04:00Z
- **Completed:** 2026-08-29T15:20:00Z
- **Tasks:** 3
- **Files modified:** 26

## Accomplishments

- Recorded explicit developer approval of the one-way D-02 dual-time evidence contract.
- Added immutable raw observation identity, append-only result corrections, restrictive provenance links, and independent effective/observed cutoff indexes.
- Added standing snapshot, sync attempt/run, provider circuit, replay plan, and staged evidence-build ledgers and regenerated Prisma 7 types.
- Proved the checked-in migrations from an empty PostgreSQL 18 database.

## Task Commits

1. **Task 1: Approve the one-way dual-time evidence contract** - `cdc6429`
2. **Task 2 RED: Add failing temporal provenance witness** - `db6ae1c`
3. **Task 2 GREEN: Persist immutable observation and result version** - `9e2ac99`
4. **Task 3 RED: Add failing evidence-ledger migration witness** - `e384f45`
5. **Task 3 GREEN: Add ledgers, migration, and generated client** - `66c5aa8`

## Files Created/Modified

- `packages/database/prisma/schema.prisma` - Authoritative Prisma models for temporal evidence and operational ledgers.
- `packages/database/prisma/migrations/20260829_historical_evidence/migration.sql` - Tables, indexes, restrictive foreign keys, checks, and append-only triggers.
- `packages/database/src/generated/prisma/` - Regenerated Prisma 7 client and model types.
- `tests/integration/temporal-provenance.test.ts` - Real PostgreSQL witness for duplicate identity, immutability, corrections, and cutoff eligibility.
- `tests/integration/migration-empty.test.ts` - Empty PostgreSQL 18 migration and constraint witness.

## Decisions Made

- D-02 was explicitly approved with its full-rebuild consequence; a correction observed after a cutoff cannot affect the earlier evidence view.
- Replay and evidence build identities converge in PostgreSQL; BullMQ remains delivery infrastructure, not evidence authority.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed undeclared Prisma config side-effect import**
- **Found during:** Task 2 RED
- **Issue:** `packages/database/prisma.config.ts` imported `dotenv/config` although the database package did not declare it, blocking migration execution.
- **Fix:** Removed the import; tests and commands provide `DATABASE_URL` explicitly.
- **Verification:** Both fresh-database integration suites reached migration deployment and passed.
- **Committed in:** `db6ae1c`

**2. [Scope boundary] Deferred replay service behavior to Plan 02-07**
- **Found during:** Task 3 overall verification
- **Issue:** The plan lists `replay.test.ts`, but its missing `previewReplay` and `queueReplay` production symbols are explicitly owned by Plan 02-07.
- **Resolution:** Did not pull later queue/replay behavior into the database schema plan; recorded the open cross-plan verification item in `.planning/WINDOWS.md`.

## Known Stubs

None in files created or modified by this plan.

## Verification

- `tests/integration/temporal-provenance.test.ts`: 2/2 passed.
- `tests/integration/migration-empty.test.ts`: 1/1 passed.
- Prisma 7 schema validation and client generation passed.
- `tests/integration/replay.test.ts`: deferred to Plan 02-07 because its production service does not yet exist.

## User Setup Required

None.

## Next Phase Readiness

- Plans 02-05 and 02-06 can consume immutable dual-time facts and standing snapshots.
- Plan 02-07 must implement the replay service and close the recorded replay verification ledger entry.

## Self-Check: PASSED

- Approval, migration, schema, generated client, and integration witnesses exist.
- Commits `cdc6429`, `db6ae1c`, `9e2ac99`, `e384f45`, and `66c5aa8` exist in history.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-29*
