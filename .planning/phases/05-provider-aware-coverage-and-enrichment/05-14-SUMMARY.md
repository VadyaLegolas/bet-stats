---
phase: 05-provider-aware-coverage-and-enrichment
plan: 14
subsystem: provider-state-and-forecast-availability
tags: [last-valid, immutable-observation, nextjs, forecast-availability]
requires: [{phase: 05-12, provides: durable provider attempts and observations}]
provides: [exact last-valid degradation timestamp, private availability proxy, server reason-coded workbench]
affects: [fixture-api, forecast-workbench]
actuals: {tokens: 5100, tasks: 2, commits: 4}
tech-stack: {added: [], patterns: [exact-scope last-valid lookup, retained availability state, closed reason copy]}
key-files:
  created: [apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/availability/route.ts]
  modified: [apps/api/src/modules/fixtures/fixtures.service.ts, apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx, tests/integration/provider-state-api.test.ts, tests/unit/forecast-comparison-ui.test.tsx]
key-decisions:
  - "Phase 05: Sole-source degradation exposes only the newest successful provider-matching observation from the exact canonical route scope."
  - "Phase 05: Forecast absence copy is derived from the server's closed reason codes and refresh never rewrites selected URL IDs."
requirements-completed: [PROV-04, PROV-06]
duration: 9min
completed: 2026-09-13
status: complete
---
# Phase 05 Plan 14: Honest Degradation and Availability Summary

**Fixture degradation now exposes the exact retained observation timestamp, while the forecast workbench consumes private server-authoritative availability reasons without substituting immutable selections.**

## Accomplishments
- Added exact provider/competition/season/endpoint successful-observation lookup for `lastValidAt` while current `capturedAt` remains null.
- Added a private no-store availability proxy with eligibility forwarding.
- Added fixed closed reason copy and retained previously verified availability on transient refresh errors.

## Task Commits
- `dfb51e7` — Task 1 RED
- `0384f30` — Task 1 GREEN
- `904a2a4` — Task 2 RED
- `0301873` — Task 2 GREEN

## Deviations from Plan
None - plan executed as specified.

## Known Stubs
None.

## Self-Check: PASSED
- Provider-state tests passed 2/2 and forecast comparison UI tests passed 11/11.
- API and web typechecks passed under Node 24.
- All four task commits and planned artifacts exist.
