---
phase: 08-backups-and-restore-verification
plan: 01
subsystem: infra
tags: [postgres, prisma, bullmq, pg_dump, robocopy, docker, backup, scheduler]

# Dependency graph
requires: []
provides:
  - "Fail-closed readBackupConfig (BACKUP_* keys, absolute dirs, bounded retention/drill intervals)"
  - "Append-only BackupRun table with frozen trigger + reason/offsiteError reason codes"
  - "runBackup: atomic pg_dump -Fc dump (.partial → sha256 → rename → receipt), fail-closed pg tooling + identity resolution"
  - "Retention rotation (keep newest BACKUP_RETENTION_COUNT) and robocopy off-host copy with bitmask exit handling"
  - "bet-stats-backup queue (no v5 repeat API) + scheduleBackupTick persisted-state daily scheduler + main.ts wiring"
affects: [08-02-restore-drill, 08-03-operations-visibility, 9-degradation-alerting]

# Actuals (#2632) — pairs with the plan's estimate (tokens 90000 / raw 45000).
# Same estimateTokens scale: chars/4 over the realized hand-written diff (66,549 chars);
# the regenerated Prisma client (machine output) is excluded from the measure.
actuals:
  tokens: 16637
  tasks: 3
  commits: 9
  plan_head_before: 9ae9de84d15a83ffba1ee380ce67ff9a136ba92e
  plan_head_after: 9c8ad16eb2f7f25b0acd1b0c94e5ee2026b2f6af

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed config reader: literal true/1 opt-in, absolute paths else undefined, bounded integers with defaults"
    - "Append-only audit rows via PostgreSQL frozen trigger (guard_backup_run) instead of application-level discipline"
    - "Atomic local backup: dot-prefixed .partial → streamed sha256 → rename → single receipt row"
    - "robocopy exit bitmask interpretation (<8 success, ≥8 failure) with bounded /R:2 /W:5 retries"
    - "Persisted-state-armed scheduler: delay = latest SUCCEEDED completedAt + interval − now (no cron, no BullMQ repeat)"

key-files:
  created:
    - "workers/data-sync/src/jobs/backup.ts (backup engine, queue factories, scheduler)"
    - "packages/database/prisma/migrations/20261022_phase08_backup_runs/migration.sql"
    - "tests/integration/backup-restore-drill.test.ts"
    - "tests/unit/backup-job.test.ts"
  modified:
    - "packages/config/src/index.ts (readBackupConfig)"
    - "packages/database/prisma/schema.prisma (BackupRun model)"
    - "workers/data-sync/src/main.ts (startBackupRuntime wiring)"
    - "README.md (operator privacy/ACL note)"
    - "vitest.config.ts (unit project workspace aliases)"

key-decisions:
  - "SUCCEEDED receipt is appended AFTER the off-host copy so the immutable BackupRun row carries the final offsiteStatus (COPIED/DEGRADED/NOT_CONFIGURED); prune runs after the receipt"
  - "Added BACKUP_PG_CONTAINER config key: the docker-exec fallback and hermetic tests need a container target the plan's key list omitted"
  - "Added BackupRun.reason column: the plan's FAILED-row acceptance requires asserting safe reason codes (PG_IDENTITY_UNRESOLVED etc.) on the row itself"
  - "docker pg_dump argv omits -f -: postgres 18 treats '-f -' as a literal file named '-', the archive streams via stdout only when -f is absent"
  - "Retention prune keeps the newest retentionCount matching dumps overall (final count == retentionCount per <done>), so a failed dump can never shrink the window"

patterns-established:
  - "Fail-closed backup identity: config keys → docker exec printenv → FAILED row without invoking pg_dump (never hardcoded roles)"
  - "Bitmask-not-boolean exit handling for robocopy with safe error classification in offsiteError"
  - "Daily tick armed from persisted state, self-healing across restarts (shared shape with scheduleRetentionPurge)"

requirements-completed: [BAK-01]

