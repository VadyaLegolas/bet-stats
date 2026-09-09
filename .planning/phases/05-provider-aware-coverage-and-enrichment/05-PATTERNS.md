# Phase 5: Provider-Aware Coverage and Enrichment - Pattern Map

**Mapped:** 2026-09-09
**Files analyzed:** 18 likely new/modified files
**Analogs found:** 18 / 18

The filenames below are the implementation seams implied by `05-CONTEXT.md`, `05-RESEARCH.md`, and `05-UI-SPEC.md`. New module boundaries may be consolidated by the planner, but each responsibility must remain represented.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/football-data/src/provider.interface.ts` | model/config | transform | same file | exact modification |
| `packages/football-data/src/routing/provider-route.ts` | service/config | request-response | `packages/database/src/replay-provider-policy.ts` | flow-match |
| `packages/football-data/src/providers/api-football/schema.ts` | model | transform | `packages/football-data/src/providers/football-data-org/schema.ts` | exact |
| `packages/football-data/src/providers/api-football/client.ts` | service | request-response | `packages/football-data/src/providers/football-data-org/client.ts` | exact |
| `packages/football-data/src/providers/api-football/normalize.ts` | utility | transform | `packages/football-data/src/providers/football-data-org/normalize.ts` | exact |
| `packages/football-data/src/providers/thesportsdb/client.ts` | service | request-response | `packages/football-data/src/providers/football-data-org/client.ts` | role-match |
| `packages/domain/src/provider-routing.ts` | model/utility | transform | `packages/domain/src/capability.ts` | role-match |
| `packages/database/prisma/schema.prisma` plus Phase 5 migration | model/migration | CRUD | existing provider policy and reconciliation models | exact modification |
| `packages/database/src/provider-routing/repository.ts` | service | CRUD | `packages/database/src/replay-provider-policy.ts` | exact |
| `packages/database/src/reconciliation/provider-fixture-resolver.ts` | service | CRUD | `apps/api/src/modules/reconciliation/reconciliation.service.ts` | role-match |
| `workers/data-sync/src/ingestion/runner.ts` | service | request-response | same file | exact modification |
| `workers/data-sync/src/jobs/fixtures.ts` / `results.ts` / `standings.ts` | service | batch | existing corresponding jobs | exact modification |
| `workers/data-sync/src/jobs/enrichment.ts` | service | event-driven | `workers/data-sync/src/jobs/fixtures.ts` | role-match |
| `apps/api/src/modules/forecasts/forecast-comparison.service.ts` | service | request-response | `apps/api/src/modules/forecasts/forecasts.service.ts` | exact role/flow |
| `apps/api/src/modules/forecasts/forecasts.controller.ts` | controller | request-response | same file | exact modification |
| `apps/api/src/modules/reconciliation/reconciliation.service.ts` | service | CRUD | same file | exact modification |
| `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` and provider notice | component | event-driven/request-response | same file; `components/evidence-state-notice.tsx` | exact modification |
| Phase 5 unit/integration/E2E tests from Research validation map | test | all above | existing `provider-*`, `forecast-*`, and reconciliation tests | exact role-match |

## Pattern Assignments

### Provider-neutral contracts and API-Football adapter

**Applies to:** `provider.interface.ts`, `providers/api-football/{schema,client,normalize}.ts`, and `providers/thesportsdb/client.ts`.

**Analog:** `packages/football-data/src/provider.interface.ts`

**Interface pattern** (lines 3-16, 57-64):

```typescript
export interface NormalizedFixture {
  provider: "football-data.org";
  externalId: string;
  competitionExternalId: string;
  seasonExternalId: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  kickoffUtc: string;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  raw: Readonly<Record<string, unknown>>;
}
export interface FixtureProvider {
  fetchCompetitionFixtures(window: RequestedDateWindow): Promise<readonly NormalizedFixture[]>;
}
```

Copy the provider interface shape and immutable normalized metadata, but replace the hard-coded provider literal with the Phase 5 provider registry. Keep TheSportsDB on a separate suggestion-only DTO; it must not implement fixture/result/standings evidence interfaces.

**Strict validation pattern:** `packages/football-data/src/providers/football-data-org/schema.ts` lines 20-24

```typescript
export function requestedCompetitionMatchesSchema(competitionCode: string) {
  return competitionMatchesSchema.refine(
    (value) => value.competition.code === competitionCode,
    { message: "Competition response does not match request", path: ["competition", "code"] },
  );
}
```

API-Football schemas should validate the response envelope and bind competition/season identity to the exact request. Coverage fields remain seasonal evidence rather than a generic availability boolean.

**HTTP and safe-error pattern:** `packages/football-data/src/providers/football-data-org/client.ts` lines 28-46

```typescript
try {
  const response = await this.#fetcher(url, {
    headers: { "X-Auth-Token": this.#apiToken },
    signal: AbortSignal.timeout(this.#timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!schema.safeParse(payload).success) throw new ProviderPayloadError("Invalid provider payload");
  return normalize(payload, this.#now());
} catch (error) {
  if (error instanceof ProviderPayloadError) throw error;
  throw new Error("provider request failed");
}
```

Preserve injected `fetcher`, clock, timeout, built-in fetch, URL encoding, and sanitized errors. Add a classified result/header-observation boundary; do not expose raw errors, authentication headers, or arbitrary response headers.

### Route policy, durable receipts, quota, and optional admission

**Applies to:** `domain/provider-routing.ts`, `routing/provider-route.ts`, Prisma schema/migration, database routing repository, `ingestion/runner.ts`, and route-aware jobs.

**Fail-closed capability analog:** `packages/domain/src/capability.ts` lines 14-25

```typescript
export type CapabilityDecision =
  | { allowed: true }
  | { allowed: false; reason: "UNKNOWN_CAPABILITY" | "UNSUPPORTED_CAPABILITY" | "EXPIRED_CAPABILITY" | "CAPABILITY_MISMATCH" };

export function evaluateCapability(capability, expected, now = new Date()): CapabilityDecision {
  if (!capability) return { allowed: false, reason: "UNKNOWN_CAPABILITY" };
  if (capability.provider !== expected.provider || capability.leagueId !== expected.leagueId || capability.seasonId !== expected.seasonId || capability.endpoint !== expected.endpoint) return { allowed: false, reason: "CAPABILITY_MISMATCH" };
  if (!capability.supported) return { allowed: false, reason: "UNSUPPORTED_CAPABILITY" };
  if (capability.expiresAt && capability.expiresAt.getTime() <= now.getTime()) return { allowed: false, reason: "EXPIRED_CAPABILITY" };
  return { allowed: true };
}
```

**Database projection pattern:** `packages/database/src/replay-provider-policy.ts` lines 39-70

```typescript
async read(provider, endpointFamily) {
  const observedAt = now();
  const config = options.policies.find((policy) => policy.provider === provider && policy.endpointFamily === endpointFamily);
  if (!config) return unavailableSnapshot(provider, endpointFamily, observedAt, "MISSING_POLICY");
  const [circuit, reserved] = await Promise.all([
    options.database.providerCircuitState.findUnique({ where: { provider_endpointFamily: { provider, endpointFamily } } }),
    options.database.providerRequestReservation.count({ where: { provider, requestDate } }),
  ]);
  if (!circuit) return quotaSnapshot(config, observedAt, resetDate, reserved, null, null, "MISSING_CIRCUIT_STATE");
  return quotaSnapshot(config, observedAt, resetDate, reserved, circuit, validUntil, blockedReason);
}
```

Copy explicit unavailable projections and safe timestamps. Extend rather than reinterpret the date-based budget: hard daily quota, short throttle window, and application soft headroom are three distinct persisted concepts.

**Admission ordering analog:** `workers/data-sync/src/ingestion/runner.ts` lines 56-99

```typescript
if (input.capability !== "SUPPORTED") return { status: "denied", reason: "CAPABILITY_DENIED" };
if (circuitState === "OPEN") return { status: "denied", reason: "CIRCUIT_OPEN" };
if (input.cache?.hit) return { status: "cached", value: input.cache.value };
const reservation = await input.reserve({ provider, endpoint, lane, allowance, jobKey });
if (!reservation.reserved) return { status: "denied", reason: reservation.reason ?? "ALLOWANCE_EXHAUSTED" };
const response = await input.callProvider(input.providerFactory());
if (wrapped && response.quota !== undefined) await input.observeQuota?.(response.quota);
if (input.publish) await input.publish(value); else await input.persist?.(value);
```

Insert route-receipt creation before dispatch and persist denied/no-fallback attempts too. Fallback is allowed only for classified transport/provider availability, unsupported coverage, or policy allowance failures; validation and ambiguous identity errors quarantine. Optional lineup/injury/odds/statistics calls retain exact capability → circuit → atomic reservation ordering and critical headroom.

### Cross-provider fixture reconciliation and suggestion-only review

**Applies to:** database fixture resolver, TheSportsDB adapter, reconciliation API and page.

**Optimistic, append-only decision analog:** `apps/api/src/modules/reconciliation/reconciliation.service.ts` lines 39-60

```typescript
const prior = await database.reconciliationDecision.findUnique({ where: { id } });
if (prior) return { decision: projectionDecision(prior), version: command.expectedVersion + 1 };
return database.$transaction(async (tx) => {
  const current = await tx.reconciliationCase.findUnique({ where: { id: command.caseId }, include: { candidates: true, decisions: true } });
  if (current.version !== command.expectedVersion) throw new ConflictException("Review case changed");
  const updated = await tx.reconciliationCase.updateMany({
    where: { id: command.caseId, version: command.expectedVersion },
    data: { version: { increment: 1 }, status: "RESOLVED", resolvedAt: new Date() },
  });
  if (updated.count !== 1) throw new ConflictException("Review case changed");
  const decision = await tx.reconciliationDecision.create({ data: { id, caseId: command.caseId, evidence, actor } });
  return { decision: projectionDecision(decision), version: command.expectedVersion + 1 };
});
```

The resolver must perform external-ref lookup first, then resolved canonical participants plus versioned kickoff window, accepting exactly one candidate. Ambiguity opens a case and blocks persistence/publication. Suggestions carry provider/time/name/alias/validated-image metadata only and never mutate identity or enter evidence.

**Client conflict-preservation pattern:** `apps/web/app/internal/reconciliation/page.tsx` lines 17-20. Preserve selected fields, send `expectedVersion` and an idempotency key, focus `Reload case` on HTTP 409, and append the returned decision locally. The new suggestion panel only copies a suggestion into an editable review input; it never invokes `submit`.

### Server-authoritative forecast comparison API

**Applies to:** `forecast-comparison.service.ts`, forecasts controller/module, and comparison tests.

**Service validation/error mapping analog:** `apps/api/src/modules/forecasts/forecasts.service.ts` lines 11-34

```typescript
function failure(code: string): Error & { code: string } {
  const exception = conflictCodes.includes(code)
    ? new ConflictException({ code })
    : new BadRequestException({ code });
  return Object.assign(exception, { code });
}
export async function generateForecast(raw: unknown, repository): Promise<ForecastResponseDto> {
  const request = parseForecastRequest(raw);
  try { return await orchestrator.run(request, repository); }
  catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
    if (code) throw failure(code);
    throw error;
  }
}
```

Parse exact left/right snapshot IDs, load both, require same fixture and `ISSUED`, and compute stable server-side deltas. Echo IDs/cutoffs and return explicit absent-side reasons; never choose “latest” or let the client subtract arbitrary receipts.

**Controller pattern:** `apps/api/src/modules/forecasts/forecasts.controller.ts` lines 7-26

```typescript
@Controller("fixtures/:fixtureId/forecasts")
@UseGuards(EligibilityGuard)
export class ForecastsController {
  @Post()
  @Header("Cache-Control", "private, no-store, max-age=0")
  generate(@Param("fixtureId") fixtureId: string, @Body() body): Promise<ForecastResponseDto> {
    return this.forecasts.generate({ ...body, fixtureId });
  }
}
```

Reuse the guard and private/no-store response policy for comparison and snapshot-availability routes.

### Provider state and immutable pair UI

**Applies to:** fixture list/detail, `forecast-workbench.tsx`, provider-state notice, and reconciliation suggestion panel.

**Honest-state analog:** `apps/web/components/evidence-state-notice.tsx` lines 7-18

```tsx
if (state === "PENDING") return <p role="status">Evidence is being rebuilt for this cutoff. Partial calculations are not published.</p>;
if (state === "UNAVAILABLE") return <p role="alert">Historical evidence could not be loaded for this cutoff. No newer data was substituted. Try again.</p>;
return <div aria-label="Evidence status">
  {freshness === "STALE" && <p>Historical evidence is stale for this cutoff. Source times remain visible below.</p>}
  {limitationReason && <p>{limitationReason}</p>}
</div>;
```

Extend this vocabulary for current, fallback, sole source, limited, stale/last-valid, unsupported, pending, and unavailable. Always show provider role, safe reason, capture/source time, and freshness. Unknown/missing enrichment is never rendered as zero.

**Stable selection and disclosure analog:** `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` lines 47-58. Copy the controlled exact-snapshot selector, `<time dateTime>`, semantic tables, `<details>/<summary>`, wrapped `<pre>`, clipboard handling, and error messages that preserve state. Add two controlled selectors backed by `leftSnapshotId`/`rightSnapshotId` URL parameters; initialize earliest/latest once only, and never overwrite user selections during refresh.

**Reconciliation UI analog:** `apps/web/app/internal/reconciliation/page.tsx` lines 13-20. Copy loading/empty/error branches, semantic fieldsets, preserved form state, explicit confirmation, optimistic-conflict focus, and audit history. Keep suggestion-only content visually separate and route candidate images only through a validated application boundary.

## Shared Patterns

### Canonical identity

Provider IDs are evidence keys, never canonical IDs. Exact external references precede participant/kickoff matching; zero or multiple conservative candidates block publication and forecasting.

### Error and degradation handling

Adapters sanitize failures. Orchestration classifies failures and persists every attempt. API projections use stable safe codes. UI states say what failed, what remained unchanged, and one retry action. Missing, stale, unsupported, limited, pending, and unavailable are distinct nonnumeric states.

### Provenance and immutability

Append route decisions, source observations, fallback captures, reconciliation decisions, evidence builds, and forecasts. Recovery may select a newer current capture by deterministic freshness rules but never rewrites fallback-derived history.

### Security and authorization

Reuse `EligibilityGuard` for public forecast paths and the existing operator guard/gateway for reconciliation. Keep provider credentials and unexpected headers server-only. Never browser-fetch arbitrary logo candidate URLs.

### Testing

Follow existing Vitest integration style and Playwright UI flows. Add the seven Research Wave 0 files: provider routing, fallback identity, API-Football, degradation E2E, enrichment admission, forecast comparison, and TheSportsDB boundary. Cover malformed payloads, 429/5xx, stale capability, quota headroom, ambiguous reconciliation, stable URL selections, no-zero missing values, keyboard/focus, 320/768/1440 widths, 200% zoom, forced colors, and reduced motion.

## No Analog Found

No required responsibility is wholly without an analog. The new concepts—multi-provider route receipts, short-window throttle observations, server pair deltas, and suggestion-only image validation—must combine the concrete patterns above with the stricter contracts in `05-RESEARCH.md`; there is no existing exact implementation to copy verbatim.

## Metadata

**Analog search scope:** `apps/`, `packages/`, `workers/`, `tests/`
**Primary analog files read:** 13
**Pattern extraction date:** 2026-09-09
