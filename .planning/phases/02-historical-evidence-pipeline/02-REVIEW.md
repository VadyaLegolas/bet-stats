---
phase: 02-historical-evidence-pipeline
reviewed: 2026-09-05T07:50:57Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - apps/api/src/modules/replay/replay.service.ts
  - packages/database/prisma/migrations/20260904_phase02_sync_run_execution_lease/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/domain/src/replay-provider-policy.ts
  - tests/integration/migration-empty.test.ts
  - tests/integration/pipeline-jobs.test.ts
  - tests/integration/provider-resilience.test.ts
  - tests/integration/replay-boundary.test.ts
  - tests/integration/replay-crash-recovery.test.ts
  - tests/integration/replay-lease-upgrade.test.ts
  - workers/data-sync/src/ingestion/runner.ts
  - workers/data-sync/src/jobs/fixtures.ts
  - workers/data-sync/src/jobs/results.ts
  - workers/data-sync/src/jobs/standings.ts
  - workers/data-sync/src/main.ts
  - workers/data-sync/src/queues/index.ts
  - workers/data-sync/src/queues/replay-execution.ts
  - workers/data-sync/src/replay-crash-harness.ts
  - workers/data-sync/src/resilience/provider-policy.ts
findings:
  critical: 3
  warning: 2
  info: 0
  total: 5
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-05T07:50:57Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

The earlier policy-fingerprint defect is fixed: approvals now bind stable configured identity while each unit evaluates a fresh complete snapshot and reserves against live durable quota. The migration also backfills pre-lease `RUNNING` rows as expired and reinstalls the guarded transition trigger.

The new execution path is not shippable yet. The production API and lease claimant disagree about the run logical key, so API-created replay jobs cannot be claimed. Two additional lifecycle defects let an expired owner mutate state and let exhausted work remain nonterminal. The focused Vitest command could not start in this review sandbox because Vite received `spawn EPERM`; the findings below are established directly from the production call chain and SQL transitions.

## Critical Issues

### CR-01 (BLOCKER): API-created replay jobs always fail the new lease claim

**File:** `workers/data-sync/src/queues/replay-execution.ts:45` (producer at `apps/api/src/modules/replay/replay.service.ts:156`; delivery normalization at `apps/api/src/modules/replay/replay-delivery.service.ts:111-115`)

**Issue:** The API deliberately persists each `SyncRun.logicalKey` as `${unit.logicalId}:replay`, and the delivery dispatcher strips that suffix before placing `job.logicalId` on BullMQ. `claimReplayExecution` now requires `run.logicalKey === job.logicalId`, so every real API-created delivery throws `RUN_NOT_FOUND` before execution. The crash test hides the break by manually inserting `SyncRun.logicalKey = logicalId` instead of using the production representation.

**Fix:** Compare the canonical persisted form (`run.logicalKey` against the job logical ID plus the `:replay` suffix), or pass and validate the full persisted logical key consistently through delivery data. Add an API preview/confirm -> outbox dispatch -> `createReplayWorker` integration test that reaches terminal success through the actual producer and dispatcher.

### CR-02 (BLOCKER): An expired owner can still reset or terminalize the run

**File:** `workers/data-sync/src/queues/replay-execution.ts:93-100`

**Issue:** `assertOwner`, `admitRequest`, and `publish` all require an unexpired lease and deadline, but `fail` checks only state and token. After the lease or hard deadline expires, the stale worker can catch `EXECUTION_LEASE_LOST` (or any later error) and call `fail`; before a replacement rotates the token, this stale owner can move the run back to `PENDING` or terminal `FAILED` and close its attempt. That violates the stated fencing contract and can defeat recovery by terminalizing work after ownership has expired.

**Fix:** Apply the same database-clock expiry and deadline predicates inside the locked `fail` transaction. If ownership is expired, return `false` without changing `SyncAttempt` or `SyncRun`; let the claimant/reconciler classify the abandoned attempt. Add a race test that advances beyond lease/deadline, invokes stale `fail` before replacement claim, and proves no state or attempt mutation occurs.

### CR-03 (BLOCKER): Exhausted PENDING runs can remain nonterminal indefinitely

**File:** `workers/data-sync/src/queues/replay-execution.ts:53-55` and `workers/data-sync/src/queues/index.ts:118-126`

**Issue:** When `attempts.length >= maxClaims`, the claimant marks the run `FAILED` only if it is currently `RUNNING`; an exhausted `PENDING` run returns `exhausted` unchanged. The worker then throws `UnrecoverableError` and depends on an asynchronous failed-job reconciler to manufacture another attempt and terminalize it. That fallback scans only failed jobs 0..99 and never paginates, so any exhausted job outside that fixed window can stay `PENDING` forever. The fire-and-forget startup/timer calls also have no error recovery, so one database failure can miss reconciliation.

**Fix:** Terminalize both expired `RUNNING` and exhausted `PENDING` states atomically in `claimReplayExecution`, closing any running attempt under the same row lock and recording an explicit exhaustion reason. Reconciliation should query durable nonterminal runs or paginate the full failed-job set with handled/retried errors; it must not be the only path that makes an exhausted claim terminal. Add coverage for PENDING with `maxClaims` attempts and more than 100 failed queue records.

## Warnings

### WR-01 (WARNING): Most validation and identity failures are retried as transient work

**File:** `workers/data-sync/src/queues/index.ts:107-111`

**Issue:** Only `FIXTURE_SCOPE_MISMATCH` and `INVALID_FIXTURE_SCOPE` become `UnrecoverableError`. Other deterministic failures produced by this path—including `INVALID_REPLAY_WINDOW`, `IDENTITY_UNRESOLVED`, `REPLAY_POLICY_CHANGED`, `MALFORMED_POLICY`, `RUN_NOT_FOUND`, and `UNSUPPORTED_REPLAY_ENDPOINT`—consume BullMQ retries even though the same payload cannot recover. This conflicts with D-12 and inflates attempt history; `RUN_NOT_FOUND` from the pre-try claim path is not classified at all.

**Fix:** Centralize an allowlist of retryable transient reasons (or a complete classification table) and convert all deterministic validation, identity, policy-version, and unsupported-endpoint failures to `UnrecoverableError`. Keep circuit/budget denials retryable only where the intended retry window is explicit and bounded.

### WR-02 (WARNING): The crash witness is platform-dependent and does not prove a hard crash

**File:** `tests/integration/replay-crash-recovery.test.ts:33-42` and `workers/data-sync/src/replay-crash-harness.ts:33-39`

**Issue:** `child.kill()` sends the platform default signal, while the harness catches `SIGTERM`/`SIGINT` and starts a graceful `worker.close()`. On Unix this is not a hard process death and may continue waiting on the deliberately unresolved handler; the test also never waits for or asserts child exit. Cleanup of worker, queue, database, and child is performed only after assertions, so a failure can leak resources and contaminate later tests.

**Fix:** Use an explicit hard-kill mechanism supported by the test platform (for example `SIGKILL` on Unix and a platform-specific forced termination on Windows), await the exit event, and put child/worker/queue/database cleanup in `finally`/hooks. Assert that the killed PID exited before starting or accepting replacement publication.

## Previous Review History

The 2026-09-04 review reported two blockers: the mutable full-snapshot policy fingerprint and unrecoverable `RUNNING` state after worker crash. Plans 02-27 and 02-28 introduced stable `identity-v2` policy fingerprints and durable execution leases. The fingerprint blocker is resolved. The lease implementation replaces the original stuck-`RUNNING` behavior but introduces the lifecycle defects listed above.

---

_Reviewed: 2026-09-05T07:50:57Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
