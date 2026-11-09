# Phase 9: Degradation Alerting - Pattern Map

**Mapped:** 2026-11-07
**Files analyzed:** 16 (9 new, 7 modified)
**Analogs found:** 14 / 16 (2 net-new: the 5xx exception filter and its unit test — RESEARCH.md Pattern 5 is the source)

All analog paths below are git-tracked source (verified with `git ls-files` this session). No `.gsd/capabilities` mirrors are referenced.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/database/prisma/schema.prisma` (+`OpsAlert`, `OpsAlertTransition`, `OpsAlertDelivery`) | model | durable storage (guarded-update + append-only) | `packages/database/prisma/schema.prisma:766-805` (`BackupRun`, `BackupVerificationReceipt`) | exact |
| `packages/database/prisma/migrations/<ts>_phase09_ops_alerts/migration.sql` | migration | DDL + triggers | `migrations/20261022_phase08_backup_runs/migration.sql` (append-only) + `migrations/20260831_phase02_replay_lifecycle/migration.sql` (guarded transition) | exact |
| `packages/config/src/index.ts` (+`readAlertsConfig`) | config | utility (env read) | `packages/config/src/index.ts:141-164` (`readBackupConfig`) | exact |
| `workers/data-sync/src/jobs/alerts.ts` (signals + evaluator + webhook dispatch) | service | periodic batch tick (reads PG + Redis, writes alerts, dispatches) | `workers/data-sync/src/jobs/retention-purge.ts` (scheduler shell) + `apps/api/src/modules/operations/operations.service.ts:184-217` (signal-source reads) | role-match |
| `workers/data-sync/src/main.ts` (+`startAlertingRuntime`) | config (composition root) | config-gated runtime | `workers/data-sync/src/main.ts:103-140` (`startBackupRuntime`) | exact |
| `apps/api/src/modules/operations/operations.service.ts` (+`alerts()` read model, acknowledge) | service | request-response (read model) | itself — `failures()` grouping + `overview()` projection (lines 134-171) | exact |
| `apps/api/src/modules/operations/operations.controller.ts` (+`POST alerts/:alertId/acknowledge`) | controller | request-response (idempotent path-only POST) | `operations.controller.ts:22-28` (`@Post("backups/run")`) | exact |
| `apps/api/src/<new>` 5xx bucket exception filter (path at planner's discretion, e.g. `modules/operations/http-5xx-bucket.filter.ts`) | middleware | request-response (counter increment) | **No analog** — repo-wide grep for `ExceptionFilter`/`@Catch(` returns zero matches (RESEARCH.md State of the Art). Registration precedent: `apps/api/src/main.ts:22-28`; Redis client precedent: `apps/api/src/modules/privacy/privacy.service.ts:164` | no analog (partial) |
| `apps/web/app/internal/operations/page.tsx` (+«Алерты» Block) | component | request-response (fetch + render) | itself — `Block` usages lines 80-101 | exact |
| `apps/web/app/internal/operations/alerts-block.tsx` (new) | component | render (pure) | `apps/web/app/internal/operations/backup-status-block.tsx` | exact |
| `apps/web/components/enum-labels.ts` (+severity/status/signal labels) | utility | transform (label map) | `enum-labels.ts:31,65` (`BACKUP_STATE_LABELS` / `backupStateLabel`) | exact |
| `tests/unit/alerts-signals.test.ts` | test | — (pure functions, injected clock) | `tests/unit/retention-purge-scheduler.test.ts` (fake timers/clock) + `tests/integration/operator-overview.test.ts:90-120` (read-time fact matrix) | role-match |
| `tests/unit/alerts-dispatch.test.ts` | test | — (fetch stub) | `tests/unit/internal-api-route.test.ts:27-31` (`vi.stubGlobal("fetch", ...)`) | exact |
| `tests/unit/alerts-5xx-filter.test.ts` | test | — | **No analog** (no filter exists) — structure from RESEARCH.md test map; Nest mock-host style is new | no analog |
| `tests/integration/alerts.test.ts` | test | — (real Postgres, triggers, canaries) | `tests/integration/mutation-rejection.test.ts` (trigger rejection) + `tests/integration/operator-overview.test.ts:12-23,73` (planted-secret canary) | exact |
| `apps/web/app/internal/operations/alerts-block.test.ts` | test | — (SSR render) | `apps/web/app/internal/operations/backup-status-block.test.ts` | exact |

---

## Pattern Assignments

### `packages/database/prisma/schema.prisma` (model, durable storage)

**Analog:** `packages/database/prisma/schema.prisma:765-805` — the Phase-8 evidence models (add `OpsAlert` / `OpsAlertTransition` / `OpsAlertDelivery` in the same style, near the other operational tables):

```prisma
/// Durable operational evidence for each backup attempt (append-only, frozen by trigger).
model BackupRun {
  id            String    @id
  startedAt     DateTime  @db.Timestamptz(3)
  completedAt   DateTime  @db.Timestamptz(3)
  durationMs    Int
  status        String
  offsiteStatus String
  trigger       String
  reason        String?   @db.VarChar(128)
  fileName      String?   @db.VarChar(256)
  createdAt     DateTime  @default(now()) @db.Timestamptz(3)

  @@index([completedAt])
}
```

Conventions to copy: `String @id` (cuid default where app-generated — see `ManualOddsSelection` line 808 `@default(cuid())`), `DateTime @db.Timestamptz(3)`, enum-ish status as `String` + DB `CHECK` in the migration (not Prisma enums — see migration below), `@@index` on the primary time column, doc-comment stating the mutation discipline. `OpsAlert` needs `@@unique` on `dedupFingerprint` (the Prisma upsert target, RESEARCH Pattern 2).

### `packages/database/prisma/migrations/<ts>_phase09_ops_alerts/migration.sql` (migration, DDL + triggers)

**Analog A:** `packages/database/prisma/migrations/20261022_phase08_backup_runs/migration.sql:4-28` — table + CHECK + append-only trigger (this exact shape goes on `OpsAlertTransition` and `OpsAlertDelivery`):

```sql
CREATE TABLE "BackupRun" (
  "id" TEXT PRIMARY KEY,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('SUCCEEDED','FAILED')),
  ...
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BackupRun_completedAt_idx" ON "BackupRun"("completedAt");

CREATE OR REPLACE FUNCTION guard_backup_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'BackupRun is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "BackupRun_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "BackupRun" FOR EACH ROW EXECUTE FUNCTION guard_backup_run();
```

**Analog B (required for `OpsAlert` — NOT the blanket append-only):** `packages/database/prisma/migrations/20260831_phase02_replay_lifecycle/migration.sql:3-39` — column allow-list guarded transition:

```sql
CREATE OR REPLACE FUNCTION "guard_sync_attempt_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SyncAttempt is immutable';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."syncRunId" IS DISTINCT FROM OLD."syncRunId"
     OR NEW."attemptNumber" IS DISTINCT FROM OLD."attemptNumber"
     OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'SyncAttempt identity, links, and startedAt are immutable';
  END IF;
  ...
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SyncAttempt_guarded_transition"
BEFORE UPDATE OR DELETE ON "SyncAttempt"
FOR EACH ROW EXECUTE FUNCTION "guard_sync_attempt_transition"();
```

Copy this RAISE-EXCEPTION style for `OpsAlert`: reject `DELETE` entirely, reject changes to `id`/`dedupFingerprint`/`firstSeen`/`createdAt`, allow `severity/status/count/lastSeen/acknowledgedAt/resolvedAt` (RESEARCH Pitfall 2 — a blanket `*_append_only` trigger would break the dedup `count` bump on the second occurrence).

### `packages/config/src/index.ts` (config, utility)

**Analog:** `readBackupConfig`, lines 141-164 (opt-in, fail-absent reader — mirror it for `readAlertsConfig`):

```ts
/**
 * Reads only explicit backup inputs (opt-in per D-04). Invalid or absent inputs
 * remain absent so callers deterministically fail closed ... BACKUP_* keys are deliberately
 * absent from the production-required superRefine: backups are opt-in, so only
 * shape validation applies here.
 */
export function readBackupConfig(input: Record<string, string | undefined>): BackupConfig {
  return {
    enabled: input.BACKUP_ENABLED === "true" || input.BACKUP_ENABLED === "1",
    dir: readAbsoluteDirectory(input.BACKUP_DIR),
    ...
    retentionCount: input.BACKUP_RETENTION_COUNT === undefined
      ? DEFAULT_BACKUP_RETENTION_COUNT
      : readBoundedInteger(input.BACKUP_RETENTION_COUNT, 1, 365),
    ...
  };
}
```

Helpers to reuse: `readNonEmpty` (130-133), `readBoundedInteger` (135-139) — use for `ALERTS_TICK_MS` / `ALERTS_WEBHOOK_TIMEOUT_MS`. Do **not** add `ALERT_*` keys to the production-required `superRefine` (lines 17-28) — alerts are opt-in like backups. Also in this file: `redactSecrets` (51-60) for payload redaction, remembering Pitfall 6 — its regex `/(?:token|password|secret|api.?key|authorization|database.?url)/i` does **not** match `url`, so `ALERT_WEBHOOK_URL` must simply never be logged.

### `workers/data-sync/src/jobs/alerts.ts` (service, periodic batch tick)

**Analog (scheduler shell):** `workers/data-sync/src/jobs/retention-purge.ts:26-87` — the whole file is the template; key shape:

```ts
const MAX_TIMER_DELAY = 2 ** 31 - 1;
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
  ...
  const arm = async (): Promise<void> => { /* setTimeout chain, MAX_TIMER_DELAY clamp, onError retry */ };
  const run = async (): Promise<void> => { /* execute tick, then re-arm */ };
  void arm();
  return { close: () => { closed = true; if (timer) clearTimer(timer); }, refresh: arm };
}
```

The evaluator is a fixed-interval variant of this (arm `tickIntervalMs` instead of persisted expiry), keeping injected `now`, `onError`, `close()`.

**Analog (signal reads):** `apps/api/src/modules/operations/operations.service.ts` — copy the query shapes rather than re-deriving:

- Quota (lines 184-188): latest `providerQuotaObservation` per `provider\0endpointFamily` + `providerThrottleReservation` count for `criticalReservations`.
- Failures/BLOCKING (lines 190-193):
  ```ts
  impact: /QUARANTINE|IDENTITY|PAYLOAD/.test(attempt.classifiedReason ?? "") ? "BLOCKING" as const : "DEGRADED" as const,
  scope: `${attempt.syncRun.provider}/${attempt.syncRun.endpointFamily}`,
  retryable: /TIMEOUT|RATE|5XX|UNAVAILABLE/.test(attempt.classifiedReason ?? ""),
  ```
- Circuit state (line 199): `providerCircuitState.findMany({ where: { state: { in: ["OPEN", "HALF_OPEN"] } ... })`.
- Backup staleness (lines 21, 45-47, 82-105): import/reuse `computeBackupFact`, `BACKUP_FRESH_MS = 25 * 3_600_000` — never re-derive thresholds; `NOT_CONFIGURED` must not alert (D-12).
- Dead letters: `workers/data-sync/src/queues/index.ts:241-248` (failed-set pagination) and `workers/data-sync/src/resilience/provider-policy.ts:36` (`status: "dead-letter"` classification), plus `removeOnFail: { age: 604_800, count: 5_000 }` (line 124) as retention proof.

**Dedup core (RESEARCH Pattern 2 — no direct in-repo analog; the closest structural precedent is the upsert-less grouping in `operations.service.ts:147-154`):**

```ts
const alert = await tx.opsAlert.upsert({
  where: { dedupFingerprint: fingerprint },
  create: { dedupFingerprint: fingerprint, signal: code, scope, severity, status: "OPEN",
            firstSeen: now, lastSeen: now, count: 1, correlationIds },
  update: { lastSeen: now, count: { increment: 1 }, severity /* only on escalation */ },
});
await tx.opsAlertTransition.create({ data: { alertId: alert.id, from, to, severityFrom, severityTo, at: now } });
```

**Webhook dispatch (RESEARCH Pattern 4 — no in-repo HTTP-retry analog; AGENTS forbids axios):** native `fetch` + `AbortSignal.timeout`, `redirect: "manual"`, bounded retries honoring `Retry-After`, every attempt appended to `OpsAlertDelivery`.

### `workers/data-sync/src/main.ts` (config/composition root)

**Analog:** `startBackupRuntime`, lines 103-140 + composition at 142-155:

```ts
export function startBackupRuntime(input: { databaseUrl: string; redisUrl: string; prefix?: string; backupConfig: BackupConfig; log?: (event: Readonly<Record<string, unknown>>) => void }) {
  const log = input.log ?? ((event) => console.info(JSON.stringify(event)));
  const config = input.backupConfig;
  if (!config.enabled || !config.dir) {
    log({ event: "backup.disabled" });
    return undefined;                    // ← honest opt-in gate, no timers when off
  }
  const database = createPrismaClient(input.databaseUrl);
  ...
  log({ event: "backup.armed", ... });
  return { async close() { scheduler.close(); drillScheduler.close(); await worker.close(); ... await database.$disconnect(); } };
}
```

Composition precedent (line 151-152): `const backupRuntime = startBackupRuntime({...}); const close = () => { void runtime.close(); void backupRuntime?.close(); };` — add `startAlertingRuntime` symmetrically. **Constraint:** keep `main.ts` import-side-effect-free — auto-start stays behind `isDirectExecution()` (lines 157-174).

### `apps/api/src/modules/operations/operations.service.ts` (service, request-response read model)

**Analog: itself.** Add `alerts()` beside `failures()` on the `OperationsRepository` interface (lines 107-115) and an `alerts` section beside `failures` in `overview()` (line 162), or a separate method per Open Question 1.

**Grouping pattern to copy** (lines 147-154) — same rootCause+scope aggregation the anti-fatigue rules need:

```ts
const grouped = new Map<string, { rootCause: string; impact: "BLOCKING" | "DEGRADED"; scope: string; count: number; first: Date; last: Date; retryable: boolean; correlations: Set<string> }>();
for (const failure of failures) {
  const key = `${failure.rootCause}\0${failure.impact}\0${failure.scope}`;
  const group = grouped.get(key) ?? { ... };
  group.count += 1; group.first = ...; group.last = ...; group.retryable &&= failure.retryable;
  if (failure.correlationId) group.correlations.add(failure.correlationId);
  grouped.set(key, group);
}
```

**Query allowlist (Pitfall 3 — extend this exact block with `alertPage`, or the ops page 400s):**

```ts
const allowed = new Set(["page", "pageSize", "windowHours", "impact", "rootCause"]);
if (Object.keys(raw).some((key) => !allowed.has(key))) throw new BadRequestException("INVALID_OPERATIONS_QUERY");
const page = raw.page ?? 1; const pageSize = raw.pageSize ?? 25; const windowHours = raw.windowHours ?? 24;
if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25 || !Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) throw new BadRequestException("INVALID_OPERATIONS_QUERY");
```

**Closed-DTO sanitizers (lines 8-9, 119-122) — every alert field passes these:**

```ts
const CORRELATION = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const ROOT_CAUSE = /^[A-Z0-9][A-Z0-9_.:-]{0,127}$/;
function safeCorrelation(value: string | null): string | null { return value && CORRELATION.test(value) ? value : null; }
function safeCode(value: string | null | undefined, fallback = "UNKNOWN"): string { return value && ROOT_CAUSE.test(value) ? value : fallback; }
function safeIdentity(value: string): string { return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(value) ? value : "unavailable"; }
```

**Redaction pass (lines 165-167):**

```ts
// D-15: belt-and-braces redactSecrets pass — the closed BackupFact carries
// basenames, sizes, instants, durations and reason codes, nothing else.
backups: redactSecrets(computeBackupFact(backupRows, current)) as BackupFact,
```

**Acknowledge service precedent** (lines 273-288): uniform `NotFoundException("Not found")` for absent/unconfigured state (no configuration oracle), lazy queue construction so module load never touches Redis, async rejection shape.

### `apps/api/src/modules/operations/operations.controller.ts` (controller, request-response)

**Analog:** the whole file (29 lines); acknowledge copies the `backups/run` POST:

```ts
@Controller("internal/operations")
@UseGuards(OperatorGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}
  ...
  @Post("backups/run")
  @HttpCode(HttpStatus.ACCEPTED)
  backupsRun() { return this.operations.triggerBackup(); }
}
```

→ add `@Post("alerts/:alertId/acknowledge") @HttpCode(HttpStatus.ACCEPTED)` — **path-only, no JSON body** (the Next proxy forwards no body and HMAC binds method+path: `apps/web/app/internal-api/operations/[[...path]]/route.ts:49-52`; segment regex at line 46 `^[A-Za-z0-9_-]{1,64}$` — cuid alert ids pass). `optionalInteger` helper (line 6) is the mapping precedent if `alertPage` is added to the overview query.

### 5xx bucket exception filter (middleware, request-response) — NO ANALOG

No `ExceptionFilter`/`@Catch(` exists in the repo. Build from RESEARCH Pattern 5 + these precedents:

- **Registration:** `apps/api/src/main.ts:19-31` — `bootstrap()` already chains `app.useGlobalPipes(...)` and `app.use(correlation middleware)`; either `app.useGlobalFilters(new Http5xxBucketFilter(redis))` there or an `APP_FILTER` provider in `app.module.ts` (module registration precedent: `app.module.ts:26-30`).
- **Must delegate:** extend `BaseExceptionFilter` / resolve `HttpAdapterHost` so 400/404 bodies stay byte-identical (RESEARCH Pitfall 1 — regression-test `{ message: "Not found" }` shape).
- **Redis client:** `apps/api/src/modules/privacy/privacy.service.ts:164`:
  ```ts
  private readonly redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
  ```
  Bucket write: `await redis.multi().incr(key).expire(key, 120).exec();` with `key = bet-stats:http5xx:<minuteIndex>` (RESEARCH Pattern 5 / Pitfall 8 — one MULTI round trip, TTL ≥ 2× window).

### `apps/web/app/internal/operations/page.tsx` (component, request-response)

**Analog: itself.** The «Алерты» block is one more `<Block>` in the existing list (first after header per UI-SPEC):

```tsx
function Block({ title, loading, error, empty, onRetry, children }: { title: string; loading: boolean; error: string; empty: boolean; onRetry(): void; children: React.ReactNode }) {
  return <section aria-labelledby={`${title.toLowerCase().replace(/[^a-zа-яё]+/g, "-")}-heading`} style={card} aria-busy={loading || undefined}>
    <h2 id={...}>{title}</h2>
    {loading && <p role="status">Загрузка: {title.toLowerCase()}…</p>}
    {error && <div role="alert"><p>{error}</p><button style={button} onClick={onRetry}>Повторить попытку</button></div>}
    {!loading && !error && empty ? <p>Нет операционных записей, соответствующим этому представлению.</p> : !error ? children : null}
  </section>;
}
```

Fetch precedent (lines 48-62): `fetch('/internal-api/operations/overview' + query, { cache: "no-store" })`, error string in Russian, gateway redirect on port 3000. Pagination precedent (line 94): `failures.pagination` `{ page, pageSize, total, start, end, pages }` envelope + `<nav aria-label="Страницы отказов">` number links. `CopyCorrelation` component (lines 35-38) renders correlation IDs with copy button. Co-located constants `card`/`grid`/`button` (lines 19-21).

**⚠️ `apps/web/AGENTS.md`:** before writing any web code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` (this Next.js version differs from training data) and keep the `next dev`-written AGENTS block in the diff.

### `apps/web/app/internal/operations/alerts-block.tsx` (component, pure render)

**Analog:** `apps/web/app/internal/operations/backup-status-block.tsx` (entire file). Copy: `"use client"` header; exported fact type consumed by `page.tsx`; co-located `card`/`button` mirrors (comment at lines 21-24 explains page.tsx cannot be imported — cycle); local `Record<string, string>` label maps with `?? raw` fallback (lines 26-32); `data-testid`/`data-state` attributes (line 46); `role={noticeFailed ? "alert" : "status"}` feedback line (line 72); Russian copy throughout; `<time dateTime={...}>` for instants.

### `apps/web/components/enum-labels.ts` (utility, transform)

**Analog:** lines 31, 65 — add `ALERT_SEVERITY_LABELS` / `ALERT_STATUS_LABELS` / `ALERT_SIGNAL_LABELS` in the same shape:

```ts
const BACKUP_STATE_LABELS: Record<string, string> = { NOT_CONFIGURED: "Не настроено", NEVER_VERIFIED: "Никогда не проверялось", STALE: "Устарело", FAILED: "Сбой", HEALTHY: "Здорово" };
/** Unknown backup state → the raw code. */
export function backupStateLabel(state: string): string { return BACKUP_STATE_LABELS[state] ?? state; }
```

Fallback contract documented at lines 3-11: unknown codes render the raw code, never blank.

---

## Test Pattern Assignments

### `tests/unit/alerts-signals.test.ts`
**Analog:** `tests/unit/retention-purge-scheduler.test.ts:1-60` — injected `now`, fake `setTimeout` arrays capturing delays, `await new Promise((resolve) => setImmediate(resolve))` to flush the timer chain, `as never` casts on hand-built fakes. Threshold matrix style: `tests/integration/operator-overview.test.ts:90-120` (row-factory with `overrides`, `it.each` over states, injected `() => NOW` clock).

### `tests/unit/alerts-dispatch.test.ts`
**Analog:** `tests/unit/internal-api-route.test.ts:14-31`:

```ts
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
...
const fetchStub = vi.fn().mockImplementation(async () => new Response('{"id":"forecast-1"}', { status: 201, headers: {...} }));
vi.stubGlobal("fetch", fetchStub);
...
expect(fetchStub.mock.calls[0]?.[1]).toMatchObject({ method: "GET", cache: "no-store", headers: {...} });
```

Assert on `fetchStub.mock.calls` for URL/method/redirect/timeout behavior; never hit a real endpoint (A3: local stub or `vi.fn` only).

### `tests/unit/alerts-5xx-filter.test.ts`
**No analog** — the filter is net-new. Follow RESEARCH test map: mock the Nest host, assert bucket writes (`multi().incr().expire().exec()` called with expected key) and assert existing error bodies unchanged (Pitfall 1).

### `tests/integration/alerts.test.ts`
**Analog:** `tests/integration/mutation-rejection.test.ts:1-9,28-34,120-123` — real-Postgres harness:

```ts
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
let prisma: PrismaClient;
const run = process.pid.toString();
const id = (value: string) => `${value}-${run}`;   // pid-scoped ids, parallel-safe
...
await expect(prisma.$executeRawUnsafe(`UPDATE "ValueReceipt" SET outcome='NO_VALUE' WHERE id=$1`, id("mut-value-receipt"))).rejects.toThrow(/immutable/i);
```

Canary pattern: `tests/integration/operator-overview.test.ts:12-23,73` — `CANARIES` array planted in repository rows, `expect(flatten(overview)).not.toMatch(/secret-token-canary|.../)` on every produced JSON.

### `apps/web/app/internal/operations/alerts-block.test.ts`
**Analog:** `apps/web/app/internal/operations/backup-status-block.test.ts` — `renderToStaticMarkup(createElement(Block, props))`, fact factory with `overrides`, `it.each` for Russian labels («never renders raw English code», «never renders green»), `role="alert"`/`role="status"` assertions, `expect(markup).not.toMatch(/...path.../)` for secret/path leakage. Runs in the **web** project: `pnpm --filter @bet-stats/web exec vitest run -c vitest.config.ts app/internal/operations/alerts-block.test.ts`.

---

## Shared Patterns

### Authentication / guard (all new API endpoints)
**Source:** `apps/api/src/modules/operations/operations.controller.ts:8-9`
```ts
@Controller("internal/operations")
@UseGuards(OperatorGuard)
```
**Apply to:** acknowledge endpoint — zero new auth surface; the gateway already covers `/internal/operations` and `/internal-api/operations` prefixes (`infra/operator-gateway/security.mjs` `protectedPrefixes`), and the proxy binds method+path by HMAC (`route.ts:35-38`).

### Redaction + closed DTOs (alerts read model AND webhook payload)
**Source:** `packages/config/src/index.ts:51-60` (`redactSecrets`) + `operations.service.ts:119-122` (`safeCode`/`safeIdentity`/`safeCorrelation`)
```ts
const sensitiveKey = /(?:token|password|secret|api.?key|authorization|database.?url)/i;
export function redactSecrets(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  ...
}
```
**Apply to:** every alert DTO and the webhook payload (D-07); plus a planted-secret canary test (see integration test above). Never log `ALERT_WEBHOOK_URL` (regex does not match `url`).

### Planted-secret canary test (all outbound surfaces)
**Source:** `tests/integration/operator-overview.test.ts:12-23,73`
```ts
const CANARIES = ["secret-token-canary", "raw-payload-canary", "authorization-header-canary", "environment-canary", "stack-trace-canary", "unrestricted-log-canary"];
expect(flatten(overview)).not.toMatch(/secret-token-canary|raw-payload-canary|.../);
```

### Opt-in config gate (worker runtime + UI honesty)
**Source:** `workers/data-sync/src/main.ts:103-109` (`startBackupRuntime` disabled path) + `packages/config/src/index.ts:141-164` (`readBackupConfig` doc comment)
**Apply to:** `startAlertingRuntime` (no timers when `ALERTS_ENABLED` off) and the block's channel line («не настроен» renders non-green, never silent).

### Interval scheduler with injected clock (evaluator tick + weekly synthetic)
**Source:** `workers/data-sync/src/jobs/retention-purge.ts:26-87`; composed at `main.ts:77`
```ts
const retentionPurgeScheduler = scheduleRetentionPurge({ database, onError: (error) => console.error(JSON.stringify({ event: "privacy.retention_purge.failed", error: error instanceof Error ? error.message : "UNKNOWN" })) });
```
Structured `console.error(JSON.stringify({ event, ... }))` logging is the worker convention — copy the `event:` naming (`alerts.tick_failed`, `alerts.webhook_delivery_failed`, …).

### Russian label lookup (all alert UI copy)
**Source:** `apps/web/components/enum-labels.ts:31,65` — map + `?? raw` fallback; machine codes (signal/scope/correlation) render as English beside Russian labels (AGENTS.md language rule).

### UI Block conventions (alerts block)
**Source:** `apps/web/app/internal/operations/page.tsx:26-38` — `aria-busy`, `role="status"` loading, `role="alert"` error + «Повторить попытку», empty copy, `CopyCorrelation`; card/button constants mirrored in the co-located block file.

### Read-time computation with injected clock (all signals)
**Source:** `operations.service.ts:80-105` (`computeBackupFact(rows, now)`) + `retention-purge.ts:40` (`now = input.now ?? (() => new Date())`)
**Apply to:** every threshold decision in the evaluator — evaluator downtime delays detection, never freezes a green state (Pitfall 9).

### Mutation-rejection discipline (new durable tables)
**Source:** `tests/integration/mutation-rejection.test.ts:120-123` + trigger templates above; CI gate runs `pnpm verify:release:schema` (`.github/workflows/ci.yml`) — every new migration must pass schema validation.

---

## No Analog Found

| File | Role | Data Flow | Reason / Fallback |
|------|------|-----------|-------------------|
| `apps/api/src/<new>` 5xx bucket exception filter | middleware | request-response | Zero `ExceptionFilter`/`@Catch(` in repo (RESEARCH State of the Art, stale STACK.md claim). Use RESEARCH.md Pattern 5 + `BaseExceptionFilter` delegation + `privacy.service.ts:164` Redis client + `main.ts:22-28` registration |
| `tests/unit/alerts-5xx-filter.test.ts` | test | — | Follows from the above; RESEARCH Validation Architecture test map defines the cases (bucket writes + unchanged error contract) |
| `workers/data-sync/src/jobs/alerts.ts` dedup upsert + webhook retry loop (inner logic) | service | batch/event-driven | Scheduler shell and all signal reads have exact analogs; the Prisma upsert-dedup and bounded-fetch-retry cores are RESEARCH Patterns 2/4 — copy those shapes verbatim, no repo duplicate exists |

---

## Metadata

**Analog search scope:** `workers/data-sync/src/**`, `apps/api/src/**`, `apps/web/app/internal/**`, `apps/web/components/**`, `packages/config/src/**`, `packages/database/prisma/**` (schema + migrations), `tests/unit/**`, `tests/integration/**`
**Files scanned:** ~30 listed/grepped, 14 read in full or in targeted ranges
**Git-tracked verification:** `git ls-files` over every named analog — all non-empty (no mirror paths emitted)
**Pattern extraction date:** 2026-11-07

**Notes for the planner:**
1. Zero new packages — `pnpm-lock.yaml` must not change (RESEARCH Standard Stack).
2. Web work must first read `apps/web/node_modules/next/dist/docs/` per `apps/web/AGENTS.md`.
3. Thresholds/window defaults (D-08..D-12), filter file path, `alertPage` vs sub-resource (Open Question 1), and webhook envelope shape remain planner-tunable per CONTEXT.md discretion.
