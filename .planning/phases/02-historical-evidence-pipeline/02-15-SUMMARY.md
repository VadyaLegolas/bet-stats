---
phase: 02-historical-evidence-pipeline
plan: 15
subsystem: evidence
tags: [postgresql, prisma, nestjs, nextjs, provenance, discriminated-union]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: timezone-safe persistence and manifest-gated publication from Plan 02-11
provides:
  - Real PostgreSQL evidence rebuild adapter and PostgreSQL-to-Nest publication witness
  - Fail-closed per-component provenance projection
  - Shared runtime-validated API/UI evidence DTO with exhaustive labelled rendering
affects: [phase-03, evidence-api, team-evidence-ui, backtesting]
actuals:
  tokens: 91600
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns: [production boundary integration witness, per-component provenance validation, exhaustive discriminated rendering]
key-files:
  created:
    - tests/integration/evidence-publication.test.ts
  modified:
    - packages/domain/src/evidence/contract.ts
    - apps/api/src/modules/evidence/evidence.service.ts
    - apps/web/app/teams/[teamId]/evidence/page.tsx
    - workers/data-sync/src/jobs/evidence-rebuild.ts
    - tests/integration/evidence-api.test.ts
    - tests/e2e/team-evidence.spec.ts
key-decisions:
  - "Every non-null projected component must match valid receipt inputs by fixture, effective time, and observed time, with a payload identity."
  - "The domain package owns the closed component DTO and runtime parser consumed by both Nest and Next."
patterns-established:
  - "Production evidence tests migrate PostgreSQL, execute the real rebuild orchestration, query the real Nest service, validate the shared DTO, and invoke the exported UI adapter."
  - "Structured evidence is rendered through an exhaustive kind switch with explicit labels and units; arbitrary object coercion is forbidden."
