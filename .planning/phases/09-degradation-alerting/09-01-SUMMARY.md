---
phase: 09-degradation-alerting
plan: 01
subsystem: database
tags: [postgresql, prisma, alerts, triggers, append-only, dedup]

requires:
  - phase: 08-backup-drills
    provides: BackupRun/BackupVerificationReceipt guarded-trigger pattern and real-Postgres mutation-rejection test harness
provides:
  - OpsAlert / OpsAlertTransition / OpsAlertDelivery tables in PostgreSQL with CHECK constraints and dedup unique index
  - Append-only triggers on transition + delivery audit tables; guarded column-allow-list transition trigger on OpsAlert
  - Migration packages/database/prisma/migrations/20261108_phase09_ops_alerts/migration.sql (applied to dev DB, recorded in _prisma_migrations)
  - Regenerated Prisma client exposing prisma.opsAlert / opsAlertTransition / opsAlertDelivery delegates
  - 7-case real-Postgres integration suite proving mutation rejection, dedup convergence, acknowledge idempotency
affects: [09-02 evaluator, 09-03 alerts API, 09-04 operations UI, ALRT-02, ALRT-04]

actuals:
  tokens: 47000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Guarded column-allow-list transition trigger (RAISE EXCEPTION on identity changes, DELETE rejected) for mutable-with-audit state"
    - "Blanket append-only triggers reserved for pure audit tables (OpsAlertTransition, OpsAlertDelivery)"
    - "Dedup via unique dedupFingerprint + upsert count/lastSeen bump — one OPEN row per signal+scope"

key-files:
  created:
    - packages/database/prisma/migrations/20261108_phase09_ops_alerts/migration.sql
    - tests/integration/alerts.test.ts
    - packages/database/src/generated/prisma/models/OpsAlert.ts
    - packages/database/src/generated/prisma/models/OpsAlertTransition.ts
    - packages/database/src/generated/prisma/models/OpsAlertDelivery.ts
  modified:
    - packages/database/prisma/schema.prisma
    - packages/database/src/generated/prisma/models.ts
    - packages/database/src/generated/prisma/client.ts

key-decisions:
  - "OpsAlert uses a guarded transition trigger (identity frozen: id/dedupFingerprint/firstSeen/createdAt), NOT a blanket append-only trigger — dedup count/lastSeen bumps and operator acknowledge/resolve must keep working"
  - "OpsAlertTransition and OpsAlertDelivery are pure audit trails frozen append-only at the database level (T-09-01/T-09-03)"
  - "ALRT-02 left Pending: requirement is shared with Plan 09-02 (shared-ID gate) and stays open until that plan completes"

patterns-established:
  - "Guarded mutable-state trigger pattern for alert lifecycle state"
  - "pid-scoped real-Postgres integration tests with raw-SQL rejection assertions (extends phase 07 harness)"

requirements-completed: [ALRT-02]

coverage:
  - id: D1
    description: "OpsAlert, OpsAlertTransition, OpsAlertDelivery tables in PostgreSQL with CHECK constraints (severity/status/signal/count), unique dedupFingerprint index, append-only triggers on both audit tables and a guarded transition trigger on OpsAlert; migration applied to dev DB"
    requirement: ALRT-02
    verification:
      - kind: integration
        ref: "packages/database/tmp-dbcheck-09-01.mjs run (pg client: pg_tables/pg_trigger/pg_indexes/pg_constraint assertions) — VERIFY-OK"
        status: pass
      - kind: other
        ref: "pnpm --filter @bet-stats/database exec prisma validate — exit 0"
        status: pass
      - kind: other
        ref: "prisma migrate status — 'Database schema is up to date!' (20261108_phase09_ops_alerts recorded)"
        status: pass
      - kind: integration
        ref: "tests/integration/alerts.test.ts — cases 1-5 reject UPDATE/DELETE on audit tables and identity/fingerprint changes, allow severity change"
        status: pass
    human_judgment: false
  - id: D2
    description: "Integration suite proving dedup upsert convergence (one OPEN row per dedupFingerprint, count bump) and acknowledge idempotency (exactly one OPEN→ACKNOWLEDGED transition row, repeat is a no-op)"
    requirement: ALRT-02
    verification:
      - kind: integration
        ref: "pnpm vitest run --project integration tests/integration/alerts.test.ts — 7/7 passed (729ms)"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-11-10
status: complete
---

# Phase 9 Plan 01: Ops Alert Storage Summary

**Durable OpsAlert/OpsAlertTransition/OpsAlertDelivery PostgreSQL storage with database-level tamper guards (append-only audit triggers + guarded identity-freeze trigger), applied to the dev DB and proven by 7 real-Postgres integration tests.**

## Performance
- **Duration:** 30min
- **Started:** 2026-11-10T14:36 local
- **Completed:** 2026-11-10T15:06 local
- **Tasks:** 2
- **Files modified:** 12 (3 plan files + 9 regenerated Prisma client files)