# Coverage metadata (#1602) — drives deterministic UAT routing in verify-work.
coverage:
  - id: D1
    description: "Fail-closed readBackupConfig for opt-in backups (BACKUP_* keys, absolute dirs, bounded retention/drill intervals)"
    requirement: BAK-01
    verification:
      - kind: unit
        ref: "packages/config/src/index.test.ts (13 cases: enabled literals, absolute-path rejection, retention 1..365 default 14, drill default 168, PG pass-throughs)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Append-only BackupRun model with frozen trigger migration (status/offsiteStatus/trigger CHECKs, reason codes)"
    requirement: BAK-01
    verification:
      - kind: integration
        ref: "tests/integration/backup-restore-drill.test.ts#migrate deploy applies the trigger onto an owned postgres:18-alpine + pnpm verify:release:schema"
        status: pass
    human_judgment: false
  - id: D3
    description: "runBackup orchestration: atomic pg_dump -Fc dump with durable SUCCEEDED/FAILED receipts, fail-closed tooling and identity resolution"
    requirement: BAK-01
    verification:
      - kind: integration
        ref: "tests/integration/backup-restore-drill.test.ts (3/3: SUCCEEDED dump+sha256 recompute, DUMP_FAILED, PG_IDENTITY_UNRESOLVED)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Retention rotation after success + robocopy off-host copy with bitmask-correct exit handling"
    requirement: BAK-01
    verification:
      - kind: unit
        ref: "tests/unit/backup-job.test.ts (robocopy 0/1/3/7→COPIED, 8/16/ENOENT→DEGRADED, unset→NOT_CONFIGURED, prune ordering, exact /R:2 /W:5 argv)"
        status: pass
    human_judgment: false
  - id: D5
    description: "bet-stats-backup queue, daily persisted-state scheduler and worker composition-root wiring (live arming on the operator stack)"
    requirement: BAK-01
    verification:
      - kind: unit
        ref: "tests/unit/backup-job.test.ts#backup tick scheduler (5 cases) + tests/unit/worker-entry-guard.test.ts"
        status: pass
    human_judgment: true
    rationale: "Scheduler/queue logic is unit-proven and the wiring is typecheck- and entry-guard-proven, but live tick arming against real Redis requires the operator's running stack, which this executor must not touch; the plan's live operator check belongs to Plan 03 ('Backup now')."

# Metrics
duration: 70min
completed: 2026-10-22
status: complete
---

# Phase 8 Plan 01: Backup Engine Summary

**Fail-closed pg_dump backup engine: atomic dumps with append-only receipts, retention rotation, robocopy off-host copies, and a persisted-state daily scheduler wired into the data-sync worker**

## Performance

- **Duration:** 70 min
- **Started:** 2026-10-22T19:07:36Z
- **Completed:** 2026-10-22T20:17Z
- **Tasks:** 3
- **Files modified:** 18 (7 of them regenerated Prisma client files)

## Accomplishments

- `readBackupConfig` fails closed: backups only run on literal `true`/`1`, directories must be absolute, retention 1..365 (default 14), drill interval default 168h; pg identity keys pass through trimmed.
- `BackupRun` is append-only by the database itself — hand-authored migration with `guard_backup_run()` frozen trigger, CHECKs on status/offsiteStatus/trigger, plus `reason`/`offsiteError` safe reason-code columns; `pnpm verify:release:schema` green.
- `runBackup` produces a real non-empty `football_prediction-<UTC>.dump` through an owned `postgres:18-alpine` drill: `.partial` → streamed sha256 → atomic rename → single SUCCEEDED receipt; failure paths record FAILED reason codes (`DUMP_FAILED`, `PG_IDENTITY_UNRESOLVED`, `PG_TOOLING_UNAVAILABLE`, `BACKUP_*`) and delete nothing.
- TDD Task 2: RED (9 failing behavior tests, semantic evidence persisted) → GREEN (`copyOffsite` + `pruneBackupRetention` wired into `runBackup`); robocopy 0/1/3/7 → COPIED, 8/16/ENOENT → DEGRADED with the code in `offsiteError` while the backup stays SUCCEEDED, unset offsite → NOT_CONFIGURED without ever spawning robocopy.
- `bet-stats-backup` queue + `scheduleBackupTick` (armed from the latest SUCCEEDED `completedAt` + 24h, idle-poll before first success, retry/onError, no BullMQ v5 `repeat` API) wired into `main.ts` behind `startBackupRuntime`, preserving the `isDirectExecution` entry guard.
- README operator note (Russian): BACKUP_* key table plus the privacy reality that dumps remain recoverable up to `BACKUP_RETENTION_COUNT` days after erasure — ACL-harden `BACKUP_DIR`, use an encrypted `BACKUP_OFFSITE_DIR` destination.

