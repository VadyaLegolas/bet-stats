---
phase: 02-historical-evidence-pipeline
reviewed: 2026-08-30T09:30:00Z
depth: standard
files_reviewed: 47
files_reviewed_list:
  - apps/api/src/app.module.ts
  - apps/api/src/modules/evidence/evidence.controller.ts
  - apps/api/src/modules/evidence/evidence.service.ts
  - apps/api/src/modules/replay/replay.controller.ts
  - apps/api/src/modules/replay/replay.service.ts
  - apps/web/app/fixtures/[fixtureId]/page.tsx
  - apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts
  - apps/web/app/internal/pipeline/replay/page.tsx
  - apps/web/app/teams/[teamId]/evidence/page.tsx
  - apps/web/components/evidence-state-notice.tsx
  - packages/database/prisma/migrations/20260829_historical_evidence/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/domain/src/evidence/contract.ts
  - packages/domain/src/evidence/eligibility.ts
  - packages/domain/src/evidence/form.ts
  - packages/domain/src/evidence/elo.ts
  - packages/domain/src/evidence/features.ts
  - packages/domain/src/index.ts
  - packages/domain/src/request-budget.ts
  - packages/football-data/src/provider.interface.ts
  - packages/football-data/src/providers/football-data-org/client.ts
  - packages/football-data/src/providers/football-data-org/normalize.ts
  - packages/football-data/src/providers/football-data-org/schema.ts
  - workers/data-sync/package.json
  - workers/data-sync/src/ingestion/runner.ts
  - workers/data-sync/src/jobs/evidence-rebuild.ts
  - workers/data-sync/src/jobs/results.ts
  - workers/data-sync/src/jobs/standings.ts
  - workers/data-sync/src/main.ts
  - workers/data-sync/src/queues/index.ts
  - workers/data-sync/src/replay/service.ts
  - workers/data-sync/src/resilience/circuits.ts
  - tests/e2e/pipeline-replay.spec.ts
  - tests/e2e/team-evidence.spec.ts
  - tests/integration/evidence-api.test.ts
  - tests/integration/migration-empty.test.ts
  - tests/integration/phase-01-security.test.ts
  - tests/integration/pipeline-jobs.test.ts
  - tests/integration/provider-budget-order.test.ts
  - tests/integration/provider-resilience.test.ts
  - tests/integration/quota-priority.test.ts
  - tests/integration/replay.test.ts
  - tests/integration/temporal-provenance.test.ts
  - tests/unit/chronological-features.test.ts
  - tests/unit/coverage-contract.test.ts
  - tests/unit/form.test.ts
  - tests/unit/provider-contract.test.ts
findings:
  critical: 7
  warning: 4
  info: 0
  total: 11
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-08-30T09:30:00Z  
**Depth:** standard  
**Files Reviewed:** 47  
**Status:** issues_found

## Summary

The implementation does not yet satisfy the phase's durable, replayable evidence contract. The most serious defects make production replay a no-op, prevent database publication/idempotent ingestion, and allow evidence to be published from failed or cancelled source runs. The green browser tests use route stubs whose payloads differ from the production API, masking two end-to-end failures.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Replay API reports queued work without persisting or enqueueing anything

**File:** `apps/api/src/modules/replay/replay.service.ts:35-78`

**Issue:** The production Nest service creates only process-local `Map` records. `queue()` never inserts `ReplayPlan`/`SyncRun`, never calls the worker replay service, and never adds BullMQ jobs. It nevertheless returns `queued: true`. Every preview/status disappears on restart or another API replica, and an operator receives a false success while no replay occurs. This violates PIPE-05/06 and the durable/idempotent replay contract.

**Fix:** Replace the in-memory engine with a repository-backed orchestration service: persist preview/version and replay plans transactionally, create versioned `SyncRun` rows, then enqueue deterministic BullMQ job IDs. Status must query durable rows. Keep duplicate and stale-preview checks as database constraints/optimistic predicates.

### CR-02: Append-only trigger makes evidence publication impossible

**File:** `packages/database/prisma/migrations/20260829_historical_evidence/migration.sql:68`

**Issue:** `EvidenceBuild_append_only` rejects every `UPDATE`, but the rebuild workflow creates a `BUILDING` row and then calls `publishBuild()` to transition it to `PUBLISHED` (`workers/data-sync/src/jobs/evidence-rebuild.ts:55-61`). Against the real database that transition must fail, so no build can become visible. The mock transaction used by tests does not execute this trigger and masks the defect.

**Fix:** Use a narrowly scoped state-transition trigger that permits `BUILDING -> PUBLISHED|FAILED` while forbidding changes to identity/content fields and all changes after publication, or model publication as an append-only publication row/event and select it through a join.

### CR-03: Idempotent observation inserts conflict with the append-only trigger

**File:** `workers/data-sync/src/jobs/results.ts:88-104`

**Issue:** Both result ingestion here and standings ingestion at `workers/data-sync/src/jobs/standings.ts:77-83` use `ON CONFLICT ... DO UPDATE` to recover the existing observation ID. `SourceObservation_append_only` rejects all updates (`migration.sql:40`), including this no-op update. Reprocessing an identical provider payload therefore fails instead of converging, breaking the mandatory idempotency guarantee.

**Fix:** Use `INSERT ... ON CONFLICT DO NOTHING RETURNING id`, then select the existing ID by the unique key when no row is returned, all under the existing advisory lock/transaction. Do not issue any update to immutable observations.

### CR-04: Failed and cancelled source runs are treated as publishable evidence

**File:** `workers/data-sync/src/jobs/evidence-rebuild.ts:43-67`

