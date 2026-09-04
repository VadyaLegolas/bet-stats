---
phase: 02-historical-evidence-pipeline
reviewed: 2026-09-04T00:00:00Z
depth: standard
files_reviewed: 72
files_reviewed_list:
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
  - apps/web/app/internal/pipeline/replay/page.tsx
  - apps/web/app/teams/[teamId]/evidence/page.tsx
  - apps/web/components/evidence-state-notice.tsx
  - apps/web/src/security/operator-proxy-authorization.ts
  - infra/docker-compose.operator.yml
  - infra/Dockerfile.app
  - infra/operator-gateway/Dockerfile
  - infra/operator-gateway/security.mjs
  - infra/operator-gateway/server.mjs
  - packages/database/prisma/migrations/20260829_historical_evidence/migration.sql
  - packages/database/prisma/migrations/20260830_phase02_replay_preview/migration.sql
  - packages/database/prisma/migrations/20260830_phase02_temporal_repair/migration.sql
  - packages/database/prisma/migrations/20260831_phase02_replay_delivery/migration.sql
  - packages/database/prisma/migrations/20260831_phase02_replay_lifecycle/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/database/src/index.ts
  - packages/database/src/replay-provider-policy.ts
  - packages/domain/src/evidence/contract.ts
  - packages/domain/src/evidence/features.ts
  - packages/domain/src/index.ts
  - packages/domain/src/replay-provider-policy.ts
  - packages/domain/src/request-budget.ts
  - packages/football-data/src/provider.interface.ts
  - packages/football-data/src/providers/football-data-org/client.ts
  - packages/football-data/src/providers/football-data-org/normalize.ts
  - packages/football-data/src/providers/football-data-org/schema.ts
  - playwright.live-evidence.config.ts
  - tests/e2e/live-evidence-stack.ts
  - tests/e2e/pipeline-replay.spec.ts
  - tests/e2e/team-evidence-live.spec.ts
  - tests/e2e/team-evidence.spec.ts
  - tests/integration/evidence-api.test.ts
  - tests/integration/evidence-browser-contract.test.ts
  - tests/integration/evidence-publication.test.ts
  - tests/integration/migration-empty.test.ts
  - tests/integration/operator-gateway-deployment.test.ts
  - tests/integration/operator-gateway.test.ts
  - tests/integration/phase-01-security.test.ts
  - tests/integration/pipeline-jobs.test.ts
  - tests/integration/provider-budget-order.test.ts
  - tests/integration/provider-capability.test.ts
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
  - workers/data-sync/src/jobs/results.ts
  - workers/data-sync/src/jobs/standings.ts
  - workers/data-sync/src/main.ts
  - workers/data-sync/src/queues/index.ts
  - workers/data-sync/src/replay/service.ts
  - workers/data-sync/src/resilience/circuits.ts
  - workers/data-sync/src/resilience/provider-policy.ts
findings:
  critical: 2
  warning: 0
  info: 0
  total: 2
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-04
**Depth:** standard
**Files Reviewed:** 72
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

The five previously reported gaps are resolved: evidence rows are team-scoped before ranking; fixture replay carries and validates the requested competition; confirmation deduplicates by logical key across fresh previews; Nest validation failures return classified, disclosure-safe 4xx responses; and a malformed receipt invalidates the complete receipt and fails dependent projections closed. Budget-before-I/O, dual-time cutoffs, payload provenance, gateway authorization, and durable replay delivery were also rechecked.

Two replay-lifecycle blockers remain. Both are missed by current tests because live worker coverage uses one-unit replay plans and graceful handler failures, not a plan whose later units observe changed quota state or a BullMQ stalled-job recovery.

## Critical Issues

### CR-01: A multi-unit replay invalidates its own provider-policy fingerprint after the first reservation

**File:** `workers/data-sync/src/resilience/provider-policy.ts:73-76` (with `packages/domain/src/replay-provider-policy.ts:45-47` and `packages/database/src/replay-provider-policy.ts:79-108`)

**Issue:** Every replay unit re-reads the provider-policy snapshot and requires its fingerprint to equal the preview fingerprint. The fingerprint excludes only `observedAt`, while the snapshot includes mutable fields such as `reserved`, `remaining`, `availableForLane`, circuit timestamps, and `validUntil`. The first unit then reserves a provider request; a later unit reads a different reservation count and gets a different fingerprint. Sequential execution of a plan with more than one unit therefore fails with `REPLAY_POLICY_CHANGED` despite unchanged policy configuration and sufficient approved capacity. Concurrent two-unit execution can pass nondeterministically if both reads race ahead of the first reservation.

**Fix:** Separate immutable policy identity from live capacity. Compare a fingerprint containing stable approval fields only (provider, endpoint family, lane, configured allowance, critical headroom, reset semantics, and version). At execution, independently validate the current circuit and atomically reserve each unit against the live budget. Add a sequential integration test with at least three units.

### CR-02: A recovered stalled job can leave `SyncRun` permanently RUNNING

**File:** `workers/data-sync/src/queues/index.ts:71-89`

**Issue:** The worker persists `PENDING -> RUNNING` before provider work. If the process crashes after that transaction but before its local `try/catch`, BullMQ recovers the stalled job. The recovered processor sees a non-`PENDING` run, returns `{ duplicate: true }`, and BullMQ marks the job successful. Nothing resets or reclaims the durable `RUNNING` row, leaving the replay plan stuck forever. The delivery lease protects only enqueue delivery, not execution ownership.

**Fix:** Add a durable execution lease/token. Allow retries to atomically reclaim `RUNNING` after lease expiry and require the token for success/failure transitions; alternatively reconcile stale `RUNNING` attempts back to `PENDING` before recovery. Add a process-level test that kills a worker after the `RUNNING` transition and verifies replacement-worker recovery and one terminal transition.

---

_Reviewed: 2026-09-04_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
