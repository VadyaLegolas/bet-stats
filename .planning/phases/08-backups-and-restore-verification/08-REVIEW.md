---
phase: 08-backups-and-restore-verification
reviewed: 2026-10-24T12:09:46Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - packages/config/src/index.ts
  - packages/database/prisma/schema.prisma
  - packages/database/prisma/migrations/20261022_phase08_backup_runs/migration.sql
  - packages/database/prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql
  - workers/data-sync/src/jobs/backup.ts
  - workers/data-sync/src/jobs/backup-drill.ts
  - workers/data-sync/src/main.ts
  - apps/api/src/modules/operations/operations.service.ts
  - apps/api/src/modules/operations/operations.controller.ts
  - apps/web/app/internal-api/operations/[[...path]]/route.ts
  - apps/web/app/internal-api/operations/[[...path]]/route.test.ts
  - apps/web/app/internal/operations/backup-status-block.tsx
  - apps/web/app/internal/operations/backup-status-block.test.ts
  - apps/web/app/internal/operations/page.tsx
  - apps/web/components/enum-labels.ts
  - apps/web/components/enum-labels.test.ts
  - tests/unit/backup-job.test.ts
  - tests/unit/backup-drill.test.ts
  - tests/integration/backup-restore-drill.test.ts
  - tests/integration/mutation-rejection.test.ts
  - tests/integration/operator-overview.test.ts
  - vitest.config.ts
  - README.md
findings:
  critical: 2
  warning: 3
  info: 3
  total: 8
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-10-24T12:09:46Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Phase 8 delivers opt-in PostgreSQL backups, a weekly restore drill, and operator visibility. The security posture is genuinely strong: append-only triggers are frozen at the database level, credentials reach pg/docker only through child env (never argv), drill stderr excerpts are credential-scrubbed and length-bounded, the HMAC ingress binds method + path + query with `timingSafeEqual`, disabled/unconfigured deployments fail closed with a uniform 404, and the enqueue payload is exactly `{ trigger: "MANUAL" }`. **T-08-SC is clean**: `git diff a33342d..HEAD` shows zero changes to any `package.json` or `pnpm-lock.yaml` in the phase.

