---
phase: 02-historical-evidence-pipeline
reviewed: 2026-09-01T00:00:00Z
depth: standard
files_reviewed: 111
files_reviewed_list:
  - .env.example
  - .gitignore
  - apps/api/package.json
  - apps/api/src/app.module.ts
  - apps/api/src/modules/evidence/evidence.controller.ts
  - apps/api/src/modules/evidence/evidence.service.ts
  - apps/api/src/modules/reconciliation/operator.guard.ts
  - apps/api/src/modules/replay/replay-delivery.service.ts
  - apps/api/src/modules/replay/replay.controller.ts
  - apps/api/src/modules/replay/replay.service.ts
  - apps/web/app/fixtures/[fixtureId]/page.tsx
  - apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts
  - apps/web/app/internal-api/teams/[teamId]/evidence/route.ts
  - apps/web/app/internal/pipeline/replay/page.tsx
  - apps/web/app/layout.tsx
  - apps/web/app/teams/[teamId]/evidence/page.tsx
  - apps/web/components/evidence-state-notice.tsx
  - apps/web/package.json
  - apps/web/src/security/operator-proxy-authorization.ts
  - docs/superpowers/plans/2026-08-31-docker-basic-auth-operator-gateway.md
  - docs/superpowers/specs/2026-08-31-docker-basic-auth-operator-gateway-design.md
  - infra/docker-compose.operator.yml
  - infra/Dockerfile.app
  - infra/operator-gateway/Dockerfile
  - infra/operator-gateway/security.mjs
  - infra/operator-gateway/server.mjs
  - packages/database/package.json
  - packages/database/prisma.config.ts
  - packages/database/prisma/migrations/20260829_historical_evidence/migration.sql
  - packages/database/prisma/migrations/20260830_phase02_replay_preview/migration.sql
  - packages/database/prisma/migrations/20260830_phase02_temporal_repair/migration.sql
  - packages/database/prisma/migrations/20260831_phase02_replay_delivery/migration.sql
  - packages/database/prisma/migrations/20260831_phase02_replay_lifecycle/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/database/src/generated/prisma/browser.ts
  - packages/database/src/generated/prisma/client.ts
  - packages/database/src/generated/prisma/commonInputTypes.ts
  - packages/database/src/generated/prisma/enums.ts
  - packages/database/src/generated/prisma/internal/class.ts
  - packages/database/src/generated/prisma/internal/prismaNamespace.ts
  - packages/database/src/generated/prisma/internal/prismaNamespaceBrowser.ts
  - packages/database/src/generated/prisma/models.ts
  - packages/database/src/generated/prisma/models/EvidenceBuild.ts
  - packages/database/src/generated/prisma/models/EvidenceComponent.ts
  - packages/database/src/generated/prisma/models/Fixture.ts
  - packages/database/src/generated/prisma/models/ProviderCircuitState.ts
  - packages/database/src/generated/prisma/models/ReconciliationCase.ts
  - packages/database/src/generated/prisma/models/ReplayDelivery.ts
  - packages/database/src/generated/prisma/models/ReplayPlan.ts
  - packages/database/src/generated/prisma/models/ReplayPreview.ts
  - packages/database/src/generated/prisma/models/ResultVersion.ts
  - packages/database/src/generated/prisma/models/SourceObservation.ts
  - packages/database/src/generated/prisma/models/StandingSnapshot.ts
  - packages/database/src/generated/prisma/models/StandingSnapshotRow.ts
  - packages/database/src/generated/prisma/models/SyncAttempt.ts
  - packages/database/src/generated/prisma/models/SyncRun.ts
  - packages/database/src/index.ts
  - packages/database/src/replay-provider-policy.ts
  - packages/domain/package.json
  - packages/domain/src/evidence/contract.ts
  - packages/domain/src/evidence/eligibility.ts
  - packages/domain/src/evidence/elo.ts
  - packages/domain/src/evidence/features.ts
  - packages/domain/src/evidence/form.ts
  - packages/domain/src/index.ts
  - packages/domain/src/replay-provider-policy.ts
  - packages/domain/src/request-budget.ts
  - packages/football-data/src/provider.interface.ts
  - packages/football-data/src/providers/football-data-org/client.ts
  - packages/football-data/src/providers/football-data-org/normalize.ts
  - packages/football-data/src/providers/football-data-org/schema.ts
  - playwright.config.ts
  - playwright.live-evidence.config.ts
  - pnpm-lock.yaml
  - tests/e2e/live-evidence-stack.ts
  - tests/e2e/pipeline-replay.spec.ts
  - tests/e2e/team-evidence-live.spec.ts
  - tests/e2e/team-evidence.spec.ts
  - tests/e2e/walking-skeleton.spec.ts
  - tests/integration/evidence-api.test.ts
  - tests/integration/evidence-browser-contract.test.ts
  - tests/integration/evidence-publication.test.ts
  - tests/integration/migration-empty.test.ts
  - tests/integration/operator-gateway-deployment.test.ts
  - tests/integration/operator-gateway.test.ts
  - tests/integration/phase-01-security.test.ts
  - tests/integration/pipeline-jobs.test.ts
  - tests/integration/provider-budget-order.test.ts
  - tests/integration/provider-resilience.test.ts
  - tests/integration/quota-priority.test.ts
  - tests/integration/replay-boundary.test.ts
  - tests/integration/replay.test.ts
  - tests/integration/temporal-provenance.test.ts
  - tests/unit/chronological-features.test.ts
  - tests/unit/coverage-contract.test.ts
  - tests/unit/form.test.ts
  - tests/unit/operator-gateway.test.ts
  - tests/unit/provider-contract.test.ts
  - workers/data-sync/package.json
  - workers/data-sync/src/ingestion/runner.ts
  - workers/data-sync/src/jobs/evidence-rebuild.ts
  - workers/data-sync/src/jobs/fixtures.ts
  - workers/data-sync/src/jobs/pipeline.ts
  - workers/data-sync/src/jobs/results.ts
  - workers/data-sync/src/jobs/standings.ts
  - workers/data-sync/src/main.ts
  - workers/data-sync/src/queues/index.ts
  - workers/data-sync/src/replay/service.ts
  - workers/data-sync/src/resilience/circuits.ts
  - workers/data-sync/src/resilience/errors.ts
  - workers/data-sync/src/resilience/provider-policy.ts
