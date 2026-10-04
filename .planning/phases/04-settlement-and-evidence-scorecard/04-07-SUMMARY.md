---
phase: 04-settlement-and-evidence-scorecard
plan: 07
subsystem: production-evaluation-acceptance
tags: [postgresql, playwright, chromium, settlement, scorecard, security]
requires:
  - phase: 04-05
    provides: rolling-origin leakage-safe backtests
  - phase: 04-06
    provides: guarded canonical scorecard API and UI
  - phase: 04-08
    provides: production settlement pipeline and correction fan-out
provides:
  - Migrated PostgreSQL security matrix covering EVAL-01 through EVAL-08 and Phase 4 tampering threats
  - Production Nest, Next and Chromium acceptance with exact API/DOM evidence parity
  - Deterministic AVAILABLE, LIMITED and UNAVAILABLE cohorts plus complete cursor pagination reconciliation
affects: [phase-04-verification, release-acceptance]
tech-stack:
  added: []
  patterns: [owned disposable PostgreSQL acceptance stack, production-built service browser testing, named requirement witnesses]
key-files:
  created: [tests/integration/phase-04-security.test.ts, tests/e2e/evidence-scorecard.spec.ts, tests/e2e/live-evaluation-stack.ts]
  modified: [playwright.config.ts]
key-decisions:
  - "Phase 4 acceptance seeds only canonical immutable sources, then invokes the production settlement service to create evaluated facts."
  - "Browser acceptance compares direct guarded Nest JSON with the Next-rendered DOM and accessible tables without route interception."
  - "The live harness owns a unique PostgreSQL container and exact process IDs and removes only those resources."
actuals:
  tokens: 6649
  tasks: 2
  commits: 4
requirements-completed: [EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, EVAL-06, EVAL-07, EVAL-08]
duration: 34min
completed: 2026-09-09
status: complete
---

# Phase 04 Plan 07: Production Evaluation Acceptance Summary

**A migrated PostgreSQL result-to-scorecard chain now has hostile-write witnesses and production Nest/Next/Chromium evidence for all eight evaluation requirements.**

## Accomplishments

- Added four named PostgreSQL witnesses covering exact result/forecast binding, retry convergence, append-only corrections, current-leaf scores, formula receipts, reliability, one-unit P/L, fail-closed CLV, bounded filters and rolling-origin poison rejection.
- Added a uniquely owned disposable PostgreSQL acceptance stack that migrates from empty, seeds 51 canonical fixtures, invokes the real settlement pipeline, builds API/web packages and starts Nest plus Next production output.
- Proved an AVAILABLE 50-fixture cohort, a LIMITED one-fixture cohort and an exact UNAVAILABLE cohort without filter widening.
- Reconciled Nest metrics, denominators, reliability events, financial totals and the 25+5 cursor-paginated candidate ledger with the browser DOM.
- Verified health-first responsive ordering, responsible-use copy, keyboard focus and policy-receipt disclosure at a mobile viewport.

## Task Commits

1. **Task 1 RED:** `d63c69b`
2. **Task 1 GREEN:** `3bdeab2`
3. **Task 2 RED:** `bc765b6`
4. **Task 2 GREEN:** `4d62c64`

## Verification

- `phase-04-security.test.ts`: 4/4 passed after migration from an empty PostgreSQL 18 database; tracer gate repeated successfully.
- `evidence-scorecard.spec.ts --project=chromium`: 3/3 passed twice against disposable PostgreSQL plus real Nest and Next processes.
- Unit suite: 20 files, 205 tests passed.
- Monorepo typecheck: 7/7 tasks passed.
- Monorepo lint: passed.
- Monorepo production build: 7/7 tasks passed, including the dynamic `/scorecards` route.
- Full integration-suite invocation was attempted but did not complete cleanly because pre-existing suites require separately provisioned shared database state and `replay-boundary.test.ts` failed outside this plan's files. The plan-owned PostgreSQL matrix passed independently.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Port allocation] Removed a host-port reservation race**
- **Found during:** Task 2 GREEN
- **Issue:** Reserving and releasing a port before Docker publication allowed the Prisma migration connection to race.
- **Fix:** Let Docker allocate the loopback port and resolve the authoritative mapping afterward.
- **Files modified:** `tests/e2e/live-evaluation-stack.ts`
- **Commit:** `4d62c64`

**2. [Rule 3 - Runtime configuration] Matched the established API validation environment**
- **Found during:** Task 2 GREEN
- **Issue:** `NODE_ENV=production` required deployment-only configuration before the already-built Nest process could become ready.
- **Fix:** Retained production-built code while using the repository's established live-acceptance `NODE_ENV=test` configuration boundary.
- **Files modified:** `tests/e2e/live-evaluation-stack.ts`
- **Commit:** `4d62c64`

**3. [Rule 1 - Acceptance locators] Scoped table and alert assertions to semantic owners**
- **Found during:** Task 2 GREEN
- **Issue:** Broad locators counted reliability rows as ledger rows and collided with Next's route-announcer alert.
- **Fix:** Scoped ledger rows to the Candidate ledger section and matched visible warning text explicitly.
- **Files modified:** `tests/e2e/evidence-scorecard.spec.ts`
- **Commit:** `4d62c64`

## Deferred Issues

- The repository-wide integration command has pre-existing environment-dependent failures outside 04-07; its failing files were not modified under the plan's scope boundary.

## Known Stubs

None.

## Threat Flags

None — the new network/process surface is test-only, bounded, loopback-only and explicitly covered by T-04-07-01/T-04-07-03.

## Self-Check: PASSED

- All four declared plan artifacts exist.
- Commits `d63c69b`, `3bdeab2`, `bc765b6`, and `4d62c64` exist in history.

---
*Phase: 04-settlement-and-evidence-scorecard*
*Completed: 2026-09-09*
