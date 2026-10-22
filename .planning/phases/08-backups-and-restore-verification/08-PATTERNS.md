# Phase 8: Backups and Restore Verification - Pattern Map

**Mapped:** 2026-10-22
**Files analyzed:** 16 (11 new / 5 modified — plus 3 shared-pattern sources)
**Analogs found:** 13 / 16 (3 files have partial/no analog — see «No Analog Found»)

All analog paths verified git-tracked via `git ls-files` (no mirrors used).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/database/prisma/schema.prisma` (+`BackupRun`, +`BackupVerificationReceipt`) | model | append-only persist | `RetentionPurgeAudit` (schema.prisma:753) + `SettlementReceipt` (schema.prisma:830) | exact |
| `packages/database/prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql` | migration | DDL + triggers | `migrations/20260908_phase04_settlement_receipts/migration.sql` | exact |
| `workers/data-sync/src/jobs/backup.ts` | job (service) | file-I/O (batch: dump→rotate→copy) | `jobs/retention-purge.ts` (run fn + injected deps) + `scripts/verify-release-integration.mjs` (exec) | role-match |
| `workers/data-sync/src/jobs/backup-drill.ts` | job (service) | file-I/O (orchestration: container→restore→checks) | `scripts/verify-release-integration.mjs` (harness) + `jobs/retention-purge.ts` (injected exec fns) | role-match |
| `workers/data-sync/src/jobs/` backup + drill schedulers (`scheduleBackupTick`/`scheduleDrillTick`) | scheduler/utility | event-driven (timer, armed from DB state) | `scheduleRetentionPurge` (`retention-purge.ts:31-87`) | exact |
| `workers/data-sync/src/queues/index.ts` (+`createBackupQueue`/`createBackupWorker`) | config/wiring | pub-sub (BullMQ) | `createSettlementQueue`/`createSettlementWorker` (queues/index.ts:89-116) | exact |
| `workers/data-sync/src/main.ts` (scheduler + queue attachment) | composition root | wiring | itself (`main.ts:75`, `:91`) | exact |
| `packages/config/src/index.ts` (+`readBackupConfig`) | config | transform (env validation, fail-closed) | `readPrivacyRetentionConfig` (index.ts:91-103) | exact |
| `apps/api/src/modules/operations/operations.service.ts` (+`backups()` in repo + overview) | service/repository | request-response (read model) | itself (`operations.service.ts:15-22`, `:46-48`, `:76-105`) | exact |
| `apps/api/src/modules/operations/operations.controller.ts` (+`@Post` triggers) | controller | request-response | itself (`operations.controller.ts:1-21`) + `OperatorGuard` | exact |
| API-side backup `Queue` construction in `OperationsService` | service | pub-sub (enqueue) | `replay.service.ts:32-41` (`createBullReplayEnqueuer`) | exact |
| `apps/web/app/internal-api/operations/[[...path]]/route.ts` (GET-only → GET+POST) | middleware/proxy | request-response | `reconciliation/[[...path]]/route.ts:1-10` (method+body forwarding) + own HMAC (method already signed) | exact |
| `apps/web/app/internal/operations/page.tsx` (+Backups Block + trigger buttons) | component | request-response (fetch) | itself — `Block` component (`page.tsx:24-31`) | exact |
| `tests/unit/backup-job.test.ts`, `tests/unit/backup-drill.test.ts` (new unit) | test | — | injected-timer symmetry of `scheduleRetentionPurge`; injected exec fns | role-match |
| `tests/integration/backup-restore-drill.test.ts` (new) | test | — | `tests/integration/backtest-production.test.ts:35,97` (docker+Prisma harness) | role-match |
| `tests/integration/mutation-rejection.test.ts` (extend, CI-04) | test | — | itself (`:120-123` immutable-rejection pattern) | exact |

---

## Pattern Assignments

### `packages/database/prisma/schema.prisma` (model, append-only persist)

**Analog:** `RetentionPurgeAudit` (append-only audit shape) + `SettlementReceipt` (frozen receipt shape). No `@@map` anywhere — tables are quoted PascalCase.

**Append-only audit shape** (`schema.prisma:752-763`):
```prisma
/// Durable operational evidence for each idempotent expiry purge.
model RetentionPurgeAudit {
  id           String   @id
  startedAt    DateTime @db.Timestamptz(3)
  completedAt  DateTime @db.Timestamptz(3)
  cutoff       DateTime @db.Timestamptz(3)
  oddsDeleted  Int
  viewsDeleted Int
  createdAt    DateTime @default(now()) @db.Timestamptz(3)

  @@index([completedAt])
}
```

**Immutable receipt shape** (`schema.prisma:829-860`, condensed):
```prisma
/// Immutable evaluation fact bound to one exact result revision and frozen forecast.
model SettlementReceipt {
  id             String   @id
  ...
  receipt        Json
  settledAt      DateTime @db.Timestamptz(3)
  createdAt      DateTime @default(now()) @db.Timestamptz(3)
  @@index([fixtureId, settledAt])
}
```
Copy for `BackupRun` (status/offsiteStatus as `String`, counts/`Int`, `@@index([completedAt])`) and `BackupVerificationReceipt` (per-check JSON in a `Json` column, `overall String`, `@@index([completedAt])`). Field typing: `id String @id`, `@db.Timestamptz(3)` instants, `createdAt @default(now())`.

---

### `packages/database/prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql` (migration, DDL + triggers)

**Analog:** `packages/database/prisma/migrations/20260908_phase04_settlement_receipts/migration.sql` (hand-authored folder, custom name, explicit DDL + guard trigger). Simpler variant: `20260908_phase04_z_score_facts/migration.sql:19,35`.

**Frozen trigger (the canonical excerpt)** (`20260908_phase04_settlement_receipts/migration.sql:27-33,75`):
```sql
CREATE OR REPLACE FUNCTION guard_settlement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'SettlementReceipt is immutable'; END IF;
  ...
