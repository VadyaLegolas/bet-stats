---
phase: 05-provider-aware-coverage-and-enrichment
reviewed: 2026-09-19T13:10:00Z
depth: deep
files_reviewed: 86
files_reviewed_list:
  - .gitignore
  - apps/api/package.json
  - apps/api/src/app.module.ts
  - apps/api/src/modules/fixtures/fixtures.service.ts
  - apps/api/src/modules/forecasts/forecast-comparison.service.ts
  - apps/api/src/modules/forecasts/forecasts.controller.ts
  - apps/api/src/modules/forecasts/forecasts.module.ts
  - apps/api/src/modules/media/media.module.ts
  - apps/api/src/modules/media/provider-logo.controller.ts
  - apps/api/src/modules/media/provider-logo.service.ts
  - apps/api/src/modules/providers/provider-policy.controller.ts
  - apps/api/src/modules/providers/provider-policy.service.ts
  - apps/api/src/modules/providers/providers.module.ts
  - apps/api/src/modules/reconciliation/reconciliation.controller.ts
  - apps/api/src/modules/reconciliation/reconciliation.service.ts
  - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
  - apps/web/app/fixtures/[fixtureId]/page.tsx
  - apps/web/app/fixtures/page.tsx
  - apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/availability/route.ts
  - apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/compare/route.ts
  - apps/web/app/internal-api/provider-logo/[reference]/route.ts
  - apps/web/app/internal/reconciliation/page.tsx
  - apps/web/app/layout.tsx
  - apps/web/components/provider-state-notice.tsx
  - packages/config/src/index.test.ts
  - packages/config/src/index.ts
  - packages/database/package.json
  - packages/database/prisma/migrations/20260909_phase05_provider_routing/migration.sql
  - packages/database/prisma/migrations/20260913_phase05_season_external_ref_scope/migration.sql
  - packages/database/prisma/migrations/20260913_phase05_terminal_route_attempt/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/database/src/forecast-repository.ts
  - packages/database/src/index.ts
  - packages/database/src/provider-routing/repository.ts
  - packages/database/src/reconciliation/provider-fixture-resolver.ts
  - packages/domain/src/forecast/comparison.ts
  - packages/domain/src/forecast/contract.ts
  - packages/domain/src/index.ts
  - packages/domain/src/provider-routing.ts
  - packages/football-data/src/index.ts
  - packages/football-data/src/provider.interface.ts
  - packages/football-data/src/providers/api-football/client.ts
  - packages/football-data/src/providers/api-football/normalize.ts
  - packages/football-data/src/providers/api-football/schema.ts
  - packages/football-data/src/providers/football-data-org/client.ts
  - packages/football-data/src/providers/football-data-org/normalize.ts
  - packages/football-data/src/providers/thesportsdb/client.ts
  - packages/football-data/src/routing/provider-route.ts
  - playwright.config.ts
  - playwright.phase05.config.ts
  - scripts/provider-policy-probe.ts
  - tests/e2e/forecast-comparison.spec.ts
  - tests/e2e/live-provider-stack.ts
  - tests/e2e/provider-degradation.spec.ts
  - tests/e2e/reconciliation-review.spec.ts
  - tests/integration/api-football-provider.test.ts
  - tests/integration/enrichment-admission.test.ts
  - tests/integration/enrichment-runtime.test.ts
  - tests/integration/forecast-comparison-api.test.ts
  - tests/integration/forecast-snapshots.test.ts
  - tests/integration/live-provider-harness-smoke.test.ts
  - tests/integration/migration-empty.test.ts
  - tests/integration/phase-05-security.test.ts
  - tests/integration/provider-fallback-identity.test.ts
  - tests/integration/provider-logo-http.test.ts
  - tests/integration/provider-policy-approval.test.ts
  - tests/integration/provider-route-runtime.test.ts
  - tests/integration/provider-routing.test.ts
  - tests/integration/provider-state-api.test.ts
  - tests/integration/provider-worker-routing.test.ts
  - tests/integration/replay-boundary.test.ts
  - tests/integration/thesportsdb-boundary.test.ts
  - tests/unit/forecast-comparison-ui.test.tsx
  - tests/unit/forecast-comparison.test.ts
  - tests/unit/odds-draft-ui.test.tsx
  - tests/unit/provider-contract.test.ts
  - tests/unit/provider-policy-probe.test.ts
  - tests/unit/provider-state-ui.test.tsx
  - workers/data-sync/src/ingestion/provider-route-runtime.ts
  - workers/data-sync/src/ingestion/runner.ts
  - workers/data-sync/src/jobs/enrichment.ts
  - workers/data-sync/src/jobs/fixtures.ts
  - workers/data-sync/src/jobs/results.ts
  - workers/data-sync/src/jobs/standings.ts
  - workers/data-sync/src/main.ts
  - workers/data-sync/src/queues/index.ts
