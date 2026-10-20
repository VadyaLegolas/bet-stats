---
phase: 01-trustworthy-fixture-discovery
plan: 06
subsystem: provider-policy
tags: [prisma, postgresql, capability, request-budget, concurrency]
requires:
  - phase: 01-05
    provides: Canonical league and season identities with PostgreSQL migration baseline
provides:
  - Canonically keyed, durable provider capability records
  - Atomic daily endpoint request reservations with idempotent job keys
  - Stable unresolved-identity forecast ineligibility contract
affects: [provider-ingestion, fixture-discovery, provider-budgeting, forecasting]
actuals:
  tokens: 10500
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [fail-closed-capability, advisory-lock-reservation, deterministic-job-idempotency]
key-files:
  created: [packages/domain/src/capability.ts, packages/domain/src/request-budget.ts, packages/domain/src/forecast-eligibility.ts, packages/database/prisma/migrations/20260828124000_provider_capability_and_request_reservations/migration.sql, tests/integration/provider-capability.test.ts]
  modified: [packages/database/prisma/schema.prisma, packages/database/src/generated/prisma]
key-decisions:
  - "Serialize allowance checks with a PostgreSQL transaction-scoped advisory lock keyed by provider/date/endpoint."
  - "Treat missing, expired, unsupported, or canonical-key-mismatched capabilities as denied."
  - "Expose unresolved identity as a stable domain reason without introducing forecast APIs or prediction behavior."
requirements-completed: [DATA-06, DATA-08]
duration: 12min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 06: Provider Capability and Request Budget Summary

**Durable fail-closed provider capability with atomic PostgreSQL request reservations and a stable unresolved-identity forecast gate**

## Accomplishments

- Added capability storage foreign-keyed to canonical League and Season records and uniquely scoped by provider, competition, season, and endpoint.
- Added append-only request reservations whose provider/date/endpoint allowance is protected under concurrency by a transaction-scoped advisory lock.
- Proved that 20 concurrent attempts against an allowance of five persist exactly five reservations, while a repeated job key reuses its reservation.
- Added the D-14 domain seam that prevents unresolved canonical identity from entering future forecast flows.

## Task Commits

1. **RED: Define capability, budget, and eligibility invariants** — `7c097da` (test)
2. **GREEN: Persist capability and atomic reservations** — `0206e71` (feat)
3. **GREEN: Add forecast eligibility seam** — `eb0e97a` (feat)

## Verification

- `pnpm test:integration -- provider-capability request-budget forecast-eligibility migration-empty --run` — 2 files, 4 tests passed against PostgreSQL 18 Docker containers.
- `pnpm --filter @bet-stats/database prisma validate` — schema valid.
- `pnpm --filter @bet-stats/database prisma generate` — Prisma Client 7.10.0 generated.
- `pnpm typecheck` — passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used the database package client in the integration witness**
- **Found during:** Task 1 RED
- **Issue:** The root test workspace does not directly expose the database package's `pg` dependency.
- **Fix:** Exercised the policy through the real Prisma 7 PostgreSQL adapter instead of adding or hoisting a dependency.
- **Files modified:** `tests/integration/provider-capability.test.ts`
- **Commit:** `7c097da`

## Issues Encountered

- The host runs Node 25.2.1 while the project contract specifies Node 24 LTS; all verification passed with the existing engine warning.
- Docker/Vitest child-process access required execution outside the filesystem sandbox.

## Known Stubs

None.

## Self-Check: PASSED

- All created source, migration, generated client, test, and summary files exist.
- Commits `7c097da`, `0206e71`, and `eb0e97a` exist.
- Named forward migration applied from an empty PostgreSQL 18 database without reset or db push.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