However, two critical defects were found and verified against source (one empirically, via the project's own pinned `postgres:18-alpine` image): (1) the local `pg_dump` branch of `runBackup` passes the connection string only via `DATABASE_URL` in the child env, which libpq does not read — so the entire PG_BIN/PATH tool-resolution path can never produce a dump; and (2) both persisted-state tick schedulers re-arm from a receipt table the in-flight job has not written to yet, causing a guaranteed duplicate-job storm on every fresh deployment and an unbounded 1 Hz enqueue loop with unbounded append-only `BackupRun` growth when backups persistently fail.

## Critical Issues

### CR-01: Local `pg_dump` branch is dead — libpq ignores `DATABASE_URL`, so PG_BIN/PATH-resolved backups always fail

**File:** `workers/data-sync/src/jobs/backup.ts:302-306`
**Issue:** The non-docker branch of `runBackup` invokes the resolved local `pg_dump` with only `--format=custom --no-password --file=...` and passes the connection string exclusively as `DATABASE_URL` in the child environment:

```ts
command = tools.pgDump;
args = ["--format=custom", "--no-password", `--file=${partialPath}`];
if (input.databaseUrl) childEnv = { ...process.env, DATABASE_URL: input.databaseUrl };
```

libpq (and therefore `pg_dump`) does **not** read `DATABASE_URL` — it reads `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` or a conninfo argument. This was verified empirically against the project's own pinned image:

```
docker run --rm -e DATABASE_URL=postgres://bogus-host-xyz.invalid:5432/nope postgres:18-alpine pg_dump --no-password
→ pg_dump: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory
```

`resolvePgTools` tries PG_BIN first, then PATH, then docker (backup.ts:175-192) — so on any host where `pg_dump` is actually installed (the intended primary deployment mode documented via `PG_BIN` in README.md:480-490), every backup run dumps against the default unix socket as the OS user, fails, and records `DUMP_FAILED`. Only the docker-exec branch works. The defect slipped through because the unit tests use a fake exec that ignores env entirely, and the integration test deliberately forces the docker fallback (`recordingExec({ blockPathProbe: true })`, tests/integration/backup-restore-drill.test.ts:101), so the local branch is exercised by no test. Combined with WR-class scheduler behavior (see CR-02), a `SUCCEEDED` receipt is then never written and the failure loop becomes self-sustaining.
**Fix:** Map the URL to libpq's native child-env variables in the non-docker branch (keeps credentials out of argv per T-08-01):

```ts
if (input.databaseUrl) {
  const url = new URL(input.databaseUrl);
  childEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ""),
  };
}
```

Also add an integration test that exercises the local branch with a real `pg_dump` instead of forcing the docker path.

### CR-02: Tick schedulers enqueue a fresh job every second until a receipt lands — duplicate-job storm on every fresh boot and unbounded 1 Hz loop (plus unbounded append-only table growth) on persistent failure

**File:** `workers/data-sync/src/jobs/backup.ts:442-470`; `workers/data-sync/src/jobs/backup-drill.ts:479-503`
**Issue:** `scheduleBackupTick.arm()` reads the latest **SUCCEEDED** `BackupRun.completedAt`; when none exists it arms at `idlePollMs` (default 1000 ms), and the timer callback `run()` immediately enqueues `{ trigger: "SCHEDULED" }` and re-arms from the same table. But the table only gains a `SUCCEEDED` row **after** the queued job completes — which takes one full dump/offsite copy (seconds to minutes). Consequences, verified against `createBackupQueue` (no `jobId` ⇒ no BullMQ dedup, backup.ts:376-380) and `createBackupWorker` (concurrency 1):

1. **Fresh deployment (no `SUCCEEDED` row): every worker start enqueues one backup job per second for the entire duration of the first dump.** The worker then serially executes the whole backlog — dozens of redundant full dumps, offsite copies, retention prunes, and immutable `BackupRun` receipts. The drill scheduler has the identical pattern, so a fresh boot also queues dozens of sequential restore drills (each spinning a throwaway container) behind the first one.
2. **Persistent failure (e.g., CR-01 on a host with pg tools installed): a FAILED receipt never satisfies `findFirst({ where: { status: "SUCCEEDED" } })`**, so the loop runs at 1 Hz forever — each tick spawns pg tooling probes and appends another row to the append-only `BackupRun` table, which has no purge anywhere. Unbounded disk/DB growth plus constant host load, from a design that explicitly anticipates fail-closed misconfiguration.

The unit tests encode the re-arm-after-run behavior with a fake DB that returns a completed receipt on the second query, so the storm is invisible to them.
**Fix:** Do not re-enqueue while a run is pending. Minimal change: give scheduled jobs a deterministic dedup `jobId` (e.g. `scheduled-backup-<epochBucket>`/receipt-anchored bucket) in `createBackupQueue.add`, and/or track an in-flight promise in the scheduler so `run()` only re-arms after the dispatcher completes (pass the worker's execute result back into the scheduler). For the failure path, anchor on the newest receipt of **any** status with an escalating backoff (capped), so a permanently broken deployment retries at a bounded rate instead of 1 Hz.

## Warnings

### WR-01: `BackupRun.byteSize` is `INTEGER` (int4) — dumps ≥ 2 GiB make the receipt insert throw after the dump is already renamed into place

**File:** `packages/database/prisma/schema.prisma:776` (`byteSize Int?`); `packages/database/prisma/migrations/20261022_phase08_backup_runs/migration.sql:14`; consumed at `workers/data-sync/src/jobs/backup.ts:315-322,336-351`
**Issue:** `fs.size()` returns a JS number, but the column is int4 (max 2,147,483,647). For a dump ≥ 2 GiB, Prisma rejects the insert with a range error **after** `fs.rename(partialPath, finalPath)` has already committed the file. `runBackup` then throws instead of returning a result — no `FAILED` receipt either — the dump sits on disk unrecorded, and the scheduler never sees a `SUCCEEDED` row (feeding CR-02's retry loop). Backups are infrastructure that must survive database growth; 2 GiB is reachable well before the feature's useful life ends.
**Fix:** Change the column to `BigInt` (`@db.BigInt`) in schema + migration, and let Prisma return a `bigint` for `byteSize` (the closed DTO in `BackupFact` should serialize it via `Number(...)` or string before the API boundary).

### WR-02: `MAX_TIMER_DELAY` capping makes configured drill intervals above ~596 hours drill early and repeatedly

**File:** `workers/data-sync/src/jobs/backup-drill.ts:447,485-487`; config allows up to 8760 h at `packages/config/src/index.ts:156-158`
**Issue:** `rawDelay` is clamped to `2 ** 31 - 1` ms (≈ 596.5 h ≈ 24.9 days) before arming the timer, and the timer callback goes straight to `run()`, which **enqueues a drill** without re-checking whether the interval has actually elapsed. Any operator setting `BACKUP_DRILL_INTERVAL_HOURS` between ~597 and the validated maximum of 8760 gets a full restore drill every ~24.9 days instead of the configured cadence (e.g., 8760 h ⇒ weekly-ish drills every 25 days, spinning containers and restoring production data far more often than intended). The backup tick shares the clamp but its interval is a fixed 24 h, so only the drill path is affected today.
**Fix:** When the computed delay exceeds `MAX_TIMER_DELAY`, arm the timer to re-invoke `arm()` (not `run()`) so the remaining delay is recomputed without enqueuing:

```ts
const capped = rawDelay > MAX_TIMER_DELAY;
timer = setTimer(() => { void (capped ? arm() : run().catch(input.onError)); }, Math.min(MAX_TIMER_DELAY, rawDelay));
```

### WR-03: Off-host copies are never rotated — personal-data dumps accumulate on `BACKUP_OFFSITE_DIR` forever, contradicting the documented retention claim

**File:** `workers/data-sync/src/jobs/backup.ts:146-157` (`pruneBackupRetention` cleans `dir` only), `328-332` (`copyOffsite`); `README.md:493`
**Issue:** Retention pruning applies solely to the local `BACKUP_DIR`. `copyOffsite` copies each new dump to the off-host destination, and nothing ever deletes anything there (deliberately no `/MIR`/`/PURGE`, correctly, for safety). README.md:493 tells operators that dumps "остаются восстановимыми вплоть до `BACKUP_RETENTION_COUNT` дней" after a deletion request — but off-host copies persist indefinitely, which the README's own privacy note does not cover. Given the project's explicit retention/privacy constraints (dumps contain personal domain data), an ever-growing off-host copy of historical data that local policy says should age out is a real retention gap, not just storage growth.
**Fix:** After a successful copy, run the same system-name-pattern-filtered prune against the off-host directory (delete only files matching `BACKUP_DUMP_FILE_PATTERN` beyond `retentionCount`, oldest first — never a mirror/purge flag, keeping the existing safety property). Update the README privacy note to state the off-host retention window.

## Info

### IN-01: Dead `RETAINED` cleanup label; real `FAILED`/`NOT_STARTED` values leak raw English codes into the Russian-only UI

**File:** `apps/web/app/internal/operations/backup-status-block.tsx:27,30`
**Issue:** `CONTAINER_CLEANUP_LABELS` maps `REMOVED` and a `RETAINED` value that cannot occur (the enum in `backup-drill.ts:29` is `REMOVED | FAILED | NOT_STARTED`), while the two values that actually occur on non-green drills — `FAILED` and `NOT_STARTED` — are unmapped and render as raw English codes (`"FAILED"`) in an interface whose convention (AGENTS.md) is Russian-only user-facing text.
**Fix:** Replace the map with `{ REMOVED: "Контейнер удалён", FAILED: "Не удалось удалить контейнер", NOT_STARTED: "Контейнер не запускался" }` and drop `RETAINED`.

### IN-02: Robocopy `/LOG+` appends to a single ever-growing log inside `BACKUP_DIR` that retention never touches

**File:** `workers/data-sync/src/jobs/backup.ts:130`
**Issue:** Every off-host copy appends to `football-prediction-offsite.log` in the backup directory. The file never matches `BACKUP_DUMP_FILE_PATTERN`, so `pruneBackupRetention` never truncates or removes it — unbounded (slow) growth in the directory the README asks operators to ACL. It also accumulates one line per copied file forever, which over years becomes a nontrivial record of backup activity sitting next to the dumps.
**Fix:** Truncate the log (`/LOG:` instead of `/LOG+:`, or delete it before each copy), or rotate it when it exceeds a fixed size during the retention pass.

### IN-03: Manual-trigger `jobId` collision within one millisecond silently drops the enqueue while still reporting `{ queued: true }`

**File:** `apps/api/src/modules/operations/operations.service.ts:246`
**Issue:** `jobId: \`manual-${job}-${Date.now()}\`` — BullMQ deduplicates identical job IDs, so two triggers landing in the same millisecond (double-fire, retried proxy, or two operators) make the second `queue.add` a no-op while `trigger()` still returns `{ queued: true }` and the UI shows "поставлена в очередь". Impact is minor (buttons are disabled while pending and the worker serializes runs), but the success report can be false.
**Fix:** Append `randomUUID()` (or a monotonic counter) to the jobId, e.g. `manual-${job}-${Date.now()}-${randomUUID()}`.

---

## Security-focus verification (STRIDE T-08-01..17, T-08-SC)

All enumerated threats were checked against source and are mitigated as designed — no findings beyond the items above:

- **T-08-01 (secrets via env, never argv):** ✔ drill password via bare `--env POSTGRES_PASSWORD` with child env (backup-drill.ts:328-343); drill/migrate URLs only in `DATABASE_URL` env (backup-drill.ts:396-404); `docker exec printenv` reads variable names only (backup.ts:214-218). Note: CR-01's fix must keep credentials out of argv (use `PG*` env vars, not a positional conninfo).
- **T-08-02 (frozen triggers):** ✔ `guard_backup_run` / `guard_backup_verification_receipt` BEFORE UPDATE/DELETE raise; integration-proven in mutation-rejection.test.ts:156-174.
- **T-08-03 (atomic dumps):** ✔ dump-to-`.partial` then `rename` (backup.ts:289-322); partial removed on failure.
- **T-08-04 (robocopy bitmask):** ✔ `code >= 8` ⇒ DEGRADED, 0-7 ⇒ COPIED, `/R:2 /W:5`, no `/MIR`/`/PURGE` (backup.ts:119-137; test-asserted).
- **T-08-07..12 (drill fail-closed):** ✔ explicit `-U`/`-d` on `pg_restore`/`pg_isready`; every exit path appends exactly one receipt; `docker rm --force` in `finally` with cleanup state defaulting to FAILED; stderr excerpts scrubbed (`redactDrillExcerpt`) and bounded to 500 chars.
- **T-08-13..17 (operator surface):** ✔ `BackupFact` is a closed secret-free projection (basename-only via `safeFileName`, `redactSecrets` belt pass); HMAC canonical binds subject/timestamp/method/path/query digest; disabled/unconfigured ⇒ uniform `NotFoundException`; manual payload exactly `{ trigger: "MANUAL" }` (asserted in operator-overview.test.ts:195-229).
- **T-08-SC (no new dependencies):** ✔ `git diff --stat a33342d..HEAD` across all `package.json` files and `pnpm-lock.yaml` is empty; the phase uses only `node:` built-ins plus already-present `bullmq`/`zod`/Prisma.

---

_Reviewed: 2026-10-24T12:09:46Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