findings:
  critical: 7
  warning: 5
  info: 0
  total: 12
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-09-19T13:10:00Z  
**Depth:** deep  
**Files Reviewed:** 86  
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

The deep review traced the Phase 5 production path from route selection through durable admission, provider clients, BullMQ enrichment, Prisma persistence, Nest projections, Next proxies, and browser tests. The submitted implementation has seven release-blocking correctness/security defects and five robustness/test-quality defects. The most serious failures are hidden by tests that seed terminal database state rather than driving the production route and enrichment executors.

## Critical Issues

### CR-01 [BLOCKER]: Non-empty API-Football enrichment cannot be persisted or produce a lineup forecast

**File:** `packages/football-data/src/providers/api-football/schema.ts:93-99`, `workers/data-sync/src/jobs/enrichment.ts:31-36`, `workers/data-sync/src/jobs/enrichment.ts:55-56`

**Issue:** `parseApiFootballEnrichmentEnvelope` returns `{ state, payload }` without `capturedAt`, and its payload is an array. The production executor passes that value directly into `runEnrichmentJob`, which then persists `new Date(observation.capturedAt!)`; for every non-empty response this is an invalid date. The official-lineup gate also expects `payload.fixtureId/status/players` on an object, so an array returned by the parser can never satisfy it. Consequently any non-empty enrichment fails during persistence and `LINEUP_CONFIRMED` can never be issued through the actual production adapter.

**Fix:** Normalize each endpoint into the declared `EnrichmentObservation` contract in the provider client, including a valid `capturedAt` supplied by the client clock. For lineups, return a typed object containing the canonical/requested fixture identity, explicit official-confirmation state, and normalized players; validate that contract before persistence. Remove the `as any` cast and add a production-executor integration test using the real parser output.

### CR-02 [BLOCKER]: STATISTICS jobs call a nonexistent provider endpoint

**File:** `packages/football-data/src/providers/api-football/schema.ts:85-86`, `workers/data-sync/src/jobs/enrichment.ts:55`

**Issue:** The API client supports `fixtures/statistics`, but the worker transforms the internal `STATISTICS` name with `toLowerCase()` and calls `statistics`. The `as any` cast suppresses the type error, so every statistics job is sent to the wrong URL and fails or receives an unrelated payload.

**Fix:** Introduce an exhaustive mapping such as `{ LINEUPS: "lineups", INJURIES: "injuries", ODDS: "odds", STATISTICS: "fixtures/statistics" } satisfies Record<EnrichmentEndpoint, ApiFootballEnrichmentEndpoint>` and remove `as any`.

### CR-03 [BLOCKER]: Optional enrichment is enqueued immediately instead of at its cutoff and is never retried at the useful time

**File:** `workers/data-sync/src/queues/index.ts:25-35`, `workers/data-sync/src/jobs/fixtures.ts:251-253`

**Issue:** The schedule computes a cutoff one hour before kickoff, but `queue.add` has no `delay`. Jobs are enqueued immediately after fixture publication, often days before a lineup can exist. An empty response is treated as completed, and the deterministic job ID prevents a later copy from creating a fresh job while the completed record remains. The production system therefore consumes its only lineup opportunity too early.

**Fix:** Add an explicit run-at time to the schedule and pass `delay: Math.max(0, runAt - Date.now())`; model empty pre-cutoff responses as retry/reschedule rather than terminal completion. Include policy/version and intended run window in deterministic identity, and test a fixture published days before kickoff with fake timers plus BullMQ state assertions.

