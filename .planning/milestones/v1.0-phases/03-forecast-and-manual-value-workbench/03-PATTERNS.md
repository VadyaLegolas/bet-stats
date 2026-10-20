# Phase 3: Forecast and Manual Value Workbench - Pattern Map

**Mapped:** 2026-09-05
**Files analyzed:** 22 likely new/modified files or file groups
**Analogs found:** 21 / 22

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/domain/src/forecast/contract.ts` | model / utility | transform | `packages/domain/src/evidence/contract.ts` | exact |
| `packages/domain/src/forecast/config.ts` | config | transform | `packages/domain/src/evidence/features.ts` | role-match |
| `packages/domain/src/forecast/model.ts` | service / utility | transform | `packages/domain/src/evidence/features.ts` | exact |
| `packages/domain/src/forecast/confidence.ts` | utility | transform | `packages/domain/src/evidence/features.ts` | role-match |
| `packages/domain/src/odds/contract.ts` | model / utility | request-response / transform | `packages/domain/src/evidence/contract.ts` | exact |
| `packages/domain/src/odds/normalize.ts` | utility | transform | `packages/domain/src/evidence/features.ts` | role-match |
| `packages/domain/src/value/contract.ts` | model / utility | request-response / transform | `packages/domain/src/evidence/contract.ts` | exact |
| `packages/domain/src/value/decision.ts` | utility | transform | `packages/domain/src/forecast-eligibility.ts` | role-match |
| `packages/domain/src/index.ts` | config / barrel | transform | current `packages/domain/src/index.ts` | exact |
| `packages/database/prisma/schema.prisma` | model | CRUD / append-only | `EvidenceBuild` + `EvidenceComponent` models | exact |
| `packages/database/prisma/migrations/<phase3>/migration.sql` | migration | CRUD / append-only | `20260830_phase02_temporal_repair/migration.sql` | exact |
| `apps/api/src/modules/forecasts/{forecasts.controller,forecasts.service}.ts` | controller / service | request-response / CRUD | `apps/api/src/modules/evidence/*` | exact |
| `apps/api/src/modules/odds/{odds.controller,odds.service}.ts` | controller / service | request-response / CRUD | `apps/api/src/modules/evidence/*` | role-match |
| `apps/api/src/modules/value/{value.controller,value.service}.ts` | controller / service | request-response / CRUD | `apps/api/src/modules/evidence/*` | role-match |
| `apps/api/src/app.module.ts` | config | request-response | current `apps/api/src/app.module.ts` | exact |
| `workers/data-sync/src/jobs/forecasts.ts` | service / job | event-driven / batch | `workers/data-sync/src/jobs/evidence-rebuild.ts` | exact |
| `apps/web/app/fixtures/[fixtureId]/page.tsx` | component | request-response | current fixture detail page | exact |
| `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` | component | event-driven / request-response | `apps/web/components/evidence-state-notice.tsx` plus fixture page | partial |
| `apps/web/app/internal-api/fixtures/[fixtureId]/.../route.ts` | route | request-response / streaming proxy | `apps/web/app/internal-api/teams/[teamId]/evidence/route.ts` | exact |
| `tests/unit/{forecast,value}.test.ts` | test | transform | `tests/unit/chronological-features.test.ts` | exact |
| `tests/integration/{forecast-snapshots,manual-odds,value-receipt}.test.ts` | test | CRUD / request-response | `tests/integration/evidence-api.test.ts` and `evidence-publication.test.ts` | exact |
| `tests/e2e/forecast-workbench.spec.ts` | test | request-response / event-driven | no single close workbench/form analog | no analog |

## Pattern Assignments

### Domain contracts: `forecast/contract.ts`, `odds/contract.ts`, `value/contract.ts`

**Analog:** `packages/domain/src/evidence/contract.ts`

Use readonly DTOs and discriminated unions, keep absence explicit as `null`, and validate unknown input at the package boundary. Phase 3 should use the same exact-key parsing approach for immutable receipt objects so extra or malformed members fail closed.

**Typed contract pattern** (lines 35-50, 61-80):

```typescript
export interface EvidenceComponent<T> {
  readonly value: T | null;
  readonly sampleSize: number;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly sourceRefs: readonly EvidenceSourceRef[];
  readonly limitation: EvidenceLimitation | null;
}

export interface EvidenceProjectionDto {
  readonly state: "COMPLETE" | "LIMITED" | "PENDING";
  readonly freshness: "FRESH" | "STALE" | "UNAVAILABLE";
  readonly buildId: string | null;
  readonly receipt: EvidenceReceipt | null;
  readonly components: Partial<Record<EvidenceComponentKind, EvidenceProjectionComponent>>;
}
```

Apply this to a strict forecast snapshot DTO, complete manual book DTO, and value receipt DTO. Model `VALUE_CANDIDATE | NO_VALUE | INSUFFICIENT_EVIDENCE` as a tagged union, not thrown errors.

**Validation and exact receipt shape** (lines 102-124, 173-177):

```typescript
export function parseEvidenceProjection(value: unknown): EvidenceProjectionDto {
  if (!value || typeof value !== "object") throw new Error("INVALID_EVIDENCE_PROJECTION");
  const candidate = value as EvidenceProjectionDto;
  // validate required scalar fields and every nested component
  return candidate;
}

function hasExactKeys<T extends readonly string[]>(value: unknown, keys: T): value is Record<T[number], unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
```

For odds, additionally enforce an allowlisted market-to-selection mapping, unique selections, exact completeness, decimal-string length/scale limits, finiteness, and `> 1.00`. Derived probabilities, edge, and EV must not be accepted from clients.

---

### Forecast calculation: `forecast/config.ts`, `forecast/model.ts`, `forecast/confidence.ts`

**Analog:** `packages/domain/src/evidence/features.ts`

Keep the calculation pure: accept a complete input DTO, resolve one cutoff, preserve every source reference, use explicit versioned configuration, and return a receipt beside calculated values. Never mutate inputs or query persistence from domain functions.

**Imports and pure calculation shape** (lines 1-5, 26-55):

```typescript
import type { EvidenceComponent, EvidenceMatch, EvidenceReceipt } from "./contract.js";
import { toSourceRef } from "./contract.js";

export function buildTeamEvidence(input: TeamEvidenceInput) {
  const resolvedAsOf = new Date(input.asOf).toISOString();
  const eligible = selectEligibleEvidence({ asOf: resolvedAsOf, matches: input.matches });
  const receipt: EvidenceReceipt = {
    requestedAsOf: input.asOf,
    resolvedAsOf,
    configVersion: "evidence-v1",
    sourceWindow: { requestedFrom: null, requestedTo: resolvedAsOf, returnedFrom: eligible[0]?.effectiveAt ?? null, returnedTo: eligible.at(-1)?.effectiveAt ?? null },
    inputs: eligible.map(toSourceRef),
  };
  return { teamId: input.teamId, state: eligible.length === 0 ? "EMPTY" as const : "COMPLETE" as const, receipt };
}
```

Phase 3 should split this into small pure helpers: bounded expected-goal adjustments, Poisson `0..7` matrix, one marginalization pass for 1X2/O-U/BTTS, retained/tail mass, configured normalization, fair-odds boundary, and confidence components. Probability and confidence remain sibling fields; confidence is only a gate.

Missing evidence follows the existing component helper pattern rather than zero filling (lines 18-23):

```typescript
function component<T>(matches: readonly EvidenceMatch[], value: T | null): EvidenceComponent<T> {
  return {
    value,
    sampleSize: matches.length,
    windowStart: matches[0]?.effectiveAt ?? null,
    windowEnd: matches.at(-1)?.effectiveAt ?? null,
    sourceRefs: matches.map(toSourceRef),
    limitation: matches.length === 0 || value === null ? "NO_ELIGIBLE_HISTORY" : null,
  };
}
```

Use `decimal.js` only at decimal boundaries (manual odds, implied/no-vig probability, fair odds, edge/EV serialization); persist canonical strings and round only in the UI.

---

### Value decision: `value/decision.ts`

**Analog:** `packages/domain/src/forecast-eligibility.ts`

Use a pure discriminated result rather than booleans mixed with exceptions (lines 1-5):

```typescript
export function forecastEligibility(state: CanonicalIdentityState):
  { eligible: true } |
  { eligible: false; reason: "UNRESOLVED_CANONICAL_IDENTITY" } {
  return state === "RESOLVED"
    ? { eligible: true }
    : { eligible: false, reason: "UNRESOLVED_CANONICAL_IDENTITY" };
}
```

Extend this shape with ordered gate results. Policy/canonical/cutoff/data-quality failures take precedence, then confidence, then edge and EV. A failed gate is a normal persisted outcome. Include every threshold, threshold version, formula version, and individual gate result in the returned receipt.

---

### Persistence: Prisma schema and Phase 3 migration

**Analogs:** `packages/database/prisma/schema.prisma` lines 365-394 and `packages/database/prisma/migrations/20260830_phase02_temporal_repair/migration.sql` lines 48-71

Use parent snapshot rows plus immutable child/detail rows, `onDelete: Restrict`, compound content identity, explicit timestamps as `@db.Timestamptz(3)`, JSON only for genuinely versioned receipt payloads, and indexes for fixture/cutoff reads.

```prisma
model EvidenceBuild {
  id            String             @id @default(cuid())
  teamId        String
  cutoff        DateTime           @db.Timestamptz(3)
  configVersion String
  configHash    String
  state         EvidenceBuildState @default(BUILDING)
  publishedAt   DateTime?          @db.Timestamptz(3)
  createdAt     DateTime           @default(now()) @db.Timestamptz(3)
  components    EvidenceComponent[]

  @@unique([teamId, cutoff, configHash, syncRunId])
  @@index([teamId, cutoff, state])
}
```

Forecast identity must include fixture, kind, cutoff, model/config fingerprint, and evidence/input fingerprint. Odds snapshots use a parent book plus selection children and a replacement link. Value receipts hold required foreign keys to the exact forecast and odds snapshots. Do not model any of these as a mutable “current” record.

Protect lifecycle and identity in PostgreSQL, not only service convention:

```sql
IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EvidenceBuild is immutable'; END IF;
IF OLD."state" <> 'BUILDING' OR NEW."state" NOT IN ('PUBLISHED','FAILED') THEN
  RAISE EXCEPTION 'invalid EvidenceBuild transition % -> %', OLD."state", NEW."state";
END IF;
IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."teamId" IS DISTINCT FROM OLD."teamId" THEN
  RAISE EXCEPTION 'EvidenceBuild identity and inputs are immutable';
END IF;
```

Submitted odds, issued forecasts, and value receipts should reject update/delete. If a short build state is retained for atomic forecast publication, allow only the equivalent guarded terminal transition.

---

### API modules: forecasts, odds, and value

**Analogs:** `apps/api/src/modules/evidence/evidence.controller.ts`, `evidence.service.ts`, and `apps/api/src/app.module.ts`

Controllers remain thin, resource-oriented, and `no-store`; services own validation, policy, persistence, and projections.

**Controller pattern** (controller lines 1-13):

```typescript
import { Controller, Get, Header, Param, Query } from "@nestjs/common";

@Controller("teams")
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get(":teamId/evidence")
  @Header("Cache-Control", "no-store")
  get(@Param("teamId") teamId: string, @Query("asOf") asOf?: string) {
    return this.evidence.get(teamId, asOf);
  }
}
```

Apply the existing eligibility guard to every new protected endpoint. Forecast generation/read must require exact fixture and cutoff/kind inputs; comparison must require explicit `forecastSnapshotId` and `oddsSnapshotId`, then verify fixture and market equality server-side. Receipt download uses a fixed server-generated filename and content type.

**Error mapping and repository seam** (service lines 36-53, 96-113):

```typescript
export interface EvidenceRepository {
  findPublished(teamId: string, cutoff: string): Promise<PublishedEvidenceBuild | null>;
}

function contractError(code: string): Error & { code: string } {
  const exception = code === "UNPUBLISHED_BUILD" || code === "POST_CUTOFF_BUILD"
    ? new ConflictException({ code })
    : new BadRequestException({ code });
  return Object.assign(exception, { code });
}
```

Keep exported orchestration functions repository-injectable for fast tests, as `resolveTeamEvidence` does. Use `BadRequestException` for malformed contracts and `ConflictException` for valid requests that conflict with lifecycle/cutoff state. Normal insufficient-evidence outcomes are returned DTOs, not exceptions.

Register controllers/providers in the existing composition root style (`apps/api/src/app.module.ts` lines 16-18).

---

### Scheduled forecast job: `workers/data-sync/src/jobs/forecasts.ts`

**Analog:** `workers/data-sync/src/jobs/evidence-rebuild.ts`

Separate a pure orchestration interface from the Prisma adapter, wrap the entire build in a transaction, use a deterministic compound key, return an already-published snapshot on collision, and publish only after all receipt components are staged.

**Transaction seam** (lines 30-43):

```typescript
export interface EvidenceRebuildTransaction {
  findBuild(key: { teamId: string; cutoff: string; configHash: string; syncRunId: string }): Promise<BuildRecord | null>;
  createBuild(build: Record<string, unknown>): Promise<BuildRecord>;
  stageComponent(component: Record<string, unknown>): Promise<void>;
  publishBuild(id: string): Promise<void>;
}

export interface EvidenceRebuildDatabase {
  transaction<T>(work: (transaction: EvidenceRebuildTransaction) => Promise<T>): Promise<T>;
}
```

**Idempotent publication** (lines 118-137):

```typescript
return input.database.transaction(async (transaction) => {
  const existing = await transaction.findBuild(key);
  if (existing?.state === "PUBLISHED") {
    return { state: "PUBLISHED" as const, buildId: existing.id };
  }
  const build = existing ?? await transaction.createBuild({ ...key, state: "BUILDING" });
  // stage complete immutable result and receipt
  await transaction.publishBuild(build.id);
  return { state: "PUBLISHED" as const, buildId: build.id };
});
```

INITIAL and PRE_MATCH job IDs must be deterministic from the logical snapshot identity. LINEUP_CONFIRMED scheduling stays dormant until an official confirmed-lineup observation exists.

---

### Fixture workbench and internal API routes

**Analogs:** `apps/web/app/fixtures/[fixtureId]/page.tsx`, `apps/web/components/evidence-state-notice.tsx`, and `apps/web/app/internal-api/teams/[teamId]/evidence/route.ts`

The fixture page is a Server Component that loads canonical fixture/snapshot data with `cache: "no-store"`, handles unavailable and not-found states inline, and delegates only the odds form and snapshot selection to a focused client component. Preserve the safe return-link boundary.

**Server fetch/error state pattern** (fixture page lines 1-6):

```typescript
async function load(id: string): Promise<Fixture | null> {
  const response = await fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:3001"}/fixtures/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("load failed");
  return response.json() as Promise<Fixture>;
}
```

Lead the workbench with an accessible outcome state and keep limitations adjacent to the qualified data:

```tsx
if (state === "PENDING") {
  return <p role="status">Evidence is being rebuilt for this cutoff. Partial calculations are not published.</p>;
}
if (state === "UNAVAILABLE") {
  return <p role="alert">Historical evidence could not be loaded for this cutoff. No newer data was substituted. Try again.</p>;
}
```

Use the same `role="status"` / `role="alert"` distinction for value/no-value/insufficient-evidence and validation failures. Keep confidence components, source times, assumptions, formulas, and receipt progressive disclosure near the outcome. Do not add stake sizing, urgency, or certainty language.

Internal routes should transparently stream the upstream body/status while pinning JSON and `no-store` (route lines 3-14):

```typescript
const response = await fetch(upstream, { headers: { accept: "application/json" }, cache: "no-store" });
return new NextResponse(response.body, {
  status: response.status,
  headers: {
    "content-type": response.headers.get("content-type") ?? "application/json",
    "cache-control": "no-store",
  },
});
```

---

### Tests: unit and integration

**Analogs:** `tests/unit/chronological-features.test.ts`, `tests/integration/evidence-api.test.ts`, and `tests/integration/evidence-publication.test.ts`

Unit tests import public package exports and assert invariants, deterministic permutation behavior, explicit missing evidence, bounded adjustments, and receipt versioning.

```typescript
it("is deterministic under permutation and limits H2H contribution to five percent", () => {
  const result = buildTeamEvidence({ /* ... */ matches });
  expect(result).toEqual(buildTeamEvidence({ /* ... */ matches: [...matches].reverse() }));
  expect(result.h2h.value?.weight).toBeLessThanOrEqual(0.05);
});
```

Forecast tests should cover probability sums/tolerance, every matrix-derived market, high-lambda tail disclosure, zero/unsupported fair odds, and deterministic config/input hashes. Odds/value truth tables should cover all markets, incomplete/duplicate/nonfinite values, no-vig sum, overround, full-precision edge/EV, and all gate precedence combinations.

API integration tests should inject repository fakes and prove fail-closed behavior before a query occurs:

```typescript
const repository = { findPublished: async () => { throw new Error("must not query"); } };
await expect(resolveTeamEvidence({ teamId: "team-arsenal", asOf: "not-an-instant" }, repository))
  .rejects.toMatchObject({ code: "INVALID_AS_OF" });