$$;
CREATE TRIGGER "SettlementReceipt_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "SettlementReceipt" FOR EACH ROW EXECUTE FUNCTION guard_settlement_receipt();
```
For the new receipts use the **minimal append-only form** (`20260908_phase04_z_score_facts/migration.sql:19`):
```sql
IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'BackupVerificationReceipt is immutable'; END IF;
```
Trigger naming convention: `"<Table>_guarded_append_only"`. Migrations are hand-authored folders (e.g. `20260924_retention_purge_audit`, `20260927_retention_quarantine_erasure`) — keep `schema.prisma` in sync; validate with `pnpm verify:release:schema`.

---

### `workers/data-sync/src/jobs/retention-purge.ts` → template for `backup.ts` / `backup-drill.ts` + schedulers (job + scheduler, file-I/O / event-driven)

**Analog:** `workers/data-sync/src/jobs/retention-purge.ts` (whole file, 79 lines).

**Injected-timer scheduler shape — copy verbatim for `scheduleBackupTick`/`scheduleDrillTick`** (`retention-purge.ts:28-44,46-66,80-87`):
```typescript
export type RetentionPurgeScheduler = Readonly<{ close(): void; refresh(): Promise<void> }>;

export function scheduleRetentionPurge(input: {
  database: PrismaClient;
  now?: () => Date;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  onError?: (error: unknown) => void;
  idlePollMs?: number;
  retryMs?: number;
}): RetentionPurgeScheduler {
  const now = input.now ?? (() => new Date());
  const setTimer = input.setTimeout ?? setTimeout;
  ...
  const arm = async (): Promise<void> => {
    if (closed) return;
    if (timer) clearTimer(timer);
    try {
      // arm delay from earliest PERSISTED timestamp (for backup: latest BackupRun success + 24h;
      // for drill: latest BackupVerificationReceipt + 7d; none → enqueue soon, idlePollMs)
      const rawDelay = ... Math.max(0, persisted.getTime() - now().getTime()) : (input.idlePollMs ?? 1_000);
      timer = setTimer(() => { void run().catch(input.onError); }, Math.min(MAX_TIMER_DELAY, rawDelay));
    } catch (error) { input.onError?.(error); if (!closed) timer = setTimer(() => { void arm(); }, input.retryMs ?? 1_000); }
  };
  void arm();
  return { close: () => { closed = true; if (timer) clearTimer(timer); }, refresh: arm };
}
```
**Testability symmetry:** jobs must accept **injected exec functions** (docker/execFile/robocopy) exactly like the scheduler injects timers — see research Wave-0 gap `backup.test.ts` with fakes.

**Core run-function shape** (`retention-purge.ts:7-24`): pure orchestration function returning a typed result, throwing a named error (`throw new Error("RETENTION_PURGE_AUDIT_MISSING")`) — `runBackup()`/`runBackupDrill()` should follow the same "orchestration + honest result" contract (research: custom code is orchestration + status bookkeeping only).

---

### `workers/data-sync/src/queues/index.ts` (config/wiring, pub-sub)

**Analog:** `createSettlementQueue`/`createSettlementWorker` (`queues/index.ts:89-116`) — the shape for `bet-stats-backup` queue + worker.

```typescript
// queues/index.ts:89-92, 98-116
export function settlementQueue(prefix = "bet-stats"): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Queue prefix contains unsupported characters");
  return `${prefix}-settlement`;
}
export function createSettlementQueue(input: { redisUrl: string; prefix?: string }) {
  const queue = new Queue<SettlementJobData>(settlementQueue(input.prefix), { connection: redisConnection(input.redisUrl) });
  return {
    enqueue: (data: SettlementJobData) => queue.add("settlement", data, {
      attempts: SETTLEMENT_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 1_000, jitter: 0.25 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
      jobId: createSettlementJobId(data).replaceAll(":", "-"),
    }),
    close: () => queue.close(),
  };
}
export function createSettlementWorker(input: { redisUrl: string; prefix?: string; execute: (data: SettlementJobData) => Promise<unknown> }) {
  return new Worker<SettlementJobData>(settlementQueue(input.prefix), (job) => input.execute(job.data), {
    connection: redisConnection(input.redisUrl), concurrency: 2, maxStalledCount: 2, lockDuration: 30_000,
  });
}
// queues/index.ts:146
export function redisConnection(redisUrl: string) { return { url: redisUrl, maxRetriesPerRequest: null as null }; }
```
**Anti-pattern warning (research-verified):** BullMQ v6 **removed** `Queue.add(..., { repeat })` — do NOT write v5 repeat options. The locked D-03 path is the retention-purge setTimeout scheduler; no cron library, no `upsertJobScheduler` needed.

---

### `workers/data-sync/src/main.ts` (composition root, wiring)

**Analog:** itself — where schedulers arm and close.

**Scheduler arming** (`main.ts:75`):
```typescript
const retentionPurgeScheduler = scheduleRetentionPurge({ database, onError: (error) => console.error(JSON.stringify({ event: "privacy.retention_purge.failed", error: error instanceof Error ? error.message : "UNKNOWN" })) });
```
**Config gate** (`main.ts:95,101-105`): `const config = readServerConfig(process.env);` then `if (config.DATABASE_URL && config.REDIS_URL && ...)` — extend this start gate with `readBackupConfig(process.env)`; when `enabled && dir` → create queue/worker + arm both schedulers, else log `{"event":"backup.disabled"}`.
**Close** (`main.ts:91`): `retentionPurgeScheduler.close(); ... await worker.close(); ... await database.$disconnect();` — backup/drill schedulers + queue/worker + backup `Queue` handle close identically. Logging convention: one JSON line per event (`console.info(JSON.stringify({ event: ... }))`).

---

### `packages/config/src/index.ts` (config, fail-closed env validation)

**Analog:** `readPrivacyRetentionConfig` (index.ts:87-103) + `redactSecrets` (index.ts:51-60).

```typescript
/**
 * Reads only explicit policy inputs. Invalid or absent inputs remain absent so
 * callers deterministically fail closed instead of guessing legal policy.
 */