### CR-04 [BLOCKER]: Durable route receipts never reflect fallback or no-fallback outcomes, so the user-facing provider state is false

**File:** `workers/data-sync/src/ingestion/provider-route-runtime.ts:75-88`, `apps/api/src/modules/fixtures/fixtures.service.ts:27-39`, `apps/api/src/modules/fixtures/fixtures.service.ts:65-71`

**Issue:** Every production route receipt is created once with `selectedProvider = candidates[0]`, `trigger = PRIMARY`, and `outcome = ADMITTED`. Terminal success/failure is written only to attempts. `projectProviderState` nevertheless derives `PRIMARY/FALLBACK/LIMITED` from the immutable receipt fields and only reads an attempt for its timestamp. A real fallback remains displayed as primary, and a real sole-source `NO_FALLBACK` attempt can never produce the LIMITED state or last-valid lookup. The passing browser test manually inserts a synthetic receipt with the desired final fields, a state the production writer never creates.

**Fix:** Project the effective state from ordered terminal attempts (selected successful attempt, failed primary trigger, terminal no-fallback reason), or append a separate immutable terminal decision receipt linked to the admission receipt. Never infer terminal state from the initial admission record. Add an integration test that invokes `executeDurableMappedRoute` and then calls `FixturesService.detail` against those exact rows.

### CR-05 [BLOCKER]: Crash recovery after provider success cannot finish canonical publication

**File:** `workers/data-sync/src/ingestion/provider-route-runtime.ts:119-125`, `workers/data-sync/src/jobs/fixtures.ts:208-216`, `workers/data-sync/src/jobs/results.ts:115`, `workers/data-sync/src/jobs/standings.ts:104-106`

**Issue:** The route attempt is marked `SUCCEEDED` before the replay execution publishes canonical data. If the process crashes in that window, the next run sees the terminal attempt and returns `{ status: "replayed", observationId }`. Every endpoint job treats `replayed` as `ROUTE_REPLAYED` error instead of reconstructing and publishing the stored observation. The retry can therefore never finish the replay unit, despite the provider call and immutable observation having succeeded.

**Fix:** Persist a versioned, parseable observation envelope and make a terminal-success replay load/validate it and return the original value for idempotent publication. Alternatively combine terminal attempt completion and canonical publication in one transaction after provider I/O. Add a fault-injection test that crashes after `completeAttempt(SUCCEEDED)` and proves the next delivery reaches `context.publish` without another provider call.

### CR-06 [BLOCKER]: Quota admission uses the all-time minimum remaining value and can permanently disable a provider

**File:** `packages/database/src/provider-routing/repository.ts:110-120`

**Issue:** Admission aggregates `_min.observedLimit` and `_min.observedRemaining` over every observation ever stored for the provider/endpoint, without filtering to the active reset window or selecting one coherent latest observation. Once any historical observation records remaining `0`, `remainingCeiling` stays at the number of current reservations forever, so future days can remain exhausted even after the upstream quota resets. The two minima may also come from different observations.

**Fix:** Select the newest valid observation for the active quota window (`observedAt/resetAt` bounded by the request instant), use its limit and remaining as one atomic sample, and ignore expired samples. Persist/reset window identity explicitly and cover the day-after-reset case.

### CR-07 [BLOCKER]: Logo SSRF defense is vulnerable to DNS rebinding

**File:** `apps/api/src/modules/media/provider-logo.service.ts:41-64`

**Issue:** `#assertSafe` resolves and checks public addresses, but the subsequent native `fetch(url)` performs a separate DNS resolution. An attacker controlling or compromising an allowed hostname's DNS response can pass the first lookup with a public address and rebind the fetch to a private/shared address. The code also buffers a chunked response with `arrayBuffer()` before enforcing `MAX_BYTES`, allowing an authenticated request to consume unbounded memory when `Content-Length` is missing or false.

**Fix:** Resolve once, validate every address, connect to a pinned validated address with TLS SNI/Host verification (or use an outbound proxy with an IP deny policy), and repeat the process for every redirect. Stream the response and abort as soon as the cumulative byte count exceeds `MAX_BYTES`; do not rely on `Content-Length`.

