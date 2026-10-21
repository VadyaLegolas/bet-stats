---
phase: 05-provider-aware-coverage-and-enrichment
plan: 02
subsystem: database
tags: [postgresql, prisma, provider-routing, quota, audit]
requires:
  - phase: 05-01
    provides: provider-neutral contracts and strict API-Football adapter
provides:
  - Forward-only provider routing migration proven from empty and Phase 4 schemas
  - Append-only route, attempt, quota observation and throttle reservation receipts
  - Atomic capability-circuit-budget admission with protected headroom
  - Exact-scope transactional capability approval repository seam
affects: [05-03, 05-04, 05-05, 05-09]
actuals:
  tokens: 289511
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [PostgreSQL advisory-lock admission, append-only provider evidence, monotonic quota narrowing]
key-files:
  created: [packages/domain/src/provider-routing.ts, packages/database/prisma/migrations/20260909_phase05_provider_routing/migration.sql, packages/database/src/provider-routing/repository.ts]
  modified: [packages/database/prisma/schema.prisma, tests/integration/migration-empty.test.ts, tests/integration/provider-routing.test.ts]
key-decisions:
  - "Phase 05: Provider admission locks the provider, endpoint and UTC request day before counting reservations."
  - "Phase 05: Observed quota facts may only narrow configured capacity; later wider observations cannot restore capacity."
  - "Phase 05: Successful attempts require an exact provider-matching immutable SourceObservation; denied attempts carry no response fact."
patterns-established:
  - "Admission order: exact seasonal capability, closed circuit, atomic daily/headroom and throttle reservation."
  - "Attempt identity is idempotent by attemptKey and conflicting reuse fails closed."
requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04, PROV-05]
coverage:
  - id: D1
    description: Forward migration applies to empty PostgreSQL and the exact Phase 4 schema.
    requirement: PROV-01
    verification:
      - kind: integration
        ref: tests/integration/migration-empty.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Route and attempt receipts are append-only, idempotent and bind success to immutable source evidence.
    requirement: PROV-02
    verification:
      - kind: integration
        ref: tests/integration/provider-routing.test.ts#links successful attempts to the exact immutable source receipt
        status: pass
    human_judgment: false
  - id: D3
    description: Capability, circuit, daily allowance, headroom and throttle admission is serialized and fail-closed.
    requirement: PROV-05
    verification:
      - kind: integration
        ref: tests/integration/provider-routing.test.ts#orders exact capability and circuit checks before atomic allowance/headroom reservation
        status: pass
    human_judgment: false
duration: 16min
completed: 2026-09-12
status: complete
---

# Phase 05 Plan 02: Provider Routing Persistence Summary

**Forward-only PostgreSQL route evidence with atomic capability/circuit/quota admission, protected headroom, and immutable source-linked attempts**

## Performance

- **Duration:** 16 min (continuation after interrupted run)
- **Started:** 2026-09-12T16:16:00Z
- **Completed:** 2026-09-12T16:32:07Z
- **Tasks:** 2
- **Files modified:** 23

## Accomplishments

- Proved the complete migration chain on an empty PostgreSQL 18 database and a forward-only upgrade from the exact Phase 4 schema.
- Persisted immutable route decisions, attempts, allowlisted quota observations and throttle reservations with database constraints and triggers.
- Serialized concurrent admission by exact provider/endpoint/day, preserving critical headroom and preventing quota observations from widening capacity.
- Added idempotent denial and success receipts; success is accepted only with a provider-matching immutable source observation.

## Task Commits

1. **Task 1 RED: migration and repository witnesses** — `5990d08`
2. **Task 1 GREEN: migration-proven provider route receipts** — `7c3341b`
3. **Task 2 RED: admission persistence witnesses** — `d133956`
4. **Task 2 GREEN: atomic provider admission outcomes** — `5ddf8ce`

## Files Created/Modified

- `packages/domain/src/provider-routing.ts` — Closed route triggers/outcomes and canonical receipt hashing.
- `packages/database/prisma/migrations/20260909_phase05_provider_routing/migration.sql` — Forward-only tables, constraints, indexes and append-only triggers.
- `packages/database/prisma/schema.prisma` — Prisma relations for durable provider routing evidence.
- `packages/database/src/provider-routing/repository.ts` — Minimal receipt seam, serialized admission, quota observations, attempts and capability approval.
- `tests/integration/migration-empty.test.ts` — Empty-chain and exact Phase 4 forward-upgrade witnesses.
- `tests/integration/provider-routing.test.ts` — Repository, concurrency, denial, quota narrowing, source binding and approval witnesses.

## Decisions Made

- PostgreSQL advisory transaction locks serialize budget decisions by provider, endpoint and UTC request date.
- Capacity is the minimum of configured allowance and every retained allowlisted quota ceiling; observations never widen it.
- Admission decisions are append-only attempts rather than mutable state transitions; provider response facts exist only on successful source-linked attempts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Excluded repository identity fields from canonical content hashing**
- **Found during:** Task 1 tracer verification
- **Issue:** The repository recalculated the receipt hash over `id` and `contentHash`, so valid canonical receipts failed with `ROUTE_CONTENT_HASH_MISMATCH`.
- **Fix:** Destructured identity fields and hashed only `ProviderRouteReceiptContent`.
- **Files modified:** `packages/database/src/provider-routing/repository.ts`
- **Verification:** Minimal migrated repository test passes.
- **Committed in:** `7c3341b`

**2. [Rule 3 - Blocking] Restored the frozen pnpm dependency tree after interruption**
- **Found during:** Recovery verification
- **Issue:** The interrupted prior run left `node_modules` without the root Vitest executable.
- **Fix:** Reinstalled the existing lockfile under Node 24 without changing dependencies.
- **Files modified:** None tracked.
- **Verification:** All planned Vitest and typecheck commands executed successfully.

**3. [Rule 3 - Blocking] Repaired an unparsable initial STATE plan position**
- **Found during:** GSD metadata update
- **Issue:** `state.advance-plan` could not parse the pre-existing `Current Plan: Not started` value.
- **Fix:** Recorded plan 02 and the Phase 5 in-progress position directly after the remaining state handlers succeeded.
- **Files modified:** `.planning/STATE.md`
- **Verification:** STATE now records current plan 02 and completed plan count 63.

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking state/environment issues)
**Impact on plan:** Both fixes were required to execute and validate the planned behavior; no scope expansion.

## Issues Encountered

- The default shell resolved Node 25; all verification used the installed Node 24.14.0 runtime required by the project.
- Vitest startup included PostgreSQL container and migration setup, but exited normally; no orphaned owned process or container remained.

## User Setup Required

None - deterministic verification uses disposable local PostgreSQL containers and no provider credentials.

## Next Phase Readiness

- Plans 05-03 and 05-04 can consume durable route/admission receipts and the exact-scope approval seam.
- Live provider quota/reset semantics remain an explicitly separate credentialed approval concern for plan 05-09.

## Self-Check: PASSED

- All key files exist.
- Commits `5990d08`, `7c3341b`, `d133956`, and `5ddf8ce` exist.
- Migration tests passed 3/3, provider-routing tests passed 6/6, and domain/database typechecks passed.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-12*