## Task Commits

Each task was committed atomically (ledger base `9ae9de8`; 9 commits measured via `git rev-list --count 9ae9de8..HEAD`):

1. **Task 1: fail-closed config + append-only schema + runBackup tracer + integration drill** — `ca10b4c` (feat), `14ec02a` (feat), `788f42e` (feat), `197a423` (feat: drill + docker stdout fix), `875942a` (docs: README operator note)
2. **Task 2 (TDD): retention rotation + robocopy off-host** — `8cf7be6` (test: RED, 9 failing cases), `0d755ad` (feat: GREEN)
3. **Task 3: bet-stats-backup queue, persisted-state scheduler, main.ts wiring** — `713b989` (feat: queue + scheduler + unit tests), `9c8ad16` (feat: composition-root wiring)

**Plan metadata:** (docs commit for this SUMMARY follows separately)

## TDD Gate Compliance

- **RED:** `8cf7be6` `test(08-01): add failing test for retention rotation and robocopy off-host` — 11 tests discovered, 9 failed on the planned assertions (`expected 'NOT_CONFIGURED' to be 'COPIED'/'DEGRADED'`, robocopy never invoked, 16 dumps not pruned to 14); 2 passed as deliberate guard cases. Evidence record: `.planning/phases/08-backups-and-restore-verification/red-evidence-08-01-task2.json` with manual `semanticAssessment: VALID RED` (machine classifier `gsd_run check tdd-red-evidence` unavailable — CLI not on PATH).
- **GREEN:** `0d755ad` `feat(08-01): implement retention rotation and robocopy off-host copy` — 11/11 pass; root `pnpm typecheck` 7/7.
- **REFACTOR:** not needed (implementation landed clean; tests untouched after GREEN aside from two win32 path-separator harness fixes recorded under Deviations).

## Files Created/Modified

- `packages/config/src/index.ts` + `index.test.ts` — `readBackupConfig`/`BackupConfig` + 13 unit tests
- `packages/database/prisma/schema.prisma` — `BackupRun` model (reason/offsiteError/dbVersion columns)
- `packages/database/prisma/migrations/20261022_phase08_backup_runs/migration.sql` — table + CHECKs + `BackupRun_guarded_append_only` frozen trigger
- `packages/database/src/generated/prisma/*` — regenerated client (BackupRun model)
- `workers/data-sync/src/jobs/backup.ts` — config gate, `resolvePgTools`/`resolvePgIdentity` (fail-closed), `spawnBackupExec` (argv arrays, env-only creds, timeouts), `runBackup`, `copyOffsite`, `pruneBackupRetention`, `backupQueue`/`createBackupQueue`/`createBackupWorker`, `scheduleBackupTick`
- `workers/data-sync/src/main.ts` — `startBackupRuntime` + `start()` wiring with shutdown close and `backup.disabled`/`backup.armed` structured logs
- `tests/integration/backup-restore-drill.test.ts` — owned postgres:18-alpine hermetic drill (3 cases)
- `tests/unit/backup-job.test.ts` — rotation/robocopy/queue/scheduler unit suite (17 cases)
- `vitest.config.ts` — unit project workspace aliases (mirrors the integration project)
- `README.md` — operator privacy/ACL note in the backup section

## Decisions Made

- **Receipt after copy:** `BackupRun` is immutable (frozen trigger), so the single SUCCEEDED receipt is appended after the off-host copy to carry the final `offsiteStatus`; prune runs after the receipt. This resolves the plan's ordering tension (action text said "after rename and receipt append" while acceptance requires the row to carry `COPIED`/`DEGRADED`).
- **Identity never hardcoded:** docker path resolves role/db from `BACKUP_PG_USER`/`BACKUP_PG_DB` config first, then `docker exec printenv`; both missing ⇒ FAILED `PG_IDENTITY_UNRESOLVED` without invoking pg_dump.
- **Robocopy is an injectable exec call** (not a platform branch): on non-Windows hosts an unconfigured offsite never spawns it; a spawn failure degrades honestly (D-06).
- **Retention test arithmetic resolved** to `<done>` semantics: prune keeps the newest `retentionCount` matching dumps overall (final count == retentionCount); the acceptance's "16 pre-existing → deletes exactly the 2 oldest" is realized by 15 seeded dumps + the just-written dump = 16 matching at prune time (plus a stray non-matching file proving the pattern filter).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `BACKUP_PG_CONTAINER` config key**
- **Found during:** Task 1 (tracer runBackup docker-exec path)
- **Issue:** The plan's docker-exec fallback ("exec into the configured application postgres container") and the hermetic test's deterministic container targeting need a container name; the plan's key list omitted it.
- **Fix:** New optional `BACKUP_PG_CONTAINER` key in `readBackupConfig` (trimmed pass-through) + unit test.
- **Files modified:** `packages/config/src/index.ts`, `packages/config/src/index.test.ts`
- **Verification:** config unit suite 13/13
- **Committed in:** `ca10b4c`