findings:
  critical: 5
  warning: 1
  info: 0
  total: 6
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 111
**Status:** issues_found

## Summary

The phase contains five shipping blockers. The evidence query is not scoped to the requested team, non-PL fixture replays silently ingest nothing, replay idempotency breaks after a preview has been consumed, public API validation failures are returned as server failures, and malformed receipts are silently rewritten rather than rejected. Existing tests do not exercise the two most important cross-entity/cross-preview cases.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Evidence rebuild mixes every fixture in the database into each team's history

**Classification:** BLOCKER
**File:** `D:/Documents/Atom/bet-stats/workers/data-sync/src/jobs/evidence-rebuild.ts:6-16`
**Issue:** `LATEST_VISIBLE_RESULT_SQL` filters only by cutoff. It never restricts rows to fixtures where the requested `teamId` is home or away. `loadEligibleMatches` receives `teamId` but passes only the cutoff to SQL (line 83), then treats every unrelated fixture as an away match for the requested team (lines 85-103). Once more than one team's fixtures exist, form, Elo, goal rates, rest days, and H2H are corrupted while the build is still published as valid.
**Fix:** Add a second bind parameter and filter before ranking, then pass `teamId`:
```ts
WHERE (f."homeTeamId" = $2 OR f."awayTeamId" = $2)
  AND rv."effectiveAt" <= $1::timestamptz
  AND rv."observedAt" <= $1::timestamptz

transaction.$queryRawUnsafe<EligibleResultRow[]>(statement, new Date(cutoff), teamId)
```

### CR-02: Fixture replay for six allowed competitions silently runs the Premier League endpoint

