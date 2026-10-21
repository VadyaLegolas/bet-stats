---
phase: 05-provider-aware-coverage-and-enrichment
plan: 13
subsystem: optional-enrichment-runtime
tags: [bullmq, api-football, enrichment, forecasts, quota]
requires: [{phase: 05-12, provides: provider-aware production worker}]
provides: [production optional queue consumer, post-publication enrichment scheduling, attributable lineup forecast revisions]
affects: [data-sync-worker, fixture-ingestion, forecasts]
actuals: {tokens: 7200, tasks: 2, commits: 4}
tech-stack: {added: [], patterns: [admission-before-factory, deterministic enrichment jobs, provenance-only provider odds]}
key-files:
  created: [tests/integration/enrichment-runtime.test.ts]
  modified: [workers/data-sync/src/main.ts, workers/data-sync/src/queues/index.ts, workers/data-sync/src/jobs/enrichment.ts, workers/data-sync/src/jobs/fixtures.ts]
key-decisions:
  - "Phase 05: Optional enrichment is admitted against provider-wide protected headroom before API-Football construction."
  - "Phase 05: Fixture enrichment is scheduled only after fenced canonical publication and provider odds remain provenance-only."
requirements-completed: [PROV-05, PROV-06]
duration: 12min
completed: 2026-09-13
status: complete
---

# Phase 05 Plan 13: Production Optional Enrichment Summary

**The production worker now owns a bounded optional BullMQ consumer that admits API-Football enrichment before client construction, persists attributable evidence and issues cutoff-safe lineup forecast revisions.**

## Accomplishments

- Registered and lifecycle-managed the optional enrichment Queue and Worker.
- Added database-backed capability, circuit and protected-budget admission before lazy API-Football construction.
- Persisted immutable endpoint observations; official same-fixture pre-cutoff lineups can issue an attributable `LINEUP_CONFIRMED` forecast.
- Scheduled deterministic LINEUPS, INJURIES, ODDS and STATISTICS jobs only after successful fenced fixture publication, deduplicating fixture delivery.
- Kept provider odds on the observation path without manual-odds, value or wagering mutation imports.

## Task Commits

- `804c58e` — Task 1 RED
- `8bf7a3c` — Task 1 GREEN
- `78ce9b1` — Task 2 RED
- `056ec16` — Task 2 GREEN

## Deviations from Plan

None - plan executed as specified.

## Known Stubs

None.

## Self-Check: PASSED

- Enrichment runtime and admission suites passed 6/6.
- Data-sync typecheck passed under Node 24.
- All four task commits and planned artifacts exist.