export function readPrivacyRetentionConfig(input: Record<string, string | undefined>): PrivacyRetentionConfig {
  const duration = input.PRIVACY_RETENTION_DURATION_DAYS;
  const parsedDuration = duration === undefined ? undefined : Number(duration);
  ...
  return {
    durationDays: Number.isSafeInteger(parsedDuration) && (parsedDuration ?? 0) > 0 ? parsedDuration : undefined,
    ...
  };
}
```
`readBackupConfig` follows this exactly: absent/invalid `BACKUP_DIR`/`BACKUP_OFFSITE_DIR`/`BACKUP_RETENTION_COUNT` ⇒ `undefined` (status NOT_CONFIGURED — never a silent default directory). `ConfigValidationError` + `readServerConfig` (`index.ts:32-49`) is the throwing variant for shape validation; backups are opt-in (D-04) so do **not** add `BACKUP_*` to the production-required `superRefine`.
**Redaction for D-15** (`index.ts:51-54`):
```typescript
const sensitiveKey = /(?:token|password|secret|api.?key|authorization|database.?url)/i;
export function redactSecrets(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  ...
}
```

---

### `apps/api/src/modules/operations/operations.service.ts` (service/repository, request-response read model)

**Analog:** itself — the exact seam.

**Repository interface** (`operations.service.ts:15-22`) — add `backups()`:
```typescript
export interface OperationsRepository {
  readiness(): Promise<ReadinessFact>;
  providerHealth(since: Date): Promise<ProviderHealthFact[]>;
  quotas(since: Date): Promise<QuotaFact[]>;
  failures(since: Date): Promise<FailureFact[]>;
  dataQuality(since: Date): Promise<DataQualityFact[]>;
  incidents(since: Date): Promise<IncidentFact[]>;
  // ADD: backups(): Promise<BackupFact>;
}
```
**Overview `Promise.all` join point** (`operations.service.ts:44-48`):
```typescript
const query = validateQuery(raw);
const since = new Date(now().getTime() - query.windowHours * 3_600_000);
const [readiness, providerHealth, quotas, rawFailures, dataQuality, incidents] = await Promise.all([
  repository.readiness(), repository.providerHealth(since), repository.quotas(since), repository.failures(since), repository.dataQuality(since), repository.incidents(since),
]);
// ADD repository.backups() to the Promise.all; serialize a `backups` section into the return object
```
**Prisma repo implementation style** (`operations.service.ts:101-104`): raw-ish typed queries against the Prisma client, `MAX_GROUPS` cap, safe field helpers (`safeCode`/`safeIdentity`/`iso`, lines 26-29) — apply `redactSecrets`/path-redaction to backup file paths before they enter the payload. State computation (NOT_CONFIGURED / NEVER_VERIFIED / STALE / FAILED / HEALTHY) is computed **fail-closed at read time**, not stored (staleness math at read — Pitfall 10).
**Manual trigger** (D-13): local Queue creation copies `replay.service.ts:32-34` verbatim:
```typescript
// apps/api/src/modules/replay/replay.service.ts:32-34
export function createBullReplayEnqueuer(redisUrl: string, database: PrismaClient, prefix = "bet-stats") {
  const queue = new Queue(`${prefix}-sync-standard`, { connection: { url: redisUrl, maxRetriesPerRequest: null } });
```
Enqueue with distinct manual jobIds (`manual-backup-${Date.now()}`); job data carries `{ trigger: "MANUAL", requestedBy }` only — no secrets in Redis-persisted job data (Pitfall 8).

---

### `apps/api/src/modules/operations/operations.controller.ts` (controller, request-response)

**Analog:** itself — `@Controller("internal/operations")` + `@UseGuards(OperatorGuard)` already applied at class level (`operations.controller.ts:8-9`), so new `@Post` methods inherit the guard:
```typescript
@Controller("internal/operations")
@UseGuards(OperatorGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("overview")
  @Header("Cache-Control", "private, no-store, max-age=0")
  overview(@Query() query: Record<string, string | undefined>) { ... }
  // ADD:
  // @Post("backups/run")   triggerBackup()  { return this.operations.triggerBackup("MANUAL"); }
  // @Post("backups/drill") triggerDrill()   { return this.operations.triggerDrill("MANUAL"); }
}
```
**Guard convention** (`reconciliation/operator.guard.ts:13-18`) — bad/missing credential throws **404 "Not found"** (no oracle leak); mirror for 404/409 when backups are disabled:
```typescript
authorize(presented: string | undefined): { actor: "operator" } {
  if (!this.credential || !presented || !timingSafeEqual(digest(this.credential), digest(presented))) {
    throw new NotFoundException("Not found");
  }
  return { actor: "operator" };
}
```

---

### `apps/web/app/internal-api/operations/[[...path]]/route.ts` (middleware/proxy, request-response)

**Analog:** own HMAC verifier (method **already** in the canonical string — line 35) + `reconciliation/[[...path]]/route.ts` for method+body forwarding.

**What changes in the operations route** (lines 49, 53):
```typescript
// BEFORE: const response = await fetch(upstream, { method: "GET", ... });  export const GET = proxy;
// AFTER:  const response = await fetch(upstream, { method: request.method, ... });  export const POST = proxy;
// HMAC already binds the method — no new secret surface:
const canonical = `${subject}\n${timestamp}\n${request.method.toUpperCase()}\n${pathname}\n${queryDigest(request.nextUrl.search)}`;   // route.ts:35
```
**POST-forwarding shape to copy** (`reconciliation/[[...path]]/route.ts:7-10`):
```typescript
const response = await fetch(upstream, { method: request.method, headers: { "content-type": "application/json", "x-operator-credential": credential }, ...(request.method === "POST" ? { body: await request.text() } : {}), cache: "no-store" });
...
export const GET = proxy; export const POST = proxy;
```
The operations trigger POSTs have no request body beyond the path, so forwarding `request.method` alone suffices. **Test analog:** `apps/web/app/internal-api/privacy/[[...path]]/route.test.ts:16` (NextRequest with `method: "POST"` against the exported proxy) — add operations-POST + method-mismatch-rejection cases there.

---

### `apps/web/app/internal/operations/page.tsx` (component, request-response)

**Analog:** itself — reuse `Block` verbatim for «Резервные копии и проверка восстановления» (`page.tsx:17-19,24-31`):
```typescript
const button = { minHeight: 44, padding: "8px 14px" } as const;

function Block({ title, loading, error, empty, onRetry, children }: { title: string; loading: boolean; error: string; empty: boolean; onRetry(): void; children: React.ReactNode }) {
  return <section aria-labelledby={`${title.toLowerCase().replace(/[^a-zа-яё]+/g, "-")}-heading`} style={card} aria-busy={loading || undefined}>
    <h2 id={`${title.toLowerCase().replace(/[^a-zа-яё]+/g, "-")}-heading`}>{title}</h2>
    {loading && <p role="status">Загрузка: {title.toLowerCase()}…</p>}
    {error && <div role="alert"><p>{error}</p><button style={button} onClick={onRetry}>Повторить попытку</button></div>}
    {!loading && !error && empty ? <p>Нет операционных записей, соответствующих этому представлению.</p> : !error ? children : null}
  </section>;
}
```
Usage pattern (`page.tsx:57`): `<Block title="Готовность системы" loading={loading && !overview} error={error} empty={false} onRetry={() => void load()}>`. State labels in Russian per `enum-labels` convention («Не настроено», «Никогда не проверялось», «Устарело», «Сбой», «Здорово»); dates via `date()` helper (line 22); refresh via existing `load()`. Manual-trigger buttons: `style={button}`, `disabled={loading}`, `role="status"` feedback, `fetch("/internal-api/operations/backups/run", { method: "POST" })`.

---

## Shared Patterns

### Authentication / operator ingress (all new API endpoints + web proxy)
**Source:** `apps/api/src/modules/reconciliation/operator.guard.ts:13-29` + operations route HMAC (`route.ts:25-38`).
**Apply to:** `POST /internal/operations/backups/run`, `POST /internal/operations/backups/drill`. Chain: operator-gateway (basic auth, injects HMAC headers) → web proxy (verifies HMAC incl. method, forwards `x-operator-credential`) → API `OperatorGuard`. Fail = 404 "Not found".

### Fail-closed config gating (BACKUP_* env)
**Source:** `packages/config/src/index.ts:87-103` (`readPrivacyRetentionConfig`).
**Apply to:** `readBackupConfig` — invalid/absent ⇒ `undefined` ⇒ honest NOT_CONFIGURED non-green state; never silent defaults.

### Secret redaction (D-15)
**Source:** `packages/config/src/index.ts:51-60` (`redactSecrets`).
**Apply to:** any backup path/metadata entering the operations read model or receipt checks JSON; tests assert no `postgresql://` substring in overview payload.

### Frozen-table immutability (append-only receipts, CI-04)
**Source:** `migrations/20260908_phase04_settlement_receipts/migration.sql:33,75` (quoted above).
**Apply to:** `BackupRun`, `BackupVerificationReceipt` — `RAISE EXCEPTION '<Table> is immutable'` on UPDATE/DELETE; extend `tests/integration/mutation-rejection.test.ts` (`:120-123` pattern: `expect(prisma.$executeRawUnsafe('UPDATE ...')).rejects.toThrow(/immutable/i)`).

### External process invocation (execFileSync, argv arrays, env-only credentials)
**Source:** `scripts/verify-release-integration.mjs:1-11,36-50` (harness) — the canonical shape:
```typescript
function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function waitFor(container, command, delayMs) { /* pg_isready poll, 60 attempts, rethrow at attempt 59 */ }

docker("run", "--detach", "--name", postgres, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
await waitFor(postgres, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"], 500);
const postgresPort = docker("port", postgres, "5432/tcp").split(":").at(-1);
execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit" });   // prismaCli = packages/database/node_modules/prisma/build/index.js
try { docker("rm", "--force", postgres); } catch { /* exact owned cleanup is best effort */ }   // D-11: best-effort, but record the failure in the receipt
```
Container naming: owned unique suffix `bet-stats-drill-pg-${process.pid}-${Date.now()}`; wait loop; dynamic port; `rm --force` in `finally`. **Apply to:** `backup-drill.ts` (container lifecycle, `pg_restore`, `migrate deploy`/`status`) and `backup.ts` (`pg_dump` via PG_BIN → PATH → `docker exec` fallback, always `-U <role>`). Credentials only via child `env` (`DATABASE_URL`/`PGPASSWORD`), never argv; `--no-password` on pg tools; job timeout records FAILED.

### BullMQ queue wiring
**Source:** `workers/data-sync/src/queues/index.ts:89-116,146` (quoted above).
**Apply to:** `backupQueue(prefix)` = `${prefix}-backup`, `createBackupQueue`, `createBackupWorker` (concurrency 1, `UnrecoverableError` on invalid job data), `redisConnection`. API-side queue: `replay.service.ts:32-34`.

### Structured logging
**Source:** `workers/data-sync/src/main.ts:75,85` — one JSON line per event, error reduced to message: `console.error(JSON.stringify({ event: "...", error: error instanceof Error ? error.message : "UNKNOWN" }))`. Apply to backup/drill lifecycle events.

### Test harness (owned containers)
**Source:** `tests/integration/backtest-production.test.ts:35,97`, `forecast-scoring.test.ts:15,36` — same docker/Prisma `execFileSync` shape as the release script. Apply to new `tests/integration/backup-restore-drill.test.ts`. Immutability rejection: `tests/integration/mutation-rejection.test.ts:120-123`.

---

## No Analog Found

Files with no close match in the codebase — planner should use RESEARCH.md (Q1/Q3/Q5) as the primary source:

| File | Role | Data Flow | Reason / Guidance |
|------|------|-----------|-------------------|
| `workers/data-sync/src/jobs/backup.ts` — robocopy invocation + exit-bitmask logic | job | file-I/O | No existing robocopy/copy code in repo. Closest shape is the `execFileSync` argv-array harness; treat robocopy codes as bitmask: `success = typeof code === "number" && code < 8`; `>= 8` or spawn error ⇒ off-host DEGRADED (research Q3). Unit-test with 0,1,3,7,8,16/ENOENT fixtures. |
| `backup.ts`/`backup-drill.ts` — `pg_dump`/`pg_restore` invocation | job | file-I/O | No pg-tool wrapper exists (host has no PG install — `docker exec` fallback verified). Use the harness excerpt above + research Q1 flags (`--no-owner --no-privileges --exit-on-error`, `--no-password`, atomic `.partial`→rename). |
| Chain-integrity checks (generic FK-orphan query, row-count parity) | job (raw SQL) | transform (read-only checks) | No FK-orphan/parity queries in repo. Use RESEARCH.md Q5 SQL verbatim (`pg_constraint`-driven loop + `UNION ALL` count capture; fail on `R < C0`, record positive deltas). Executed via `$queryRaw`/`$executeRawUnsafe` against the throwaway DB, following the `database.$queryRaw` style of `retention-purge.ts:10-21`. |

---

## Metadata

**Analog search scope:** `packages/database/prisma/` (schema + migrations), `workers/data-sync/src/` (jobs, queues, main), `packages/config/src/`, `apps/api/src/modules/` (operations, reconciliation, replay), `apps/web/app/internal-api/` + `apps/web/app/internal/operations/`, `tests/integration/`, `scripts/`.
**Files scanned:** ~15 full reads + 8 greps; all analogs verified git-tracked (`git ls-files` non-empty for every named path).
**Pattern extraction date:** 2026-10-22
