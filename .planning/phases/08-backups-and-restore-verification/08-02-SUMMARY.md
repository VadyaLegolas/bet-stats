---
phase: 08-backups-and-restore-verification
plan: 02
subsystem: infra
tags: [postgres, prisma, bullmq, docker, pg_restore, restore-drill, chain-integrity, scheduler, append-only]

# Dependency graph
requires:
  - phase: 08-01 (backup engine)
  provides: "readBackupConfig, runBackup/pg_dump engine, BackupRun receipts, bet-stats-backup queue factories, resolvePgIdentity/resolvePgTools, spawnBackupExec, nodeBackupFs, scheduleBackupTick pattern"
provides:
  - "Append-only BackupVerificationReceipt table with frozen trigger (immutable drill evidence, D-12)"
  - "runBackupDrill: dump -> owned throwaway postgres:18-alpine -> pg_restore -> migrations at head -> chain-integrity checks -> receipt (fail-closed at every step)"
  - "captureSourceCounts + runChainIntegrityChecks: UNION ALL parity baseline, non-empty keyed on source counts, generic pg_constraint FK-orphan scan, curated supersession checks"
  - "scheduleDrillTick: weekly persisted-state drill scheduler armed from the newest verification receipt; 'drill' job dispatch on the existing backup queue"
affects: [08-03-operations-visibility, 9-degradation-alerting]

# Actuals (#2632) — pairs with the plan's estimate (tokens 95000 / raw 47500).
# Same estimateTokens scale: chars/4 over the realized hand-written diff (73,800 chars);
# the regenerated Prisma client (machine output) is excluded from the measure.
actuals:
  tokens: 18450
  tasks: 3
  commits: 7
  plan_head_before: df0e24a6d8c60bed56df1dc483ad9127eb901f0c
  plan_head_after: 8b5aa5bb1718a47b08b88abc6600069ac7a3ef54

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chain-integrity evidence embedded in the append-only receipt checks JSON (nonEmpty/fkOrphans/curated/parity + sourceCounts baseline)"
    - "Generic FK-orphan scan driven by pg_constraint with per-key IS NOT NULL guards (zero hardcoding, survives future migrations)"
    - "Fail-closed drill states: every missing precondition -> UNVERIFIED receipt, every failed step/check -> FAILED; VERIFIED only when every executed check passed"
    - "Persisted-state-armed drill tick: newest receipt completedAt + BACKUP_DRILL_INTERVAL_HOURS (default 168h); no receipt -> idle-poll (never-verified deployments self-verify)"

key-files:
  created:
    - "packages/database/prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql"
    - "tests/unit/backup-drill.test.ts (21 cases: fail-closed drill states, chain-integrity contracts, scheduler, dispatch)"
  modified:
    - "packages/database/prisma/schema.prisma (BackupVerificationReceipt model)"
    - "workers/data-sync/src/jobs/backup-drill.ts (captureSourceCounts, runChainIntegrityChecks, scheduleDrillTick, drill query wiring)"
    - "workers/data-sync/src/jobs/backup.ts (enqueueDrill, createBackupJobDispatcher, worker dispatch)"
    - "workers/data-sync/src/main.ts (drill dispatch + drill tick wiring, both close()s, drillIntervalHours in backup.armed)"
    - "tests/integration/backup-restore-drill.test.ts (full-drill case asserts chain-integrity entries)"
    - "tests/integration/mutation-rejection.test.ts (BackupRun + BackupVerificationReceipt UPDATE/DELETE rejection)"