requirements-completed: [PIPE-02, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: A complete successful source run publishes evidence in PostgreSQL that Nest reads invariantly at the exact cutoff
    requirement: PIPE-07
    verification:
      - kind: integration
        ref: tests/integration/evidence-publication.test.ts#publishes a complete build and keeps the exact-cutoff Nest response invariant
        status: pass
    human_judgment: false
  - id: D2
    description: Missing or mismatched provenance fails only the affected evidence component closed
    requirement: PIPE-02
    verification:
      - kind: integration
        ref: tests/integration/evidence-api.test.ts#fails only the affected component closed
        status: pass
    human_judgment: false
  - id: D3
    description: API and browser consume one discriminated DTO and render every component with named fields and units
    requirement: PIPE-08
    verification:
      - kind: integration
        ref: tests/integration/evidence-publication.test.ts#shared DTO and UI rendering adapter
        status: pass
      - kind: e2e
        ref: tests/e2e/team-evidence.spec.ts#renders every shared component kind as named values with units
        status: pass
    human_judgment: false
duration: 4h42min
completed: 2026-08-30
status: complete
---

# Phase 02 Plan 15: Honest Evidence Publication Summary

**Real PostgreSQL evidence publication through Nest with fail-closed provenance and a shared, exhaustively rendered API/UI component contract**

## Performance

- **Duration:** 4h 42min including an execution pause
- **Started:** 2026-08-30T13:23:00+02:00
- **Completed:** 2026-08-30T18:05:00+02:00
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added a production Prisma adapter for evidence rebuilds and proved the full migrated PostgreSQL → production rebuild → published build → Nest service boundary.
- Made projection provenance fail closed per component while preserving valid sibling components and exact-cutoff response invariance after later corrections.
- Replaced arbitrary object stringification with one shared runtime DTO and exhaustive labelled rendering for form, Elo, strength, goal rates, rest days, and H2H.

## Task Commits

1. **Task 1 RED: Publication boundary witness** — `7ddca3c`
2. **Task 1 GREEN: PostgreSQL publication adapter** — `a4bc44b`
3. **Task 2 RED: Provenance guards** — `7e7d6b3`
4. **Task 2 GREEN: Fail-closed component projection** — `1e9df61`
5. **Task 3 RED: Shared renderer contract** — `4aafe7c`
6. **Task 3 GREEN: Typed component rendering** — `43f60c7`

## Files Created/Modified

- `tests/integration/evidence-publication.test.ts` — real migrated PostgreSQL publication and exact-cutoff Nest/UI contract witness.
- `workers/data-sync/src/jobs/evidence-rebuild.ts` — production Prisma rebuild adapter and observation provenance query.
- `packages/database/src/generated/prisma/*` — regenerated Prisma client aligned with Plan 02-11 SyncRun completeness fields.
- `packages/domain/src/evidence/contract.ts` — closed component union, units, and runtime projection parser.
- `apps/api/src/modules/evidence/evidence.service.ts` — matched provenance validation and shared DTO construction.
- `apps/web/app/teams/[teamId]/evidence/page.tsx` — shared parser consumption and exhaustive labelled renderer.
- `tests/integration/evidence-api.test.ts` — malformed/missing provenance matrix with valid-sibling assertions.
- `tests/e2e/team-evidence.spec.ts` — browser matrix for all structured component kinds and units.

## Decisions Made

- Component source identities match receipt inputs on fixture ID, effective time, and observed time; the matched receipt input must also contain a valid payload hash and byte count.
- Unknown or malformed component shapes do not cross the public boundary as arbitrary JSON; the closed runtime contract rejects them and projection falls back to unavailable evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added the real Prisma rebuild adapter and source-observation join**
- **Found during:** Task 1
- **Issue:** The rebuild orchestration exposed only an abstract transaction port, and its eligibility SQL did not load payload provenance required by the published receipt.
- **Fix:** Added a production Prisma adapter and joined immutable `SourceObservation` payload metadata into eligible matches.
- **Files modified:** `workers/data-sync/src/jobs/evidence-rebuild.ts`
- **Verification:** Real PostgreSQL publication test and worker typecheck pass.
- **Committed in:** `a4bc44b`

**2. [Rule 3 - Blocking] Regenerated the Prisma client after Plan 02-11 schema changes**
- **Found during:** Task 1 RED setup
- **Issue:** Generated `SyncRun` types/runtime omitted completeness counters and manifest fields already present in the live schema.
- **Fix:** Regenerated the checked-in Prisma client from the approved schema.
- **Files modified:** `packages/database/src/generated/prisma/*`
- **Verification:** Database and worker typechecks pass; real PostgreSQL test writes and reads the completeness ledger.
- **Committed in:** `a4bc44b`

---

**Total deviations:** 2 auto-fixed (1 missing critical functionality, 1 blocking generated-client drift)
**Impact on plan:** Both changes were required to make the mandated production boundary real; no product scope was expanded.

## Issues Encountered

- Windows sandbox initially blocked Vitest child-process creation (`spawn EPERM`); approved execution completed normally.
- The plan's literal `node node_modules/playwright/cli.js` path does not exist under pnpm. Verification used the installed `@playwright/test` CLI path.
- Playwright requires the shared domain package to be built before the API server starts; after building it, the full six-test browser suite passed.
- The host uses Node 25 while the workspace declares Node 24; package commands emitted engine warnings but all checks passed.

## User Setup Required

None.

## Known Stubs

None.

## Verification

- `tests/integration/evidence-publication.test.ts` + `tests/integration/evidence-api.test.ts`: 2 files, 10 tests passed.
- `tests/e2e/team-evidence.spec.ts --project=chromium`: 6 tests passed.
- Domain, database, data-sync worker, API, and Web package typechecks passed.

## Next Phase Readiness

- PIPE-02/07/08 now have a non-stub production boundary witness and a single API/UI component contract.
- Later forecast and backtest phases can consume exact-cutoff evidence without relying on opaque JSON or unverifiable values.

## Self-Check: PASSED

- All key files exist.
- Task commits `7ddca3c`, `a4bc44b`, `7e7d6b3`, `1e9df61`, `4aafe7c`, and `43f60c7` exist in git history.
- Required integration, browser, and package typechecks passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-30*
