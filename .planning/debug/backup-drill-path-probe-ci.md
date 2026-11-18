---
status: fixed_and_verified
trigger: "CI run 44261545363: integration job fails in tests/integration/backup-restore-drill.test.ts > 'records FAILED and leaves no dump when the source database is unreachable' — expected FAILED, got SUCCEEDED"
created: "2026-11-18T08:35:00Z"
updated: "2026-11-18T16:52:00Z"
fixed_commit: "9387bd0"
---

# Debug Session: backup-drill-path-probe-ci

## Symptoms

- **Expected behavior:** `runBackup` with `BACKUP_PG_CONTAINER=<test container>` and `BACKUP_PG_DB: "missing_database"` resolves pg tooling through the docker-exec fallback, the dump against `missing_database` fails, and the receipt is persisted as `FAILED` / `DUMP_FAILED` with no dump files written.
- **Actual behavior:** On the GitHub Actions ubuntu runner the same call returns `SUCCEEDED` and writes a dump.
- **Error messages:** `AssertionError: expected 'SUCCEEDED' to be 'FAILED' // Object.is equality` at `tests/integration/backup-restore-drill.test.ts:159:27`.
- **Timeline:** Only fails on CI. The identical test is green on the local Windows machine. CI run 44261545363 (head `ede253d`): 514 passed, 1 failed.
- **Reproduction:** Run `pnpm run test:integration:docker` on a Linux host that has `pg_dump` on `PATH` (GitHub ubuntu runners ship PostgreSQL client tooling).

## Root Cause

`tests/integration/backup-restore-drill.test.ts:147-167` calls

```ts
const result = await runBackup({ config, database, databaseUrl, trigger: "SCHEDULED", exec: recordingExec({ record }) });
```

without `blockPathProbe: true`.

`recordingExec` (lines 55-77) only forces the PATH probe to fail when that flag is set:

```ts
if (command === "pg_dump" && options.blockPathProbe) {
  return { code: undefined, stdout: Buffer.alloc(0), stderr: "", spawnError: "ENOENT" };
}
```

`resolvePgTools` (`workers/data-sync/src/jobs/backup.ts:179-197`) resolves in order: `PG_BIN` dir → PATH probe (`pg_dump --version`) → docker exec. On the CI runner `pg_dump` exists on PATH, so it returns `{ kind: "local", pgDump: "pg_dump" }` and the dump runs against the real `databaseUrl` (`bet_stats`), which exists — therefore `SUCCEEDED`.

On the local Windows machine `pg_dump` is not on PATH, so the probe fails, the docker fallback is used with `-d missing_database`, and the dump correctly fails.

The sibling test at line 109 ("produces one real non-empty dump ...") already passes `blockPathProbe: true` for exactly this determinism reason, and the `recordingExec` doc comment (lines 47-54) states that bare `pg_dump` PATH probes must fail so resolution is deterministic on any host. The failing test simply violates that established contract.

`workers/data-sync/src/jobs/backup-drill.ts` only invokes `docker`(and `process.execPath` for prisma) — it never calls `resolvePgTools` — so the drill tests (lines 192-290) are not affected by host PATH and need no change.

## Fix

Added `blockPathProbe: true` to the `recordingExec({ record })` call in the failing test (commit `9387bd0`):

```ts
const result = await runBackup({ config, database, databaseUrl, trigger: "SCHEDULED", exec: recordingExec({ record, blockPathProbe: true }) });
```

This keeps the test asserting the docker-exec fail-closed path it was written for, and makes it host-independent.

## Verification

Local run of the test file (`pnpm vitest run tests/integration/backup-restore-drill.test.ts`) — all 7 tests pass:

```
✓ produces one real non-empty dump and one durable SUCCEEDED receipt with the dump sha256 1329ms
✓ records FAILED and leaves no dump when the source database is unreachable 633ms
✓ fails closed with PG_IDENTITY_UNRESOLVED and invokes no dump when neither config nor container env supply the identity 241ms
✓ restores the newest dump into an owned throwaway container and appends exactly one VERIFIED verification receipt 17835ms
✓ persists FAILED containerCleanup with the drill overall untouched when the pre-rm identity check fails on a live daemon 18966ms
✓ records exactly one UNVERIFIED NO_BACKUP_FOUND receipt and starts no container for an empty BACKUP_DIR 30ms
✓ fails closed with PG_IDENTITY_UNRESOLVED and starts no container when neither config nor container env supply the identity 14ms
```

## Status

**Fixed and verified locally.** CI verification pending (pushed commit `9387bd0` to `origin/main`).