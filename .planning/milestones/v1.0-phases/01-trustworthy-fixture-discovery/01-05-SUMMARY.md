---
phase: 01-trustworthy-fixture-discovery
plan: 05
subsystem: canonical-identity
tags: [prisma, postgresql, reconciliation, audit, docker]
requires:
  - phase: 01-04
    provides: Fixture tracer, dependency readiness, and deterministic integration harness
provides:
  - Provider-independent canonical football identity with unique provider external references
  - Conservative fixture reconciliation and append-only auditable decisions
  - Reviewable Prisma 7 migration proven from empty PostgreSQL 18
affects: [provider-ingestion, fixture-discovery, data-integrity, audit]
actuals:
  tokens: 6900
  tasks: 3
  commits: 3
tech-stack:
  added: [prisma-7.10.0, prisma-adapter-pg, pg]
  patterns: [provider-independent-identity, conservative-reconciliation, append-only-audit, migration-from-empty]
key-files:
  created: [packages/database/prisma/schema.prisma, packages/database/prisma.config.ts, packages/database/src/client.ts, packages/database/prisma/migrations/20260828061500_canonical_identity_and_reconciliation/migration.sql, packages/domain/src/reconciliation.ts, tests/integration/reconciliation.test.ts, tests/integration/migration-empty.test.ts]
  modified: [packages/database/package.json, pnpm-lock.yaml]
key-decisions:
  - "Use provider IDs exclusively in unique external-reference tables; canonical IDs remain provider-independent."
  - "Treat the ±36-hour window and fuzzy identity as candidate evidence only; ambiguity and no-lineage postponements quarantine."
  - "Enforce decision immutability with an append-only PostgreSQL trigger and explicit supersession links."
requirements-completed: [DATA-03, DATA-04]
coverage:
  - id: D1
    description: "Exact external references resolve idempotently while ambiguous, fuzzy, time-only, and no-lineage postponement cases remain quarantined."
    requirement: DATA-03
    verification:
      - kind: integration
        ref: "tests/integration/reconciliation.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The named Prisma 7 migration applies from empty PostgreSQL 18 and preserves unique refs, non-unique candidate indexes, foreign keys, and append-only audit."
    requirement: DATA-04
    verification:
      - kind: integration
        ref: "tests/integration/migration-empty.test.ts"
        status: pass
    human_judgment: false
duration: 24min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 05: Canonical Identity and Reconciliation Summary

**Provider-independent football identity with conservative reconciliation, immutable audit history, and an empty-PostgreSQL-18 migration witness**

## Performance

- **Duration:** 24 min active execution
- **Completed:** 2026-08-28
- **Tasks:** 3
- **Files modified:** 34

## Accomplishments

- Materialized D-08 canonical League, Season, Team, Player, and Fixture identities with provider identifiers isolated in unique external-reference tables.
- Implemented D-09–D-11 reconciliation: exact lineage resolves, only one strong team-pair candidate may auto-resolve, and fuzzy/ambiguous/time-only/no-lineage postponements quarantine.
- Added D-12 evidence-rich decision history with supersession and a database trigger preventing UPDATE or DELETE.
- Generated Prisma Client 7.10.0 with the PostgreSQL driver adapter and proved the named migration against a fresh PostgreSQL 18 container.

## Task Commits

1. **RED: Define reconciliation invariants** — `a96e760` (test)
2. **GREEN: Model canonical identity and reconciliation** — `d6c17c8` (feat)
3. **Migration: Prove canonical identity from empty PostgreSQL 18** — `7390165` (feat)

## Files Created/Modified

- `packages/database/prisma/schema.prisma` — canonical entities, refs, provenance, cases, candidates, and decisions.
- `packages/database/prisma/migrations/20260828061500_canonical_identity_and_reconciliation/migration.sql` — named reviewable PostgreSQL migration and append-only trigger.
- `packages/database/src/client.ts` — Prisma 7 client factory using `@prisma/adapter-pg`.
- `packages/domain/src/reconciliation.ts` — pure conservative reconciliation policy.
- `tests/integration/reconciliation.test.ts` — D-09–D-12 behavior proof.
- `tests/integration/migration-empty.test.ts` — live PostgreSQL 18 deployment and catalog witness.

## Decisions Made

- Kept kickoff/team-pair indexes non-unique because the ±36-hour window generates candidates but cannot prove identity.
- Allowed kickoff mutation for postponements only after an exact existing external-reference lineage match.
- Stored corrections as new decisions linked by `supersedesDecisionId`; database-level mutation attempts are rejected.

## Deviations from Plan

- The Windows integration harness invokes Prisma CLI through `process.execPath` because Node 25 returns `EINVAL` when spawning `pnpm.cmd` directly.
- Generated Prisma client files were committed with Task 2 so every production commit remained compilable.

## Issues Encountered

- Docker Desktop required an interactive administrator launch before the PostgreSQL 18 witness could run.
- The host uses Node 25.2.1 while the project contract requires Node 24 LTS; verification passed with an engine warning.

## User Setup Required

Use Node 24 LTS for normal project development and CI.

## Next Phase Readiness

Canonical identity and audit guarantees are ready for provider ingestion work in Plan 01-06.

## Self-Check: PASSED

- Prisma schema validate and client generation: passed.
- Database package TypeScript typecheck: passed.
- Reconciliation integration suite: 6/6 passed.
- Empty PostgreSQL 18 migration suite: 1/1 passed.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