key-decisions:
  - "Any drill outcome (VERIFIED/FAILED/UNVERIFIED) resets the weekly cadence — the scheduler arms from the newest BackupVerificationReceipt regardless of overall, so a failing deployment drills again weekly rather than never"
  - "Source-count capture failure is UNVERIFIED/SOURCE_COUNTS_UNAVAILABLE with no container started (missing precondition), distinct from CHAIN_INTEGRITY_FAILED for restored-DB check failures"
  - "nonEmpty fails only on source-positive/restored-zero; the truncation signal (restored < captured) lives in parity — matches the plan's (a)/(d) split and Pitfall 7"
  - "FK-orphan predicate adds per-key IS NOT NULL guards to the research-Q5 predicate: a NULL FK column is not an orphan, and nullable supersedes*Id keys would otherwise false-fail every real deployment"
  - "createBackupJobDispatcher extracted from createBackupWorker so job-name routing is unit-provable without a Redis connection"
  - "redactDrillExcerpt scrubs whole connection URLs to [REDACTED_URL] (scheme prefix no longer survives into the checks JSON)"

patterns-established:
  - "Receipt-as-audit-trail: per-check evidence persisted inside the immutable receipt's checks JSON, not just logged"
  - "Injected query-function style (DrillSqlQuery) shared by source capture and throwaway checks — retention-purge repository symmetry"
  - "Structural copy of the persisted-state setTimeout scheduler for a second cadence (drill tick), same now/setTimeout/clearTimeout/onError surface"

requirements-completed: [BAK-02]

# Coverage metadata (#1602) — drives deterministic UAT routing in verify-work.
coverage:
  - id: D1
    description: "Append-only BackupVerificationReceipt model with frozen trigger migration (overall/failureReason/containerCleanup/checks columns)"
    requirement: BAK-02
    verification:
      - kind: integration
        ref: "tests/integration/mutation-rejection.test.ts#rejects BackupVerificationReceipt mutation and removal as immutable (UPDATE/DELETE match /immutable/i against real postgres:18-alpine)"
        status: pass
    human_judgment: false
  - id: D2
    description: "runBackupDrill restores the newest local dump into an owned throwaway container, migrates to head, destroys the container and appends one VERIFIED receipt"
    requirement: BAK-02
    verification:
      - kind: integration
        ref: "tests/integration/backup-restore-drill.test.ts#restores the newest dump into an owned throwaway container... (real dump, container absent from docker ps --all after run, checks JSON carries nonEmpty/fkOrphans/curated/parity)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fail-closed drill: Docker absence, unresolved pg identity, restore errors, parity regressions and broken chains all surface as UNVERIFIED/FAILED receipts — the drill can never silently pass"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#runBackupDrill fail-closed states (docker spawn ENOENT -> DOCKER_UNAVAILABLE no container; identity -> no pg_restore; restore non-zero -> redacted excerpt; restored<captured -> FAILED; fk orphans -> FAILED)"
        status: pass
      - kind: integration
        ref: "tests/integration/backup-restore-drill.test.ts (NO_BACKUP_FOUND and PG_IDENTITY_UNRESOLVED receipts, no container started)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Row-count parity fails only on restored < captured; positive deltas recorded; zero-source canonical tables SKIPPED, never PASSED"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts (restored>captured -> VERIFIED delta +2; zero-source -> SKIPPED; equal -> PASSED) + runChainIntegrityChecks parity contract"
        status: pass
    human_judgment: false
  - id: D5
    description: "Weekly persisted-state drill scheduler and 'drill' worker dispatch on the bet-stats-backup queue (trigger-only payload, concurrency 1, clean close)"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#drill tick scheduler (7 cases) + #backup worker job dispatch (2 cases); tests/unit/backup-job.test.ts (Plan 01 suite stays 17/17); tests/unit/worker-entry-guard.test.ts (no import-time arming)"
        status: pass
      - kind: integration
        ref: "pnpm typecheck 7/7; workers/data-sync dist rebuilt and entry-guard re-run green"
        status: pass
    human_judgment: true
    rationale: "Scheduler and dispatch logic are unit-proven and the composition-root wiring is typecheck- and entry-guard-proven, but live weekly arming against the operator's real Redis/Docker stack must not be done by this executor; the live 'Drill now' operator check belongs to Plan 03."
  - id: D6
    description: "Chain-integrity checks: non-empty keyed on source counts, generic pg_constraint FK-orphan scan, curated supersession checks (ForecastSnapshot/ValueReceipt/SettlementReceipt)"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#runChainIntegrityChecks (pg_constraint catalog + per-relation orphan SQL with IS NOT NULL guards; curated violations flip state FAILED)"
        status: pass
      - kind: integration
        ref: "tests/integration/backup-restore-drill.test.ts full-drill case: fkOrphans PASSED, curated PASSED, nonEmpty/parity entries present in the real restored database"
        status: pass
    human_judgment: false

