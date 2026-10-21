---
phase: 03-forecast-and-manual-value-workbench
plan: 04
subsystem: api
tags: [nestjs, forecast, immutable-snapshots, bullmq-jobs, cutoff-correctness]
requires:
  - phase: 03-forecast-and-manual-value-workbench
    provides: forecast calculation contracts and immutable PostgreSQL snapshot schema
provides:
  - Strict shared forecast request and response transport contract
  - Protected cutoff-correct forecast generation and exact snapshot reads
  - Deterministic INITIAL, PRE_MATCH, and capability-gated LINEUP_CONFIRMED publication jobs
affects: [03-05, 03-06, 04-evaluation, forecast-api, forecast-worker]
actuals:
  tokens: 9806
  tasks: 3
  commits: 7
tech-stack:
  added: []
  patterns: [strict exact-key transport parsing, repository-injected forecast orchestration, deterministic content-addressed jobs]
key-files:
  created: [packages/domain/src/forecast/contract.ts, apps/api/src/modules/forecasts/forecasts.service.ts, apps/api/src/modules/forecasts/forecasts.controller.ts, apps/api/src/modules/forecasts/forecasts.module.ts, workers/data-sync/src/jobs/forecasts.ts, tests/integration/forecast-api.test.ts, tests/integration/forecast-publication.test.ts]
  modified: [packages/domain/src/index.ts, packages/domain/src/forecast/model.ts, apps/api/src/app.module.ts, workers/data-sync/src/jobs/pipeline.ts]
key-decisions:
  - "Use one strict forecast DTO for API and worker boundaries, preserving probability, confidence, limitations, cutoff, tail, and receipt separation."
  - "Derive deterministic snapshot and job identities from fixture, kind, cutoff, model/config, and sorted evidence fingerprints."
patterns-established:
  - "Forecast orchestration applies policy, canonical identity, kickoff, exact evidence, and source-time gates before calculation or persistence."
  - "INITIAL freezes its first eligible cutoff, PRE_MATCH resolves to kickoff minus six hours, and LINEUP_CONFIRMED requires durable official observation."
requirements-completed: [PRED-04, PRED-05, PRED-06]
coverage:
  - id: D1
    description: "Strict forecast transport preserves immutable identity and separates probability, confidence, limitations, tail disclosure, and receipt data."
    requirement: PRED-05
    verification:
      - kind: integration
        ref: "tests/integration/forecast-api.test.ts#forecast transport contract"
        status: pass
    human_judgment: false
  - id: D2
    description: "Protected orchestration rejects policy, identity, cutoff, and evidence violations before publishing an immutable forecast."
    requirement: PRED-04
    verification:
      - kind: integration
        ref: "tests/integration/forecast-api.test.ts#forecast API orchestration"
        status: pass
    human_judgment: false
  - id: D3
    description: "Deterministic scheduled jobs publish INITIAL and PRE_MATCH snapshots while lineup publication stays dormant without official evidence."
    requirement: PRED-06
    verification:
      - kind: integration
        ref: "tests/integration/forecast-publication.test.ts"
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-09-06
status: complete
---

# Phase 3 Plan 4: Forecast Publication Orchestration Summary

**One fail-closed forecast path now serves protected API requests and deterministic scheduled publication with exact cutoff evidence and immutable receipts.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-06T02:46:00Z
- **Completed:** 2026-09-06T02:55:16Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Published a strict exact-key forecast transport contract with stable validation codes and complete immutable receipt boundaries.
- Added guarded no-store Nest resources that apply policy, canonical identity, cutoff, evidence availability, and dual-time source checks before atomic publication.
- Added deterministic INITIAL/PRE_MATCH jobs and official-observation-gated LINEUP_CONFIRMED capability using the same authoritative publisher request.

## Task Commits

