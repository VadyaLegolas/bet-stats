---
phase: 03-forecast-and-manual-value-workbench
plan: 11
subsystem: forecast-discovery
tags: [nestjs, prisma, nextjs, immutable-snapshots, no-store]
requires:
  - phase: 03-08
    provides: provenance-complete immutable forecast receipts
  - phase: 03-09
    provides: hardened manual odds workbench
provides:
  - fixture-scoped issued forecast discovery with deterministic ordering
  - unambiguous list versus exact lookup semantics
  - exact immutable snapshot selection without synthesized cutoffs
affects: [03-verification, forecast-workbench, value-comparison]
actuals:
  tokens: 6582
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [fixture-scoped-list-contract, server-returned-immutable-identity, stable-client-selection]
key-files:
  created: []
  modified:
    - apps/api/src/modules/forecasts/forecasts.controller.ts
    - apps/api/src/modules/forecasts/forecasts.service.ts
    - apps/web/app/fixtures/[fixtureId]/page.tsx
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - tests/integration/forecast-api.test.ts
    - tests/unit/internal-api-route.test.ts
    - tests/unit/odds-draft-ui.test.tsx
key-decisions:
  - "An empty forecast query lists issued receipts; exact lookup requires both kind and cutoff and rejects partial or unknown filters."
  - "Issued receipts are ordered by issuedAt, cutoff, revision, then ID so discovery is deterministic."
patterns-established:
  - "Discovery returns complete immutable receipts rather than reconstructing identities from schedule assumptions."
  - "Client selection is keyed by exact snapshot ID and survives refreshed props while that ID remains present."
requirements-completed: [PRED-01, PRED-02, PRED-03, PRED-04, PRED-05, PRED-06]
coverage:
  - id: D1
    description: "Fixture API discovers only issued forecast receipts in stable order and keeps exact lookup explicit."
    requirement: PRED-01
    verification:
      - kind: integration
        ref: "tests/integration/forecast-api.test.ts#discovers only issued snapshots for one fixture in deterministic newest-first order"
        status: pass
    human_judgment: false
  - id: D2
    description: "Workbench consumes discovered immutable IDs, displays arbitrary cutoffs, and preserves explicit selection."
    requirement: PRED-06
    verification:
      - kind: unit
        ref: "tests/unit/internal-api-route.test.ts and tests/unit/odds-draft-ui.test.tsx"
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-09-08
status: complete
---

# Phase 03 Plan 11: Issued Forecast Discovery Summary

Fixture-scoped issued-receipt discovery now drives an exact immutable workbench selector without guessed kickoff offsets.

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-08T07:11:00Z
- **Completed:** 2026-09-08T07:20:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added a protected fixture-scoped list operation that discloses only `ISSUED` forecast receipts for the requested fixture in deterministic newest-first order.
- Separated no-query discovery from exact `kind` plus `cutoff` lookup and reject partial or unknown query shapes.
- Removed kickoff-offset cutoff synthesis from the fixture page and rendered exact returned IDs and non-round cutoffs.
- Preserved explicit snapshot selection when refreshed data still contains the selected immutable ID, with an honest empty state when no receipts exist.

## Task Commits

1. **Task 1 RED: issued discovery regressions** — `53baf28`
2. **Task 1 GREEN: fixture-scoped issued list API** — `9c96b14`
3. **Task 2 RED: immutable selector regressions** — `9002f0a`
4. **Task 2 GREEN: discovered snapshot workbench** — `ab709aa`

## Files Created/Modified

- `apps/api/src/modules/forecasts/forecasts.controller.ts` — strict list versus exact-query dispatch.
- `apps/api/src/modules/forecasts/forecasts.service.ts` — fixture/state predicates, complete receipt mapping, and stable ordering.
- `apps/web/app/fixtures/[fixtureId]/page.tsx` — one no-store issued-list fetch with no fabricated cutoff.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` — exact cutoff labels, stable ID selection, and honest empty copy.
- `tests/integration/forecast-api.test.ts` — API isolation, lifecycle, ordering, and query-shape coverage.
- `tests/unit/internal-api-route.test.ts` — allowlisted no-store list proxy coverage.
- `tests/unit/odds-draft-ui.test.tsx` — arbitrary cutoff, stable selection, and empty-state coverage.

## Decisions Made

- List discovery uses an empty query; the existing exact resource lookup requires the complete identity pair and has no implicit latest behavior.
- Ordering uses `issuedAt desc`, `cutoff desc`, `revision desc`, and `id asc` as a stable tie-breaker.
- The complete immutable forecast DTO remains the sole source for probability, confidence, evidence, and limitation display.

## Deviations from Plan

None - plan executed exactly as written. The internal no-store proxy already supported an empty allowlisted query, so its production file required no change; a regression test now locks that behavior.

## Issues Encountered

- The documented `corepack pnpm exec vitest` form did not resolve the local executable in this Windows shell. The pinned workspace binary was invoked directly; results are equivalent.
- Vitest required running outside the restricted sandbox because Vite spawns a child process.

## Verification

- Focused API and web suites: **16/16 tests passed** across 3 files.
- API TypeScript check: **passed**.
- Web TypeScript check: **passed**.
- Source scan found no kickoff-minus-hour or `URLSearchParams({ kind, cutoff })` synthesis in the fixture workbench path.
- Environment warning only: current Node is 25.2.1 while the project declares Node 24.x.

## Known Stubs

None.

## Threat Model Closure

- **T-03-11-01:** database query binds both requested fixture ID and `ISSUED` lifecycle; responses remain private/no-store behind the eligibility guard.
- **T-03-11-02:** selector values come only from server-returned snapshot IDs and retain an explicit ID while it remains available.

## Self-Check: PASSED

- All seven modified source/test files exist.
- All four TDD task commits exist in Git history.
- All available focused verification passed.