## Warnings

### WR-01 [WARNING]: Any observed LINEUPS payload is persisted as OFFICIAL_CONFIRMED

**File:** `workers/data-sync/src/jobs/enrichment.ts:56`

**Issue:** Persistence creates `LineupObservation.status = OFFICIAL_CONFIRMED` for every non-empty LINEUPS observation before the same-fixture/pre-cutoff/official gate is evaluated. After CR-01 is fixed, an unofficial, wrong-fixture, or post-cutoff response would pollute durable truth and cause the availability endpoint to believe an official lineup exists.

**Fix:** Validate and normalize official status, fixture identity, and capture time before entering the transaction. Persist non-official evidence with an appropriate non-confirmed status, and create `OFFICIAL_CONFIRMED` only from the validated branch.

### WR-02 [WARNING]: Forecast absence reason reads an unrelated latest route

**File:** `apps/api/src/modules/forecasts/forecast-comparison.service.ts:49-60`

**Issue:** The LINEUP_CONFIRMED absence query filters only competition and season. It does not filter `endpointFamily = LINEUPS`, provider, or the relevant cutoff/window. A newer FIXTURES, RESULTS, or STANDINGS route can therefore supply the reason, producing `CAPABILITY_DENIED`, `BUDGET_PROTECTED`, or `PROVIDER_UNAVAILABLE` copy unrelated to lineup enrichment.

**Fix:** Query the exact optional endpoint/provider scope and relevant attempt window for the fixture/cutoff, or persist a dedicated enrichment decision receipt keyed by fixture and endpoint.

### WR-03 [WARNING]: Source deltas hide changed evidence for the same fixture

**File:** `packages/domain/src/forecast/comparison.ts:35-47`

**Issue:** Comparison reduces every evidence source to `fixtureId`. If the same historical fixture is re-observed with a different payload hash, observed/effective time, or source update, the UI reports no source change even though the immutable evidence changed. Duplicate home/away references are also collapsed semantically by `Set`-based difference.

**Fix:** Compare a stable composite identity including at least `fixtureId`, `payloadHash`, `effectiveAt`, and `observedAt`, and expose structured source-reference deltas rather than bare fixture IDs.

### WR-04 [WARNING]: The live acceptance tests seed impossible terminal states and do not exercise production enrichment

**File:** `tests/e2e/live-provider-stack.ts:31`, `tests/e2e/live-provider-stack.ts:54-67`, `tests/e2e/provider-degradation.spec.ts:23-25`

**Issue:** The harness injects an enrichment factory that always returns `observed-empty`, manually inserts final fallback/no-fallback receipts that the production runtime never writes, and directly seeds the official lineup plus LINEUP_CONFIRMED forecast. The browser assertions therefore validate rendering of prepared data, not provider routing or enrichment through the claimed real boundaries. This is why CR-01, CR-03, and CR-04 pass verification.

**Fix:** Drive the production worker with a deterministic HTTP provider stub that returns provider-shaped payloads. Let the real runtime write route attempts, observations, lineup evidence, and the forecast; assert those rows and then render them. Keep direct seeding only for unrelated fixture prerequisites.

### WR-05 [WARNING]: Provider-policy approval is not transactionally idempotent across API replicas and does not persist the approving actor

**File:** `apps/api/src/modules/providers/provider-policy.service.ts:24-41`

**Issue:** The in-memory `inFlight` map only serializes requests inside one process. Two replicas can both pass the prior-attempt check; one then fails a unique insert and returns a 500 instead of the same decision. Route creation, capability upsert, and decision attempt are also separate transactions. Finally, `actor` is returned to the caller but not stored in the durable receipt/attempt, so the approval lacks the advertised authenticated audit identity.

**Fix:** Execute receipt, capability, and decision creation in one serializable database transaction with conflict readback by idempotency key. Persist the authenticated actor (and approval timestamp) in an immutable approval receipt or dedicated approval table and return the stored actor on replay.

---

_Reviewed: 2026-09-19T13:10:00Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: deep_