**Classification:** BLOCKER
**File:** `D:/Documents/Atom/bet-stats/workers/data-sync/src/jobs/fixtures.ts:75-83`
**Issue:** replay validation permits `PD`, `BL1`, `SA`, `FL1`, `CL`, and `EL`, but fixture ingestion always calls `fetchPremierLeagueFixtures()`. That client is hard-coded to `/competitions/PL/matches` and its schema requires literal `PL` (`packages/football-data/src/providers/football-data-org/client.ts:27-34`, `schema.ts:13-16`). For any other allowed competition, the subsequent scope filter returns an empty array and the job reports `completed`, producing false-success replay records with no fixtures.
**Fix:** Replace the PL-only interface with `fetchCompetitionFixtures(competitionCode, window)`, validate the requested configured code, build the provider URL from it, and call it directly from replay. Treat an unexpected competition mismatch as a classified failure rather than filtering it to an empty success.

### CR-03: Reconfirming a logical replay through a fresh preview violates the revision uniqueness constraint

**Classification:** BLOCKER
**File:** `D:/Documents/Atom/bet-stats/apps/api/src/modules/replay/replay.service.ts:127-132`
**Issue:** duplicate detection only looks up `ReplayPlan.previewId`. After the first preview is consumed, `preview()` creates a fresh preview for the same `logicalKey`. Queueing it without `newRevision` sets `revision = 1` unconditionally, then inserts into a table with `@@unique([logicalKey, revision])`. The request therefore fails with a database uniqueness error instead of returning the existing plan/idempotent result promised by the UI. Current tests only submit the exact same preview twice.
**Fix:** Under the existing advisory lock, query by `logicalKey` as well. If a plan already exists and `newRevision !== true`, return that plan as `duplicate: true`; only allocate `MAX(revision)+1` when an explicitly reasoned new revision was requested.

### CR-04: Expected client validation errors escape NestJS as HTTP 500 responses

**Classification:** BLOCKER
**File:** `D:/Documents/Atom/bet-stats/apps/api/src/modules/replay/replay.service.ts:46-53`
**Issue:** `replayError` creates a plain `Error` with a custom `status`, but NestJS does not interpret that property. `preview()` exposes these errors directly, and `queue()` maps only `STALE_PREVIEW` and `QUEUE_DELIVERY_FAILED`. Inputs such as unsupported provider, invalid window, oversized window, missing revision reason, or malformed provider policy consequently become 500 responses. The evidence endpoint has the same defect for `INVALID_AS_OF` and `INVALID_TEAM_ID` (`apps/api/src/modules/evidence/evidence.service.ts:41-49,99-103`). This breaks the public contract and misclassifies operator mistakes as server outages.
**Fix:** Throw Nest `BadRequestException`/`ConflictException` at the controller/service boundary or install a tested exception filter that maps `{ code, status }` to the intended HTTP status and disclosure-safe body. Add real HTTP tests for every validation code.

### CR-05: Malformed provenance receipts are silently rewritten and still published

**Classification:** BLOCKER
**File:** `D:/Documents/Atom/bet-stats/apps/api/src/modules/evidence/evidence.service.ts:52-57`
**Issue:** `asReceipt` removes invalid entries with `.filter(isEvidenceSourceRef)` and casts the modified object back to `EvidenceReceipt`. A persisted immutable receipt containing one malformed input is therefore returned as a different, apparently valid receipt instead of being rejected or marked unavailable. It also accepts unvalidated `requestedAsOf`, `configVersion`, and `sourceWindow`. This destroys the exact reproduction contract: the API response no longer represents the stored receipt and consumers cannot distinguish corruption from a genuinely smaller input set.
**Fix:** Validate the entire receipt atomically with a strict schema. If any field or input is invalid, return `null` (and force the build to `LIMITED`/provenance unavailable) without filtering or rewriting any entries. Add a test with one valid and one malformed input proving the receipt fails closed as a whole.

## Warnings

### WR-01: Integration coverage misses the multi-team and fresh-preview idempotency paths

**Classification:** WARNING
**File:** `D:/Documents/Atom/bet-stats/tests/integration/evidence-publication.test.ts:52-133`
**Issue:** evidence publication tests seed only one fixture/team, so the missing team predicate in CR-01 remains invisible. Replay tests retry only the same `previewId`, so they do not detect CR-03. These are reliability gaps in the tests because both defects pass the current suite.
**Fix:** Seed at least two unrelated fixtures and assert each team's receipt contains only its own matches. Then consume a preview, create a second preview for the same normalized input, and assert a non-revision queue returns the existing plan without inserting a new row.

---

_Reviewed: 2026-09-01T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
