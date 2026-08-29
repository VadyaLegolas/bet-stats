# Phase 2: Historical Evidence Pipeline - Pattern Map

**Mapped:** 2026-08-29
**Files analyzed:** 32 proposed new/modified files grouped into 14 implementation areas
**Analogs found:** 12 / 14 areas

## File Classification

The phase documents specify package boundaries and symbols more often than final filenames. The paths below are the concrete file shape the planner should use unless it deliberately consolidates closely related files.

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/database/prisma/schema.prisma` | model/config | CRUD + temporal append | `FixtureProvenance`, `ReconciliationDecision`, `ProviderRequestReservation` in the same file | exact primitives, new composition |
| `packages/database/prisma/migrations/<timestamp>_historical_evidence/migration.sql` | migration | append-only + indexed temporal queries | `20260828061500_canonical_identity_and_reconciliation/migration.sql` | exact |
| `packages/football-data/src/provider.interface.ts` | provider port | request-response transform | existing `FixtureProvider` / `NormalizedFixture` | exact |
| `packages/football-data/src/providers/football-data-org/schema.ts` | validation | transform | `footballDataMatchSchema` / `competitionMatchesSchema` | exact |
| `packages/football-data/src/providers/football-data-org/normalize.ts` | adapter/utility | transform | `normalizeCompetitionMatches` | exact |
| `packages/football-data/src/providers/football-data-org/client.ts` | provider adapter | request-response | `FootballDataOrgClient.fetchPremierLeagueFixtures` | exact |
| `packages/domain/src/request-budget.ts` | service/utility | transactional CRUD | existing `reserveProviderRequest` | exact extension |
| `packages/domain/src/evidence/{contract,eligibility,form,elo,features}.ts` | model/utility | transform/batch | `packages/domain/src/data-state.ts` for discriminated contracts; no chronological fold exists | partial |
| `workers/data-sync/src/ingestion/runner.ts` | service | request-response + transactional CRUD | `workers/data-sync/src/jobs/fixtures.ts` | exact |
| `workers/data-sync/src/jobs/{results,standings,evidence-rebuild}.ts` | worker jobs | event-driven/batch | `workers/data-sync/src/jobs/fixtures.ts` | role-match |
| `workers/data-sync/src/{queues,replay,resilience}/**/*.ts` | config/service | event-driven | `workers/data-sync/src/main.ts` only for fail-closed bootstrap; no BullMQ/circuit implementation exists | weak/no analog |
| `apps/api/src/modules/evidence/{evidence.controller,evidence.service}.ts` | controller/service | request-response | `modules/fixtures/*` | exact role |
| `apps/api/src/modules/replay/{replay.controller,replay.service}.ts` | protected controller/service | request-response + event-driven | `modules/reconciliation/*` and `operator.guard.ts` | exact role |
| `apps/web/app/teams/[teamId]/evidence/page.tsx` and components | page/components | request-response | fixture detail/list pages and `DataStateNotice` | role-match |
| `apps/web/app/internal/pipeline/replay/page.tsx` + proxy route | page/route | request-response/event-driven | internal reconciliation page and proxy | exact role |
| `tests/unit/{form,chronological-features}.test.ts` | test | transform | `tests/unit/provider-contract.test.ts` style | role-match |
| `tests/integration/{pipeline-jobs,temporal-provenance,provider-budget-order,quota-priority,provider-resilience,replay,evidence-api}.test.ts` | test | CRUD/event/request-response | `provider-capability.test.ts`, `migration-empty.test.ts`, `eligibility.test.ts` | exact harness/pattern |
| `tests/e2e/{team-evidence,pipeline-replay}.spec.ts` | test | request-response/UI | `fixture-discovery.spec.ts`, `reconciliation-review.spec.ts` | exact role |

## Pattern Assignments

### Prisma temporal evidence models and migration

**Analogs:** `packages/database/prisma/schema.prisma` and the two existing migrations.

**Immutable observation shape** (`schema.prisma:215-226`):

```prisma
model FixtureProvenance {
  id              String   @id @default(cuid())
  fixtureId       String
  provider        String
  observedAt      DateTime @default(now())
  sourceUpdatedAt DateTime?
  payloadHash     String
  rawPayload      Json
  fixture         Fixture  @relation(fields: [fixtureId], references: [id], onDelete: Restrict)

  @@unique([provider, payloadHash])
  @@index([fixtureId, observedAt])
}
```

Copy this field vocabulary into `SourceObservation`: provider, endpoint family, `observedAt`, nullable source time, hash, and JSON/reference. Extend uniqueness with endpoint plus logical source identity where identical payloads from different endpoints must remain distinct. Relations from fact versions must use `onDelete: Restrict`.

**Durable logical-key reservation** (`schema.prisma:91-100`):

```prisma
model ProviderRequestReservation {
  provider    String
  requestDate DateTime @db.Date
  endpoint    String
  jobKey      String
  reservedAt  DateTime @default(now())

  @@unique([provider, requestDate, endpoint, jobKey])
  @@index([provider, requestDate, endpoint])
}
```

Use the same unique-then-query-index pairing for `SyncRun(logicalKey, revision)`, observation identities, standing snapshot rows, and evidence build identities. Equality keys precede effective/observed time in as-of indexes.

**Append-only enforcement** (`20260828061500.../migration.sql:317-330`):

```sql
CREATE FUNCTION "prevent_reconciliation_decision_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ReconciliationDecision is append-only';
END;
$$;

CREATE TRIGGER "ReconciliationDecision_append_only"
BEFORE UPDATE OR DELETE ON "ReconciliationDecision"
FOR EACH ROW EXECUTE FUNCTION "prevent_reconciliation_decision_mutation"();
```

Apply equivalent triggers to immutable source observations and append-only fact versions. Corrections insert a row linked by `supersedes...Id`; do not update an earlier observation/version. Keep mutable operational projections (`SyncRun.state`, circuit state, building evidence state) separate from immutable evidence.

**Migration structure** (`20260828124000.../migration.sql:1-29`): create tables first, then unique/index definitions, then foreign keys with explicit delete behavior. Advanced trigger and partial/window-supporting indexes belong in SQL migration even when Prisma models describe ordinary relations.

### Provider ports, validation, normalization, and clients

**Analog:** `packages/football-data/src/provider.interface.ts:1-20`.

```typescript
export interface NormalizedFixture {
  provider: "football-data.org";
  externalId: string;
  kickoffUtc: string;
  status: CanonicalFixtureStatus;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  raw: Readonly<Record<string, unknown>>;
}

export interface FixtureProvider {
  fetchPremierLeagueFixtures(): Promise<readonly NormalizedFixture[]>;
}
```

Add normalized result and standing snapshot DTOs beside fixtures. Preserve provider external IDs only at this boundary; worker persistence resolves them to canonical IDs. Every DTO carries capture/source-update/raw fields. Standing rows must be returned under one capture-level snapshot rather than independently mergeable rows.

**Validation pattern** (`schema.ts:3-16`):

```typescript
export const footballDataMatchSchema = z.object({
  id: z.number().int().nonnegative(),
  utcDate: z.string().datetime({ offset: true }),
  status: z.string().min(1),
  lastUpdated: z.string().datetime({ offset: true }).nullable(),
}).passthrough();
```

Validate untrusted response envelopes and nested score/table fields with Zod; retain `.passthrough()` so raw evidence is preserved. Required score values for a finished result must be refined, while unavailable source update times stay `null`.

**Normalization and classified validation** (`normalize.ts:4-24,25-39`):

```typescript
export class ProviderPayloadError extends Error {
  override readonly name = "ProviderPayloadError";
}

const parsed = competitionMatchesSchema.safeParse(payload);
if (!parsed.success) throw new ProviderPayloadError("Invalid football-data.org competition matches payload");
return parsed.data.matches.map((match) => ({
  provider: "football-data.org",
  capturedAt: capturedAt.toISOString(),
  sourceUpdatedAt: match.lastUpdated,
  raw: match,
}));
```

Results/standings normalizers should use the same safe error class so the resilience layer can mark validation failures non-retryable.

**HTTP and redaction** (`client.ts:27-39`):

```typescript
const response = await this.#fetcher(fixedProviderUrl, {
  headers: { "X-Auth-Token": this.#apiToken },
  signal: AbortSignal.timeout(this.#timeoutMs),
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
return normalizeCompetitionMatches(await response.json(), this.#now());
// ...
throw new Error("football-data.org request failed");
```

Keep origins and endpoint construction inside the adapter, inject `fetcher`/clock for tests, use platform fetch timeout, preserve `ProviderPayloadError`, and replace all network/provider errors with secret-free classified errors.

### Reservation-first ingestion and worker jobs

**Analog:** `workers/data-sync/src/jobs/fixtures.ts:24-48`.

```typescript
const decision = evaluateCapability(capability, key, now);
if (!decision.allowed) return { status: "denied", reason: decision.reason };

const reservation = await reserveProviderRequest(input.database, {
  provider: PROVIDER,
  requestDate: now.toISOString().slice(0, 10),
  endpoint: ENDPOINT,
  jobKey: input.jobKey,
  allowance: input.allowance,
});
if (!reservation.reserved) return { status: "denied", reason: reservation.reason };

// Construction is intentionally after the durable gate.
const fixtures = await input.providerFactory().fetchPremierLeagueFixtures();
```

Generalize this into one ingestion runner. Phase 2 ordering must be: capability → circuit → lane/headroom authorization → cache lookup → durable reservation → provider construction/I/O → validation/identity → atomic observation+fact persistence. The Phase 1 function lacks circuit/cache/lane gates; do not blindly preserve its direct capability→reservation sequence.

**Atomic idempotent persistence** (`fixtures.ts:51-92`):

```typescript
await database.$transaction(async (transaction) => {
  await transaction.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    `${fixture.provider}:fixture:${fixture.externalId}`,
  );
  // resolve canonical refs; fail when identity is unresolved
  // insert/update canonical projection
  // insert provenance ON CONFLICT DO NOTHING
});
```

Use one advisory lock per provider/logical fact identity. Insert `SourceObservation` and its result/standing fact version in the same transaction. Database uniqueness makes reruns no-ops; BullMQ IDs are only delivery deduplication.

**Atomic quota algorithm** (`packages/domain/src/request-budget.ts:20-40`): transaction-scoped advisory lock, reuse exact job reservation first, count current endpoint usage, deny before insert, then return `{ reserved, reused }`. Extend its request with lane/headroom/reset-zone policy rather than implementing quota truth in BullMQ.

**No live analog:** queue creation, three physical lanes, bounded exponential+jitter options, Cockatiel circuit registry, DLQ events, and replay fan-out do not exist. Follow `02-RESEARCH.md` for these. `workers/data-sync/src/main.ts:7-20` supplies only the bootstrap convention: validate config before startup, emit structured initialization, catch without leaking configuration, and set nonzero exit status.

### Pure cutoff-aware feature engine

There is no chronological calculation analog. Keep it in `packages/domain`, with no Prisma, Nest, BullMQ, or provider imports.

Use the repository's discriminated-union style (for example `request-budget.ts:18`) for every component result:

```typescript
type ComponentResult<T> =
  | { available: true; value: T; sampleCount: number; window: EvidenceWindow; sources: readonly SourceRef[] }
  | { available: false; value: null; sampleCount: number; limitation: LimitationReason };
```

The eligibility boundary must require both `effectiveAt <= asOf` and `observedAt <= asOf`, then stable-sort oldest-to-newest by effective/kickoff time, observation time, fixture ID. `form.ts`, `elo.ts`, and `features.ts` accept already eligible ordered readonly inputs and versioned config. They must never pad samples, treat missing as zero, inspect the clock, or fetch data. `buildTeamEvidence` composes component receipts without inventing a forecast aggregate.

### Nest evidence module

**Read endpoint analog:** `apps/api/src/modules/fixtures/fixtures.controller.ts:5-17` and `fixtures.service.ts:13-28,37-47`.

```typescript
@Controller("fixtures")
export class FixturesController {
  constructor(private readonly fixtures: FixturesService) {}
  @Get(":fixtureId") detail(@Param("fixtureId") fixtureId: string) {
    return this.fixtures.detail(fixtureId);
  }
}
```

```typescript
if (!UTC_INSTANT.test(value)) throw new BadRequestException(`${name} must be an ISO 8601 UTC instant`);
const parsed = new Date(value);
if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(...);
```

The evidence controller should expose `GET /teams/:teamId/evidence?asOf=...`. The service parses/normalizes but never substitutes latest on invalid input, selects only published builds, and projects every Date to ISO strings. Use stable query ordering as fixtures do (`orderBy: [{ kickoffUtc: "asc" }, { id: "asc" }]` at service line 40), expanded to the locked three-part temporal tie-break.

Register controllers/providers in `apps/api/src/app.module.ts:12-15`; retain explicit `.js` relative imports.

### Protected replay API

**Guard/controller analog:** `reconciliation.controller.ts:5-11` and `operator.guard.ts:13-24`.

```typescript
@Controller("internal/reconciliation")
@UseGuards(OperatorGuard)
export class ReconciliationController { /* ... */ }
```

```typescript
if (!this.credential || !presented ||
    !timingSafeEqual(digest(this.credential), digest(presented))) {
  throw new NotFoundException("Not found");
}
```

Reuse `OperatorGuard` for all replay preview/queue/status endpoints so unauthorized access is a generic 404. Server derives provider allowlist, fixed endpoint, lane, priority and bounds; browser input never chooses URLs/queue names.

**Idempotent/optimistic command analog** (`reconciliation.service.ts:39-60`): derive deterministic command ID from logical input, return prior row when found, then in one transaction compare expected version, `updateMany` with version predicate, throw `ConflictException` on stale state, and insert the audit row. Apply this to replay preview tokens and queue submission; forced revision must add a reason and explicit revision identity.

### Public evidence UI

**Server page/no-store/error-state analog** (`apps/web/app/fixtures/[fixtureId]/page.tsx:1-6`):

```tsx
async function load(id: string): Promise<Fixture | null> {
  const response = await fetch(`${API_ORIGIN}/fixtures/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("load failed");
  return response.json() as Promise<Fixture>;
}
```

Use an App Router server page for the evidence read. Encode team ID and `asOf`; preserve the exact query in retry/back links. Render invalid cutoffs as an explicit error with no cached/latest values. Add fixture detail links for both canonical team IDs using kickoff as `asOf`.

**Trust-state component analog** (`components/data-state-notice.tsx:1-5`): state is a closed union, labels are centralized, the `<aside aria-label>` includes written state, reason, source and `<time>` capture metadata. Generalize it with `PENDING` and degraded operational states rather than creating color-only badges.

Follow the UI spec's semantic `<dl>`, `<details>/<summary>`, real desktop table/mobile cards, 48px targets, fixed 320/768/1440 behavior, and inert `<pre>{JSON.stringify(...)}</pre>` receipt. Values unavailable at a cutoff render `Not available` plus reason, never `0`.

### Protected replay UI and server proxy

**Client workspace analog:** `apps/web/app/internal/reconciliation/page.tsx:8-20`. Copy its explicit `null` loading state, `role=status`, error message stating no change, preserved form state, disabled submit controls, conflict-specific focus via `useRef`, native dialog semantics, and raw evidence rendered as escaped text.

**Server-only credential proxy** (`internal-api/reconciliation/.../route.ts:3-10`):

```typescript
const credential = process.env.OPERATOR_CREDENTIAL;
if (!credential) return NextResponse.json({ message: "Not found" }, { status: 404 });
const response = await fetch(upstream, {
  method: request.method,
  headers: { "content-type": "application/json", "x-operator-credential": credential },
  cache: "no-store",
});
return new NextResponse(response.body, {
  status: response.status,
  headers: { "content-type": "application/json", "cache-control": "private, no-store, max-age=0" },
});
```

Create the same catch-all proxy under `internal-api/pipeline/replay`; credentials remain server-side. Preview and queue are separate requests. A 409 preserves preview and focuses “Preview replay again”; submission freezes all mutable fields and prevents double clicks.

### Tests

**Provider contract tests:** copy `tests/unit/provider-contract.test.ts:19-54`: deterministic captured clock, object-containing normalized provenance assertions, malformed/unknown input rejection, injected fetch spy, timeout assertion, and proof token/cause is absent from serialized errors. Extend to finished scores and complete standing snapshots.

**PostgreSQL migration tests:** copy `migration-empty.test.ts:45-82,84-130`: unique per-process PostgreSQL 18 container, `prisma migrate deploy`, best-effort teardown, then inspect tables, composite indexes, FKs and append-only triggers through `information_schema`/`pg_indexes`. Add observation/fact mutation rejection and dual-time indexes.

**Reservation and job integration:** copy `provider-capability.test.ts:61-70,80-121`: launch concurrent reservations, assert hard allowance count, retry same job key, spy that provider factory is untouched on denial, verify reservation exists before fetch, run job twice, and assert one durable canonical identity. Phase 2 adds headroom-by-lane, circuit-before-reservation, late correction, standing snapshot atomicity, DLQ and replay revision matrices.

**API tests:** copy `eligibility.test.ts:47-69` for direct controller/guard assertions and private no-store response headers. Evidence tests must cover invalid/unsupported cutoff with no latest fallback and only terminal published builds.

**E2E:** copy `fixture-discovery.spec.ts:37-86` for URL-state, semantic headings, mobile/desktop, 200% zoom, forced colors/reduced motion, no horizontal page scroll, zero/populated states, and forbidden betting language. Copy `reconciliation-review.spec.ts:5-64` for route stubs, escaped malicious/large evidence, validation, confirmation dialog, 409 focus and preserved inputs. Add cutoff browser Back, trace sort invariance, null-with-reason matrix, mandatory replay preview, stale preview, forced-revision reason, and duplicate-submit protection.

## Shared Patterns

### Canonical identity before analytics

**Source:** `workers/data-sync/src/jobs/fixtures.ts:57-69`.

Resolve provider external IDs through external-reference tables inside the transaction. Missing identity throws before any evidence feature is published; never persist provider IDs as canonical team/fixture IDs.

### Transactional provenance

**Source:** `workers/data-sync/src/jobs/fixtures.ts:51-92`.

Hash the preserved raw payload and commit normalized fact plus provenance in one database transaction. Replay duplicate observations use database conflict handling; corrections append a new payload hash/version.

### Fail closed before I/O

**Sources:** `fixtures.ts:24-46`, `operator.guard.ts:13-24`, `request-budget.ts:20-40`.

Unknown capability/circuit/quota/auth never constructs a provider or reveals a protected route. Denial results have stable classified reasons suitable for operator display, without raw exceptions or secrets.

### Deterministic identity and optimistic concurrency

**Source:** `reconciliation.service.ts:8-10,39-60`.

Hash logical command input to a stable ID, return an existing successful command as an idempotent no-op, and guard mutable plan transitions with an expected version predicate and 409 conflict.

### No-store trust projections

**Sources:** fixture pages and internal proxy.

Cutoff evidence and operator pipeline state always use `cache: "no-store"`; protected proxy responses additionally set `private, no-store, max-age=0`. Public projections expose safe limitation/provenance metadata beside values.

### ESM/import conventions

Package internals use explicit `.js` extensions in TypeScript relative imports (`./normalize.js`). Workspace imports use `@bet-stats/*`. Next App Router page imports currently omit extensions. Keep strict readonly DTO arrays and injected clocks/fetchers in pure/testable boundaries.

## No Analog Found

| File/Area | Role | Data Flow | Reason / Planner Guidance |
|---|---|---|---|
| `workers/data-sync/src/queues/**`, `resilience/**`, `replay/**` | service/config | event-driven | No BullMQ or Cockatiel code exists. Use Phase 2 research examples and official APIs; database ledgers remain authoritative. |
| `packages/domain/src/evidence/{eligibility,form,elo,features}.ts` | utility | deterministic transform | No chronological fold exists. Implement pure functions from the locked dual-time/tie-break contract and test invariants/property cases. |

## Integration Order

1. Extend Prisma schema and SQL migration; regenerate the client; prove empty migration plus immutability/index constraints.
2. Extend provider port/schema/normalizers/client for results and standings; keep existing fixture contract compatible.
3. Extend quota policy and implement the reusable gated runner, durable run/attempt/circuit/replay ledgers, then lane workers.
4. Implement the as-of query boundary and pure feature functions; publish `EvidenceBuild` only after terminal source windows.
5. Add public evidence and protected replay Nest modules; register them in `AppModule`.
6. Add Next server evidence page/team links, then protected replay proxy/client workspace.
7. Complete integration/E2E matrices, including replay-twice and post-cutoff-correction invariants.

## Metadata

**Analog search scope:** `packages/database`, `packages/domain`, `packages/football-data`, `workers/data-sync`, `apps/api`, `apps/web`, `tests`
**Repository files scanned:** 125
**Strong analog files read:** 24
**Pattern extraction date:** 2026-08-29

