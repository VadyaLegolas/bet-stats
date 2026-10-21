---
phase: 05-provider-aware-coverage-and-enrichment
plan: 15
subsystem: database
tags: [postgresql, prisma, provider-routing, canonical-identity, bullmq]
requires:
  - phase: 05-provider-aware-coverage-and-enrichment
    provides: provider-aware routing, durable receipts, and canonical external references
provides:
  - Canonical-league-scoped provider season identity
  - Lossless forward migration with compound relational enforcement
  - Fail-closed scoped production lookups and deterministic routed replay regressions
affects: [provider-ingestion, replay, phase-05-16]
actuals:
  tokens: 189584
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns: [compound canonical-provider identity, forward-only guarded backfill, route-selected deterministic factories]
key-files:
  created:
    - packages/database/prisma/migrations/20260913_phase05_season_external_ref_scope/migration.sql
  modified:
    - packages/database/prisma/schema.prisma
    - packages/database/src/reconciliation/provider-fixture-resolver.ts
    - workers/data-sync/src/jobs/fixtures.ts
    - workers/data-sync/src/jobs/results.ts
    - workers/data-sync/src/jobs/standings.ts
    - tests/integration/provider-fallback-identity.test.ts
key-decisions:
  - "Provider season identity is provider + canonical leagueId + exact externalId; provider IDs are never synthesized."
  - "A provider may map a canonical season only once, and the database enforces SeasonExternalRef league consistency through a composite foreign key."
  - "Replay tests count durable route reservations once route-selected execution is active, while preserving exactly-once assertions."
patterns-established:
  - "Canonical-first lookup: resolve LeagueExternalRef, then query SeasonExternalRef within that canonical league."
  - "Migration guard: backfill, abort on null/mismatch/duplicates, then make the scope required and replace uniqueness."
requirements-completed: [PROV-01, PROV-02, PROV-03]
coverage:
  - id: D1
    description: "PL, UEL and UECL may share API-Football season 2026 without identity collision."
    requirement: PROV-01
    verification:
      - kind: integration
        ref: "tests/integration/provider-fallback-identity.test.ts#keeps API-Football year 2026 independent"
        status: pass
      - kind: integration
        ref: "tests/integration/migration-empty.test.ts#scopes provider season identity"
        status: pass
    human_judgment: false
  - id: D2
    description: "Production fixture, result and standings lookups remain inside canonical league scope and fail closed."
    requirement: PROV-02
    verification:
      - kind: integration
        ref: "tests/integration/provider-worker-routing.test.ts"
        status: pass
      - kind: integration
        ref: "tests/integration/replay-boundary.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Empty and populated pre-D-15 PostgreSQL databases migrate forward with generated Prisma types in sync."
    requirement: PROV-03
    verification:
      - kind: integration
        ref: "tests/integration/migration-empty.test.ts"
        status: pass
      - kind: other
        ref: "prisma validate && prisma generate && database/data-sync/football-data/config typecheck"
        status: pass
    human_judgment: false
duration: 1h 5m
completed: 2026-09-13
status: complete
---

# Phase 5 Plan 15: Canonical Provider Season Scope Summary

**Lossless PostgreSQL migration and Prisma contract now scope provider seasons by canonical competition, with PL/UEL/UECL shared-year regressions and fail-closed routed replay behavior.**

## Performance

- **Duration:** 1h 5m
- **Completed:** 2026-09-13T19:58:00Z
- **Tasks:** 3
- **Files modified:** 16

## Accomplishments

- Added `leagueId` to `SeasonExternalRef`, compound uniqueness, one-provider-mapping-per-season enforcement, and a same-league composite foreign key.
- Added a forward-only guarded migration that preserves existing references and proves both empty and populated upgrade paths on PostgreSQL 18.
- Scoped every production lookup and proved shared API-Football year `2026` across PL, UEL and UECL.
- Restored route-selected replay completion, fail-closed error propagation, durable reservation accounting, and exactly-once behavior without weakening assertions.

## Task Commits

1. **Task 1 RED:** `73800bd`
2. **Task 1 GREEN:** `ffa2d5e`
3. **Task 2 RED:** `e6bd462`
4. **Task 2 GREEN:** `4ed9043`
5. **Task 3 creators and fallback regressions:** `808f1f8`
6. **Replay regression fix:** `5bcc898`

## Decisions Made

- Exact provider values remain unchanged; canonical league scope disambiguates repeated provider seasons.
- Reads derive season scope from the canonical league selected by `LeagueExternalRef`.
- Route-selected replay uses scoped provider capabilities/circuits and durable throttle reservations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored routed replay identity, scope classification and exactly-once execution**
- **Found during:** Task 3 full verification
- **Issue:** The preserved provider-factory composition seam activated durable routing in replay tests, exposing incomplete capability seeds, legacy reservation assertions, primary fixture reconciliation behavior, and swallowed non-fallback errors.
- **Fix:** Seeded scoped route capabilities/circuits, injected deterministic route-selected factories, retained conservative fallback reconciliation, validated fixture scope before publication, propagated non-fallback errors, and asserted durable reservations.
- **Files modified:** `tests/integration/replay-boundary.test.ts`, `workers/data-sync/src/jobs/fixtures.ts`, `workers/data-sync/src/ingestion/provider-route-runtime.ts`
- **Verification:** Full replay/fallback suite passed 20/20.
- **Committed in:** `5bcc898`

---

**Total deviations:** 1 auto-fixed bug.
**Impact on plan:** Required to make D-15 production routing and the mandatory replay verification coherent; no Phase 6 or live acceptance work was started.

## Issues Encountered

- Vitest requires a test-only signing secret and authorized subject for the private replay ingress; both were supplied only to the test process.

## User Setup Required

None.

## Next Phase Readiness

- D-15 migration and production consumers are complete.
- The separate live acceptance harness remains owned by 05-16 and was not modified or committed.

## Self-Check: PASSED

- Migration, schema, generated client, production lookup files and all six commits exist.
- Prisma generation produced no tracked drift.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-13*
