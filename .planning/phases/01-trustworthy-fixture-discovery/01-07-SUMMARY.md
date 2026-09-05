---
phase: 01-trustworthy-fixture-discovery
plan: 07
subsystem: provider-ingestion
tags: [football-data-org, zod, postgresql, prisma, capability, idempotency]
requires:
  - phase: 01-06
    provides: Durable provider capability records and atomic request reservations
provides:
  - Validated Premier League fixture adapter with exhaustive status handling
  - Pre-call capability and request-budget enforcement on production fixture sync
  - Idempotent canonical fixture, external-reference, and provenance persistence
affects: [fixture-discovery, provider-ingestion, forecasting, data-quality]
actuals:
  tokens: 6020
  tasks: 2
  commits: 6
tech-stack:
  added: [zod]
  patterns: [construct-client-after-reservation, advisory-lock-canonical-upsert, credential-safe-errors]
key-files:
  created: [packages/football-data/src/provider.interface.ts, packages/football-data/src/providers/football-data-org/schema.ts, packages/football-data/src/providers/football-data-org/normalize.ts, packages/football-data/src/providers/football-data-org/client.ts, workers/data-sync/src/jobs/fixtures.ts, tests/unit/provider-contract.test.ts, tests/unit/forecast-eligibility.test.ts]
  modified: [packages/football-data/src/index.ts, packages/football-data/package.json, packages/database/package.json, workers/data-sync/package.json, tests/integration/provider-capability.test.ts, vitest.config.ts, pnpm-lock.yaml]
key-decisions:
  - "Construct the provider client only after persisted capability approval and atomic reservation, preventing constructor-side I/O from bypassing policy."
  - "Serialize fixture reconciliation by provider external ID and preserve raw payload provenance with a deterministic SHA-256 identity."
  - "Discard upstream error causes at the public provider boundary because providers may echo credential-bearing headers."
requirements-completed: [DATA-06, DATA-08]
coverage:
  - id: D1
    description: "football-data.org payloads are validated, normalized exhaustively, and retain nullable provenance."
    requirement: DATA-06
    verification:
      - kind: unit
        ref: "tests/unit/provider-contract.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Fixture synchronization reserves budget before provider I/O and reruns without duplicate facts."
    requirement: DATA-08
    verification:
      - kind: integration
        ref: "tests/integration/provider-capability.test.ts#guarded fixture ingestion"
        status: pass
    human_judgment: false
duration: 10min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 07: Guarded Football-Data Fixture Ingestion Summary

**A narrow football-data.org Premier League adapter whose live path is capability-gated, atomically reserved, validated, and idempotently persisted with provenance**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-28T12:49:00Z
- **Completed:** 2026-08-28T12:58:48Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Added Zod validation, explicit provider-independent status normalization, nullable source timestamps, capture timestamps, raw provenance, fetch timeout, and sanitized failures.
- Enforced persisted capability and atomic daily endpoint reservation before provider construction or network I/O.
- Persisted canonical fixtures, external references, and provenance under a PostgreSQL advisory lock so retries reuse one reservation and one canonical fact.

## Task Commits

1. **Task 1 RED: Define provider boundary** — `a91ef32` (test)
2. **Task 1 GREEN: Implement validated adapter** — `c279719` (feat)
3. **Task 2 RED: Define guarded ingestion** — `536f48d` (test)
4. **Task 2 GREEN: Implement gated idempotent sync** — `1b0a580` (feat)
5. **Security regression RED: Expose retained secret cause** — `87b8786` (test)
6. **Security regression GREEN: Sanitize provider errors** — `a7f9d75` (fix)

## Verification

- `vitest run --project unit provider-contract forecast-eligibility` — 2 files, 5 tests passed.
- `vitest run --project integration provider-capability request-budget idempotency` — 1 file, 5 tests passed against ephemeral Docker PostgreSQL 18.
- `pnpm typecheck` — 7/7 workspace typecheck tasks passed.
- `pnpm build` — 7/7 workspace build tasks passed, including the Next.js production build.

## Decisions Made

- The provider factory is invoked only after reservation persistence, making the pre-call invariant mechanically visible and testable.
- Exact provider fixture references are the idempotency anchor; PostgreSQL advisory locking prevents concurrent duplicate creation.
- Public provider errors intentionally omit the original cause to prevent accidental token disclosure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Removed credential-bearing upstream error causes**
- **Found during:** Task 1 security review
- **Issue:** The sanitized error message retained the original provider error as `cause`, which could expose a token if upstream text echoed request headers.
- **Fix:** Added a failing regression test and discarded the upstream cause at the public boundary.
- **Files modified:** `tests/unit/provider-contract.test.ts`, `packages/football-data/src/providers/football-data-org/client.ts`
- **Verification:** Provider contract suite passes 4/4 tests.
- **Committed in:** `87b8786`, `a7f9d75`

**2. [Rule 3 - Blocking] Exposed workspace source types for dependent package typechecking**
- **Found during:** Task 2 typecheck
- **Issue:** Database and provider packages only exposed generated `dist` declarations, which are absent before a build in a clean workspace.
- **Fix:** Pointed package `types` exports at source entrypoints while retaining runtime exports from `dist`.
- **Files modified:** `packages/database/package.json`, `packages/football-data/package.json`
- **Verification:** Full monorepo typecheck passes 7/7 tasks.
- **Committed in:** `1b0a580`

**Total deviations:** 2 auto-fixed (1 security, 1 blocking)

## Issues Encountered

- The plan's literal root `pnpm test -- ... --run` syntax is incompatible with Turbo argument parsing; equivalent targeted Vitest commands were used.
- The host runs Node 25.2.1 while the project specifies Node 24 LTS; verification passed with the existing engine warning.

## Known Stubs

None.

## Threat Flags

No security-relevant surface beyond the plan threat model was introduced.

## User Setup Required

Production execution requires `FOOTBALL_DATA_API_TOKEN`; deterministic injected adapters keep development and tests secret-free.

## Self-Check: PASSED

- All created provider, worker, test, and summary files exist.
- Commits `a91ef32`, `c279719`, `536f48d`, `1b0a580`, `87b8786`, and `a7f9d75` exist.
- PostgreSQL 18 integration witness confirmed reservation ordering and idempotent persistence.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
