---
phase: 03-forecast-and-manual-value-workbench
plan: 03
subsystem: database
tags: [postgresql, prisma, immutable-snapshots, triggers, integration-tests]
requires:
  - phase: 03-forecast-and-manual-value-workbench
    provides: deterministic forecast, odds, and value receipt contracts
provides:
  - Append-only forecast, lineup, manual-odds, and value-receipt persistence
  - Exact fixture and market compatibility enforcement for value snapshot pairs
  - Forward-only Prisma migration verified against an empty PostgreSQL database
affects: [03-04, 03-05, 04-evaluation, forecast-api, manual-odds-api]
actuals:
  tokens: 273165
  tasks: 3
  commits: 2
tech-stack:
  added: []
  patterns: [append-only database triggers, compound content identity, exact snapshot pairing]
key-files:
  created: [packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots/migration.sql, tests/integration/forecast-snapshots.test.ts, tests/integration/manual-odds.test.ts, tests/integration/value-receipt.test.ts]
  modified: [packages/database/prisma/schema.prisma, packages/database/src/generated/prisma]
key-decisions:
  - "Treat fixture, kind, model/config fingerprint, cutoff, evidence/input fingerprint, sources, probabilities, confidence, assumptions, and creation time as permanent issued-forecast identity facts; corrections append revisions."
  - "Require value receipts to reference an exact fixture- and market-compatible forecast and manual-odds snapshot pair."
patterns-established:
  - "Issued forecast, odds, selections, and value receipts reject UPDATE and DELETE at the PostgreSQL boundary."
  - "INITIAL and PRE_MATCH forecasts use compound idempotency identities; LINEUP_CONFIRMED requires durable official lineup provenance."
requirements-completed: [PRED-04, PRED-06, ODDS-02, VALUE-01, VALUE-04]
coverage:
  - id: D1
    description: "Issued forecasts are content-addressed, revision-linked, and immutable, including official lineup provenance for LINEUP_CONFIRMED."
    requirement: PRED-04
    verification:
      - kind: integration
        ref: "tests/integration/forecast-snapshots.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Manual odds books and selections are append-only and replacements preserve the prior snapshot."
    requirement: ODDS-02
    verification:
      - kind: integration
        ref: "tests/integration/manual-odds.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Value receipts persist exact forecast and odds IDs and reject cross-fixture or cross-market pairs."
    requirement: VALUE-04
    verification:
      - kind: integration
        ref: "tests/integration/value-receipt.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The complete migration chain deploys cleanly to an empty PostgreSQL database with Prisma schema synchronization."
    requirement: PRED-06
    verification:
      - kind: integration
        ref: "tests/integration/migration-empty.test.ts"
        status: pass
      - kind: other
        ref: "prisma validate, generate, migrate deploy, and migrate status"
        status: pass
    human_judgment: false
duration: 32min active
completed: 2026-09-06
status: complete
---

# Phase 3 Plan 3: Immutable Forecast and Value Snapshot Persistence Summary

**PostgreSQL now preserves revision-linked forecasts and manual odds as immutable records while enforcing exact compatible snapshot pairs for every value receipt.**

## Performance

- **Duration:** 32 min active
- **Started:** 2026-09-06T02:12:36Z
- **Completed:** 2026-09-06T02:44:20Z
- **Tasks:** 3
- **Files modified:** 22

## Accomplishments

- Added Prisma models and a forward migration for forecast snapshots, market probabilities, official lineup observations, manual odds books/selections, and value receipts.
- Enforced append-only issued data, linked revisions/replacements, compound idempotency identities, and exact fixture/market snapshot compatibility in PostgreSQL.
- Proved the full migration chain and generated client against a disposable PostgreSQL database with four integration suites and database/API/worker typechecks.

## Task Commits

1. **Task 1: Confirm the one-way forecast snapshot identity boundary** - approved decision checkpoint (no code commit)
2. **Task 2 RED: Snapshot persistence constraints** - `7900f27` (test)
3. **Task 2 GREEN: Immutable forecast value snapshots** - `e71cac6` (feat)
4. **Task 3: Verify forward migration and schema synchronization** - approved verification checkpoint (no code commit)

## Files Created/Modified

- `packages/database/prisma/schema.prisma` - Durable snapshot, revision, provenance, and receipt relations.
- `packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots/migration.sql` - Forward DDL, constraints, and append-only/compatibility triggers.
- `packages/database/src/generated/prisma/` - Regenerated Prisma 7 client and model types.
- `tests/integration/forecast-snapshots.test.ts` - Forecast identity, immutability, revisions, and lineup provenance coverage.
- `tests/integration/manual-odds.test.ts` - Immutable odds book and replacement coverage.
- `tests/integration/value-receipt.test.ts` - Exact compatible snapshot-pair coverage.
- `tests/integration/migration-empty.test.ts` - Empty-database migration-chain coverage.

## Decisions Made

- Proceeded with D-05: issued forecast identity/input facts are permanent; corrections create linked rows instead of mutating history.
- Kept semantic receipt compatibility below the service layer so individually valid but mismatched IDs cannot be persisted.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The approved disposable PostgreSQL verification environment completed all planned commands successfully.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Verification

- Prisma `validate`, `generate`, `migrate deploy`, and `migrate status` — passed with no pending migration or drift.
- Four integration files — 8 tests passed.
- `@bet-stats/database`, `@bet-stats/api`, and `@bet-stats/data-sync` typechecks — passed against the generated client.

## Next Phase Readiness

- API and worker plans can persist issued forecasts, manual odds, and exact value receipts without mutable-history risk.
- Phase 4 evaluation can rely on stable snapshot identities and reproducible receipt inputs.
- No blocking issues remain for dependent Phase 3 plans.

## Self-Check: PASSED

- All 22 implementation, generated-client, migration, and integration-test files exist.
- Commits `7900f27` and `e71cac6` exist in repository history.

---
*Phase: 03-forecast-and-manual-value-workbench*
*Completed: 2026-09-06*
