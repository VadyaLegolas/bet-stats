# Phase 8: Backups and Restore Verification - Research

**Researched:** 2026-10-22
**Domain:** PostgreSQL backup (`pg_dump -Fc`), restore verification (throwaway container drill), BullMQ scheduling, operations-center visibility
**Confidence:** HIGH (stack facts empirically verified in-session against the repo's own tooling and a live `postgres:18-alpine` container)

## Summary

Phase 8 adds an opt-in daily `pg_dump -Fc` backup with 14-dump retention, an optional `robocopy` off-host copy, and a weekly restore drill that runs as a BullMQ job on the operator's Windows host. The drill restores the **latest real backup** into an owned throwaway `postgres:18-alpine` container, runs `prisma migrate deploy` + `migrate status` (at-head proof), runs chain-integrity checks (canonical tables non-empty, FK orphans = 0, row-count parity), destroys the container best-effort, and appends an immutable verification receipt. The operations center gains a "Backups & Restore Verification" block that renders never-verified / stale / failed / not-configured as explicit non-green, plus manual "Backup now" / "Drill now" triggers.

The most consequential findings this session: **(1)** BullMQ v6 **removed** `Queue.add(..., { repeat })` entirely — the v6 scheduling API is `Queue.upsertJobScheduler(...)`; however the locked decision D-03 says to follow the repo's existing `scheduleRetentionPurge` setTimeout-based scheduler pattern, which sidesteps the issue and is the recommended path. **(2)** On this operator host there is **no host PostgreSQL installation** — `pg_dump`/`pg_restore` exist only **inside the running `postgres:18.6-alpine` container** (verified: `docker exec … pg_dump --version` → `pg_dump (PostgreSQL) 18.6`). The `PG_BIN` resolution strategy therefore fails closed out of the box unless the planner chooses the `docker exec` fallback (recommended, documented below) or requires the operator to install PG 18 tools. **(3)** The full drill harness chain was executed end-to-end in-session against a throwaway container: 25 migrations deploy in seconds, `migrate status` exits **1** with pending / **0** at head, and `pg_restore -d <db> --no-owner --no-privileges --exit-on-error` restores a full schema+trigger dump into a fresh empty database with exit 0 — including one real pitfall captured live (container `docker exec` defaults to role `root`; explicit `-U` is mandatory).

**Primary recommendation:** Follow the locked decisions literally — setTimeout-schedulers-armed-from-DB-state (retention-purge pattern) that enqueue jobs on a new `bet-stats-backup` BullMQ queue; resolve pg tooling via `PG_BIN` with a `docker exec` fallback against the app's own postgres container; add two append-only Prisma models (`BackupRun` + `BackupVerificationReceipt`) with SettlementReceipt-style frozen triggers; plug `backups()` into the existing `OperationsRepository`.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Daily full backup via `pg_dump -Fc` (custom format — compressed, single-file, supports selective restore). Target RPO = up to 24 hours. — roadmap exclusions: no WAL, no pgBackRest/Barman, no paid backup SaaS.
- **D-02:** Rotation keeps the last **N successful dumps** (default **N = 14**, configurable), deleting older files after each successful backup — never delete-before-new-backup-succeeds.
- **D-03:** Backup runs as a **scheduled BullMQ job in the worker** (`workers/data-sync`), following the existing `scheduleRetentionPurge` interval-scheduler pattern.
- **D-04:** Backup is **opt-in**: `BACKUP_ENABLED` gate + configured `BACKUP_DIR`. Until enabled and configured, the operations center honestly reports backups as **not configured / never run** (non-green), not as passing.
- **D-05:** Primary store = a local `BACKUP_DIR`. **Off-host copy is an explicit, optional second step**: after a successful dump, the worker copies the file to a configured `BACKUP_OFFSITE_DIR` using Windows-native **`robocopy`**. `BACKUP_OFFSITE_DIR` may be any mounted network/SMB share or a cloud-sync folder.
- **D-06:** If `BACKUP_OFFSITE_DIR` is **not configured**, the system reports off-host replication as **not configured** (explicit, non-green). If configured but the copy fails, the backup still counts as locally successful but off-host status goes **degraded**, and the failure is recorded.
- **D-07:** The restore drill runs as a **scheduled BullMQ job on the operator host**, **not** in CI. It reuses the throwaway-container harness pattern from `scripts/verify-release-integration.mjs` (owned container name, `pg_isready` wait, `rm --force` cleanup).
- **D-08:** Drill procedure: (1) locate latest backup file; (2) start owned `postgres:18-alpine` throwaway container on a dynamic port; (3) `pg_restore` the dump; (4) run `prisma migrate deploy` then confirm `migrate status` is **at head / no pending**; (5) run chain-integrity checks; (6) `rm --force` the container; (7) append a verification receipt.
- **D-09:** Chain-integrity checks (all must pass for a green drill): restored DB reachable; migrations at head; canonical tables non-empty (teams, fixtures, forecast snapshots, value receipts); **FK orphan check returns 0** on key relations; **row-count parity** between restored DB and source counts captured at drill start.
- **D-10:** Drill cadence = **weekly** (configurable).
- **D-11:** **Fail-closed:** if Docker is unavailable on the host, or any drill step fails, the drill records a **failed / unverified** receipt and the status renders **non-green**. Successful cleanup is best-effort but a cleanup failure is recorded, not hidden.
- **D-12:** Each drill appends an **immutable verification receipt** (new Prisma model, append-only) capturing: backup file id/name, restore duration, per-check pass/fail, container cleanup outcome, DB version, timestamp.
- **D-13:** Operator can trigger **manual "Backup now"** and **"Restore drill now"** from the operations center.
- **D-14:** Operations center gains a **"Backups & Restore Verification"** block: last backup (time, file id, size, local + off-host state), backup age with **stale** flag when older than expected cadence + grace (daily → stale after ~25h), last drill (time, pass/fail, failed checks), and an overall state that is **green only when** last backup is fresh AND last drill passed AND drill is not stale. **Never-verified / stale / failed / not-configured** each render as an explicit non-green state.
- **D-15:** The block **never exposes secrets**: no connection strings, no credentials; shows only file ids/names, sizes, timestamps, durations, check outcomes, and safe paths with credentials redacted.

### the agent's Discretion

All four gray areas (schedule/retention, off-host storage, restore-drill mechanism, management/visibility) were delegated to the agent. The planner retains flexibility on: exact env-var names (proposed: `BACKUP_ENABLED`, `BACKUP_DIR`, `BACKUP_RETENTION_COUNT`, `BACKUP_OFFSITE_DIR`, `BACKUP_DRILL_*`), exact cron/interval encodings, precise table list for non-empty/FK/parity checks, and where the backup status read-model plugs into the existing operations repository — all guided by the decisions above and existing conventions.

### Deferred Ideas (OUT OF SCOPE)

- Object-storage off-host destination (Cloudflare R2 / Backblaze B2 free tiers) as an alternative to robocopy — a later upgrade that would not change the receipt contract.
- WAL/point-in-time recovery — explicitly out of scope for v1.1 (daily RPO is the honest target).
- Backing up Redis — permanently out (disposable, not a source of truth).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BAK-01 | Operator can enable automated PostgreSQL backups (pg_dump custom format) with configurable retention and rotation | Q1 (pg_dump invocation, exit codes, atomic write), Q3 (robocopy off-site), Q4 (daily tick scheduling), Q6 (`BACKUP_*` env, fail-closed gating) |
| BAK-02 | A scheduled restore drill restores the latest backup into a throwaway PostgreSQL container, applies migrations, runs chain-integrity checks, and records a verification receipt | Q1 (pg_restore flags — empirically round-tripped), Q2 (migrate deploy/status exit codes — empirically verified), Q5 (FK-orphan/parity SQL), Q7 (append-only receipt model + frozen trigger), container harness reuse from `verify-release-integration.mjs` |
| BAK-03 | Backup and restore-verification status visible in operations center without exposing secrets; never-verified and stale render as explicit non-green | Q6 (config gating states), Q8 (manual-trigger endpoints + proxy), `OperationsRepository` extension, `redactSecrets` discipline |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daily `pg_dump -Fc` + rotation | Worker (`workers/data-sync`, runs on operator host) | — | Locked D-03: BullMQ job in the worker; host-local filesystem access required |
| Off-host copy (`robocopy`) | Worker | — | Windows-native CLI invoked by the worker after successful dump (D-05) |
| Restore drill orchestration | Worker | Database/Storage (throwaway container) | Locked D-07: worker job on operator host, not CI; Docker lifecycle owned by the job |
| Migration-chain proof (`migrate deploy`/`status`) | Worker (spawning Prisma CLI in `packages/database`) | — | Prisma CLI runs with `DATABASE_URL` pointing at the throwaway container |
| Chain-integrity SQL checks | Worker (raw SQL against restored DB) | — | Read-only checks executed via throwaway `pg`/Prisma connection |
| Verification receipts (append-only) | Database/Storage (new Prisma models + frozen triggers) | Worker (writer) | Immutability enforced in the DB, same as SettlementReceipt/ForecastSnapshot |
| Backup status read model | API (`OperationsRepository.backups()`) | Worker (persists runs) | Joins the existing operations overview assembly |
| Manual "Backup now"/"Drill now" | API (`POST /internal/operations/...`, OperatorGuard) | Web (`/internal-api/operations` proxy — currently GET-only, must gain POST) | Existing operator ingress chain: gateway → signed headers → web proxy → API |
| Backup/restore status UI block | Web (`apps/web/app/internal/operations/page.tsx`) | — | Renders Russian-labeled `Block` per existing pattern |
| Config validation (`BACKUP_*`) | Shared (`@bet-stats/config`, Zod) | Worker + API consume | Existing env-validation convention |

## Standard Stack

**No new npm packages are required.** Everything is stdlib (`node:child_process`, `node:fs`), Windows built-ins (`robocopy` at `C:\Windows\System32\Robocopy.exe` — [VERIFIED: in-session probe `where.exe robocopy`]), Docker CLI (already a hard dependency of the release harness), and the repo's existing `pg`/`@prisma/adapter-pg`/BullMQ/Zod stack.

### Core (existing, reused)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bullmq` | ^6.3.2 [VERIFIED: workers/data-sync/package.json:17] | Backup + drill job queues | Locked D-03; matches every existing queue factory in `queues/index.ts` |
| `pg` 8.23.0 + `@prisma/adapter-pg` 7.10.0 | [VERIFIED: packages/database/package.json:25-27] | Row-count/FK queries against restored DB; Prisma client | Only DB driver in the repo; do not add a second one |
| `prisma` CLI 7.10.0 | devDependency of `@bet-stats/database` | `migrate deploy` / `migrate status` in the drill | Invoked exactly as `scripts/verify-release-integration.mjs` does |
| Zod (via `@bet-stats/config`) | existing | `BACKUP_*` env validation, fail-closed | Established convention (`readServerConfig`, `readPrivacyRetentionConfig`) |
| Docker `postgres:18-alpine` image | already used by harness | Throwaway drill container | Same image family as production (`postgres:18.6-alpine` per `infra/docker-compose.yml:5`) |

**Installation:** none. (Package Legitimacy Audit: no external packages are installed by this phase — audit vacuously clean.)

## Environment Availability (probed 2026-10-22 on the operator host)

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker engine | Drill container, optional dump fallback | ✓ | Server 29.9.1 [VERIFIED: `docker version`] | none — drill fail-closed per D-11 |
| `postgres:18.6-alpine` image | Drill + dump fallback | ✓ (running as `football-prediction-platform-postgres-1` on `0.0.0.0:5432`) [VERIFIED: `docker ps`] | 18.6 | pull `postgres:18-alpine` on demand |
| `robocopy` | Off-host copy | ✓ [VERIFIED: `where.exe robocopy` → `C:\Windows\System32\Robocopy.exe`] | OS built-in | — |
| Host `pg_dump`/`pg_restore`/`psql` (`PG_BIN`) | Primary dump path | ✗ **not installed, not on PATH** [VERIFIED: `where.exe pg_dump` / `where.exe psql` → not found; `C:\Program Files\PostgreSQL` absent] | — | **`docker exec` into the app's postgres container** — `pg_dump (PostgreSQL) 18.6` confirmed present [VERIFIED: in-session probe]; or operator installs PG 18 tools and sets `PG_BIN` |
| Node 24 | Worker | ✓ `.tools/node24` [VERIFIED: directory listing] | v24.x | — |
| pnpm 10.34.5 | build/test | ✓ (`packageManager` pin + corepack) | 10.34.5 | — |

**Missing with fallback:** host PG tools — the `docker exec` fallback (recommended, see Q1) keeps backups functional with zero operator installs. **Missing, blocking if chosen strategy is `PG_BIN`-only:** planner must either mandate the fallback or add an operator install step.

## Architecture Patterns

### System Architecture (data flow)

```
                                   ┌────────────────────────────────────────────────┐
  operator browser                 │  operator host (Windows)                       │
        │                          │                                                │
        ▼                          │  ┌──────────────────────────────────────────┐  │
  /internal/operations  (web,      │  │ workers/data-sync                        │  │
  Next.js Block UI)               │  │                                          │  │
        │ HMAC-signed              │  │  daily tick ──► backup job:              │  │
        ▼                          │  │  (retention-purge-style    pg_dump -Fc ──┼──► BACKUP_DIR/*.dump
  /internal-api/operations ────────┼─►│   setTimeout scheduler)     (PG_BIN or    │  │   (atomic tmp+rename)
  proxy (GET today;               │  │        │                    docker exec)  │  │        │
   add POST for triggers)          │  │        ▼                    rotation:     │  │        ▼ robocopy
        ▼                          │  │  bet-stats-backup queue    keep last N   │  │  BACKUP_OFFSITE_DIR
  apps/api OperationsController    │  │  (Worker)                  after success │  │  (optional; exit<8 ok)
   + OperatorGuard                 │  │        │                                   │  │
   POST backups/run, backups/drill │  │  weekly tick ──► drill job:                │  │
        │ enqueue BullMQ ──────────┼─►│  (scheduler armed from     throwaway      │  │
        ▼                          │  │   last receipt timestamps) postgres:18-   │  │
  operations read model            │  │        │                alpine container   │  │
   backups() fact ─────────────────┼──┼────────┴─► pg_restore → migrate deploy →  │  │
  (last run, last receipt,         │  │             migrate status → SQL checks → │  │
   states: NOT_CONFIGURED /        │  │             docker rm --force → append    │  │
   NEVER_VERIFIED / STALE /        │  │             BackupVerificationReceipt ────┼──► PostgreSQL
   FAILED / HEALTHY)               │  └──────────────────────────────────────────┘  │   (append-only)
                                   └────────────────────────────────────────────────┘
```

Decision points: `BACKUP_ENABLED` + `BACKUP_DIR` gate (fail-closed → NOT_CONFIGURED); `BACKUP_OFFSITE_DIR` presence gates off-host (absent → "not configured", copy failure → DEGRADED not fatal); any drill step failure or missing Docker → FAILED/UNVERIFIED receipt, never green.

### Recommended Project Structure (new files only)

```
workers/data-sync/src/
├── jobs/
│   ├── backup.ts              # runBackup(): dump → verify → rotate → off-site copy
│   ├── backup-drill.ts        # runBackupDrill(): container → restore → migrate → checks → receipt
│   └── schedulers.ts          # or inline: scheduleBackupTick/scheduleDrillTick (retention-purge shape)
└── queues/index.ts            # + createBackupQueue / createBackupWorker (new bet-stats-backup queue)
packages/database/
├── prisma/schema.prisma       # + model BackupRun, model BackupVerificationReceipt
└── prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql   # hand-authored, frozen triggers
apps/api/src/modules/operations/
├── operations.controller.ts   # + @Post("backups/run"), @Post("backups/drill")
└── operations.service.ts      # + OperationsRepository.backups(), overview.backups section
apps/web/app/internal-api/operations/[[...path]]/route.ts   # add POST passthrough (currently GET-only)
apps/web/app/internal/operations/page.tsx                   # + «Резервные копии и проверка восстановления» Block
packages/config/src/index.ts   # + readBackupConfig() fail-closed reader (BACKUP_* vars)
```

### Pattern 1: Container + Prisma CLI harness (reuse verbatim)
**What:** Owned throwaway container lifecycle + Prisma CLI invocation.
**When to use:** The drill's container steps and both migrate commands.
**Example (source: `scripts/verify-release-integration.mjs:23-56`, read this session):**
```typescript
const suffix = `${process.pid}-${Date.now()}`;
const postgres = `bet-stats-drill-pg-${suffix}`;            // owned, unique name
docker("run", "--detach", "--name", postgres, "--env", "POSTGRES_PASSWORD=postgres",
       "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
await waitFor(postgres, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"], 500);
const postgresPort = docker("port", postgres, "5432/tcp").split(":").at(-1);
const drillDatabaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
// Prisma CLI — no driver adapter needed for migrate; only DATABASE_URL + cwd=packages/database:
execFileSync(process.execPath,
  [resolve(databaseRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy"],
  { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: drillDatabaseUrl }, stdio: "inherit" });
// cleanup, best effort, recorded not hidden (D-11):
try { docker("rm", "--force", postgres); } catch { /* record cleanup failure in receipt */ }
```

### Pattern 2: Self-closing interval scheduler armed from persisted state
**What:** `scheduleRetentionPurge` shape (`workers/data-sync/src/jobs/retention-purge.ts:31-87`): a `setTimeout` armed from the earliest persisted timestamp, recomputed after each run, with `close()`/`refresh()` handles and `onError` retry — no cron library.
**When to use:** The daily backup tick (arm from last `BackupRun` + 24h; no runs yet → run soon after worker start) and the weekly drill tick (arm from last `BackupVerificationReceipt` + 7d). This is what locked decision D-03 prescribes.
**Example:**
```typescript
export function scheduleBackupTick(input: {
  database: PrismaClient; enqueueBackup: () => Promise<unknown>;
  intervalMs?: number; now?: () => Date; onError?: (e: unknown) => void;
}): { close(): void; refresh(): Promise<void> }  // copy arm()/run()/close() structure from scheduleRetentionPurge
```

### Pattern 3: BullMQ v6 job scheduler (alternative — ONLY if wall-clock cron anchoring is wanted)
**What:** BullMQ v6 **removed** `Queue.add(name, data, { repeat: {...} })`. Verbatim from the official docs fetched this session: *"these APIs were deprecated from BullMQ version 5.16.0 onwards and have been **removed** in v6 in favor of 'Job Schedulers'"* [CITED: docs.bullmq.io/guide/jobs/repeatable]. The v6 API:
```typescript
// Source: https://docs.bullmq.io/guide/job-schedulers + /repeat-options
await queue.upsertJobScheduler(
  'daily-backup',                       // scheduler id — upsert = no duplicate schedulers
  { pattern: '0 30 3 * * *', tz: 'UTC' }, // cron-parser "unix cron w/ optional seconds"; tz:'UTC' replaces removed repeat.utc
  { name: 'backup', data: { trigger: 'scheduled' }, opts: { attempts: 1, removeOnComplete: { age: 604800, count: 100 } } },
);
```
Per official docs: upsert *"ensures the scheduler is updated or created without duplications"*; a new scheduler fires its **first job immediately** (the `immediately` option is deprecated since 5.19 — *"the first repetition will always be immediately for a new inserted job scheduler"*); subsequent upserts do **not** re-fire; custom `jobId` is not allowed for scheduler-produced jobs [CITED: docs.bullmq.io/guide/job-schedulers, /repeat-options].
**Recommendation:** prefer Pattern 2 (locked D-03, zero new API surface, arms from persisted receipts = self-healing after downtime). Pattern 3 is documented so the planner does **not** accidentally write v5 `repeat:` code — it does not exist in bullmq ^6.3.2 [VERIFIED: workers/data-sync/package.json:17].

### Pattern 4: API-side job enqueue (manual triggers)
**What:** API constructs a local `Queue` with the same name/options/jobId as the worker — verbatim pattern from `apps/api/src/modules/replay/replay.service.ts:32-34`: `new Queue(`${prefix}-sync-standard`, { connection: { url: redisUrl, maxRetriesPerRequest: null } })`.
**When to use:** `POST /internal/operations/backups/run` and `POST /internal/operations/backups/drill` → `queue.add('backup', { trigger: 'manual', actor }, { jobId: ... })` on the `bet-stats-backup` queue. Guard with existing `OperatorGuard` (`apps/api/src/modules/reconciliation/operator.guard.ts` — timing-safe `x-operator-credential` check).
**Important web-proxy detail:** `apps/web/app/internal-api/operations/[[...path]]/route.ts:53` today exports only `export const GET = proxy;` and the upstream fetch hardcodes `method: "GET"` (line 49). The HMAC canonical string already covers the method (line 35: `` `${subject}\n${timestamp}\n${request.method.toUpperCase()}\n${pathname}\n${queryDigest(...)}` ``) [VERIFIED: route.ts:25-53], so POST support = `export const POST = proxy;` + forward `request.method` instead of the hardcoded `"GET"`. The operator gateway already forwards arbitrary methods (replay pages POST through it).

### Anti-Patterns to Avoid
- **`Queue.add(..., { repeat })` under BullMQ v6:** removed; runtime TypeError. Use Pattern 2 or `upsertJobScheduler`.
- **Delete-before-dump rotation:** violates D-02 — rotate only after the new dump succeeds and is written atomically.
- **`--clean` restore as the drill default:** unnecessary for a throwaway empty DB and masks "dump restores into a live DB" mistakes; keep `--clean --if-exists` only for retry-within-same-container paths.
- **Embedding `DATABASE_URL` (with password) in CLI argv:** leaks credentials via process listing; pass libpq params via env (`DATABASE_URL`/`PGPASSWORD`) — child `env` option, never string-concatenated argv.
- **Putting credentials in BullMQ job data:** job payloads are persisted in Redis; the drill job needs zero secrets beyond the worker's own env.
- **Hiding cleanup/robocopy failures:** D-11 requires them recorded (receipt field), even when the drill itself passed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Backup file transfer to off-site | Custom copy/retry/resume logic | `robocopy` (`/E /R:2 /W:5 /XJ`) | 40 years of edge cases (long paths, SMB transient errors, resume); exit bitmask gives free partial-failure info |
| Container lifecycle for drill | Hand-rolled docker API client | `docker` CLI via `execFileSync`, exactly the harness shape in `verify-release-integration.mjs` | Proven in this repo; `pg_isready` wait + owned-name `rm --force` already solved |
| Migration-chain proof | Parsing `_prisma_migrations` table manually | `prisma migrate status` (exit 1 pending / 0 at head — verified) | Hand-rolled checks drift from Prisma's own checksum/consistency semantics |
| FK-orphan detection for all relations | Per-table hardcoded orphan queries only | Generic `pg_constraint`-driven query (Q5) + curated checks on supersession chains | Schema evolves (MKT-05 adds tables); generic query stays correct |
| Dump compression/incremental logic | Custom archiver/incremental diff | `pg_dump -Fc` (built-in compression, single file, selective restore) | Locked D-01; WAL/PITR excluded by roadmap |
| Config parsing for `BACKUP_*` | Ad-hoc `process.env.X ?? ...` | Zod reader in `@bet-stats/config` (pattern: `readPrivacyRetentionConfig`) | Fail-closed by construction; one place for validation errors |

**Key insight:** every component here has a battle-tested CLI equivalent (pg_dump, pg_restore, robocopy, docker, prisma). The custom code should be **orchestration + honest status bookkeeping only**.

## Answers to Research Questions (implementation-ready)

### Q1 — pg_dump / pg_restore on Windows from Node

**Dump (daily job):**
```
pg_dump --format=custom --file="<BACKUP_DIR>\.<name>.partial" --no-password <conn>
```
then `fs.rename` → final name (atomic same-volume; rename-on-success also implements D-02's "only successful dumps count"). Use filename pattern like `football_prediction-20261022T033000Z.dump`.

- **Binary resolution (fail-closed):** `PG_BIN` env (dir containing `pg_dump.exe`); if unset → resolve from `PATH`; if still absent → **recommended fallback:** `docker exec <app postgres container> pg_dump -Fc -U <user> -d <db> -f -` piping stdout to the file (verified present in container: `pg_dump (PostgreSQL) 18.6` [VERIFIED: in-session probe on `football-prediction-platform-postgres-1`]). If neither available → failed `BackupRun` row + non-green status; never silently skip.
- **Pitfall — `docker exec` default user:** container exec runs as `root`, so client tools try role `root` → `FATAL: role "root" does not exist` [VERIFIED: in-session failing probe, exact output: `pg_restore: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL: role "root" does not exist`]. **Always pass explicit `-U <role>`.**
- **Pitfall — PowerShell `>` corrupts binary stdout** if an operator tests manually; in Node, pipe the stream and `createWriteStream` — never shell-redirect.
- **Pitfall — version skew:** `pg_dump` major must be ≥ server major. Container-fallback guarantees parity (both 18.6 here).
- **Credentials:** pass via env (`DATABASE_URL` or `PGPASSWORD`/`PGHOST`…), never argv. Add `--no-password` so a missing credential fails fast instead of hanging a scheduled job on a prompt [CITED: postgresql.org/docs/current/app-pgrestore.html — `-w/--no-password`: "Never issue a password prompt… the connection attempt will fail"].
- **Exit codes [VERIFIED: in-session probes]:** `pg_dump` → `0` success (`WARN_EXIT=0` probe), `1` on fatal (connection-failure probe: `DUMP_FATAL_EXIT=1`). Rule: **treat any non-zero as a failed backup**; do not rotate.
- **Optional hardening:** `-Fc` compression level `-Z6` default is fine; `--no-privileges --no-owner` at dump time simplifies restore further (harmless given restore-side flags below).

**Restore (drill):**
```
pg_restore -U postgres -d bet_stats --no-owner --no-privileges --exit-on-error "<latest.dump>"
```
- **Verified live this session:** restoring a full 25-migration schema (with enum types, plpgsql trigger functions, triggers) into a fresh empty database with exactly these flags → exit 0, data intact [VERIFIED: in-session round-trip probe; output `RESTORE_EXIT=0`, `3` rows].
- **Flag semantics** [CITED: postgresql.org/docs/current/app-pgrestore.html]:
  - `-O/--no-owner`: "Do not output commands to set ownership of objects to match the original database… any user name can be used for the initial connection, and this user will own all the created objects" — **mandatory** (dump owner `football_prediction` doesn't exist in the throwaway container; only `postgres` does).
  - `-x/--no-privileges`: "Prevent restoration of access privileges (grant/revoke commands)."
  - `-e/--exit-on-error`: "Exit if an error is encountered… The default is to continue and to display a count of errors at the end" — without it, a restore can partially fail and still exit 0. **Mandatory for fail-closed drills.**
  - `-1/--single-transaction`: all-or-nothing, implies `-e`; mutually exclusive with `-j`. Optional (nice for integrity), fine at this data scale.
  - `--clean` + `--if-exists`: only needed when restoring into a non-empty DB. **Pitfall verified live:** re-restore without `--clean` fails with `pg_restore: error: could not execute query: ERROR: type "CircuitState" already exists`; with `--clean --if-exists --exit-on-error` the same re-restore exits 0 [VERIFIED: in-session probes]. Docs: "`--if-exists`… is not valid unless `--clean` is also specified."
- **Restore target:** connect directly with `-d` to the throwaway container's `POSTGRES_DB` (container creates it at boot) — do **not** use `-C/--create` (archive's original DB name would be created instead).
- **Encoding:** custom format is encoding-portable; container defaults to UTF8, production compose does too — no action.
- **Exit-code rule:** success = 0; anything else = failed drill step (record in receipt with captured stderr excerpt, redacted).

### Q2 — `prisma migrate deploy` + `migrate status` in the drill

**All of the following was executed in-session against a throwaway `postgres:18-alpine` with the repo's own Prisma 7.10.0** [VERIFIED: in-session probe]:

```
cd packages/database            # cwd MUST be the package — prisma.config.ts discovery
node node_modules/prisma/build/index.js migrate deploy    # → "All migrations have been successfully applied." exit 0
node node_modules/prisma/build/index.js migrate status    # at head: "Database schema is up to date!" exit 0
                                                        # pending:  "Following migrations have not yet been applied: …" exit 1
```
- **Exit codes:** `migrate status` → **1 when pending**, **0 at head** — the at-head check is simply `exitCode === 0` [VERIFIED: exact outputs quoted above]. `migrate deploy` → 0 on success.
- **Driver adapter NOT needed for CLI:** `prisma.config.ts` (read this session, 11 lines) supplies the URL:
  ```typescript
  export default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: env("DATABASE_URL") } });
  ```
  The `PrismaPg` adapter (`packages/database/src/client.ts:10-12`) is runtime-client-only. Just set `DATABASE_URL` in the child env (already proven by `verify-release-integration.mjs:46-50`).
- **Invocation shape:** reuse `execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: drillUrl } })` with `prismaCli = <repo>/packages/database/node_modules/prisma/build/index.js`.
- **Locating the migrations project at runtime (open point):** the verify script computes `databaseRoot` from its own module URL. A compiled worker (`workers/data-sync/dist/main.js`) sits deeper than `scripts/`; resolve via `new URL('../../../packages/database', import.meta.url)` or a `BACKUP_PRISMA_DIR` env override, fail-closed when `schema.prisma`/`migrations/` are absent (deployed worker without the repo checkout ⇒ drill FAILED with explicit reason).
- **Semantics:** dump carries schema as-of dump-time; `migrate deploy` applies any newer migration (drift-proof chain proof); `migrate status` exit 0 is the BAK-02 "at head" signal. Expect a fast no-op when backup and code are in sync.
- **Pitfall:** never run `migrate dev` in the drill (it can reset/shadow databases); `deploy` + `status` only.

### Q3 — robocopy off-host copy semantics

**Recommended flag set** (copy the single new dump file, non-destructive, bounded retries):
```
robocopy "<BACKUP_DIR>" "<BACKUP_OFFSITE_DIR>" "<filename>" /R:2 /W:5 /Z /XJ /COPY:DAT /NP /LOG+:"<BACKUP_DIR>\robocopy.log"
```
- `/R:2 /W:5` — critical: robocopy's **defaults are 1,000,000 retries / 30s wait** [CITED: learn.microsoft.com robocopy reference] — an unreachable SMB share would otherwise hang a worker slot for weeks.
- `/XJ` — exclude junctions (loop protection); `/Z` — restartable; `/COPY:DAT` is the default (data, attributes, timestamps) — stated explicitly; `/NP` — no progress noise; `/LOG+` — append history.
- **Do NOT use `/MIR` or `/PURGE`** (destructive mirror) for the off-site copy — the context's suggested `/E` applies when copying a whole tree; copying a single named file needs neither.
- **Exit-code interpretation (the critical pitfall — mental model confirmed):** robocopy codes are a **bitmask of result classes, not booleans**. Verbatim from Microsoft docs: *"Any value equal to or greater than **8** indicates that there was at least one failure during the copy operation"* [CITED: learn.microsoft.com/en-us/windows-server/administration/windows-commands/robocopy]. Codes 0–7 are success classes (0 = nothing copied but no failure — e.g. file already there; 1 = copied; 3 = copied + extras; 7 = copied + extras + mismatches). Node-side:
  ```typescript
  // success = code < 8 ; treat >= 8 (and spawn ENOENT errors) as off-host failure → DEGRADED state (D-06)
  const { code, error } = await spawnRobocopy(...);
  if (error || code === undefined || code >= 8) return { status: "DEGRADED", robocopyExitCode: code ?? null };
  ```
- Also: robocopy is Windows-only (fine — single Windows host); wrap it behind an interface for unit-testability; a destination that already has the file yields code 0 or 3 — both success.
- Verify the copy independently if desired: compare `statSync(file).size` against robocopy's parsed summary — optional; the exit bitmask plus size check is enough for MVP.

### Q4 — Scheduling in BullMQ

**Recommendation (fits locked D-03 best): the `scheduleRetentionPurge` setTimeout pattern**, adapted: arm delay = `max(0, lastSuccess + intervalMs - now())` computed from the DB (`BackupRun` latest success; none → enqueue soon after start), run → `queue.add(...)` → re-arm. Rationale: zero new BullMQ API surface, self-healing across restarts/downtime (retention-purge recomputes from persisted state — verbatim its `arm()` structure at `retention-purge.ts:46-66`), and the app already stores UTC instants so interval math is trivial. Weekly drill = same function with 7d interval, armed from latest `BackupVerificationReceipt`.
**If wall-clock anchoring is desired instead** (e.g. "backup daily at 03:30 UTC sharp"): `queue.upsertJobScheduler('daily-backup', { pattern: '0 30 3 * * *', tz: 'UTC' }, { name, data, opts })` — the **only** v6 repeat API. Pitfalls:
- v5 `repeat:` option is gone (see Pattern 3) — hard runtime failure, not deprecation.
- Duplicate-scheduler pitfall is solved by upsert semantics ("without duplications") + stable scheduler ids; cron changes create/update under the same id.
- Timezone: cron evaluates in `tz` — always pass `tz: 'UTC'` (host TZ is the operator's local Windows zone; the app stores UTC).
- First run fires immediately for a **new** scheduler; an existing scheduler upserted later does not re-fire — don't rely on upsert for "run now" (that's what the manual trigger endpoint is for).
- Jobs are produced only after the previous run starts processing — a slow backup can push the next tick late; acceptable for daily cadence.
- Duplicate-enqueue across restart: the interval pattern has no repeatable-job duplication question at all (this is a real benefit for a single-host deployment).

### Q5 — Chain-integrity SQL checks (against the restored throwaway DB)

**Canonical tables** — confirmed from `packages/database/prisma/schema.prisma` (model names = table names; **no `@@map` anywhere**, tables are quoted PascalCase): `Team` (line 154), `Fixture` (line 184), `ForecastSnapshot` (line 612), `ValueReceipt` (line 778), plus recommended additions `League` (91), `Season` (107), `ResultVersion` (805), `SettlementReceipt` (830), `ManualOddsSnapshot` (660). Non-empty check: `SELECT count(*) FROM "Team"` > 0, etc. (note: a brand-new platform may legitimately have zero `ValueReceipt`s — gate on whichever tables the operator's source DB has non-zero, captured at drill start: `restored == source ? (source == 0 ? skip : fail if restored == 0) : fail`).

**Generic FK-orphan check (all FKs, zero hardcoding — survives future migrations):**
```sql
DO $$
DECLARE r RECORD; orphans BIGINT; total_orphans BIGINT := 0;
BEGIN
  FOR r IN (
    SELECT c.oid, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
      (SELECT string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' AND ' ORDER BY k.ord)
         FROM unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(cnum, pnum, ord)
         JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.cnum
         JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.pnum) AS join_pred
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.conrelid
    WHERE c.contype = 'f' AND n.nspname = 'public'
  ) LOOP
    EXECUTE format('SELECT count(*) FROM %s c LEFT JOIN %s p ON %s WHERE p.oid IS NULL',
                   r.child, r.parent, r.join_pred) INTO orphans;
    IF orphans > 0 THEN RAISE EXCEPTION 'FK orphans: % in %', orphans, r.child; END IF;
    total_orphans := total_orphans + orphans;
  END LOOP;
  RAISE NOTICE 'fk_orphan_total=%', total_orphans;
END $$;
```
(For a plain-query variant, execute per-FK `SELECT count(*)` from the same cursor via `$queryRaw` in Node and sum — easier to record per-relation counts in the receipt. The `DO`-block shape above is the fail-fast form.)
**Curated supersession-chain checks** (recommended per `.planning/research/PITFALLS.md` — "no orphan `supersedes*Id`, no broken receipt→snapshot links"):
```sql
SELECT count(*) FROM "ForecastSnapshot" f LEFT JOIN "ForecastSnapshot" p ON f."supersedesForecastId" = p.id WHERE f."supersedesForecastId" IS NOT NULL AND p.id IS NULL;   -- 0
SELECT count(*) FROM "ValueReceipt" v JOIN "ForecastSnapshot" fs ON v."forecastSnapshotId" = fs.id JOIN "ManualOddsSnapshot" m ON v."oddsSnapshotId" = m.id WHERE fs."fixtureId" <> v."fixtureId" OR m."fixtureId" <> v."fixtureId";  -- 0
SELECT count(*) FROM "SettlementReceipt" s WHERE s.revision > 1 AND s."supersedesSettlementReceiptId" IS NULL;  -- 0
```

**Row-count parity (with the live-DB race handled honestly):** capture per-table counts from the **source** at drill start (C0), compare after restore (R). For append-only canonical tables a healthy dump guarantees `R ≥ C0` (dump snapshot ≥ capture time). Recommended rule: **FAIL when `R < C0`** (proves truncation/loss — the real signal D-09 wants); `R > C0` means live writes landed between capture and dump snapshot — record the delta in the receipt, do not fail. Capture counts with one `UNION ALL` pass:
```sql
SELECT 'League' t, count(*)::bigint n FROM "League" UNION ALL SELECT 'Season', count(*) FROM "Season"
  UNION ALL SELECT 'Team', count(*) FROM "Team" UNION ALL SELECT 'Fixture', count(*) FROM "Fixture"
  UNION ALL SELECT 'ForecastSnapshot', count(*) FROM "ForecastSnapshot" UNION ALL SELECT 'ValueReceipt', count(*) FROM "ValueReceipt"
  /* …… */ ;
```
Run identically against source (drill start) and restored DB (post-migrate). Store both maps in the receipt JSON.

### Q6 — Config/env conventions for `BACKUP_*`

- Existing convention: **Zod schema in `packages/config/src/index.ts`**, validated by `readServerConfig(process.env)` (worker `main.ts:95`, throws `ConfigValidationError` listing issues) [VERIFIED: packages/config/src/index.ts:10-49]. Secret-redaction regex lives there too: `const sensitiveKey = /(?:token|password|secret|api.?key|authorization|database.?url)/i` (line 51) with `redactSecrets()` — reuse for any path/metadata surfaced in the ops block.
- **Fail-closed sub-config pattern:** follow `readPrivacyRetentionConfig` (lines 91-103): "Invalid or absent inputs remain absent so callers deterministically fail closed" — absent `BACKUP_DIR` ⇒ `undefined` ⇒ status NOT_CONFIGURED, never a default directory.
- Recommended reader:
  ```typescript
  export type BackupConfig = { enabled: boolean; dir?: string; offsiteDir?: string; retentionCount?: number;
    drillIntervalMs?: number; pgBinDir?: string; dockerFallbackEnabled: boolean;
    pgUser?: string; pgDb?: string };
  export function readBackupConfig(input: Record<string, string | undefined>): BackupConfig
  // BACKUP_ENABLED: only "true"/"1" enable (default false)
  // BACKUP_DIR, BACKUP_OFFSITE_DIR: trimmed, must be absolute; absent → undefined (NOT_CONFIGURED state)
  // BACKUP_RETENTION_COUNT: safe integer 1..365, default 14 (D-02); invalid → undefined → fail closed, not silent default
  // BACKUP_DRILL_INTERVAL_HOURS: default 168 (D-10)
  // PG_BIN: optional directory of PG 18 client tools; absent → PATH → docker-exec fallback
  // BACKUP_PG_USER, BACKUP_PG_DB: optional non-empty strings — docker-exec fallback identity (Q2);
  //   absent → container env printenv POSTGRES_USER/POSTGRES_DB → fail-closed PG_IDENTITY_UNRESOLVED
  ```
- **There is no `.env.example` in the repo today** [VERIFIED: glob for `.env.example` → none] — env is injected by the launcher (`scripts`/app-lifecycle per STATE.md) and CI secrets. The phase should either create `.env.example` documenting the `BACKUP_*` names (recommended; no secrets in it) or document them in README's operator section. Do **not** read or modify the real `.env`.
- Worker wiring: extend the `if (config.DATABASE_URL && …)` start gate in `workers/data-sync/src/main.ts:101` with `readBackupConfig(process.env)`; when `enabled && dir` → arm schedulers + create queue/worker; else log `{"event":"backup.disabled"}` and expose NOT_CONFIGURED.
- **Not required in the production-required superRefine** (backups are opt-in per D-04) — validation only for shape, not presence.

### Q7 — Verification receipt model (append-only) + migration workflow

- **Models to add** (names to confirm — research SUMMARY.md already anticipated `BackupVerificationReceipt`):
  - `BackupRun` — one row per backup attempt: id, startedAt, completedAt, status (`SUCCEEDED`/`FAILED`), fileName, byteSize, durationMs, offsiteStatus (`NOT_CONFIGURED`/`COPIED`/`DEGRADED`), offsiteError (safe code), dbVersion, trigger (`SCHEDULED`/`MANUAL`), createdAt.
  - `BackupVerificationReceipt` — one row per drill (D-12 fields): backupFileName, restoreDurationMs, checksJson (per-check pass/fail + detail, e.g. `migrateStatus`, `fkOrphans`, per-table parity), containerCleanup (`REMOVED`/`FAILED`), dbVersion, overall (`VERIFIED`/`FAILED`/`UNVERIFIED`), startedAt, completedAt.
  - Follow `RetentionPurgeAudit` shape for field typing [VERIFIED: schema.prisma:753-763 — `id String @id`, `@db.Timestamptz(3)` instants, `Int` counts, `@@index([completedAt])]` — quoted verbatim] — but **add the frozen trigger** (RetentionPurgeAudit has none; receipts must have one per CI-04 discipline).
- **Immutability pattern** — reuse the canonical frozen trigger [VERIFIED: packages/database/prisma/migrations/20260908_phase04_settlement_receipts/migration.sql:33 — verbatim: `IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'SettlementReceipt is immutable'; END IF;`], wired as `CREATE TRIGGER "BackupVerificationReceipt_guarded_append_only" BEFORE UPDATE OR DELETE ON "BackupVerificationReceipt" FOR EACH ROW EXECUTE FUNCTION guard_backup_verification_receipt();` (simpler than ForecastSnapshot's guard — append-only means **no** UPDATE at all, mirroring `ForecastScore`: `IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'ForecastScore is immutable'; END IF;` [VERIFIED: 20260908_phase04_z_score_facts/migration.sql:19]).
- **Migration workflow:** migrations in this repo are **hand-authored folders** with custom (non-default) names — e.g. `20260927_retention_quarantine_erasure`, `20260924_retention_purge_audit` [VERIFIED: directory listing] — each containing a `migration.sql` of explicit DDL + triggers. Add `packages/database/prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql` (hand-written SQL, quoted identifiers, TIMESTAMPTZ(3), CHECK constraints), keep schema.prisma in sync, then apply with `pnpm --filter @bet-stats/database exec prisma migrate dev` (README:112/261 documents `prisma migrate dev --name <name>`; hand-edited folder + `migrate dev` to apply is equivalent here). Validate via the existing `pnpm verify:release:schema` gate. CI's mutation-rejection suite (`tests/integration/mutation-rejection.test.ts`, CI-04) should be extended with UPDATE/DELETE rejection cases for the new receipt tables.

### Q8 — Manual trigger wiring (end-to-end chain)

Existing chain (all read this session): operator browser → operator-gateway (basic auth; injects `x-operator-subject/timestamp/signature` HMAC headers, `infra/operator-gateway/server.mjs:18`) → web `/internal-api/operations/[[...path]]/route.ts` (verifies HMAC incl. **method** in canonical string, then proxies to `API_ORIGIN` with `x-operator-credential`) → API `OperationsController` `@Controller("internal/operations")` + `@UseGuards(OperatorGuard)`.

Wiring steps:
1. **Web proxy:** change upstream fetch to `method: request.method` and add `export const POST = proxy;` (route.ts:49,53). Method already covered by signature verification (line 35). No new secret surface.
2. **API controller:** add
   ```typescript
   @Post("backups/run")   triggerBackup()  { return this.operations.triggerBackup("MANUAL"); }
   @Post("backups/drill") triggerDrill()   { return this.operations.triggerDrill("MANUAL"); }
   ```
   Both return `202 { queued: true }` (or `409`/`404 "Not found"` when backups disabled — mirroring `OperatorGuard`'s NotFound-on-bad-credential convention to avoid oracle leaks).
3. **API → queue:** in `OperationsService`, construct the backup queue lazily like `results-sync.service.ts:178` / `replay.service.ts:34`: `new Queue<BackupJobData>(backupQueueName(prefix), { connection: { url: config.REDIS_URL!, maxRetriesPerRequest: null } })`, `queue.add("backup", { trigger: "MANUAL", requestedBy: actor }, { jobId: \`manual-backup-${Date.now()}\` })` (distinct from scheduler-produced jobs; BullMQ scheduler jobs have generated ids so no collision).
4. **Web UI:** two buttons in the new Block (pattern: existing `button` const, `role="status"` feedback, Russian labels «Создать резервную копию сейчас», «Запустить проверку восстановления сейчас», disabled while pending), POST via `fetch("/internal-api/operations/backups/run", { method: "POST" })`. Status refresh via the existing overview `load()`.
5. Worker consumes `bet-stats-backup` queue with the same run functions as the schedulers — one execution path, two triggers.

## Common Pitfalls

### Pitfall 1: BullMQ v5 API under v6
**What goes wrong:** `queue.add(name, data, { repeat: {...} })` throws — removed in v6.
**Why:** v6 replaced repeatables with Job Schedulers.
**Avoid:** use the retention-purge setTimeout pattern (D-03) or `upsertJobScheduler`; add a unit test asserting the scheduler arms/enqueues.

### Pitfall 2: robocopy exit code treated as boolean
**What goes wrong:** `code !== 0` → false failure (codes 2–7 are success) or `code === 8+` treated as success via `error === null`.
**Avoid:** `success = typeof code === "number" && code < 8`; unit-test with 0,1,3,7,8,16 fixtures.

### Pitfall 3: `docker exec` client tools auth as `root`
**What goes wrong:** `FATAL: role "root" does not exist` (captured live).
**Avoid:** always `-U <role>`; wire the container env user from config.

### Pitfall 4: restore without `--exit-on-error`
**What goes wrong:** pg_restore counts errors and can finish with 0 despite a broken restore — a green drill on a corrupt restore.
**Avoid:** `--exit-on-error` mandatory; exit 0 strictly.

### Pitfall 5: rotation deletes before the new dump succeeds
**What goes wrong:** failed dump + old rotation = data loss window.
**Avoid:** D-02 ordering: dump to `.partial` → verify exit 0 + size > threshold → rename → **then** prune to last N **successful** dumps.

### Pitfall 6: scheduled job hangs on password prompt
**What goes wrong:** `pg_dump` prompts on stderr/stdin when creds are missing → stuck job, no receipt.
**Avoid:** `--no-password` + non-interactive check; job timeout (e.g. 30 min) that records FAILED.

### Pitfall 7: parity check false-fails on live writes
**What goes wrong:** strict equality fails whenever the app writes between count-capture and dump snapshot.
**Avoid:** Q5 rule — fail on `R < C0`; record positive deltas.

### Pitfall 8: secrets leaking into Redis, receipts, or UI
**What goes wrong:** `DATABASE_URL` in job data (Redis-persisted), connection strings in `checksJson`, paths with embedded creds rendered in the Block.
**Avoid:** job data = `{ trigger }` only; receipt fields = safe metadata; run ops payloads through `redactSecrets()`; D-15 + tests asserting no `postgresql://` substring in the overview payload.

### Pitfall 9: drill passes on an empty/near-empty backup
**What goes wrong:** zero-row canonical tables still "restore" fine.
**Avoid:** non-empty checks keyed on source-captured counts; zero-source tables recorded as SKIPPED, never as PASSED.

### Pitfall 10: stale rendered green after worker downtime
**What goes wrong:** last receipt was weeks ago but UI shows green.
**Avoid:** D-14 staleness math (backup > ~25h, drill > interval + grace) computed at read time in the projection, not stored.

## Code Examples (verified in-repo patterns)

### Throwaway container + migrate (canonical — `scripts/verify-release-integration.mjs:36-50`)
```typescript
docker("run", "--detach", "--name", postgres, "--env", "POSTGRES_PASSWORD=postgres",
  "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
await waitFor(postgres, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"], 500);
execFileSync(process.execPath, [prismaCli, "migrate", "deploy"],
  { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit" });
```

### Prisma client against the restored DB (runtime checks — `packages/database/src/client.ts:5-13`)
```typescript
const drillClient = createPrismaClient(drillDatabaseUrl); // PrismaPg adapter, runtime only
```

### Redis connection option for new queue (`workers/data-sync/src/queues/index.ts:146`)
```typescript
export function redisConnection(redisUrl: string) { return { url: redisUrl, maxRetriesPerRequest: null as null }; }
```

### Operations read-model seam (`apps/api/src/modules/operations/operations.service.ts:15-22`)
```typescript
export interface OperationsRepository {
  readiness(): Promise<ReadinessFact>;
  providerHealth(since: Date): Promise<ProviderHealthFact[]>;
  quotas(since: Date): Promise<QuotaFact[]>;
  failures(since: Date): Promise<FailureFact[]>;
  dataQuality(since: Date): Promise<DataQualityFact[]>;
  incidents(since: Date): Promise<IncidentFact[]>;
  // ADD: backups(): Promise<BackupFact>;   // last run, last drill receipt, computed states
}
```
The projection's `overview()` `Promise.all` (line 46-48) gains `repository.backups()`; return shape adds a `backups` section with `state: "NOT_CONFIGURED" | "NEVER_VERIFIED" | "STALE" | "FAILED" | "HEALTHY"` (+ reasons array), computed fail-closed.

### Web Block (UI seam — `apps/web/app/internal/operations/page.tsx:24-31`)
Reuse the existing `Block` component verbatim (Russian title, `loading`/`error`/`empty`/`onRetry`, `aria-busy`); state vocabulary in Russian per `enum-labels` convention (e.g. «Никогда не проверялось», «Устарело», «Сбой», «Не настроено», «Здорово»).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BullMQ `repeat` on `Queue.add` | `Queue.upsertJobScheduler(id, repeatOpts, template)` | deprecated 5.16.0, **removed in v6** | Any v5-style repeat code fails at runtime under ^6.3.2 |
| `repeat.utc: true` | `tz: 'UTC'` in repeat options | v6 | Use explicit `tz` for all cron patterns |
| Host-installed pg tools assumed | PG_BIN → PATH → `docker exec` fallback | this session's environment probe | Host has no PG install; fallback keeps phase shippable |

**Deprecated/outdated:**
- `QueueScheduler` class — unneeded since BullMQ 2.0.
- `immediately` repeat option — deprecated 5.19; new schedulers always fire immediately.
- Axios (project already avoids it — child `fetch`/`execFileSync` only).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The worker process runs with access to the repo checkout (so `packages/database/node_modules/prisma/build/index.js` + `prisma/migrations` are resolvable), matching the operator-host deployment via launcher scripts | Q2 | Drill cannot locate Prisma project → drill FAILED (fail-closed); mitigate with `BACKUP_PRISMA_DIR` env override |
| A2 | The app's production PostgreSQL runs in the compose container `football-prediction-platform-postgres-1` (name prefix `football-prediction-platform`) and stays up while backups run — the `docker exec` dump fallback targets it | Q1, Env | Container-down ⇒ backup fails (honest FAILED state); `PG_BIN` path unaffected |
| A3 | Dump volume fits the default `-Fc` compression on one host (tens of MB scale for this domain) | Q1, Q3 | Large dumps would need `-Z` tuning/splitting; retention of 14 stays cheap |
| A4 | `robocopy` availability is required only when `BACKUP_OFFSITE_DIR` is configured (off-site remains optional per D-05/D-06) | Q3 | None — unconfigured off-site is an explicit non-green state, not a failure |
| A5 | Two new tables (`BackupRun`, `BackupVerificationReceipt`) are acceptable scope for the planner (D-12 mandates the receipt; the run catalog is the honest way to render BAK-01 status) | Q7 | If the planner wants one table, the read model can fall back to filesystem scan — weaker (no failure history) |
| A6 | Migration folder name `20261022_phase08_backup_verification_receipts` follows the repo's hand-named convention (exact name is planner's call) | Q7 | Cosmetic; Prisma accepts custom prefixes (25 existing migrations prove it) |
| A7 | Retention default N=14 and drill default 7d encoded as env defaults in `readBackupConfig` (per D-02/D-10 + agent discretion on names) | Q6 | Config names only; contract-free (D-02 reversibility note) |

## Open Questions / Verify at Implementation (RESOLVED)

1. **Dump strategy on the operator host** — `PG_BIN` (operator installs PG 18 client tools) vs `docker exec` into the app's postgres container vs both-with-fallback. Recommendation: `PG_BIN` → PATH → docker fallback (all fail-closed). The context's "PG_BIN/PATH, fail-closed if absent" wording permits the fallback; confirm with planner. *(Probe evidence: no host PG tools exist today.)* **(RESOLVED → Plan 01 Task 1: `PG_BIN` → PATH → docker-exec fallback chain, fail-closed — and since the host has no PG install, docker exec is the default live path)**
2. **`docker exec` dump connection details** — needs the container's role/db (compose defaults `POSTGRES_USER:-football_prediction`, but `.env` may override — **not read** per secret-guard). Implementation must read the container env (`docker exec <c> printenv POSTGRES_USER`) or receive `BACKUP_PG_USER`/`BACKUP_PG_DB` config rather than hardcoding. **(RESOLVED → Plan 01 Task 1: `BACKUP_PG_USER`/`BACKUP_PG_DB` config keys → container `printenv` read → fail-closed `PG_IDENTITY_UNRESOLVED`; Plan 02 Task 1 applies the same chain (Plan 01's `resolvePgIdentity`) to the drill's `pg_restore` -U/-d and throwaway container env)**
3. **Parity strictness** — Q5 proposes fail-on-`R<C0`, record positive deltas. Confirm the planner accepts this as satisfying D-09's "row-count parity" (strict equality would false-fail under live writes). **(RESOLVED → Plan 02 Task 2: fail-on-`R<C0`, positive deltas recorded in the receipt — satisfies D-09 honestly)**
4. **`pg_dump` warning exit semantics** — official docs: fatal → 1; observed non-fatal → 0. Not every warning class was exercised; the implementation's "exit 0 only" rule makes this moot, but do not loosen it. **(RESOLVED → Plan 01 Task 1: any non-zero pg_dump exit ⇒ FAILED row, no rotation; the exit-0-only rule is kept verbatim)**
5. **Drill `postgres:18-alpine` vs production `postgres:18.6-alpine`** — same major, patch skew harmless for restore; keep harness on `postgres:18-alpine` per D-07, or pin `18.6-alpine` for exact parity — planner's call. **(RESOLVED → Plan 02: harness stays on `postgres:18-alpine` per locked D-07; 18.6-vs-18 patch skew is restore-safe)**
6. **Backup file id** — D-14 mentions "file id"; use filename + size + sha256 (compute while dumping, store in `BackupRun`) — confirm planner wants the hash. **(RESOLVED → Plan 01 Task 1: sha256 streamed from the `.partial` file and stored in `BackupRun.sha256` as the file id; surfaced in Plan 03's `BackupFact.lastBackup`)**
7. **Privacy interaction** — dumps contain privacy-domain rows (retained odds histories) for up to N=14 days after erasure; out of scope to solve, but the planner should add an operator note (dumps are sensitive: recommend ACL-hardened `BACKUP_DIR` and encrypted off-site destination if the share is untrusted). **(RESOLVED → Plan 01 Task 1: README operator note — dumps embed personal data up to retention days; ACL-harden `BACKUP_DIR`, encrypt the off-site destination; documentation only, no code change)**

## Validation Architecture

> `.planning/config.json` → `workflow.nyquist_validation: true` [VERIFIED: config.json:25] — section enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (root devDependency), projects `unit` + `integration` [VERIFIED: vitest.config.ts:14-40] |
| Config file | `vitest.config.ts` (root); integration = `tests/integration/**/*.test.ts`, `fileParallelism: false` |
| Quick run | `pnpm vitest run --project unit` / targeted: `pnpm vitest run --project integration tests/integration/backup-restore-drill.test.ts` (Node 24 via `.tools/node24` on PATH) |
| Full suite | `pnpm test` (unit + web) and `pnpm test:integration` (Docker required — harness pattern) |
| Release gate | `pnpm verify:release` already chains schema validate → typecheck → unit → owned-container integration → build |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| BAK-01 | `readBackupConfig` fail-closed gating (disabled/dir-missing/invalid retention) | unit | `pnpm vitest run --project unit packages/config` | `packages/config/src/index.test.ts` (extend) |
| BAK-01 | retention rotation: prune to N after success only; never delete-before-success | unit | same | new `tests/unit/backup-job.test.ts` |
| BAK-01 | robocopy exit-bitmask interpretation (0,1,3,7 pass; 8,16,ENOENT fail → DEGRADED) | unit | same | `backup.test.ts` |
| BAK-01 | real `pg_dump -Fc` roundtrip + atomic rename + rotation on throwaway container | integration | `pnpm test:integration` (targeted filter) | new `tests/integration/backup-restore-drill.test.ts` |
| BAK-02 | full drill: container → restore → deploy → status-at-head → checks → receipt → cleanup | integration | `pnpm test:integration` | `tests/integration/backup-restore-drill.test.ts` |
| BAK-02 | drill fail-closed: Docker unavailable ⇒ FAILED receipt (never green) | integration | same | `backup-restore-drill.test.ts` |
| BAK-02 | receipt immutability: UPDATE/DELETE rejected (`P0001`) | integration | same | extend `tests/integration/mutation-rejection.test.ts` (CI-04 pattern) |
| BAK-02 | `migrate status` semantics used correctly (pending → non-zero ⇒ UNVERIFIED) | integration (empirical behavior already verified this session) | same | `backup-restore-drill.test.ts` |
| BAK-03 | overview `backups` section: NOT_CONFIGURED / NEVER_VERIFIED / STALE / FAILED / HEALTHY computation incl. 25h staleness | unit | `pnpm vitest run --project unit` | extend `apps/api` operations tests / projection test |
| BAK-03 | no secrets in overview payload (no `postgresql://`, no credential substrings) | unit + integration | `pnpm test` | extend `tests/integration/operator-overview.test.ts` |
| BAK-03 | manual trigger endpoints enqueue jobs; unsigned/bad-credential ⇒ 404 | integration | `pnpm test:integration` | extend `operator-overview.test.ts` |
| BAK-03 | web proxy POST passthrough + method-in-signature rejection | unit (route test) | `pnpm --filter @bet-stats/web test` | extend `apps/web/app/internal-api/operations/[[...path]]/route.test.ts` |
| BAK-03 | UI Block renders 5 states (Russian labels, non-green honesty) | web unit | `pnpm --filter @bet-stats/web test` | web components test |

### Sampling Rate
- **Per task commit:** `pnpm test` (unit) — <30s budget; touched integration file for DB tasks.
- **Per wave merge:** `pnpm test:integration` (Docker up).
- **Phase gate:** `pnpm verify:release` green (includes owned-container integration + schema validation) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/integration/backup-restore-drill.test.ts` — new harness test (needs Docker; follows `verify-release-integration.mjs` shape).
- [ ] `tests/unit/backup-job.test.ts` + `tests/unit/backup-drill.test.ts` — unit-level orchestration tests with injected `docker`/`execFile` fakes (the job modules must accept injected exec functions, like `scheduleRetentionPurge` injects timers — keep testability symmetry).
- [ ] Extend `tests/integration/mutation-rejection.test.ts` with the two new receipt tables.
- [ ] Web route test file exists for operations proxy (`route.test.ts` pattern is proven under `internal-api/privacy`) — add operations-POST cases.
- [ ] No framework installs needed.

## Security Domain

`security_enforcement` is enabled (absent from config = enabled). Applicable ASVS categories:

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V5 Input Validation | yes | `readBackupConfig` Zod schema; drill validates backup filename against strict pattern before passing to shell-less `execFileSync` argv arrays (no shell string interpolation — `execFileSync` with args array prevents injection) |
| V4 Access Control | yes | `OperatorGuard` on trigger endpoints; web proxy HMAC (method-bound) + gateway basic auth — reuse unchanged |
| V3 Session Management | no | — |
| V2 Authentication | no | — (operator auth pre-exists) |
| V6 Cryptography | no new crypto | HMAC-SHA256 proxy signing already in place; no hand-rolled crypto |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential leak via child-process argv / Redis job data / receipt JSON | Information Disclosure | env-only credentials; job data carries `{trigger}` only; `redactSecrets()` on read model; payload tests (D-15) |
| Malicious/compromised off-site share feeding poisoned dump back | Tampering | drills always restore the **local latest**; optional sha256 recorded in `BackupRun`; `pg_restore` warning in official docs ("Restoring a dump causes the destination to execute arbitrary code of the source superusers' choice") — only restore self-produced dumps |
| Backup rot (silent staleness) | Repudiation | append-only `BackupRun`/`BackupVerificationReceipt` + read-time staleness computation; fail-closed states |
| Path traversal via `BACKUP_OFFSITE_DIR`/filename | Tampering | config is operator-set; filenames generated by the system (timestamp), never from request input; argv-array exec |
| Unattended job hangs (prompt/lock) | DoS | `--no-password`, job timeout, drill container unique-name + `rm --force` in `finally` |

**Compliance note:** dumps embed privacy-domain personal data for up to retention days — flag as operator documentation item (Assumptions A7 / Open Question 7), not a code change this phase.

## Sources

### Primary (HIGH confidence)
- `scripts/verify-release-integration.mjs` (read in full, this session) — container harness, Prisma CLI invocation, env plumbing
- `workers/data-sync/src/jobs/retention-purge.ts`, `queues/index.ts`, `main.ts` (read) — scheduler + queue + composition-root patterns
- `apps/api/src/modules/operations/operations.service.ts` + `operations.controller.ts`, `apps/api/src/modules/reconciliation/operator.guard.ts` (read) — operations seam + guard
- `apps/web/app/internal/operations/page.tsx`, `apps/web/app/internal-api/operations/[[...path]]/route.ts` (read) — UI block + proxy (GET-only today; HMAC covers method)
- `packages/database/prisma/schema.prisma` (models, no `@@map`), `prisma.config.ts`, `src/client.ts`, migrations `20260908_phase04_settlement_receipts`, `20260905_phase03_forecast_value_snapshots`, `20260908_phase04_z_score_facts`, `20260924_retention_purge_audit` (read) — receipt/immutability templates
- `infra/docker-compose.yml`, `packages/config/src/index.ts`, root + workspace `package.json`s, `vitest.config.ts`, `README.md` (read) — versions, config, migration workflow
- **In-session empirical probes** (throwaway `postgres:18-alpine`, removed after): `migrate status` exit 1 pending / 0 at head; `migrate deploy` 0; full `pg_restore` round-trip with `--no-owner --no-privileges --exit-on-error` (exit 0); non-empty re-restore failure without `--clean`; `--clean --if-exists` success; `docker exec` root-role failure; `pg_dump` exit 0/1 behavior; host tool absence (`where.exe`); `robocopy` presence

### Secondary (MEDIUM confidence)
- [CITED: postgresql.org/docs/current/app-pgrestore.html] — flag semantics (`--no-owner`, `--no-privileges`, `--exit-on-error`, `--clean`/`--if-exists`, `-1`, `--no-password`), fetched this session
- [CITED: docs.bullmq.io/guide/job-schedulers, /guide/jobs/repeatable, /guide/job-schedulers/repeat-options] — v6 removal of `repeat`, `upsertJobScheduler` shape, `tz`, immediate-fire semantics, fetched this session
- [CITED: learn.microsoft.com/en-us/windows-server/administration/windows-commands/robocopy] — exit-code bitmask table + flag reference, fetched this session

### Tertiary (LOW confidence)
- [ASSUMED] Exact `pg_dump` behavior for every non-fatal warning class (only fatal=1 and clean-run=0 exercised) — see Open Question 4
- [ASSUMED] Operator-host deployment keeps the full repo checkout reachable from the worker (A1) — confirm deployment shape at implementation

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no new packages; all versions read from manifests this session
- Architecture: HIGH — every integration point read; full drill chain empirically executed against a throwaway container
- Pitfalls: HIGH — every major pitfall (root-role, non-empty restore, robocopy bitmask, BullMQ v6 removal, migrate exit codes) verified live or from primary docs
- Scheduling: HIGH for the locked interval pattern; MEDIUM for long-term cron-anchoring ergonomics (single-host uptime assumptions)

**Research date:** 2026-10-22
**Valid until:** 90 days (stack pinned; BullMQ/Prisma majors are frozen in-repo — re-verify only if `bullmq`/`prisma` versions change)