1. **Task 1 RED: Forecast transport contract** - `9f402ab` (test)
2. **Task 1 GREEN: Strict shared forecast DTO** - `01c9e96` (feat)
3. **Task 2 RED: Forecast orchestration gates** - `d0c6f00` (test)
4. **Task 2 GREEN: Protected immutable forecast resources** - `76335a5` (feat)
5. **Task 3 RED: Scheduled publication behavior** - `3cd73f0` (test)
6. **Task 3 GREEN: Deterministic forecast jobs** - `679f202` (feat)
7. **Rule 1 fix: Non-circular content identity** - `2be0a4e` (fix)

## Files Created/Modified

- `packages/domain/src/forecast/contract.ts` - Strict request/response DTOs and exact-key parsers.
- `packages/domain/src/forecast/model.ts` - Snapshot assignment removed from the content input fingerprint.
- `packages/domain/src/index.ts` - Shared forecast contract exports.
- `apps/api/src/modules/forecasts/forecasts.service.ts` - Repository-injected fail-closed orchestration and Prisma atomic publication adapter.
- `apps/api/src/modules/forecasts/forecasts.controller.ts` - Eligibility-guarded no-store resource endpoints.
- `apps/api/src/modules/forecasts/forecasts.module.ts` - Forecast module registration.
- `apps/api/src/app.module.ts` - Forecast module composition.
- `workers/data-sync/src/jobs/forecasts.ts` - Deterministic publication plans, job IDs, and authoritative publisher delegation.
- `workers/data-sync/src/jobs/pipeline.ts` - Forecast publication queue naming.
- `tests/integration/forecast-api.test.ts` - Contract and fail-closed orchestration coverage.
- `tests/integration/forecast-publication.test.ts` - Cutoff, identity, lineup, and atomic failure coverage.

## Decisions Made

- Kept eligibility enforcement at the Nest guard and as an injectable orchestration precondition so non-HTTP callers cannot bypass policy ownership.
- Sorted evidence identities before hashing and transport publication so home/away query completion order cannot alter idempotency.
- Kept worker scheduling transport-only: it delegates complete requests to the authoritative forecast publisher rather than duplicating calculation or persistence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed circular snapshot identity from the forecast input hash**
- **Found during:** Overall identity verification after Task 3
- **Issue:** The pre-existing model included its assigned snapshot ID in `inputHash`, making content identity depend on an output identifier and preventing stable revision addressing.
- **Fix:** Excluded snapshot assignment from the content fingerprint and derived the snapshot ID from fixture, kind, cutoff, model/config, and evidence identity.
- **Files modified:** `packages/domain/src/forecast/model.ts`, `apps/api/src/modules/forecasts/forecasts.service.ts`
- **Verification:** Forecast API/publication integration suites and existing forecast unit suites passed.
- **Committed in:** `2be0a4e`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix is required for deterministic idempotency and changed-input revisions; no feature scope was added.

## Issues Encountered

- The managed sandbox initially blocked Vitest's local Vite helper process; approved execution provided the required RED and GREEN evidence.
- The local runtime is Node 25.2.1 while the repository declares Node 24 LTS. This emitted engine warnings only.

## Known Stubs

None.

## Threat Flags

None. The new protected resource, cutoff selection, lineup provenance, and duplicate-job surfaces are all covered by the plan threat register.

## User Setup Required

None - no external service configuration required.

## Verification

- `forecast-api.test.ts` and `forecast-publication.test.ts` — 2 files, 7 tests passed.
- Existing `forecast.test.ts` and `forecast-value-tracer.test.ts` — 2 files, 24 tests passed.
- Domain, API, and data-sync TypeScript typechecks — passed.

## Next Phase Readiness

- Manual odds and workbench plans can consume exact immutable forecast DTOs without selecting newer evidence implicitly.
- Evaluation can rely on stable cutoff, config, evidence, and receipt identities.

## Self-Check: PASSED

- All eleven created or modified implementation/test files exist.
- Commits `9f402ab`, `01c9e96`, `d0c6f00`, `76335a5`, `3cd73f0`, `679f202`, and `2be0a4e` exist in repository history.

---
*Phase: 03-forecast-and-manual-value-workbench*
*Completed: 2026-09-06*
