---
phase: 05-provider-aware-coverage-and-enrichment
plan: 11
subsystem: provider-routing-runtime
tags: [postgresql, fallback, immutable-observation, state-machine, recovery]
requires:
  - phase: 05-02
    provides: durable route and admission repository
  - phase: 05-03
    provides: bounded provider route runner and failure classification
provides:
  - Reusable durable route execution seam with admission-before-construction
  - Idempotent ADMITTED-to-terminal database transition
  - PostgreSQL evidence that primary recovery preserves fallback history
affects: [worker-ingestion, provider-routing, provider-state-projection]
actuals: {tokens: 7600, tasks: 2, commits: 5}
tech-stack:
  added: []
  patterns: [bounded durable route lifecycle, locked terminal transition, append-only recovery, timestamped last-valid lookup]
key-files:
  created: [workers/data-sync/src/ingestion/provider-route-runtime.ts, tests/integration/provider-route-runtime.test.ts, packages/database/prisma/migrations/20260913_phase05_terminal_route_attempt/migration.sql]
  modified: [workers/data-sync/src/ingestion/runner.ts, packages/database/src/provider-routing/repository.ts, tests/integration/provider-routing.test.ts]
key-decisions:
  - "Phase 05: Provider factories are constructed only after durable exact-attempt admission and every admitted attempt reaches one classified terminal state."
  - "Phase 05: The database permits exactly one immutable ADMITTED-to-terminal transition while rejecting conflicting replay and all identity-field mutation."
requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04]
duration: 16min
completed: 2026-09-13
status: complete
---

# Phase 05 Plan 11: Durable Provider Route Runtime Summary

**A bounded route runtime now joins durable admission, classified fallback, provider-matching immutable observations, terminal receipts and timestamped last-valid recovery, with PostgreSQL proving history survives primary recovery.**

## Accomplishments

- Added `executeProviderRoute` with route-first persistence, admission before factory construction, bounded fallback and quarantine/no-fallback stopping.
- Persisted successful values before linking a provider-matching terminal `SUCCEEDED` receipt.
- Returned exact timestamped last-valid values for sole-source exhaustion without fabricating a current response.
- Added a locked, replay-safe `completeAttempt` repository transition and a forward-only trigger migration preserving immutable identity fields.
- Proved fallback and recovered primary observations remain separately queryable while deterministic freshness selects the newer fact.

## Task Commits

1. **Task 1 RED:** `206c5c5`
2. **Task 1 GREEN:** `60e380b`
3. **Task 2 RED:** `47f5eb5`
4. **Task 2 GREEN:** `8b726aa`
5. **Regression fix:** `ee43d30`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added a forward migration for the terminal state machine**
- The historical blanket append-only trigger rejected the single intended `ADMITTED → terminal` transition.
- Added a new migration permitting only that transition while locking every identity/admission/timestamp field.
- Commit: `8b726aa`

**2. [Rule 3 - Blocking] Restored pnpm links from the frozen lockfile**
- A prior interrupted install omitted `proper-lockfile`'s `signal-exit@3` link, causing Prisma migration startup to load an incompatible version.
- Restored existing dependencies without changing the lockfile.

**3. [Rule 1 - Bug] Removed wall-clock dependence from daily reservation counting**
- Reservations were counted by attempt creation time rather than their requested throttle window, making historical/concurrent admission incorrect after UTC day rollover.
- Commit: `ee43d30`

## Threat Mitigations

- Provider code is never constructed before durable admission.
- Stable classified codes, not raw provider bodies or headers, enter failure receipts.
- Success requires an immutable observation whose provider exactly matches the admitted attempt.
- Row locking and serializable retry converge identical replay and reject conflicting terminal content.

## Known Stubs

None.

## Self-Check: PASSED

- All planned runtime, repository, migration and test artifacts exist.
- Commits `206c5c5`, `60e380b`, `47f5eb5`, `8b726aa`, and `ee43d30` exist.
- Runtime integration passed 3/3 and the complete PostgreSQL routing suite passed 10/10.
- Database and data-sync typechecks passed under Node 24.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-13*