**2. [Rule 2 - Missing Critical] Added `BackupRun.reason` column**
- **Found during:** Task 1
- **Issue:** Plan acceptance requires asserting safe reason codes (`PG_IDENTITY_UNRESOLVED`, `DUMP_FAILED`) on the persisted FAILED row, but the planned column set had no reason field.
- **Fix:** `reason String? @db.VarChar(128)` + hand-authored migration column.
- **Files modified:** `packages/database/prisma/schema.prisma`, migration SQL, regenerated client
- **Verification:** `prisma validate` green; drill asserts `reason` on rows
- **Committed in:** `14ec02a`

**3. [Rule 1 - Bug] docker pg_dump produced an empty dump (`-f -` regression)**
- **Found during:** Task 1 tracer gate (integration drill returned `DUMP_EMPTY`)
- **Issue:** On postgres 18.6 `pg_dump … -f -` writes to a literal file named `-` inside the container (exit 0, zero stdout bytes) — verified against a throwaway container. The plan never mandated `-f -`; it requires `--format=custom --no-password` with explicit `-U`/`-d`.
- **Fix:** Docker argv omits `-f -`; the archive streams through stdout (documented default when `-f` is absent). Test argv assertion updated; comment added at the argv.
- **Files modified:** `workers/data-sync/src/jobs/backup.ts`, `tests/integration/backup-restore-drill.test.ts`
- **Verification:** integration drill 3/3 green (real dump + sha256 recompute)
- **Committed in:** `197a423`

**4. [Rule 3 - Blocking] vitest unit project lacked workspace aliases**
- **Found during:** Task 2 RED (test file failed to load: `Cannot find package '@bet-stats/config'`)
- **Issue:** Root `resolve.alias` does not propagate into `defineProject` entries; the integration project repeats the aliases, the unit project had none.
- **Fix:** Mirrored the existing alias block onto the unit project.
- **Files modified:** `vitest.config.ts`
- **Verification:** RED run then discovered and executed all 11 tests
- **Committed in:** `8cf7be6`

**5. [Rule 3 - Tooling] `gsd_run` CLI unavailable → manual state tracking**
- **Found during:** plan start / RED evidence classification
- **Issue:** `gsd_run`/`gsd-tools` are not on PATH in this executor shell, so SDK state verbs (`state.advance-plan`, `roadmap.update-plan-progress`, `requirements.mark-complete`), the `windows` ledger, `check tdd-red-evidence`, and SDK `commit` are unavailable.
- **Fix:** STATE.md/ROADMAP.md/REQUIREMENTS.md updated by hand with equivalent semantics; TDD RED evidence recorded as JSON with a manual `semanticAssessment`; final docs commit via plain `git commit`. (This mirrors how plans 07-01..07-03 were completed.)
- **Verification:** manual diff review of each edited tracking file before commit
- **Committed in:** final docs commit of this plan

**6. [Plan inconsistency - resolved] Task 2 acceptance arithmetic vs `<done>`**
- **Found during:** Task 2 GREEN
- **Issue:** "16 pre-existing dumps + retention 14 ⇒ deletes exactly the 2 oldest" cannot hold together with `<done>`'s "prunes to the configured count" when the just-written dump also lands (17 files ⇒ 3 deletions).
- **Fix:** Implemented `<action>`/`<done>` semantics (keep newest `retentionCount` overall); the unit test realizes the acceptance figure with 15 seeded dumps + the new dump = 16 matching at prune time (2 oldest deleted) and additionally proves non-matching files are never touched.
- **Committed in:** `0d755ad`

---

