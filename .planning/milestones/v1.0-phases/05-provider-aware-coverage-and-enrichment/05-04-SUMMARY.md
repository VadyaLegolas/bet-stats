---
phase: 05-provider-aware-coverage-and-enrichment
plan: 04
subsystem: enrichment
tags: [api-football, lineups, optional-queue, cutoff, provenance]
requires:
  - phase: 05-09
    provides: exact-scope approved provider capability
provides:
  - Strict request-bound API-Football schemas for optional enrichment
  - Capability/circuit/budget-gated enrichment execution before provider construction
  - Cutoff-bound official lineup issuance and deterministic optional schedules
affects: [forecast-orchestration, provider-budget, optional-workers]
actuals:
  tokens: 5469
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [observed-empty state, provider-wide optional headroom, immutable lineup receipt binding, bounded optional jobs]
key-files:
  created: [workers/data-sync/src/jobs/enrichment.ts, tests/integration/enrichment-admission.test.ts]
  modified: [packages/football-data/src/providers/api-football/schema.ts, packages/football-data/src/providers/api-football/client.ts, packages/database/src/forecast-repository.ts, workers/data-sync/src/queues/index.ts, workers/data-sync/src/main.ts, tests/integration/forecast-snapshots.test.ts]
key-decisions:
  - "Phase 05: Provider construction for optional enrichment occurs only after exact capability, closed circuit and successful provider-wide optional reservation."
  - "Phase 05: LINEUP_CONFIRMED may reference only an official same-fixture source observed no later than the forecast cutoff."
  - "Phase 05: Empty optional responses are OBSERVED_EMPTY, while denied, unavailable and pending states remain distinct and never become numeric zero."
requirements-completed: [PROV-05]
coverage:
  - id: D1
    description: Official same-fixture lineup is admitted in capability/circuit/reservation order and issues one attributable forecast revision.
    requirement: PROV-05
    verification:
      - kind: integration
        ref: tests/integration/enrichment-admission.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Lineup source time and fixture identity are enforced at forecast repository cutoff.
    requirement: PROV-05
    verification:
      - kind: integration
        ref: tests/integration/forecast-snapshots.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Optional lineup, injury, odds and statistics jobs are deterministic, bounded and blocked before I/O when headroom is protected.
    requirement: PROV-05
    verification:
      - kind: integration
        ref: tests/integration/enrichment-admission.test.ts
        status: pass
    human_judgment: false
duration: 12min
completed: 2026-09-12
status: complete
---

# Phase 05 Plan 04: Quota-Safe Pre-Match Enrichment Summary

**Strict optional enrichment now preserves provider-wide critical quota and issues lineup forecasts only from immutable, official, same-fixture, cutoff-safe receipts.**

## Accomplishments

- Added request-bound strict schemas and a sanitized API-Football client seam for lineups, injuries, provider odds and detailed statistics.
- Enforced capability → circuit → atomic optional reservation ordering before provider construction.
- Preserved explicit observed-empty evidence rather than coercing absence into zero-valued facts.
- Bound official lineup lookup to fixture, status, confirmation time, source observation time and forecast cutoff.
- Added deterministic bounded optional queue schedules with two retry attempts independent from circuit transitions.

## Task Commits

1. **Task 1 RED:** `9d7dd8b`
2. **Task 1 GREEN:** `b87b35a`
3. **Task 2 RED:** `d69f44b`
4. **Task 2 GREEN:** `26d3a7c`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated stale forecast integration fixture to satisfy immutable lineup receipt guards**
- **Found during:** Task 1 GREEN verification
- **Issue:** The existing test imported the repository from a module that does not export it and created a receipt/source timestamp rejected by the current database guards.
- **Fix:** Imported the database repository directly and made the fixture receipt, external identity and source time explicit.
- **Files modified:** `tests/integration/forecast-snapshots.test.ts`
- **Commit:** `b87b35a`

## Threat Mitigations

- **T-05-04-01:** Optional work cannot construct a provider client until provider-wide headroom reservation succeeds.
- **T-05-04-02:** Strict schemas and fixture/cutoff-bound immutable receipt lookup prevent fabricated enrichment evidence.
- **T-05-04-03:** Admission returns stable denial codes and provider errors expose only allowlisted headers.

## Self-Check: PASSED

- All eight planned source/test files exist.
- Commits `9d7dd8b`, `b87b35a`, `d69f44b`, and `26d3a7c` exist.
- Integration verification passed 7/7 on PostgreSQL 18; worker, database and football-data typechecks passed under Node 24.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-12*
