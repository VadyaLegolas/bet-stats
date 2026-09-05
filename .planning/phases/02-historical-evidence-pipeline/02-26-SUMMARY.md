---
phase: 02-historical-evidence-pipeline
plan: 26
subsystem: ingestion
tags: [football-data-org, replay, bullmq, postgresql, idempotency]
status: complete
requires:
  - phase: 02-24
    provides: generalized competition-aware fixture provider contract
provides:
  - reservation-first non-PL fixture replay through the production worker
  - fail-closed competition and unit-window validation before persistence
  - removal of the temporary Premier League compatibility method
affects: [phase-03-forecast-workbench, provider-enrichment]
tech-stack:
  added: []
  patterns: [validated date-only provider window, classified scope mismatch, reservation-before-provider-I/O]
key-files:
  created: []
  modified:
    - packages/football-data/src/provider.interface.ts
    - packages/football-data/src/providers/football-data-org/client.ts
    - workers/data-sync/src/jobs/fixtures.ts
    - tests/integration/replay-boundary.test.ts
    - tests/integration/provider-capability.test.ts
    - tests/unit/provider-contract.test.ts
key-decisions:
  - Returned fixture competition, season, and kickoff must all match the durable replay unit; any mismatch fails the whole unit before persistence.
  - Invalid configured competitions fail before reservation and provider construction, while policy and capability denial remain ahead of provider I/O.
requirements-completed: [PIPE-01, PIPE-03, PIPE-04, PIPE-05, PIPE-06]
actuals:
  tokens: 4970
  tasks: 2
  commits: 4
metrics:
  duration: 12min
  completed: 2026-09-04
coverage:
  - id: D1
    description: A PD fixture replay uses the generalized provider with exact date-only bounds and persists one canonical fixture with provenance.
    requirement: PIPE-01
    verification:
      - kind: integration
        ref: tests/integration/replay-boundary.test.ts#routes a PD FIXTURES unit through the generalized provider and persists it once
        status: pass
    human_judgment: false
  - id: D2
    description: Invalid, mismatched, and out-of-window fixture scopes fail closed without unintended provider I/O or persistence.
    requirement: PIPE-03
    verification:
      - kind: integration
        ref: tests/integration/provider-capability.test.ts#rejects an invalid configured competition before reservation or provider construction
        status: pass
      - kind: integration
        ref: tests/integration/replay-boundary.test.ts#classifies mismatch and persists no fixture
        status: pass
    human_judgment: false
  - id: D3
    description: Re-delivery reuses request reservation and canonical/provenance identities.
    requirement: PIPE-06
    verification:
      - kind: integration
        ref: tests/integration/provider-capability.test.ts#reserves before I/O and reruns without duplicate canonical facts
        status: pass
    human_judgment: false
---

# Phase 02 Plan 26: Competition-Aware Fixture Replay Summary

**Production replay now routes PL and non-PL fixture units through one explicit competition/date provider contract, rejecting scope drift before canonical persistence while retaining reservation-first idempotency.**

## Performance

- **Duration:** 12 min
- **Completed:** 2026-09-04
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Migrated `runFixtureSyncJob` from the obsolete implicit-PL method to `fetchCompetitionFixtures` with validated configured competition and UTC date-only unit bounds.
- Added fail-closed classified errors for invalid request scope and provider competition, season, or kickoff-window mismatch.
- Proved a real PD replay persists one matching canonical fixture and immutable provenance, while denial and invalid-input paths perform no provider construction/I/O.
- Preserved deterministic reservation, canonical fixture, and provenance identities across repeat delivery.

## Task Commits

- `bb95cbb` — RED witness for non-PL production replay routing.
- `e89eb47` — Competition-aware worker wiring and compatibility-wrapper removal.
- `ab4a449` — Remaining provider contract unit consumer migration.
- `5e13b26` — Mismatch, invalid-scope, policy-order, and rerun regression witnesses.

## Verification

- `replay-boundary.test.ts` + `provider-capability.test.ts`: **20/20 passed**.
- `provider-contract.test.ts`: **28/28 passed**.
- `pnpm --filter @bet-stats/data-sync typecheck`: **passed**.
- Repository search for `fetchPremierLeagueFixtures`: **zero references**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Migrated the unit-level provider contract consumer**
- **Found during:** Task 1, before removing the compatibility wrapper.
- **Issue:** `tests/unit/provider-contract.test.ts` still called the deprecated method but was omitted from the plan file list.
- **Fix:** Migrated the assertions to `fetchCompetitionFixtures` with an explicit PL window before removing the wrapper.
- **Files modified:** `tests/unit/provider-contract.test.ts`
- **Commit:** `ab4a449`

## Issues Encountered

- Retried mismatched payloads correctly avoid repeated provider I/O because the durable policy fingerprint changes after the first reservation; the regression asserts the first classified scope failure and subsequent zero-I/O behavior.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 2 fixture replay now has competition-correct production wiring and adversarial boundary coverage.
- No known stubs, skipped tests, schema changes, or new package dependencies were introduced.

## Self-Check: PASSED

- All six modified files exist.
- All four task commits exist in git history.
- Required verification commands pass.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-09-04*