# Metrics
duration: 40min
completed: 2026-10-23
status: complete
---

# Phase 8 Plan 02: Restore Drill and Verification Receipts Summary

**Immutable BackupVerificationReceipt + fail-closed restore drill: newest local dump restored into an owned throwaway postgres:18-alpine container, migrations proven at head, chain-integrity checks (non-empty/FK-orphan/curated/parity) recorded in the receipt, weekly persisted-state drill scheduler wired into the backup worker**

## Performance

- **Duration:** ~40 min (Task 1 executed by a prior executor session on 2026-10-22 ~21:00Z; Tasks 2-3 + summary on 2026-10-23 13:00-13:35Z)
- **Started:** 2026-10-22T20:53Z (Task 1 commit 6420d25); resumed 2026-10-23T13:00Z
- **Completed:** 2026-10-23T13:35Z
- **Tasks:** 3
- **Files modified:** 8 (hand-written; regenerated Prisma client excluded)

## Accomplishments

- `BackupVerificationReceipt` is append-only by the database itself — hand-authored migration with `guard_backup_verification_receipt()` frozen trigger; UPDATE/DELETE rejection proven in the integration mutation suite alongside `BackupRun`.
- `runBackupDrill` is fail-closed end-to-end: no backup -> UNVERIFIED `NO_BACKUP_FOUND`; unresolved pg identity -> UNVERIFIED `PG_IDENTITY_UNRESOLVED` with no container started; docker spawn failure -> UNVERIFIED `DOCKER_UNAVAILABLE`; restore error -> FAILED with a redacted, length-bounded stderr excerpt; pending migrations -> UNVERIFIED; any failed chain check -> FAILED `CHAIN_INTEGRITY_FAILED`. VERIFIED requires every executed check to pass (T-08-08).
- Chain-integrity evidence lives in the immutable receipt checks JSON: `sourceCounts` baseline captured at drill start (one UNION ALL pass), `nonEmpty` keyed on source counts (zero-source tables SKIPPED, never PASSED), `fkOrphans` from a generic pg_constraint-driven scan with per-key IS NOT NULL guards, `curated` supersession checks (ForecastSnapshot pointers, ValueReceipt fixture compatibility, SettlementReceipt revisions > 1), and `parity` failing only on restored < captured with positive deltas recorded (Pitfall 7).
- TDD Task 2: RED (10 failing behavior tests, evidence persisted in red-evidence-08-02-task2.json, 2 deliberate guard cases green) -> GREEN (`captureSourceCounts`, `runChainIntegrityChecks`, drill query handle wired and disconnected in finally).
- `scheduleDrillTick` arms weekly from the newest verification receipt (`BACKUP_DRILL_INTERVAL_HOURS`, default 168h), idle-polls when no receipt exists (a never-verified deployment drills soon after worker start), enqueues `{ trigger: "SCHEDULED" }` only, and re-arms from persisted state; `createBackupJobDispatcher` routes "drill"/"backup" on the concurrency-1 worker and fails closed otherwise; `main.ts` arms both ticks only on the enabled path and closes both.

## Task Commits

Each task was committed atomically (ledger base `df0e24a`; 7 commits measured via `git rev-list --count df0e24a..HEAD`):