**Total deviations:** 6 auto-fixed (2 Rule 2, 1 Rule 1, 2 Rule 3/tooling, 1 plan-inconsistency resolution)
**Impact on plan:** All changes serve plan acceptance criteria or unblock execution; no scope creep; no packages installed (`T-08-SC` vacuously clean).

## Issues Encountered

- **Tracer gate:** first end-to-end drill run failed `DUMP_EMPTY` → root-caused to pg_dump 18 `-f -` semantics (fixed inline per Rule 1, auto mode), re-ran the full `<verify>` end-to-end (integration 3/3, config 13/13, schema valid, trigger present, typecheck clean) before expanding to Tasks 2/3.
- **GREEN harness fixes:** fake-fs `list()` and the `/LOG+:` assertion assumed posix separators; on win32 `path.dirname` normalizes `\` — assertions kept behavioral intent, harness made platform-neutral (CI ubuntu unaffected).
- **Pre-existing environmental failure (out of scope):** `tests/unit/fixtures-sync.test.ts` fails on this machine with `Authentication failed against the database server … credentials for 'user' are not valid` (test hardcodes `user:pass@127.0.0.1:5432/betstats-test`). Full unit suite: 396/403 pass; the 7 failures are unrelated to this plan (relative imports only — proven unaffected by the alias change). Logged in `deferred-items.md`; `pnpm test` therefore exits non-zero for this pre-existing reason only.

## User Setup Required

No generated USER-SETUP.md — operator opt-in lives in the plan's `user_setup` frontmatter: set `BACKUP_ENABLED=true` and `BACKUP_DIR` (absolute) in the secret `.env` consumed by `scripts/app-lifecycle.ps1`; optionally `BACKUP_OFFSITE_DIR`, `BACKUP_PG_USER`/`BACKUP_PG_DB`, `BACKUP_RETENTION_COUNT`, `BACKUP_DRILL_INTERVAL_HOURS`, `PG_BIN`, `BACKUP_PG_CONTAINER`. The agent never reads the secret `.env`. Live daily backups activate only after opt-in (locked decision D-04); the live "Backup now" operator check belongs to Plan 03.

## Verification

- `pnpm verify:release:schema` — schema valid ✓
- `pnpm typecheck` — 7/7 tasks ✓
- `pnpm lint` — 7/7 tasks ✓ (8 pre-existing web warnings, 0 errors)
- `pnpm vitest run --project unit tests/unit/backup-job.test.ts tests/unit/worker-entry-guard.test.ts` — 19/19 ✓
- `pnpm vitest run --project unit packages/config/src/index.test.ts` — 13/13 ✓
- `pnpm vitest run --project unit` — 396/403 (7 pre-existing environmental failures, deferred)
- `pnpm --filter @bet-stats/web test` — 56/56 ✓
- `pnpm vitest run --project integration tests/integration/backup-restore-drill.test.ts` — 3/3 ✓ (Docker up)
- Trigger grep `BackupRun_guarded_append_only` in migration — 1 ✓
- `grep -c "repeat" workers/data-sync/src/jobs/backup.ts` — 1 occurrence, inside a doc comment stating no v5 repeat option is used; no `repeat:` Queue.add option exists

## Known Stubs

None. The `createBackupWorker` dispatcher handles only the `"backup"` job name and throws `UNSUPPORTED_BACKUP_JOB` otherwise — the `"drill"` name is an explicit plan-level deferral to Plan 08-02, not a stub.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes beyond the plan's registered surface (T-08-01..T-08-06, T-08-SC). Mitigations verified: credentials never in argv or Redis payloads; system-generated filenames only; bounded robocopy retries; exec timeouts; prune-after-success ordering.

## Next Phase Readiness

- Plan 08-02 (restore drill) can build on `runBackup`/`BackupRun`/`backupQueue` — the worker dispatcher awaits its `"drill"` job name.
- Plan 08-03 (operations visibility) can read the `BackupRun` receipt model; its "Backup now" provides the live operator check deferred from this plan.
- Deferred: `tests/unit/fixtures-sync.test.ts` environmental red (needs `betstats-test` DB creds) — see `deferred-items.md`.
- No blockers.

## Self-Check: PASSED

All 8 key files present (`FOUND`), all 9 task commits are ancestors of HEAD (`FOUND`), measured `commits: 9` matches `git rev-list --count 9ae9de8..HEAD` at SUMMARY write.

---
*Phase: 08-backups-and-restore-verification*
*Completed: 2026-10-22*