**Issue:** `isTerminal()` returns true for `FAILED` and `CANCELLED`. The rebuild then loads whatever facts happen to exist and publishes a complete build. “Terminal” is not equivalent to “complete”: failed/cancelled ingestion can leave a truncated source window. This silently turns partial data into authoritative evidence, directly violating D-14/D-16 and the plan requirement to publish only complete builds.

**Fix:** Publish only from `SUCCEEDED` runs whose expected units/captures are complete. Project `FAILED`/`CANCELLED` as pending/limited failure and retain the previous published build. Add real-database tests for each terminal state.

### CR-05: Replay form submits timestamps rejected by its own API

**File:** `apps/web/app/internal/pipeline/replay/page.tsx:63`

**Issue:** `datetime-local` produces values such as `2026-08-01T00:00` with no offset. The API accepts only seconds plus trailing `Z` (`apps/api/src/modules/replay/replay.service.ts:7,26`). The production preview request therefore always returns `INVALID_WINDOW`. E2E tests stub the endpoint and never validate the submitted payload, so they pass despite the broken journey.

**Fix:** Convert both form values to explicit UTC ISO strings before `JSON.stringify` (and document the interpretation), or accept/normalize the documented local input server-side. Add an E2E assertion on the intercepted request body and an integration test through the real proxy/API.

### CR-06: Provider client cannot ingest six of the seven allowlisted competitions

**File:** `packages/football-data/src/providers/football-data-org/client.ts:43-51`

**Issue:** Completed-result fetches always call `/competitions/PL/...`; result schemas also require `competition.code === "PL"` (`schema.ts:30-33`). Replay accepts PD, BL1, SA, FL1, CL and EL, but those replays will either fetch Premier League data under another competition identity or reject a legitimate provider response. The platform's top-five/UEFA scope is therefore incorrect.

**Fix:** Include an allowlisted competition code in `RequestedDateWindow` (or a dedicated request DTO), build the URL from it, and validate that the response competition matches the request rather than a PL literal. Cover every configured competition.

### CR-07: Evidence tables lose timezone semantics at the persistence boundary

**File:** `packages/database/prisma/migrations/20260829_historical_evidence/migration.sql:6-13`

**Issue:** All evidence instants are declared `TIMESTAMP(3)` (without time zone), while writes cast inputs to `timestamptz` and the phase contract requires exact UTC dual-time semantics. PostgreSQL converts `timestamptz` to the session timezone when storing into `timestamp`; later comparisons/casts can represent a different instant when database/session timezone changes. Prisma fields likewise lack `@db.Timestamptz`. This can include or exclude facts at the wrong cutoff.

**Fix:** Migrate every instant (`observedAt`, `effectiveAt`, cutoff, window bounds, source timestamps, publication times) to `TIMESTAMPTZ(3)` and annotate Prisma with `@db.Timestamptz(3)`. Set/database-test non-UTC session timezones to prove invariant cutoff behavior.

## Warnings

### WR-01: Evidence UI renders structured form values as `[object Object]`

**File:** `apps/web/app/teams/[teamId]/evidence/page.tsx:30-42`

**Issue:** The API exposes each component's persisted `value`; `form5`/`form10` are staged from `item.value`, currently numeric, but other components such as goal rates and H2H are objects. The generic component renderer at line 77 calls `String(value.value)`, producing `[object Object]`, an unlabeled and unusable result contrary to the UI contract.

**Fix:** Define a discriminated DTO per component and render named fields/units. Reject unknown component shapes rather than string-coercing arbitrary JSON.

### WR-02: Missing provenance does not actually block computed values

**File:** `apps/api/src/modules/evidence/evidence.service.ts:59-84`

**Issue:** When component `sourceTimes` cannot be matched to receipt inputs, `sourceRefs()` returns `[]`, but the component's non-null value remains exposed. Unless persistence independently set `MISSING_TIMESTAMP`, the API/UI shows a computed value alongside only a page-level provenance warning. D-19/D-20 require the affected component itself to be unavailable.

**Fix:** Validate receipt/source consistency at projection time. If any required source reference is absent or malformed, set that component's value to `null`, limitation to `MISSING_TIMESTAMP`, and overall state to `LIMITED`.

### WR-03: Half-open circuits are allowed through without probe ownership

**File:** `workers/data-sync/src/ingestion/runner.ts:48-69`

**Issue:** The gate denies only `OPEN`; every `HALF_OPEN` job proceeds directly and does not call `ProviderCircuitRegistry.acquireProbe()`. Concurrent workers can therefore all issue provider calls during half-open recovery, defeating the single-probe contract and causing incorrect circuit transitions.

**Fix:** Require a probe lease for `HALF_OPEN`, deny/defer when acquisition fails, and release it in `finally`. Integrate the registry into the runner rather than passing only a state string.

### WR-04: Tests replace the production boundaries and miss the principal failures

**File:** `tests/e2e/pipeline-replay.spec.ts:20-42`

**Issue:** Replay E2E intercepts every internal API call and accepts any request body, so it cannot detect the invalid datetime format, missing provider-state endpoint, missing durable writes, or missing BullMQ enqueue. Temporal publication tests use an in-memory transaction whose `publishBuild` mutates freely, so they cannot detect the database trigger conflict. These are reliability defects in the tests, not merely coverage preferences.

**Fix:** Retain narrow UI fixture tests, but add one browser/integration journey through the real Next proxy and Nest service with PostgreSQL/Redis Testcontainers. Exercise duplicate payload ingestion and `BUILDING -> PUBLISHED` against the checked-in migration.

---

_Reviewed: 2026-08-30T09:30:00Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
