---
phase: 04-settlement-and-evidence-scorecard
plan: 06
subsystem: evaluation-scorecard
tags: [nestjs, nextjs, cursor-pagination, reliability, responsible-gambling]
requires:
  - phase: 04-03
    provides: reliability buckets and cohort health
  - phase: 04-04
    provides: flat one-unit and CLV evidence
  - phase: 04-05
    provides: leakage-safe backtest evidence
provides:
  - Guarded canonical scorecard API with deterministic default cohort redirects
  - Exact-cohort candidate ledger with opaque stable pagination and page reconciliation
  - Health-first responsive scorecard UI with accessible reliability and audit detail
affects: [04-07, phase-04-verification, user-scorecard]
tech-stack:
  added: []
  patterns: [server-owned evidence DTOs, exact canonical URL identity, cohort-bound opaque cursors]
key-files:
  created: [apps/api/src/modules/evaluation/evaluation.controller.ts, apps/api/src/modules/evaluation/evaluation.service.ts, apps/api/src/modules/evaluation/evaluation.module.ts, apps/web/app/internal-api/scorecards/route.ts, apps/web/app/scorecards/page.tsx, apps/web/app/scorecards/scorecard-dashboard.tsx, tests/integration/evaluation-api.test.ts, tests/unit/scorecard-ui.test.tsx]
  modified: [apps/api/src/app.module.ts]
key-decisions:
  - "Canonical scorecard identity always includes exact model, competition, market, and inclusive-exclusive UTC bounds."
  - "Default cohorts rank AVAILABLE evidence by event count then canonical tuple; absence redirects to bounded all/all/all without substitution."
  - "Candidate cursors embed and validate the exact cohort identity plus deterministic settledAt/id position."
actuals:
  tokens: 10032
  tasks: 2
  commits: 4
requirements-completed: [EVAL-03, EVAL-04, EVAL-05, EVAL-07, EVAL-08]
duration: 18min
completed: 2026-09-09
status: complete
---

# Phase 04 Plan 06: Guarded Evidence Scorecard Summary

**A protected evidence dashboard now exposes exact cohorts, honest sample health, server-owned proper scores and a reconciliation-ready candidate ledger without filter widening.**

## Accomplishments

- Added a private/no-store Nest evaluation boundary protected by the existing eligibility guard.
- Implemented exact allowlisted cohort parsing, bounded millisecond UTC periods, deterministic qualified defaults and canonical 308 redirects.
- Aggregated current-leaf forecast scores, reliability buckets, flat-unit evidence and CLV state on the server.
- Added opaque cohort-bound `(settledAt,id)` pagination with stable ordering and page totals.
- Added a Next proxy and responsive scorecard route that show health and denominators before metrics, accessible reliability tables, honest empty states and progressive policy receipts.

## Task Commits

1. **Task 1 RED:** `aeb9e7f`
2. **Task 1 GREEN:** `9ec4fde`
3. **Task 2 RED:** `351a0be`
4. **Task 2 GREEN:** `a676ef7`

## Verification

- Scorecard integration and UI unit tests: 7/7 passed.
- API and web TypeScript checks passed.
- Web ESLint passed.
- Next.js production build passed and emitted `/scorecards` plus `/internal-api/scorecards` routes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Cursor validation] Accepted bounded opaque cursors larger than ordinary scalar filters**
- **Found during:** Task 2 GREEN
- **Issue:** The generic 128-character scalar limit rejected a valid cohort-bound cursor.
- **Fix:** Applied a dedicated 2048-character cursor envelope limit before strict decode and cohort comparison.
- **Files modified:** `apps/api/src/modules/evaluation/evaluation.service.ts`
- **Committed in:** `a676ef7`

**2. [Rule 1 - Strict optional property] Omitted an absent cursor prop under exact optional property types**
- **Found during:** Task 2 GREEN
- **Issue:** Passing `cursor={undefined}` failed the web typecheck.
- **Fix:** Spread the cursor prop only when present.
- **Files modified:** `apps/web/app/scorecards/page.tsx`
- **Committed in:** `a676ef7`

## Known Stubs

None.

## User Setup Required

None.

## Self-Check: PASSED

- All nine declared implementation/test artifacts exist.
- Commits `aeb9e7f`, `9ec4fde`, `351a0be`, and `a676ef7` exist in history.

---
*Phase: 04-settlement-and-evidence-scorecard*
*Completed: 2026-09-09*
