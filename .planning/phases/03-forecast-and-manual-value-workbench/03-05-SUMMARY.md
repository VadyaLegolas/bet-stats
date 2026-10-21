---
phase: 03-forecast-and-manual-value-workbench
plan: 05
subsystem: api
tags: [nestjs, manual-odds, decimal-normalization, immutable-receipts, postgres]
requires:
  - phase: 03-forecast-and-manual-value-workbench
    provides: forecast/value domain contracts and immutable snapshot persistence
provides:
  - Protected complete-book manual odds submission and immutable snapshot reads
  - Explicit-pair server-authoritative value decisions with three-state outcomes
  - Fixed-name immutable JSON receipt downloads
affects: [03-06, 04-evaluation, manual-odds-ui, value-workbench]
actuals:
  tokens: 7774
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [repository-injected API orchestration, validate-before-mutation, fixed server-generated download names]
key-files:
  created: [apps/api/src/modules/odds/odds.service.ts, apps/api/src/modules/value/value.service.ts, tests/integration/manual-odds-api.test.ts, tests/integration/value-api.test.ts]
  modified: [apps/api/src/app.module.ts, packages/domain/src/index.ts, packages/domain/src/value/decision.ts]
key-decisions:
  - "Reject every unknown client field, including draft and derived analytics, before repository access."
  - "Converge value comparisons on the exact forecast/odds pair and derive receipt IDs and filenames only from server-owned identifiers."
patterns-established:
  - "Protected analytical resources use eligibility guards plus private no-store responses."
  - "HTTP validation maps allowlisted domain errors while tagged abstentions remain successful persisted results."
requirements-completed: [ODDS-01, ODDS-02, ODDS-03, VALUE-01, VALUE-02, VALUE-03, VALUE-04]
coverage:
  - id: D1
    description: "Complete supported manual odds books are validated, normalized, and appended while invalid and browser-draft payloads cannot mutate persistence."
    requirement: ODDS-01
    verification:
      - kind: integration
        ref: "tests/integration/manual-odds-api.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Manual odds snapshots disclose source/capture/schema metadata, implied and no-vig probabilities, overround, and replacement linkage."
    requirement: ODDS-03
    verification:
      - kind: integration
        ref: "tests/integration/manual-odds-api.test.ts#normalizes and appends a complete market book"
        status: pass
    human_judgment: false
  - id: D3
    description: "Explicit compatible forecast and odds IDs yield one server-calculated immutable three-state value receipt."
    requirement: VALUE-03
    verification:
      - kind: integration
        ref: "tests/integration/value-api.test.ts"
        status: pass
      - kind: integration
        ref: "tests/integration/value-receipt.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Receipt JSON is exported with a fixed persisted-ID filename and server-owned content."
    requirement: VALUE-04
    verification:
      - kind: integration
        ref: "tests/integration/value-api.test.ts#exports exact immutable JSON"
        status: pass
    human_judgment: false
duration: 7min
completed: 2026-09-06
status: complete
---

# Phase 3 Plan 5: Manual Odds and Value APIs Summary

**Protected Nest APIs now turn complete manual decimal books into immutable normalized snapshots and exact forecast/odds pairs into reproducible three-state value receipts.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-09-06T02:58:56Z
- **Completed:** 2026-09-06T03:04:20Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Added guarded no-store submission/read routes for all three complete odds markets with strict pre-persistence validation and server-side multiplicative normalization.
- Added exact-pair value comparison that ignores client analytics, verifies fixture/market equality, persists all three outcome states, and converges repeated requests.
- Added immutable JSON receipt retrieval with a fixed receipt-ID filename and tested the persistence boundary against PostgreSQL.

## Task Commits

1. **Task 1 RED: Manual odds API behavior** - `e42b0c4` (test)
2. **Task 1 GREEN: Immutable manual odds resources** - `73cd26c` (feat)
3. **Task 2 RED: Exact-pair value API behavior** - `1cc167c` (test)
4. **Task 2 GREEN: Value receipt and download resources** - `3fd49f0` (feat)

## Files Created/Modified

- `apps/api/src/modules/odds/*` - Complete-book validation, normalization, repository persistence, guarded routes, and module composition.
- `apps/api/src/modules/value/*` - Exact-pair decision orchestration, receipt persistence/read/export, guarded routes, and module composition.
- `apps/api/src/app.module.ts` - Registers odds and value modules.
- `packages/domain/src/index.ts` - Exposes existing odds and value contracts to API consumers.
- `packages/domain/src/value/decision.ts` - Narrows decision input to the immutable published forecast fields it actually consumes.
- `tests/integration/manual-odds-api.test.ts` - Invalid-input, normalization, and replacement behavior.
- `tests/integration/value-api.test.ts` - Pair validation, authoritative calculation, convergence, and safe download behavior.

## Decisions Made

- Optional replacement linkage is the only accepted extension to the strict domain odds book; draft and derived fields remain rejected.
- Value receipt identity is derived from the exact forecast/odds pair, matching the database uniqueness boundary.
- Download filenames accept only server-safe receipt identifiers and never use source labels.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exposed existing domain odds/value contracts from the package barrel**
- **Found during:** Task 1
- **Issue:** The API package could not consume the already-built odds/value contracts through `@bet-stats/domain`.
- **Fix:** Added the existing odds and value modules to the domain package exports.
- **Files modified:** `packages/domain/src/index.ts`
- **Verification:** API and domain typechecks passed.
- **Committed in:** `73cd26c`

**2. [Rule 1 - Bug] Narrowed value calculation input to persisted forecast fields**
- **Found during:** Task 2 typecheck
- **Issue:** `decideValue` declared unused score-matrix fields mandatory, although issued snapshot transport intentionally does not persist them.
- **Fix:** Typed the decision input against only the immutable forecast fields the calculation reads.
- **Files modified:** `packages/domain/src/value/decision.ts`
- **Verification:** Domain/API typechecks and both API suites passed.
- **Committed in:** `3fd49f0`

---

**Total deviations:** 2 auto-fixed (1 blocking issue, 1 bug)
**Impact on plan:** Both changes were necessary to connect the existing domain and persistence contracts without widening product scope.

## Issues Encountered

- Vitest required approved process-spawn permission in the managed sandbox.
- The local runtime is Node 25.2.1 while the repository declares Node 24 LTS; this emitted an engine warning only.

## Known Stubs

None.

## Threat Flags

None. Eligibility, client-tampering, pair compatibility, and download-header surfaces are covered by the plan threat register.

## User Setup Required

None - no external service configuration required.

## Verification

- `manual-odds-api.test.ts` and `value-api.test.ts` — 2 files, 8 tests passed.
- Combined API and persistence suites against `bet-stats-phase03-pg` — 4 files, 13 tests passed.
- `@bet-stats/api` and `@bet-stats/domain` typechecks — passed.
- Every new controller route declares private no-store caching and uses `EligibilityGuard`.

## Next Phase Readiness

- The web workbench can submit complete books and render exact server-owned value receipts without calculating analytics client-side.
- Phase 4 can evaluate stable snapshot pair identities and stored thresholds/gates.

## Self-Check: PASSED

- All eleven created or modified implementation/test files exist.
- Commits `e42b0c4`, `73cd26c`, `1cc167c`, and `3fd49f0` exist in repository history.

---
*Phase: 03-forecast-and-manual-value-workbench*
*Completed: 2026-09-06*
