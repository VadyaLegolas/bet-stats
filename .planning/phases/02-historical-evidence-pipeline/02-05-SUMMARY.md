---
phase: 02-historical-evidence-pipeline
plan: 05
subsystem: api
tags: [football-data-org, zod, provenance, results, standings]
requires:
  - phase: 02-03
    provides: endpoint coverage contract
  - phase: 02-04
    provides: immutable result and standings evidence ledgers
provides:
  - validated completed-result normalization with requested and returned coverage
  - atomic complete standings snapshots with envelope provenance
  - executable coverage-to-provider symbol drift detection
affects: [02-06, 02-07, historical-sync, evidence-builds]
tech-stack:
  added: []
  patterns: [fail-closed Zod provider boundaries, atomic envelope normalization, compatibility aliases]
key-files:
  created: []
  modified:
    - packages/football-data/src/provider.interface.ts
    - packages/football-data/src/providers/football-data-org/schema.ts
    - packages/football-data/src/providers/football-data-org/normalize.ts
    - packages/football-data/src/providers/football-data-org/client.ts
    - tests/unit/provider-contract.test.ts
    - tests/unit/coverage-contract.test.ts
key-decisions:
  - "Plan-native result and standings names are primary while provisional COVERAGE.md names remain source-compatible aliases."
  - "A standings response is normalized as one snapshot containing all TOTAL rows; rows are never independently exposed as captures."
patterns-established:
  - "Provider timestamps remain nullable; capturedAt is the adapter observation time and is never substituted into sourceUpdatedAt."
  - "Requested scope and returned coverage travel with normalized historical evidence."
requirements-completed: [PIPE-01, PIPE-02]
coverage:
  - id: D1
    description: "Finished football-data.org results validate scores and retain raw, capture, source-update, request-window, and returned-coverage provenance."
    requirement: PIPE-02
    verification:
      - kind: unit
        ref: "tests/unit/provider-contract.test.ts#normalizes a finished result with capture and requested coverage provenance"
        status: pass
    human_judgment: false
  - id: D2
    description: "Complete standings are validated and normalized as one atomic capture with external provider references only."
    requirement: PIPE-02
    verification:
      - kind: unit
        ref: "tests/unit/provider-contract.test.ts#normalizes standings as one atomic snapshot with envelope provenance"
        status: pass
    human_judgment: false
  - id: D3
    description: "Documented fixture, result, and standings provider symbols are checked against exported contracts."
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/unit/coverage-contract.test.ts#keeps documented adapter methods and DTO names aligned with exported provider contracts"
        status: pass
    human_judgment: false
duration: 6min
completed: 2026-08-29
status: complete
---

# Phase 02 Plan 05: Football-data.org Historical Contracts Summary

**Validated completed-result arrays and atomic standings snapshots now preserve raw provider evidence, nullable source timestamps, capture time, and requested-versus-returned coverage.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-29T15:22:00Z
- **Completed:** 2026-08-29T15:28:17Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added fail-closed finished-result validation and deterministic normalization without synthesizing provider timestamps.
- Added complete TOTAL-standings validation and one-envelope-to-one-snapshot normalization.
- Added a coverage contract witness that fails when documented adapter methods or DTO exports drift.
- Preserved every Phase 1 fixture method and contract unchanged.

## Task Commits

1. **Task 1 RED: Specify completed-result provider behavior** - `3bb5d5d` (test)
2. **Task 1 GREEN: Normalize completed competition results** - `8935480` (feat)
3. **Task 2 RED: Specify atomic standings and coverage symbol behavior** - `8181699` (test)
4. **Task 2 GREEN: Normalize atomic standings snapshots** - `2fe1bad` (feat)

## Files Created/Modified

- `packages/football-data/src/provider.interface.ts` - Result, standings, provenance, coverage, and compatibility contracts.
- `packages/football-data/src/providers/football-data-org/schema.ts` - Finished-score and complete-standings Zod boundaries.
- `packages/football-data/src/providers/football-data-org/normalize.ts` - Deterministic result and atomic standings normalization.
- `packages/football-data/src/providers/football-data-org/client.ts` - Result and standings provider methods with sanitized failures.
- `tests/unit/provider-contract.test.ts` - Result/standings success, malformed payload, provenance, and client witnesses.
- `tests/unit/coverage-contract.test.ts` - Documented-to-exported provider symbol cross-check.

## Decisions Made

- Exported both the plan-native names (`NormalizedResult`, `NormalizedStandingSnapshot`, `fetchCompetitionResults`, `fetchCompetitionStandings`) and the provisional coverage names as aliases, avoiding a breaking contract rename.
- Kept provider team and match identifiers explicitly named as external IDs so they cannot be confused with canonical database identities.
- Required exactly one complete `TOTAL` table per standings envelope and retained the complete raw response at snapshot scope.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The PowerShell `pnpm exec vitest` shim did not resolve `vitest`; verification used the same installed Vitest entry point directly with Node.
- Vite helper-process creation was sandbox-blocked (`spawn EPERM`), so targeted tests were run with approved elevated execution.
- The active shell uses Node 25 while the repository declares Node 24; scoped tests and typecheck passed without runtime-dependent changes.

## Known Stubs

None.

## Verification

- `tests/unit/provider-contract.test.ts` and `tests/unit/coverage-contract.test.ts`: 15/15 passed.
- `@bet-stats/football-data` TypeScript typecheck passed.
- `git diff --check 33fa725..HEAD` passed.

## User Setup Required

None - no external provider credentials were needed for contract tests.

## Next Phase Readiness

- Historical sync jobs can consume traceable results and complete standings captures.
- Result and standings evidence can use `capturedAt` as downstream observation time while preserving nullable provider update time.

## Self-Check: PASSED

- All six modified implementation/test files and this summary exist.
- Commits `3bb5d5d`, `8935480`, `8181699`, and `2fe1bad` exist in repository history.
- Fresh targeted verification passed 15 tests with no failures.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-29*
