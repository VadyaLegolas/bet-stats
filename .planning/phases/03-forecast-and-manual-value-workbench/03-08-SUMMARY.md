---
phase: 03-forecast-and-manual-value-workbench
plan: 08
subsystem: forecast-publication
tags: [forecast, provenance, prisma, postgresql, concurrency]
requires: [03-07]
provides:
  - Complete official-lineup provenance in forecast identities and receipts
  - Serialized fixture/kind forecast revision allocation
affects: [forecast-api, immutable-snapshots, value-receipts]
tech-stack:
  added: []
  patterns: [canonical provenance hashing, transaction-scoped advisory lock, nulls-not-distinct identity]
key-files:
  created:
    - packages/database/prisma/migrations/20260908_phase03_forecast_identity_gap/migration.sql
  modified:
    - packages/domain/src/forecast/contract.ts
    - apps/api/src/modules/forecasts/forecasts.service.ts
    - packages/database/prisma/schema.prisma
    - tests/integration/forecast-publication.test.ts
    - tests/integration/forecast-snapshots.test.ts
decisions:
  - Bind an explicit null or official lineup observation ID into every forecast input hash and receipt.
  - Serialize revisions with a PostgreSQL transaction advisory lock keyed by fixture and forecast kind.
metrics:
  duration: 11min
  completed: 2026-09-08
status: complete
actuals:
  tokens: 6320
  tasks: 2
  commits: 4
requirements-completed: [PRED-04, PRED-06]
coverage:
  - id: D1
    description: Corrected official lineup observations create distinct immutable forecast identities while identical retries converge.
    requirement: PRED-04
    verification:
      - kind: integration
        ref: tests/integration/forecast-publication.test.ts#binds the exact official lineup observation into immutable forecast identity and receipt
        status: pass
    human_judgment: false
  - id: D2
    description: Concurrent distinct publications receive consecutive linked revisions and identical publications converge.
    requirement: PRED-06
    verification:
      - kind: integration
        ref: tests/integration/forecast-snapshots.test.ts#serializes concurrent distinct contents into consecutive linked revisions
        status: unknown
    human_judgment: true
    rationale: PostgreSQL verification could not run because Docker Desktop daemon and DATABASE_URL were unavailable.
---

# Phase 3 Plan 08: Forecast Identity Gap Closure Summary

**Official-lineup provenance is now part of the immutable forecast identity, with PostgreSQL-serialized revision allocation for concurrent publishers.**

## Performance

- **Duration:** 11 min
- **Completed:** 2026-09-08
- **Tasks:** 2
- **Commits:** 4

## Accomplishments

- Added the exact official lineup observation ID to snapshot IDs, canonical input hashes, strict transport DTOs, and receipts.
- Preserved INITIAL and PRE_MATCH identity with an explicit null observation provenance.
- Added a fixture/kind transaction advisory lock and re-read convergence/predecessor state inside the protected transaction.
- Migrated the content index to include lineup provenance with `NULLS NOT DISTINCT` so null-provenance retries still converge.

## Commits

- `905a506` — RED regression for lineup provenance identity.
- `09350fd` — Bind lineup provenance to forecast identity and receipt.
- `f5161ae` — RED PostgreSQL concurrency regression.
- `fdc149a` — Serialize revisions and migrate complete content identity.

## Verification

- PASS: `corepack pnpm exec vitest run tests/integration/forecast-publication.test.ts tests/integration/forecast-api.test.ts tests/integration/value-api.test.ts` — 11/11.
- PASS: database, domain, and API TypeScript typechecks.
- PASS: Prisma schema validation using a non-connecting placeholder `DATABASE_URL`.
- NOT RUN: migration-from-empty, forecast snapshot, and Phase 3 security PostgreSQL suites; Docker daemon was unavailable and no `DATABASE_URL` was configured.
- OUT OF SCOPE: root unit suite had 147 passing and 2 failing tests in `odds-draft-ui.test.tsx`, caused by concurrent Plan 03-09 changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated strict forecast fixtures for the new required provenance contract**
- **Found during:** Task 2 available verification
- **Issue:** Existing forecast/value API fixtures omitted the newly required explicit null provenance.
- **Fix:** Updated only strict contract fixtures to carry matching top-level and receipt provenance.
- **Files modified:** `tests/integration/forecast-api.test.ts`, `tests/integration/value-api.test.ts`, `tests/integration/phase-03-security.test.ts`
- **Commit:** `fdc149a`

## Deferred Issues

- Run the full plan PostgreSQL gate when Docker Desktop or a disposable PostgreSQL `DATABASE_URL` is available.

## Known Stubs

None.

## Self-Check: PASSED

- All files listed above exist.
- All four plan commits exist in git history.
- The only unrun verification is explicitly recorded above and in the cross-phase windows ledger.
