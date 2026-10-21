---
phase: 02-historical-evidence-pipeline
plan: 08
subsystem: domain
tags: [bitemporal, form, elo, evidence, postgres]
requires:
  - phase: 02-07
    provides: terminal sync runs and bounded replay identities
provides:
  - deterministic dual-time eligible evidence folds
  - versioned form, Elo, strength, goal, rest, and H2H components
  - terminal-gated atomic evidence build publication
affects: [02-09, evidence-api, historical-replay, forecasting]
actuals:
  tokens: 7713
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns: [pure chronological folds, dual-time eligibility, atomic publication]
key-files:
  created:
    - packages/domain/src/evidence/features.ts
    - workers/data-sync/src/jobs/evidence-rebuild.ts
  modified:
    - packages/domain/src/index.ts
    - tests/integration/temporal-provenance.test.ts
key-decisions:
  - "All evidence components consume one stable dual-time eligible match sequence."
  - "Evidence builds remain BUILDING until their source run is terminal and every component plus receipt is staged atomically."
patterns-established:
  - "Evidence values always travel with actual sample, window, source references, and explicit limitations."
  - "Receipts contain reproducible inputs and version identifiers but no forecast or confidence aggregation."
requirements-completed: [PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: "Five- and ten-match form is deterministic, cutoff-safe, and honest about bounded samples."
    requirement: PIPE-07
    verification:
      - kind: unit
        ref: "tests/unit/form.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Elo, strength, goals, rest, and H2H are separate leakage-safe reproducible components."
    requirement: PIPE-08
    verification:
      - kind: unit
        ref: "tests/unit/chronological-features.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Evidence publication is terminal-gated, atomic, versioned, and idempotent."
    requirement: PIPE-08
    verification:
      - kind: integration
        ref: "tests/integration/temporal-provenance.test.ts#evidence publication contract"
        status: pass
    human_judgment: false
duration: 13min
completed: 2026-08-30
status: complete
---

# Phase 02 Plan 08: Leakage-Safe Team Evidence Summary

**Deterministic dual-time form and feature folds now produce reproducible evidence receipts, with atomic publication only after source processing reaches a terminal state.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-30T05:58:00Z
- **Completed:** 2026-08-30T06:11:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added strict effective-time plus observed-time eligibility, stable chronological ordering, honest 5/10 samples, UTC cutoff echoing, and source-window provenance.
- Added versioned Elo, home/away strength, goal rates, rest days, and capped low-weight H2H as separate evidence components without forecast or confidence output.
- Added PostgreSQL latest-visible ranking and an atomic, terminal-gated, idempotent evidence publication contract that preserves the prior published receipt while rebuilding.

## Task Commits

1. **Task 1 RED: Define weighted-form contract** - `b84c78a` (test)
2. **Task 1 GREEN: Implement cutoff-aware form** - `d15e10c` (feat)
3. **Task 2 RED: Define chronological components** - `6a6d9ac` (test)
4. **Task 2 GREEN: Implement team evidence** - `28f03fb` (feat)
5. **Task 3 RED: Define publication contract** - `cfcec26` (test)
6. **Task 3 GREEN: Implement atomic rebuild** - `5901796` (feat)

## Files Created/Modified

- `packages/domain/src/evidence/contract.ts` - Immutable evidence, source, window, limitation, and receipt contracts.
- `packages/domain/src/evidence/eligibility.ts` - Dual-time filtering and stable chronological ordering.
- `packages/domain/src/evidence/form.ts` - Weighted 5/10 form with honest coverage metadata.
- `packages/domain/src/evidence/elo.ts` - Versioned 1500/K20/home-adjusted chronological Elo fold.
- `packages/domain/src/evidence/features.ts` - Separate chronological evidence components and reproducible receipt.
- `workers/data-sync/src/jobs/evidence-rebuild.ts` - Latest-visible SQL selection and terminal-gated atomic publication.
- `tests/unit/form.test.ts` - Cutoff, permutation, sample, UTC, and coverage cases.
- `tests/unit/chronological-features.test.ts` - Component, leakage, H2H, receipt, and no-forecast cases.
- `tests/integration/temporal-provenance.test.ts` - Pending, atomic, and idempotent publication cases.

## Decisions Made

- Used one ascending kickoff/observation/fixture-ID ordering for every component, then selected the most recent bounded windows from that same eligible sequence.
- Kept Elo parameters explicit and versioned as `elo-1500-k20-home65-v1`; no Phase 3 aggregate was introduced.
- Considered `SUCCEEDED`, `FAILED`, and `CANCELLED` source runs terminal for publication readiness; non-terminal runs preserve the previous visible build with a `PENDING` response.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used the installed Vitest module directly**
- **Found during:** Task 1 verification
- **Issue:** The root `node_modules/.bin` lacked a `vitest` shim even though Vitest was installed.
- **Fix:** Invoked the pinned installed `vitest.mjs` with Node and redirected TEMP to the D: workspace.
- **Files modified:** None
- **Verification:** All targeted unit and publication tests passed.
- **Committed in:** No code change required

## Issues Encountered

- Docker Desktop was unavailable. Starting it was cancelled, so the two pre-existing Docker/PostgreSQL temporal-provenance cases could not be rerun. The two new publication cases passed separately and the issue is recorded in `.planning/WINDOWS.md`.
- The active shell runs Node 25 while the repository targets Node 24; both scoped TypeScript checks and all executable targeted tests passed.

## Known Stubs

None.

## Verification

- Form and chronological unit suites: 2 files, 11 tests passed.
- Evidence publication contract: 2 tests passed.
- `@bet-stats/domain` and `@bet-stats/data-sync` typechecks passed.
- `git diff --check 696ce79..HEAD` passed.
- Full Docker-backed temporal provenance suite: not run because Docker Desktop was unavailable.

## User Setup Required

None.

## Next Phase Readiness

- Plan 02-09 can expose receipt and component projections through the Nest API.
- A running Docker Desktop instance is needed to close the outstanding PostgreSQL verification ledger item.

## Self-Check: PASSED

- All nine listed implementation and test files exist.
- Commits `b84c78a`, `d15e10c`, `6a6d9ac`, `28f03fb`, `cfcec26`, and `5901796` exist in repository history.
- Fresh unit, publication, and scoped typecheck verification passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-30*
