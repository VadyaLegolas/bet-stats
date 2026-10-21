---
phase: 02-historical-evidence-pipeline
plan: 12
subsystem: ingestion
tags: [football-data-org, competition-allowlist, circuit-breaker, bullmq, tdd]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: durable reservation-first ingestion and provider circuit registry
provides:
  - Competition-parameterized result and standings requests for all seven configured competitions
  - Request-aware provider envelope validation before normalization
  - Single-owner HALF_OPEN probe gate with release on every exit path
affects: [phase-03, provider-ingestion, replay, reliability]
actuals:
  tokens: 5252
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [request-aware schema refinement, registry-owned half-open probe lease, reservation-first ingestion]
key-files:
  created: []
  modified:
    - packages/football-data/src/provider.interface.ts
    - packages/football-data/src/providers/football-data-org/client.ts
    - packages/football-data/src/providers/football-data-org/schema.ts
    - packages/football-data/src/providers/football-data-org/normalize.ts
    - workers/data-sync/src/ingestion/runner.ts
    - tests/unit/provider-contract.test.ts
    - tests/integration/provider-resilience.test.ts
key-decisions:
  - "The football-data.org competition allowlist is a shared runtime value and TypeScript union, so invalid values fail before network I/O."
  - "HALF_OPEN execution requires ownership from the circuit registry; a caller-provided HALF_OPEN string alone cannot authorize quota spend."
patterns-established:
  - "Provider envelopes are refined against the exact competition requested, not a global literal."
  - "A HALF_OPEN lease wraps every post-circuit exit in finally, including policy denial, reservation denial, success, and exceptions."
requirements-completed: [PIPE-01, PIPE-05]
coverage:
  - id: D1
    description: "Every configured competition routes results and standings through its own provider path and rejects identity mismatches."
    requirement: PIPE-01
    verification:
      - kind: unit
        ref: "tests/unit/provider-contract.test.ts#routes configured competition requests and rejects mismatches"
        status: pass
    human_judgment: false
  - id: D2
    description: "Only one concurrent HALF_OPEN worker can reserve quota or call the provider, and its lease is always released."
    requirement: PIPE-05
    verification:
      - kind: integration
        ref: "tests/integration/provider-resilience.test.ts#HALF_OPEN probe ownership"
        status: pass
      - kind: integration
        ref: "tests/integration/provider-budget-order.test.ts"
        status: pass
    human_judgment: false
duration: 5min
completed: 2026-08-30
status: complete
---

# Phase 02 Plan 12: Competition and HALF_OPEN Reliability Summary

**Allowlisted multi-competition ingestion with request-matched envelopes and a single registry-owned HALF_OPEN recovery probe**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-30T11:17:00Z
- **Completed:** 2026-08-30T11:22:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added a typed runtime allowlist for PL, PD, BL1, SA, FL1, CL, and EL and carried the requested code into result and standings URLs.
- Rejected unknown codes before fetch and rejected provider envelopes whose competition identity differs from the request.
- Enforced one concurrent HALF_OPEN probe before allowance checks, reservation, provider construction, or I/O, with guaranteed lease release.

## Task Commits

1. **Task 1 RED: Competition routing witnesses** — `0e1b1c0`
2. **Task 1 GREEN: Parameterized competition ingestion** — `1fa8057`
3. **Task 2 RED: HALF_OPEN concurrency witnesses** — `fd68465`
4. **Task 2 GREEN: Single HALF_OPEN probe lease** — `518ed08`

## Files Created/Modified

- `packages/football-data/src/provider.interface.ts` — configured competition union, runtime allowlist, and parameterized request DTOs.
- `packages/football-data/src/providers/football-data-org/client.ts` — pre-fetch allowlist validation and competition-specific URLs.
- `packages/football-data/src/providers/football-data-org/schema.ts` — request-aware result and standings envelope refinements.
- `packages/football-data/src/providers/football-data-org/normalize.ts` — passes requested competition identity into validation.
- `workers/data-sync/src/ingestion/runner.ts` — registry-authoritative circuit state and safely released probe ownership.
- `tests/unit/provider-contract.test.ts` — seven-competition routing, mismatch, and unknown-code coverage.
- `tests/integration/provider-resilience.test.ts` — concurrent ownership and release-path coverage.

## Decisions Made

- Used one exported allowlist as both the runtime authorization source and the TypeScript competition-code source.
- Treat missing registry ownership during HALF_OPEN as `CIRCUIT_OPEN`, preserving fail-closed behavior without widening the public denial taxonomy.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- Sandboxed Vitest could not spawn Vite (`EPERM`); the approved unsandboxed invocation completed successfully.
- The host runs Node 25 while the workspace declares Node 24; all tests and typechecks passed with the existing engine warning.

## User Setup Required

None.

## Known Stubs

None.

## Next Phase Readiness

- PIPE-01 now covers every configured football-data.org competition without silently falling back to Premier League data.
- PIPE-05 now prevents concurrent recovery workers from bypassing circuit protection and spending multiple reservations.

## Self-Check: PASSED

- All seven key files exist.
- Commits `0e1b1c0`, `1fa8057`, `fd68465`, and `518ed08` exist in git history.
- 35 targeted tests and all seven workspace typechecks passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-30*
