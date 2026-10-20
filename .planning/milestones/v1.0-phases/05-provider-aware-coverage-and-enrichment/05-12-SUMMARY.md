---
phase: 05-provider-aware-coverage-and-enrichment
plan: 12
subsystem: provider-aware-production-ingestion
tags: [provider-routing, api-football, postgresql, fallback, canonical-identity]
requires:
  - phase: 05-11
    provides: durable admitted-to-terminal provider route runtime
provides:
  - Independent validated and redacted live provider credentials
  - Canonical-to-provider external mapping with numeric API-Football validation
  - Route-selected durable fixture, result and standings production dispatch
  - Audited fallback fixture reconciliation before canonical publication
affects: [data-sync-worker, provider-routing, fixture-reconciliation, results, standings]
actuals: {tokens: 10200, tasks: 2, commits: 5}
tech-stack:
  added: []
  patterns: [factory-after-admission, canonical mapping gate, endpoint-specific attempt identity, provider-neutral adapters]
key-files:
  created: [tests/integration/provider-worker-routing.test.ts]
  modified: [packages/config/src/index.ts, packages/database/src/reconciliation/provider-fixture-resolver.ts, packages/football-data/src/providers/api-football/client.ts, workers/data-sync/src/main.ts, workers/data-sync/src/ingestion/provider-route-runtime.ts, workers/data-sync/src/jobs/fixtures.ts, workers/data-sync/src/jobs/results.ts, workers/data-sync/src/jobs/standings.ts]
key-decisions:
  - "Phase 05: Every production endpoint resolves provider request identities from canonical league and season IDs before constructing a client."
  - "Phase 05: Provider credentials remain isolated in a closed factory map and the selected factory is constructed only after durable admission."
requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04]
duration: 31min
completed: 2026-09-13
status: complete
---

# Phase 05 Plan 12: Provider-Aware Production Ingestion Summary

**Production fixture, result and standings replay now executes the versioned provider route through durable admission and terminal receipts, with isolated credentials, numeric API-Football requests and identity-safe fallback publication.**

## Accomplishments

- Added independent production validation for `FOOTBALL_DATA_API_TOKEN` and `API_FOOTBALL_API_KEY`; both are covered by recursive secret redaction.
- Replaced the global production provider factory with a closed provider factory map that supplies each secret only to its own client.
- Added fail-closed canonical `LeagueExternalRef`/`SeasonExternalRef` resolution for every route candidate, including positive base-10 validation for API-Football IDs.
- Wired fixtures, results and standings through endpoint-specific durable routes, provider-specific attempt keys, immutable observations and terminal receipts.
- Added provider-neutral API-Football result normalization and request adapters for all three endpoint families.
- Routed fallback fixtures through `resolveProviderFixture` inside fenced publication so exact references are reused and ambiguity is quarantined.

## Task Commits

1. **Task 1 RED:** `b1b9780`
2. **Task 1 GREEN:** `1dcfd22`
3. **Task 2 RED:** `658b5b8`
4. **Task 2 mapping GREEN:** `d7ae829`
5. **Task 2 production wiring GREEN:** `3ee1827`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved the existing PostgreSQL fallback identity witness**
- The initial RED edit accidentally replaced the established integration suite rather than extending it.
- Restored the complete prior suite before Task 1 GREEN and retained the new routing witnesses separately.
- Commit: `1dcfd22`

**2. [Rule 2 - Missing Critical] Added transaction-owned resolver execution**
- Fenced publication already owns a Prisma transaction, so the canonical resolver needed an explicit transaction-owned mode to avoid an invalid nested transaction while preserving the lock and quarantine behavior.
- Commit: `1dcfd22`

**3. [Rule 2 - Missing Critical] Added API-Football result normalization**
- The API-Football client exposed fixtures and standings but lacked the provider-neutral completed-result contract required by the production RESULTS route.
- Added result derivation from validated finished fixture envelopes with score validation and request/coverage metadata.
- Commit: `3ee1827`

## Threat Mitigations

- Unknown providers cannot select a credentialed factory.
- Missing, duplicate, cross-season or nonnumeric external mappings fail before network I/O.
- Factories are lazy and constructed only for a durably admitted route candidate.
- Successful attempts link a provider-matching immutable source observation before fenced canonical publication.
- Fixture ambiguity creates terminal quarantine evidence and cannot create a duplicate canonical fixture.

## Known Stubs

None.

## Self-Check: PASSED

- All implementation and test artifacts exist.
- Commits `b1b9780`, `1dcfd22`, `658b5b8`, `d7ae829`, and `3ee1827` exist.
- Config tests passed 7/7; routing, durable runtime and PostgreSQL fallback identity tests passed 17/17.
- Replay regression commands exited successfully.
- Config, database, football-data and data-sync typechecks passed under Node 24.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-13*