1. **Task 1: Tracer — model, migration, drill engine, full-drill integration** — `6420d25` (feat: BackupVerificationReceipt + frozen-trigger migration + regenerated client), `7837ce3` (feat: runBackupDrill fail-closed engine + full-drill integration case) — *executed by the prior executor session before it terminated*
2. **Task 2 (TDD): chain-integrity checks, fail-closed receipts, immutability proof** — `47f1739` (test: RED), `7ebdd88` (feat: GREEN), `b42bd81` (test: integration immutability + enriched drill checks)
3. **Task 3: weekly drill scheduler and worker dispatch wiring** — `b771cb7` (feat: scheduleDrillTick + dispatch + main.ts), `8b5aa5b` (test: scheduler + dispatch unit cases)

**Plan metadata:** docs commit for this SUMMARY follows separately

## TDD Gate Compliance

- **RED:** `47f1739` `test(08-02): add failing chain-integrity and fail-closed drill behavior tests` — 12 tests discovered, 10 failed on the planned behaviors (`captureSourceCounts`/`runChainIntegrityChecks` missing, drill returns VERIFIED regardless of restored counts, receipt checks JSON missing the four evidence entries); 2 passed as deliberate fail-closed guards. Evidence record: `.planning/phases/08-backups-and-restore-verification/red-evidence-08-02-task2.json` with manual `semanticAssessment: VALID RED` (machine classifier `gsd_run check tdd-red-evidence` unavailable — CLI not on PATH).
- **GREEN:** `7ebdd88` `feat(08-02): add chain-integrity checks and fail-closed receipts to the drill engine` — 12/12 pass; root `pnpm typecheck` 7/7.
- **REFACTOR:** one test-assertion correction during GREEN (nonEmpty fails only on restored-zero per the plan's (a)/(d) split; truncation asserted via parity) plus the `redactDrillExcerpt` URL-scrub tightening — both recorded under Deviations.

## Files Created/Modified

- `packages/database/prisma/schema.prisma` — `BackupVerificationReceipt` model (nullable backupFileName, checks Json, containerCleanup/overall CHECKs in DDL)
- `packages/database/prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql` — table + `BackupVerificationReceipt_guarded_append_only` frozen trigger
- `packages/database/src/generated/prisma/*` — regenerated client (machine output, prior session)
- `workers/data-sync/src/jobs/backup-drill.ts` — `runBackupDrill` (7-step fail-closed procedure), `captureSourceCounts`, `runChainIntegrityChecks`, `redactDrillExcerpt`, `resolvePrismaProjectRoot`, `scheduleDrillTick`
- `workers/data-sync/src/jobs/backup.ts` — `createBackupQueue.enqueueDrill`, `createBackupJobDispatcher`, extended `createBackupWorker`
- `workers/data-sync/src/main.ts` — drill dispatch + `scheduleDrillTick` wiring, both `close()`s in shutdown, `drillIntervalHours` in `backup.armed`, disabled path unchanged
- `tests/unit/backup-drill.test.ts` — 21 cases (fail-closed states, chain-integrity contracts, scheduler, dispatch)
- `tests/integration/backup-restore-drill.test.ts` — full-drill case now asserts sourceCounts/nonEmpty/fkOrphans/curated/parity in the receipt
- `tests/integration/mutation-rejection.test.ts` — UPDATE/DELETE rejection cases for both receipt tables

## Decisions Made

- **Cadence reset by any receipt:** the drill tick arms from the newest `BackupVerificationReceipt.completedAt` regardless of `overall` — a FAILED/UNVERIFIED drill is still a drill that ran, so the weekly retry cadence holds; a VERIFIED deployment stays weekly (D-10).
- **Two fail-closed reason codes:** `SOURCE_COUNTS_UNAVAILABLE` (UNVERIFIED, no container started — missing precondition, like PG_IDENTITY_UNRESOLVED) vs `CHAIN_INTEGRITY_FAILED` (FAILED — the restored database demonstrably violates integrity). Both are non-green per D-11; the split keeps the receipt diagnosable.
- **Parity vs non-empty split (plan-faithful):** non-empty fails only when source > 0 and restored == 0; restored < captured is parity's failure with the negative delta recorded — one truncation signal, no double-fail ambiguity.
- **Dispatcher extraction:** routing pulled out of the BullMQ worker callback so "drill invokes runBackupDrill exactly once / backup still invokes runBackup" is proven in unit tests without Redis.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `redactDrillExcerpt` kept the `postgresql://` scheme prefix**
- **Found during:** Task 2 GREEN (RED test asserted no `postgresql://` substring in the persisted excerpt)
- **Issue:** the first scrub regex replaced only the URL body, so `postgresql://[REDACTED]` still entered the checks JSON — weaker than the integration suite's credential-scrub convention.
- **Fix:** whole connection URL (scheme included) is replaced with `[REDACTED_URL]`; `:***@` and `password=…` scrubs unchanged.
- **Files modified:** `workers/data-sync/src/jobs/backup-drill.ts`
- **Verification:** unit case asserts excerpt contains neither `hunter2secret` nor `postgresql://` and is <= 500 chars
- **Committed in:** `7ebdd88`

**2. [Rule 2 - Missing Critical] Source-count capture failure path unspecified**
- **Found during:** Task 2 implementation — the plan required capture at drill start but named no failure state.
- **Fix:** capture failure records `checks.sourceCounts.error` and appends an UNVERIFIED receipt with reason `SOURCE_COUNTS_UNAVAILABLE` without starting a container (fail-closed, D-11).
- **Files modified:** `workers/data-sync/src/jobs/backup-drill.ts`
- **Committed in:** `7ebdd88`

**3. [Design refinement] FK-orphan predicate hardened beyond research Q5**
- **Found during:** Task 2 — Q5's `WHERE p.oid IS NULL` counts every NULL-FK row as an orphan; nullable `supersedes*Id` foreign keys exist in this schema, so the naive predicate would false-fail any real deployment.
- **Fix:** the catalog query also emits a per-key `c."col" IS NOT NULL` guard; the unit test pins the generated SQL shape.
- **Files modified:** `workers/data-sync/src/jobs/backup-drill.ts`, `tests/unit/backup-drill.test.ts`
- **Committed in:** `7ebdd88`

**4. [Rule 3 - Tooling] `gsd_run` CLI unavailable → manual state tracking**
- **Found during:** plan start / evidence classification (same as Plan 01 deviation 5)
- **Issue:** SDK state verbs (`state.advance-plan`, `roadmap.update-plan-progress`, `requirements.mark-complete`), the `windows` ledger, `check tdd-red-evidence`, and SDK `commit` are unavailable (CLI not on PATH in this executor shell).
- **Fix:** STATE.md/ROADMAP.md/REQUIREMENTS.md updated by hand with equivalent semantics; TDD RED evidence recorded as JSON with manual `semanticAssessment`; docs commit via plain `git commit`. (Mirrors plans 07-01..07-03 and 08-01.)
- **Committed in:** final docs commit of this plan

**5. [Harness note - no repo change] `prisma migrate deploy` requires cwd `packages/database`**
- **Found during:** integration verification — running the Prisma CLI from the repo root fails with `datasource.url property is required in your Prisma config file` (Prisma 7 config resolution).
- **Fix:** the executor's throwaway harness mimics `scripts/verify-release-integration.mjs` (cwd = `packages/database`, `DATABASE_URL` via env). No project file affected.

---

**Total deviations:** 5 (2 Rule 1/2 auto-fixes, 1 research-refinement hardening, 1 Rule 3 tooling, 1 harness note)
**Impact on plan:** all changes serve plan acceptance criteria; no scope creep; no packages installed (`T-08-SC` vacuously clean).

## Issues Encountered

- **Prior-session handoff:** the Task 1 tracer executor terminated after committing `6420d25`/`7837ce3`; this session resumed at Task 2 per the continuation brief, verified those commits are ancestors of HEAD, and did not redo them.
- **Pre-existing environmental failure (out of scope, unchanged):** `tests/unit/fixtures-sync.test.ts` — 7 tests fail on this machine (hardcoded placeholder DB creds for `127.0.0.1:5432/betstats-test`); already logged in `deferred-items.md` by Plan 01. Full unit run: 417/424 pass with exactly those 7 failures.

## User Setup Required

No new setup. The drill consumes the same opt-in `BACKUP_*` configuration as Plan 01 (`BACKUP_ENABLED`, `BACKUP_DIR`, optional `BACKUP_PG_USER`/`BACKUP_PG_DB`/`BACKUP_PG_CONTAINER`, `BACKUP_DRILL_INTERVAL_HOURS` default 168h) and requires Docker on the operator host. The agent never reads the secret `.env`. The live "Drill now" operator check belongs to Plan 03.

## Verification

Run on the final tree (real output excerpts):

- `pnpm vitest run --project unit tests/unit/backup-drill.test.ts` — `Test Files 1 passed (1) / Tests 12 passed (12)` (Task 2 gate)
- `pnpm vitest run --project unit tests/unit/backup-drill.test.ts tests/unit/backup-job.test.ts tests/unit/worker-entry-guard.test.ts` — `Test Files 3 passed (3) / Tests 40 passed (40)` (Task 3 gate; dist rebuilt first)
- `pnpm vitest run --project integration tests/integration/mutation-rejection.test.ts tests/integration/backup-restore-drill.test.ts` against a throwaway `postgres:18-alpine` (migrate deploy exit 0) — `Test Files 2 passed (2) / Tests 14 passed (14)`, `VITEST_EXIT=0`; `docker ps --all --filter name=bet-stats-drill-pg-` empty after the suite (owned cleanup proven)
- `pnpm typecheck` — `Tasks: 7 successful, 7 total`, exit 0
- `pnpm lint` — `Tasks: 7 successful, 7 total`, exit 0
- `pnpm verify:release:schema` — `The schema at prisma\schema.prisma is valid`, exit 0
- `pnpm vitest run --project unit` (full) — `Tests 7 failed | 417 passed (424)` — the 7 are the documented pre-existing `fixtures-sync.test.ts` environmental failures only
- Trigger present: `BackupVerificationReceipt_guarded_append_only` in the migration (grep hit), and both receipt tables reject UPDATE/DELETE in the integration suite

## Known Stubs

None. Every planned symbol (`captureSourceCounts`, `runChainIntegrityChecks`, `scheduleDrillTick`, "drill" dispatch) is implemented and tested; the live "Drill now" operator endpoint is an explicit Plan 03 deliverable, not a stub in this plan's artifacts.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes beyond the plan's registered surface (T-08-07..T-08-12, T-08-SC). Mitigations verified: credentials reach pg/docker children only via env; job payload is trigger-only; excerpts are redacted and length-bounded before persistence; container names are owned-unique with `rm --force` in a finally block; receipt tables are database-enforced append-only. Note: `gsd_run windows append` unavailable (CLI not on PATH) — no Known Stubs or unrun verifies exist, so the ledger would have been empty.

## Next Phase Readiness

- Plan 08-03 (operations visibility) can read `BackupRun` + `BackupVerificationReceipt`; its "Drill now"/"Backup now" endpoints provide the live operator checks deferred from Plans 01/02.
- Deferred: `tests/unit/fixtures-sync.test.ts` environmental red — see `deferred-items.md`.
- No blockers.

## Self-Check: PASSED

All key files found (`schema.prisma` model, migration SQL with trigger, backup-drill.ts with all four planned exports, main.ts wiring, 4 test files); all 7 plan commits (`6420d25`, `7837ce3`, `47f1739`, `7ebdd88`, `b42bd81`, `b771cb7`, `8b5aa5b`) are ancestors of HEAD; measured `commits: 7` matches `git rev-list --count df0e24a..HEAD` at SUMMARY write; verification commands above were executed on this tree with the recorded outputs.

---
*Phase: 08-backups-and-restore-verification*
*Completed: 2026-10-23*
