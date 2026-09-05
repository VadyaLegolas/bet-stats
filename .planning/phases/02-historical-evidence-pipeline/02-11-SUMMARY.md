---
phase: 02-historical-evidence-pipeline
plan: 11
subsystem: database
tags: [postgresql, prisma, timestamptz, idempotency, evidence]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: historical ingestion, evidence rebuild, and dual-time contracts
provides:
  - Timezone-invariant Phase 2 persistence with TIMESTAMPTZ(3)
  - Immutable observation reuse without conflict updates
  - Manifest-reconciled evidence publication state machine
affects: [phase-03, replay, evidence-api, backtesting]
actuals:
  tokens: 8485
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [forward temporal repair migration, conflict-do-nothing identity reuse, manifest-gated publication]
key-files:
  created:
    - packages/database/prisma/migrations/20260830_phase02_temporal_repair/migration.sql
  modified:
    - packages/database/prisma/schema.prisma
    - workers/data-sync/src/jobs/results.ts
    - workers/data-sync/src/jobs/standings.ts
    - workers/data-sync/src/jobs/evidence-rebuild.ts
    - workers/data-sync/src/ingestion/runner.ts
    - tests/integration/temporal-provenance.test.ts
    - tests/integration/migration-empty.test.ts
key-decisions:
  - "Existing timestamp-without-zone evidence values are explicitly interpreted as UTC during the forward migration."
  - "Evidence publication requires SUCCEEDED plus exact counter and manifest reconciliation; terminal state alone is insufficient."
patterns-established:
  - "Immutable observations use INSERT ON CONFLICT DO NOTHING followed by unique-key SELECT under the advisory-lock transaction."
  - "EvidenceBuild permits only BUILDING to PUBLISHED or FAILED while identity and published rows remain immutable."
requirements-completed: [PIPE-01, PIPE-02, PIPE-06, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: Dual-time evidence instants remain invariant across PostgreSQL session timezones
    requirement: PIPE-02
    verification:
      - kind: integration
        ref: tests/integration/temporal-provenance.test.ts#preserves cutoff identity across PostgreSQL session timezones
        status: pass
    human_judgment: false
  - id: D2
    description: Duplicate result and standings ingestion reuses immutable observations
    requirement: PIPE-01
    verification:
      - kind: integration
        ref: tests/integration/pipeline-jobs.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Only complete successful source work publishes evidence
    requirement: PIPE-07
    verification:
      - kind: integration
        ref: tests/integration/temporal-provenance.test.ts#evidence publication contract
        status: pass
    human_judgment: false
duration: 10min
completed: 2026-08-30
status: complete
---

# Phase 02 Plan 11: Temporal Persistence Repair Summary

**Timezone-safe PostgreSQL evidence history with immutable rerun convergence and manifest-gated publication**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-30T11:05:00Z
- **Completed:** 2026-08-30T11:15:08Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Migrated all Phase 2 evidence instants to `TIMESTAMPTZ(3)` through an explicit UTC forward conversion and aligned Prisma native types.
- Replaced trigger-conflicting observation upserts with immutable conflict-do-nothing reuse for result and standings ingestion.
- Added durable SyncRun completion counters/manifests and required exact successful reconciliation before an EvidenceBuild can publish.

## Task Commits

1. **Task 1: Prove the repaired database path** — `5e31338`
2. **Task 2: Make result and standings reruns converge** — `2d21071`
3. **Task 3: Publish only from complete successful work** — `5ee9aae`

## Files Created/Modified

- `packages/database/prisma/migrations/20260830_phase02_temporal_repair/migration.sql` — forward temporal conversion, completeness constraints, and guarded build transition.
- `packages/database/prisma/schema.prisma` — native timestamptz annotations and SyncRun completeness ledger.
- `workers/data-sync/src/jobs/results.ts` — immutable result observation reuse.
- `workers/data-sync/src/jobs/standings.ts` — immutable standing observation reuse.
- `workers/data-sync/src/ingestion/runner.ts` — idempotent completion-manifest reconciliation.
- `workers/data-sync/src/jobs/evidence-rebuild.ts` — fail-closed successful-completeness publication predicate.
- `tests/integration/temporal-provenance.test.ts` — real PostgreSQL timezone and transition witnesses plus publication-contract tests.
- `tests/integration/migration-empty.test.ts` — fresh migration native-type and completeness-column checks.

## Decisions Made

- Preserved approved D-02 semantics by interpreting legacy Phase 2 timestamp values as UTC at migration time.
- Required non-empty expected units and captures, matching counters, and set reconciliation before publication.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- The first sandboxed Vitest launch was blocked by Windows `spawn EPERM`; the same command succeeded with the approved execution permission.
- Prisma validation requires a syntactically valid `DATABASE_URL`; validation used a local non-secret placeholder without connecting.
- The host runs Node 25 while the workspace declares Node 24; tests and typecheck passed with the existing engine warning.

## User Setup Required

None.

## Known Stubs

None.

## Next Phase Readiness

- The persistence blockers for PIPE-01/02/06/07/08 are closed at the real PostgreSQL boundary.
- Remaining Phase 2 gap plans may safely consume timezone-invariant evidence and the complete-source publication predicate.

## Self-Check: PASSED

- All key files exist.
- Task commits `5e31338`, `2d21071`, and `5ee9aae` exist in git history.
- Prisma validation, 18 targeted tests, and worker typecheck passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-30*
