---
phase: 05-provider-aware-coverage-and-enrichment
plan: 03
subsystem: ingestion
tags: [provider-routing, reconciliation, postgres, fallback, provenance]
requires:
  - phase: 05-02
    provides: durable provider route receipts, attempts, exact capability and admission seams
  - phase: 05-09
    provides: approved exact-scope provider policy
provides:
  - Versioned competition/season/endpoint provider route matrix
  - External-ref-first fixture resolver with conservative kickoff matching
  - Bounded persist-before-I/O fallback orchestration and explicit sole-source limited state
affects: [05-04, 05-05, fixture-ingestion, result-ingestion, standings-ingestion]
actuals:
  tokens: 7399
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [closed provider candidate lists, external-ref-first reconciliation, append-only fixture provenance, deterministic route job identity]
key-files:
  created: [packages/football-data/src/routing/provider-route.ts, packages/database/src/reconciliation/provider-fixture-resolver.ts, tests/integration/provider-fallback-identity.test.ts]
  modified: [workers/data-sync/src/ingestion/runner.ts, workers/data-sync/src/jobs/fixtures.ts, workers/data-sync/src/jobs/results.ts, workers/data-sync/src/jobs/standings.ts, tests/integration/provider-routing.test.ts]
key-decisions:
  - "Phase 05: A fallback fixture may only attach through an exact external ref or one canonical league/season/home/away candidate inside the versioned 15-minute window."
  - "Phase 05: Provider fallback is a closed list of at most two attempts, and malformed or identity-ambiguous data never triggers another provider."
  - "Phase 05: UEL/UECL routes are API-Football sole-source and expose NO_FALLBACK with timestamped last-valid data."
requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04]
coverage:
  - id: D1
    description: Eligible primary failure falls back once without changing canonical league, season, team or fixture IDs.
    requirement: PROV-02
    verification:
      - kind: integration
        ref: tests/integration/provider-fallback-identity.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Zero or multiple fixture candidates publish nothing and reuse an open reconciliation case.
    requirement: PROV-03
    verification:
      - kind: integration
        ref: tests/integration/provider-fallback-identity.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Fixtures, results and standings derive deterministic top-five/UCL fallback routes and UEL/UECL sole-source routes.
    requirement: PROV-04
    verification:
      - kind: integration
        ref: tests/integration/provider-routing.test.ts
        status: pass
    human_judgment: false
duration: 18min
completed: 2026-09-12
status: complete
---

# Phase 05 Plan 03: Provider-Aware Core Routing Summary

**Bounded provider fallback now preserves one canonical football identity graph through external-ref-first reconciliation, append-only provenance, and explicit sole-source degradation.**

## Performance

- **Duration:** 18 min
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Added a versioned route matrix selecting football-data.org first for top-five/UCL and API-Football alone for UEL/UECL.
- Reconciled fallback fixtures against existing provider refs and a configurable ±15-minute kickoff window; only one candidate can be linked.
- Quarantined missing or ambiguous identity in a reusable review case without inserting or publishing a fixture.
- Persisted route and attempt facts before provider I/O, bounded fallback to the closed candidate list, and returned timestamped last-valid state when sole source fails.
- Derived deterministic job IDs for fixture, result and standings routes from canonical competition, season, endpoint and policy version.

## Task Commits

1. **Task 1 RED:** `fb62580`
2. **Task 1 GREEN:** `25e6db7`
3. **Task 2 RED:** `0da893a`
4. **Task 2 GREEN:** `138863b`

## Decisions Made

- Exact provider fixture refs always win; conservative participant and kickoff matching is only the one-way path for attaching a new provider ref.
- Non-eligible failures and the final candidate terminate as explicit limited state; fallback never loops.
- Route-specific job identity includes the route policy version so policy changes cannot silently reuse prior jobs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebuilt workspace links after adding the existing internal football-data dependency to database**
- **Found during:** Task 1 typecheck
- **Issue:** TypeScript could not resolve the newly declared workspace package until pnpm links were regenerated.
- **Fix:** Updated the frozen lockfile and rebuilt node_modules from the existing local pnpm store; no external package version changed.
- **Files modified:** `packages/database/package.json`, `pnpm-lock.yaml`
- **Commit:** `25e6db7`

## Threat Mitigations

- **T-05-03-01:** Exact external refs precede a unique conservative candidate; zero/multiple candidates are quarantined.
- **T-05-03-02:** Candidate lists are closed and limited to two; only classified eligible failures advance.
- **T-05-03-03:** Route selection and every attempt are persisted before provider I/O; fixture payload provenance is append-only.

## Self-Check: PASSED

- All planned source and test files exist.
- Commits `fb62580`, `25e6db7`, `0da893a`, and `138863b` exist.
- Integration verification passed 10/10 on PostgreSQL 18; worker and database typechecks passed under Node 24.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-12*
