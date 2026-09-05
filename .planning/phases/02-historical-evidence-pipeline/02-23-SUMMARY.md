---
phase: 02-historical-evidence-pipeline
plan: 23
subsystem: data-pipeline
tags: [postgresql, prisma, temporal-query, evidence, vitest]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: immutable evidence publication and exact payload provenance
provides:
  - Team-scoped eligible-result selection before latest-version ranking
  - Adversarial PostgreSQL coverage for cross-team contamination
  - Boundary, empty-history, and rebuild-idempotency regression coverage
affects: [team-evidence, feature-generation, phase-03-predictions]
actuals:
  tokens: 2328
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [team predicate inside ranked source relation, dual-time conjunctive cutoff]
key-files:
  created: []
  modified:
    - workers/data-sync/src/jobs/evidence-rebuild.ts
    - tests/integration/evidence-publication.test.ts
key-decisions:
  - "Filter fixtures by requested team inside the SQL source relation before ROW_NUMBER ranking."
  - "Bind normalized cutoff first and teamId second without changing dual-time or result-version ordering semantics."
patterns-established:
  - "Team isolation is enforced at the durable query boundary, never by post-query array filtering."
requirements-completed: [PIPE-02, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: Requested-team evidence cannot contain unrelated fixtures or provenance.
    requirement: PIPE-07
    verification:
      - kind: integration
        ref: "tests/integration/evidence-publication.test.ts#excludes unrelated fixtures before latest-visible result ranking"
        status: pass
    human_judgment: false
  - id: D2
    description: Team-scoped evidence preserves dual-time boundaries, empty history, and immutable rerun behavior.
    requirement: PIPE-08
    verification:
      - kind: integration
        ref: "tests/integration/evidence-publication.test.ts#preserves cutoff equality, empty history, and identical-build idempotency"
        status: pass
      - kind: other
        ref: "pnpm --filter @bet-stats/data-sync typecheck"
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-09-01
status: complete
---

# Phase 2 Plan 23: Team-Isolated Historical Evidence Summary

**PostgreSQL now filters requested-team fixtures before result-version ranking while preserving dual-time cutoff and immutable publication semantics.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-01T11:17:00Z
- **Completed:** 2026-09-01T11:24:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Bound `teamId` into the eligible-result query before `ROW_NUMBER` ranking, eliminating cross-team evidence contamination.
- Proved receipts and all component provenance remain subsets of the requested team's eligible fixture set under adversarial same-time data.
- Locked exact-cutoff eligibility, post-cutoff exclusion, empty-history limitations, and identical-build idempotency with real PostgreSQL tests.

## Task Commits

1. **Task 1 RED: expose cross-team evidence contamination** - `cb17dff`
2. **Task 1 GREEN: scope evidence results before ranking** - `a15d04b`
3. **Task 2: lock boundary and rerun semantics** - `e63a1ad`

## Files Created/Modified

- `workers/data-sync/src/jobs/evidence-rebuild.ts` - Adds the requested-team SQL predicate and second query binding.
- `tests/integration/evidence-publication.test.ts` - Adds adversarial team-isolation, cutoff, empty-history, and idempotency witnesses.

## Decisions Made

- Applied team filtering in the inner ranked SQL relation so unrelated rows never participate in evidence selection.
- Retained `effectiveAt <= cutoff AND observedAt <= cutoff` and the existing deterministic version ordering unchanged.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- One PostgreSQL test startup hit a transient Prisma schema-engine error; an immediate clean rerun passed all four tests without code changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PIPE-02/07/08 evidence inputs are team-correct, cutoff-correct, deterministic, and idempotent under adversarial data.
- Phase verification can now reassess the team-contamination blocker against the real publication path.

## Self-Check: PASSED

- Both modified files exist.
- Commits `cb17dff`, `a15d04b`, and `e63a1ad` exist in repository history.
- PostgreSQL evidence-publication suite passes 4/4 and data-sync typecheck passes.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-09-01*
