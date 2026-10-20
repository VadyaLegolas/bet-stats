---
phase: 02-historical-evidence-pipeline
plan: 21
subsystem: evidence-provenance
tags: [postgresql, prisma, nestjs, provenance, immutable-payload, tdd]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: immutable observations, evidence rebuild publication, and fail-closed component projection
provides:
  - Exact fixture/effective/observed/hash/byte source-reference propagation
  - Payload-identity receipt matching that cannot cross-join same-time corrections
  - Component-local fail-closed handling for malformed or missing immutable identity
affects: [phase-03, evidence-api, prediction-snapshots, backtesting]
actuals:
  tokens: 3642
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [exact immutable provenance join, receipt input sanitization, append-only collision witness]
key-files:
  created: []
  modified:
    - packages/domain/src/evidence/contract.ts
    - workers/data-sync/src/jobs/evidence-rebuild.ts
    - apps/api/src/modules/evidence/evidence.service.ts
    - tests/integration/evidence-publication.test.ts
    - tests/integration/evidence-api.test.ts
key-decisions:
  - "Component provenance matches receipt inputs on fixture, effective time, observed time, payload hash, and payload byte count."
  - "Malformed receipt inputs are discarded at projection time so only dependent components fail closed while valid siblings remain visible."
patterns-established:
  - "Immutable evidence joins use the complete payload identity; temporal coordinates alone are never sufficient."
requirements-completed: [PIPE-02, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: Published components retain the exact immutable observation payload identity from rebuild through the public DTO
    requirement: PIPE-02
    verification:
      - kind: integration
        ref: tests/integration/evidence-publication.test.ts#publishes a complete build and keeps the exact-cutoff Nest response invariant
        status: pass
    human_judgment: false
  - id: D2
    description: Same-time corrections cannot cross-join receipts and malformed provenance affects only its component
    requirement: PIPE-08
    verification:
      - kind: integration
        ref: tests/integration/evidence-publication.test.ts#keeps same-time corrections distinct by immutable payload identity
        status: pass
      - kind: integration
        ref: tests/integration/evidence-api.test.ts#does not cross-join corrections that share the same temporal tuple
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-09-01
status: complete
---

# Phase 02 Plan 21: Exact Immutable Evidence Provenance Summary

**Evidence components now carry and match exact immutable payload hash and byte identity, preventing same-time corrections from borrowing one another's public receipts.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-01T08:19:00+02:00
- **Completed:** 2026-09-01T08:28:00+02:00
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Propagated complete immutable source references from PostgreSQL observations into every staged evidence component.
- Centralized runtime source-reference validation and required exact hash/byte identity during API receipt projection.
- Proved with real PostgreSQL corrections that identical fixture/effective/observed coordinates remain distinct and that mismatches null only the affected component.

## Task Commits

1. **Task 1 RED: Expose dropped payload provenance** — `4990bb9`
2. **Task 1 GREEN: Bind evidence refs to payload identity** — `378afdf`
3. **Task 2 RED: Cover payload identity collisions** — `61a832e`
4. **Task 2 GREEN: Fail malformed receipt inputs closed** — `6577a70`

## Files Created/Modified

- `packages/domain/src/evidence/contract.ts` — validates exact immutable source references in receipts and projected components.
- `workers/data-sync/src/jobs/evidence-rebuild.ts` — stages complete source references rather than temporal coordinates alone.
- `apps/api/src/modules/evidence/evidence.service.ts` — matches all immutable identity fields and filters malformed receipt inputs.
- `tests/integration/evidence-publication.test.ts` — real PostgreSQL propagation and same-time correction collision witnesses.
- `tests/integration/evidence-api.test.ts` — byte/hash mismatch and component-local fail-closed coverage.

## Decisions Made

- Payload hash and payload byte count are part of provenance identity, alongside fixture ID, effective time, and observed time.
- Invalid receipt inputs are excluded before DTO validation; components referencing them become unavailable without hiding valid siblings.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The sandbox blocked Vitest child-process creation, so integration verification ran with approved unrestricted process access.
- One combined PostgreSQL run hit a transient Prisma schema-engine startup failure; a fresh rerun reached the behavioral assertion and the final combined run passed.
- The host uses Node 25 while the workspace requests Node 24; typechecks emitted engine warnings but completed successfully.

## User Setup Required

None.

## Known Stubs

None.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/integration/evidence-api.test.ts tests/integration/evidence-publication.test.ts --project integration` — 2 files, 13 tests passed.
- `pnpm --filter @bet-stats/domain typecheck` — passed.
- `pnpm --filter @bet-stats/api typecheck` — passed.
- `pnpm --filter @bet-stats/data-sync typecheck` — passed.

## Next Phase Readiness

- PIPE-02/07/08 provenance now remains exact under append-only correction collisions.
- Prediction snapshots and backtests can reproduce component inputs without ambiguous temporal joins.

## Self-Check: PASSED

- All five modified implementation/test files exist.
- Task commits `4990bb9`, `378afdf`, `61a832e`, and `6577a70` exist in git history.
- Required integration suites and package typechecks passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-09-01*
