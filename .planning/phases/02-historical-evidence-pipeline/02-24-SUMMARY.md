---
phase: 02-historical-evidence-pipeline
plan: 24
subsystem: provider-api
tags: [football-data-org, fixtures, zod, tdd, api-coverage]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: configured competition codes, normalized fixture contract, replay boundary
provides:
  - Competition-parameterized fixture provider contract for all seven configured competitions
  - Request-bound fixture envelope validation and disclosure-safe failures
  - Exact route and bounded-window provider contract witnesses
affects: [02-26, data-sync, fixture-replay, provider-coverage]
actuals:
  tokens: 3144
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [request-bound provider schemas, configured competition allowlist, deprecated compatibility wrapper]
key-files:
  created: []
  modified:
    - packages/football-data/src/provider.interface.ts
    - packages/football-data/src/providers/football-data-org/client.ts
    - packages/football-data/src/providers/football-data-org/schema.ts
    - tests/unit/provider-contract.test.ts
    - .planning/phases/02-historical-evidence-pipeline/COVERAGE.md
key-decisions:
  - "Fixture requests carry a configured competition code and exact date window; response envelopes must report the same competition."
  - "The PL-only method remains temporarily as a deprecated bounded compatibility wrapper until Plan 02-26 migrates the worker."
patterns-established:
  - "Request-bound validation: validate both configured request identity and untrusted response identity before normalization."
  - "Provider disclosure safety: discard upstream causes and emit a stable public request failure."
requirements-completed: [PIPE-01]
coverage:
  - id: D1
    description: "All configured fixture competitions route to their own football-data.org endpoint with the exact requested date window."
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/unit/provider-contract.test.ts#routes %s fixture requests with exact bounded coverage"
        status: pass
      - kind: other
        ref: "pnpm --filter @bet-stats/football-data typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unknown competitions, mismatched envelopes, and secret-bearing provider failures fail closed."
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/unit/provider-contract.test.ts#provider boundary adversarial cases"
        status: pass
    human_judgment: false
duration: 5min
completed: 2026-09-01
status: complete
---

# Phase 02 Plan 24: Competition-Correct Fixture Provider Summary

**Seven-competition fixture routing with exact bounded windows, request-bound response validation, and redacted provider failures**

## Performance

- **Duration:** 5 min
- **Started:** 2026-09-01T11:18:00Z
- **Completed:** 2026-09-01T11:23:03Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Promoted fixture fetching from a PL-only operation to a configured competition/date-window contract.
- Proved exact routing and normalized competition identity for PL, PD, BL1, SA, FL1, CL, and EL.
- Rejected unknown competition inputs before network I/O and mismatched provider envelopes at the trust boundary without exposing upstream secrets.

## Task Commits

1. **Task 1 RED: expose the PD routing gap** - `b17697f` (test)
2. **Task 1 GREEN: parameterize fixture routing** - `1e38796` (feat)
3. **Task 2: seal seven-competition matrix** - `4f8d4e6` (test/docs)
4. **Task 2 API coverage correction** - `ceebecd` (fix)

## Files Created/Modified

- `packages/football-data/src/provider.interface.ts` - Adds the competition-window fixture contract and temporary deprecated PL wrapper.
- `packages/football-data/src/providers/football-data-org/client.ts` - Builds encoded competition routes with exact date bounds and redacts provider failures.
- `packages/football-data/src/providers/football-data-org/schema.ts` - Validates fixture envelopes against the requested competition.
- `tests/unit/provider-contract.test.ts` - Covers PD tracer behavior, the seven-code matrix, mismatch, unknown input, and error redaction.
- `.planning/phases/02-historical-evidence-pipeline/COVERAGE.md` - Records seven-competition scope and provider/replay witnesses.

## Decisions Made

- Preserved `fetchPremierLeagueFixtures()` as a deprecated compatibility wrapper so the concurrent wave remains type-correct; Plan 02-26 owns production consumer migration and wrapper removal.
- Kept `upcoming fixtures` as the canonical coverage-table key while documenting the seven supported competition variants in prose.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored the canonical API coverage endpoint key**
- **Found during:** Task 2 API coverage gate
- **Issue:** The pre-existing expanded row name `upcoming fixtures (PL, PD, BL1, SA, FL1, CL, EL)` broke the coverage contract that keys the surface as `upcoming fixtures`.
- **Fix:** Restored the canonical key and retained the full seven-competition scope in explicit coverage prose.
- **Files modified:** `.planning/phases/02-historical-evidence-pipeline/COVERAGE.md`
- **Verification:** Provider and coverage contract suites pass 33/33.
- **Committed in:** `ceebecd`

---

**Total deviations:** 1 auto-fixed bug.
**Impact on plan:** The correction keeps API coverage machine-readable without changing provider scope.

## Issues Encountered

- Vitest process spawning was blocked inside the Windows sandbox; the same commands passed outside the sandbox.
- The workspace runs Node 25.2.1 while package metadata requests Node 24.x; typechecks and scoped tests still passed.

## Known Stubs

None.

## Threat Flags

None - the provider request and response trust boundaries were included in the plan threat model and both high-severity mitigations are covered.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-26 can migrate the replay worker to `fetchCompetitionFixtures` and remove the deprecated PL wrapper.
- No blocker remains within Plan 02-24 ownership.

## Self-Check: PASSED

- All five modified artifacts exist.
- Commits `b17697f`, `1e38796`, `4f8d4e6`, and `ceebecd` exist in git history.
- Provider and coverage contract suites pass 33/33; football-data and data-sync typechecks pass.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-09-01*
