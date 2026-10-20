---
phase: 02-historical-evidence-pipeline
plan: 03
subsystem: testing
tags: [football-data-org, endpoint-coverage, quota-priority, vitest, markdown-contract]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: [Wave 0 pipeline contracts, priority lane decisions, provenance witnesses]
provides:
  - Machine-verifiable Phase 2 football-data.org live endpoint matrix
  - Explicit Phase 3 and Phase 5 opt-outs for optional enrichment surfaces
  - Deterministic duplicate, completeness, lane and reservation validation
affects: [provider-adapters, pipeline-workers, request-budget-policy, phase-03, phase-05]
tech-stack:
  added: []
  patterns: [markdown policy parsed as an executable contract, named row-level policy failures]
key-files:
  created:
    - .planning/phases/02-historical-evidence-pipeline/COVERAGE.md
    - tests/unit/coverage-contract.test.ts
  modified: []
key-decisions:
  - "Endpoint priority lane is the primary scheduling and budget policy; endpoint surface remains variant detail."
  - "Phase 2 live access is restricted to fixture continuity, completed results and standings; optional enrichment is deferred to Phases 3/5."
patterns-established:
  - "Coverage matrix pattern: every live endpoint names its adapter, capability, lane, reservation, DTO, durable output and witness."
  - "Opt-out pattern: deferred surfaces are unique, phase-pinned and forbidden from appearing in the live matrix."
requirements-completed: [PIPE-01, PIPE-03, PIPE-04]
coverage:
  - id: D1
    description: "Phase 2 football-data.org live coverage is limited to critical fixture/result continuity and standard standings."
    requirement: PIPE-03
    verification:
      - kind: unit
        ref: "tests/unit/coverage-contract.test.ts#declares the required live endpoint matrix and classifications"
        status: pass
    human_judgment: false
  - id: D2
    description: "Optional lineup, injury, odds, secondary-statistics and fallback/enrichment calls are explicitly deferred and cannot leak into the live matrix."
    requirement: PIPE-04
    verification:
      - kind: unit
        ref: "tests/unit/coverage-contract.test.ts#keeps every deferred endpoint unique and outside the live classifications"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-08-29
status: complete
---

# Phase 02 Plan 03: Endpoint Coverage Contract Summary

**A parsed football-data.org coverage matrix now locks Phase 2 to fixture continuity, completed results and standings while enforcing named Phase 3/5 enrichment opt-outs.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-29T10:46:24Z
- **Completed:** 2026-08-29T10:49:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Declared all required adapter, capability, priority, reservation, DTO, persistence and witness fields for the three Phase 2 live endpoint surfaces.
- Classified fixture and result continuity as critical while keeping standings standard.
- Added deterministic checks for missing columns/rows, duplicate surfaces, incomplete cells, invalid policy values and deferred endpoint leakage.
- Pinned lineups, injuries and secondary statistics to Phase 3 and odds plus fallback/enrichment endpoints to Phase 5.

## Task Commits

1. **Task 1 RED: Declare and parse the Phase 2 endpoint matrix** - `8856c2e` (test)
2. **Task 1 GREEN: Declare and parse the Phase 2 endpoint matrix** - `af0534a` (feat)
3. **Task 2: Enforce coverage matrix consistency** - `3f7bf8e` (test)

## Files Created/Modified

- `.planning/phases/02-historical-evidence-pipeline/COVERAGE.md` - Phase 2 live endpoint classifications and later-phase opt-outs.
- `tests/unit/coverage-contract.test.ts` - deterministic markdown parser and policy consistency assertions.

## Decisions Made

- Promoted endpoint priority lane to the primary scheduling/budget noun because quota headroom and worker order depend on it.
- Kept the contract document-only so result and standings production symbols can be implemented by later plans without weakening early scope enforcement.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The sandbox blocked Vite helper-process creation with `spawn EPERM`; targeted verification was rerun with approved execution outside the sandbox.
- The active shell runs Node 25 despite the repository's Node 24 engine declaration; all scoped tests passed and no runtime-dependent behavior was introduced.

## Verification

- TDD RED: 2 tests failed only because `COVERAGE.md` was absent.
- Tracer GREEN and feedback gate: 2 tests passed.
- Task 2: 4 coverage-contract tests passed.
- Overall: `pnpm exec vitest run tests/unit/coverage-contract.test.ts tests/unit/provider-contract.test.ts` passed 2 files and 8 tests in 1.19 seconds.

## Known Stubs

None. Future result and standings symbol names are documented contract targets, not executable placeholders.

## Threat Flags

None. This plan adds no network endpoint, authentication path, file-access boundary or schema change; it machine-enforces the planned coverage-document trust boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Result and standings provider expansion can now use a fixed lane/reservation contract.
- Any attempt to silently introduce optional Phase 2 provider calls will fail the coverage test by endpoint name.

## Self-Check: PASSED

- Both planned artifacts and this summary exist on disk.
- Task commits `8856c2e`, `af0534a` and `3f7bf8e` exist in repository history.
- The final targeted coverage and provider contract verification passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-29*