```

Database integration tests should use the existing PostgreSQL/Testcontainers boundary to verify compound-key idempotency, changed-input revisions, snapshot pairing, and rejected update/delete operations.

## Shared Patterns

### Cutoff and canonical eligibility

**Sources:** `packages/domain/src/forecast-eligibility.ts`; `apps/api/src/modules/evidence/evidence.service.ts` lines 49-53, 96-113

Apply before forecast generation, snapshot reads, odds submission, comparison, and receipt download. Normalize instants once, reject missing/invalid cutoffs, require resolved canonical identity, and never substitute a newer build.

### Receipt provenance

**Sources:** `packages/domain/src/evidence/contract.ts` lines 44-50, 115-149; `packages/domain/src/evidence/features.ts` lines 37-43

Every analytical result carries exact IDs, cutoff, versions, config/input hashes, source refs including payload identity, assumptions, formulas, and gates. Exact-key validation prevents silently accepting altered receipt shapes.

### Error and abstention semantics

**Sources:** `apps/api/src/modules/evidence/evidence.service.ts` lines 42-47; `apps/web/components/evidence-state-notice.tsx` lines 7-18

Malformed input and lifecycle conflicts use stable machine-readable errors. Limited evidence and threshold failure are successful tagged outcomes with visible reasons. Never collapse pending, stale, limited, unavailable, and no-value.

### ESM and imports

Source packages use `.js` on relative imports and workspace aliases for cross-package imports:

```typescript
import { buildTeamEvidence, type EvidenceMatch } from "@bet-stats/domain";
import { toSourceRef } from "./contract.js";
```

### API cache policy

Mutable availability plus immutable selected receipts still use `Cache-Control: no-store` at controller, server fetch, and internal proxy boundaries so a client never silently sees a stale pairing.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `tests/e2e/forecast-workbench.spec.ts` | test | request-response / event-driven | Existing E2E tests cover navigation and evidence states, but no complete multi-market form plus immutable snapshot-pair workbench exists. Follow Playwright configuration and Research validation cases. |

## Metadata

**Analog search scope:** `packages/domain`, `packages/database/prisma`, `apps/api/src`, `apps/web`, `workers/data-sync/src`, `tests/unit`, `tests/integration`, `tests/e2e`
**Primary analog files read:** 15 (including project instructions and phase inputs)
**Pattern extraction date:** 2026-09-05
**Deferred and excluded:** settlement, scoring, calibration, ROI/yield, CLV, automated odds ingestion, inferred lineups, stake sizing, and automatic wagering