## Accomplishments
- Three alert tables live in PostgreSQL with CHECK constraints, dedup unique index, and three guard triggers — tampering (T-09-01/T-09-02) and delivery repudiation (T-09-03) mitigated at the database layer
- 7/7 integration tests green against real PostgreSQL: audit-table UPDATE/DELETE rejection, OpsAlert identity/dedupFingerprint immutability, guarded severity change, dedup upsert convergence to one OPEN row with count bump, acknowledge idempotency with exactly one transition row
- `prisma validate` passes; migration recorded in `_prisma_migrations` (migrate status: up to date); CI schema gate input unchanged and valid

## Task Commits
Each task was committed atomically:
1. **Task 1 (tracer): OpsAlert schema + guarded migration + apply to dev DB** - `9e58d15` (feat)
2. **Task 2: Mutation-rejection tests** - `8a52913` (test)
3. **Rule 3 fix: regenerated Prisma client** - `c3d0f6d` (chore)

**Plan metadata:** committed together with STATE/ROADMAP updates (docs commit).

## Files Created/Modified
- `packages/database/prisma/schema.prisma` - OpsAlert, OpsAlertTransition, OpsAlertDelivery models (BackupRun style)
- `packages/database/prisma/migrations/20261108_phase09_ops_alerts/migration.sql` - DDL + CHECK constraints + three guard triggers
- `tests/integration/alerts.test.ts` - 7 real-Postgres cases (mutation rejection, dedup, acknowledge idempotency)
- `packages/database/src/generated/prisma/**` - regenerated client exposing the three new delegates (tracked artifact, phase 08 precedent)

## Decisions Made
- Guarded transition trigger on OpsAlert instead of blanket append-only (plan prohibition honored): identity columns frozen, DELETE rejected, severity/status/count/lastSeen/acknowledgedAt/resolvedAt mutable
- ALRT-02 requirement checkbox left open — shared with Plan 09-02 per the shared-ID gate (`requirements.ready-ids` reports it blocked)
- Verification used a direct pg-client check script instead of `psql -d "$DATABASE_URL"` (secret guard blocks env reads into commands); assertion coverage is equivalent (tables, triggers, indexes, constraints)

## Deviations from Plan
**1. [Rule 3 - Blocking] Regenerated Prisma client committed**
- **Found during:** Task 2
- **Issue:** The tracked generated client (`packages/database/src/generated/prisma/**`) did not know the new models, so the committed `alerts.test.ts` (`prisma.opsAlert.*` delegates) would fail typecheck/CI
- **Fix:** Ran `prisma generate` and committed the regenerated client (same pattern as phase 08 model commits 6420d25/14ec02a)
- **Files modified:** packages/database/src/generated/prisma/** (6 modified, 3 created)
- **Verification:** `pnpm --filter @bet-stats/database run typecheck` exit 0
- **Commit:** `c3d0f6d`

**2. [Note - Process] Prior interrupted executor session artifacts found**
- **Found during:** Task 1 precondition check
- **Issue:** Working tree already contained uncommitted schema.prisma edits, the finished migration.sql, and tmp helper scripts from an earlier 09-01 attempt (no commits existed)
- **Fix:** Verified the artifacts against every Task 1 acceptance criterion (validate, tables, triggers, constraints, migrate status), then committed them as Task 1; tmp helpers deleted after use
- **Commit:** `9e58d15`

**Total deviations:** 2 auto-handled (1 Rule 3 fix, 1 process note). **Impact on plan:** none — acceptance criteria unchanged; generated-client commit is required for the plan's own tests to compile.

## Issues Encountered
- `prisma db execute` fails with a spurious P1014 ("table for model opsalert does not exist") when the SQL contains `'OpsAlert'::regclass` string casts — worked around with a direct pg-client check; worth knowing for future migration verifiers
- `vitest run` in this executor shell hangs indefinitely (non-TTY forks pool / stdin); fixed with `CI=true` + `< NUL` stdin — **future verifiers should run integration vitest with `CI=1`** (plain node/Prisma DB access was fast throughout)
- `prisma.config.ts` requires DATABASE_URL even for `prisma generate` — env must be loaded first

## TDD Gate Compliance
- RED: `test(09-01)` commit `8a52913` — target tests did NOT fail on first run (7/7 immediate GREEN). Investigation (per tdd.md error handling): the feature under test is the Task 1 tracer deliverable — tables + triggers were deliberately implemented and committed (`feat(09-01)` `9e58d15`) before Task 2's tests. A genuine RED is impossible without destructively dropping the applied migration; INVALID_RED (missing-table crashes) would not satisfy the RED evidence rules either.
- GREEN: implementation commit `9e58d15` precedes the test commit (inverted vs canonical order — plan structure is tracer-first); gate flagged per fail-fast rule 3.
- REFACTOR: no changes needed.
- The 7 cases prove Task 1's `<done>` criteria (mutation rejection, dedup, acknowledge idempotency) against real PostgreSQL.

## Issues Deferred
None — no stubs, skipped tests, or unrun verifications.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema is the durable alert state Plan 02's five signal adapters upsert into (dedupFingerprint = signal\0scope per plan contract)
- `prisma.opsAlert/opsAlertTransition/opsAlertDelivery` delegates available for the evaluator and the Plan 03 API read model
- Integration harness note: run vitest with `CI=true` in non-interactive shells to avoid the hang documented above

---
*Phase: 09-degradation-alerting*
*Completed: 2026-11-10*
