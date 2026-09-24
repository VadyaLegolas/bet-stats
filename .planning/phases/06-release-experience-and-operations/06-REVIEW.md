---
phase: 06-release-experience-and-operations
reviewed: 2026-09-24T08:48:03Z
depth: standard
files_reviewed: 51
files_reviewed_list:
  - apps/api/src/app.module.ts
  - apps/api/src/modules/operations/operations.controller.ts
  - apps/api/src/modules/operations/operations.module.ts
  - apps/api/src/modules/operations/operations.service.ts
  - apps/api/src/modules/privacy/privacy.controller.ts
  - apps/api/src/modules/privacy/privacy.module.ts
  - apps/api/src/modules/privacy/privacy.service.ts
  - apps/api/src/modules/replay/replay.service.ts
  - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
  - apps/web/app/globals.css
  - apps/web/app/internal-api/operations/[[...path]]/route.ts
  - apps/web/app/internal-api/privacy/[[...path]]/route.ts
  - apps/web/app/internal/operations/page.tsx
  - apps/web/app/internal/pipeline/replay/page.tsx
  - apps/web/app/layout.tsx
  - apps/web/app/methodology/page.tsx
  - apps/web/app/privacy/page.tsx
  - apps/web/app/scorecards/scorecard-dashboard.tsx
  - apps/web/components/contextual-methodology-warning.tsx
  - apps/web/components/local-data-block.tsx
  - apps/web/components/release-navigation.tsx
  - apps/web/components/responsive-evidence.tsx
  - package.json
  - packages/config/src/index.ts
  - packages/database/prisma/migrations/20260920_privacy_retention/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/domain/src/index.ts
  - packages/domain/src/methodology/model-card.ts
  - packages/domain/src/privacy/retention.ts
  - playwright.phase06.config.ts
  - scripts/verify-release-integration.mjs
  - tests/e2e/live-provider-stack.ts
  - tests/e2e/live-release-stack.ts
  - tests/e2e/methodology.spec.ts
  - tests/e2e/operator-overview.spec.ts
  - tests/e2e/operator-recovery.spec.ts
  - tests/e2e/privacy-retention.spec.ts
  - tests/e2e/release-accessibility.spec.ts
  - tests/e2e/release-degradation.spec.ts
  - tests/e2e/release-journey.spec.ts
  - tests/integration/forecast-api.test.ts
  - tests/integration/live-provider-harness-smoke.test.ts
  - tests/integration/operator-overview.test.ts
  - tests/integration/phase-01-security.test.ts
  - tests/integration/phase-03-security.test.ts
  - tests/integration/privacy-retention.test.ts
  - tests/integration/provider-policy-approval.test.ts
  - tests/integration/replay-boundary.test.ts
  - tests/integration/replay.test.ts
  - tests/integration/value-receipt.test.ts
  - tests/unit/release-db-lifecycle.test.ts
findings:
  critical: 6
  warning: 3
  info: 0
  total: 9
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-09-24T08:48:03Z
**Depth:** standard
**Files Reviewed:** 51
**Status:** issues_found

## Summary

Phase 06 must not ship in its current form. The review found six blocker-class correctness, security, privacy, and release-gate defects. Most importantly, the privacy credential is reusable across endpoints, consent is not bound to the current policy version, expired personal history has no deletion path, and the advertised D-16/lifecycle release guarantees are not actually exercised or supervised end-to-end. Three additional robustness issues affect database ownership, serializable consent writes, and retained-history input bounds.

Generated Prisma client output and the lockfile were excluded as generated artifacts; their source schema and migration were reviewed.

## Critical Issues

### CR-01: Privacy signatures can be replayed across read, consent, retention, and destructive withdrawal endpoints

**File:** `apps/api/src/modules/privacy/privacy.service.ts:106-120`; `apps/web/app/internal-api/privacy/[[...path]]/route.ts:4-12`
**Issue:** The HMAC covers only `subjectId` and `timestamp`. It does not bind the request method, path, body digest, or a one-time nonce. The Next proxy forwards the same client-supplied credential to every privacy route. Consequently, any valid assertion captured for harmless `GET /privacy/status` remains valid for `POST /privacy/withdrawal`, `POST /privacy/consent`, or an arbitrary retained-view body during the five-minute acceptance window. This is a confused-deputy/replay vulnerability on a destructive privacy boundary.
**Fix:** Canonicalize and sign at least subject, timestamp, HTTP method, normalized route, and body digest; enforce strict signature syntax and a bounded one-time nonce stored server-side. Prefer deriving the subject from an authenticated server session and generating the upstream assertion inside the trusted proxy so browsers never supply the provider assertion directly.

### CR-02: Superseded-policy consent continues to authorize personal-history retention

**File:** `apps/api/src/modules/privacy/privacy.service.ts:60-68`; `apps/api/src/modules/privacy/privacy.service.ts:133-139`
**Issue:** Both status and retained-view writes accept any unrevoked, unexpired consent. Neither query requires `policyVersion`, `policyEffectiveAt`, or duration to match the currently resolved policy. After a policy change, the UI therefore reports `ON` under the new displayed version and writes new personal history using an old consent the subject never granted for that policy. This violates the versioned explicit-consent contract.
**Fix:** Resolve the current policy before status and every retained write, then require an exact consent tuple match (`policyVersion`, canonical `policyEffectiveAt`, and approved duration). Return `OFF` and deny retention until the subject explicitly grants the current policy. Add a migration/transition test proving an old consent cannot authorize writes after a policy version change.

### CR-03: Expired personal history is retained indefinitely

**File:** `apps/api/src/modules/privacy/privacy.service.ts:52-72`; `packages/database/prisma/migrations/20260920_privacy_retention/migration.sql:63-72`
**Issue:** `expiresAt` prevents future inserts after consent expiry, but no application job, worker, database procedure, or cascade removes already-retained odds/view rows when their retention period ends. The only deletion path is explicit withdrawal. The indexes merely make a purge possible; they do not perform one. Personal betting-related history can therefore remain forever despite the configured retention duration.
**Fix:** Add an idempotent scheduled purge that deletes `RetainedOddsHistory` and `RetainedViewHistory` at or before `expiresAt`, with durable audit counts and tests against PostgreSQL time boundaries. If operational scheduling is unavailable, enforce deletion via a database-owned scheduled mechanism and document its deployment requirement.

### CR-04: The D-16 release matrix can pass without exercising the production failure boundaries it claims to verify

**File:** `tests/e2e/release-degradation.spec.ts:29-55`; `tests/e2e/release-degradation.spec.ts:66-85`
**Issue:** The open-circuit/quota case directly upserts circuit state and never proves provider construction/call denial; the quarantine case directly inserts a `SourceObservation` and only compares fixture counts without invoking envelope validation/admission; the dead-letter case directly inserts failed ledger rows rather than exhausting a real BullMQ job; and the “safe replay” case never previews, confirms, queues, or checks immutable counts/hashes. These tests verify rendering of seeded database rows, not the locked D-16 production paths. `pnpm verify:release` can be green while admission, retry, dead-letter, or replay behavior is broken.
**Fix:** Drive each scenario through its actual production adapter/service/worker and assert both the attempted side effect and durable invariants. Add provider factory call counters for circuit/quota denial, submit an invalid envelope through ingestion, exhaust a real owned BullMQ job into dead-letter state, and execute preview-confirm replay while comparing immutable row counts and hashes before/after.

### CR-05: Post-readiness API/web failures are swallowed by the Playwright global owner

**File:** `tests/e2e/live-provider-stack.ts:61-64`; `tests/e2e/live-release-stack.ts:72-93`
**Issue:** After initial web readiness, `startLiveProviderStack` explicitly attaches a catch that discards `supervision.failure`. The Phase 06 global setup receives the supervision object but never races the Playwright owner against it. The new `runSupervisedLiveOwner` helper is only exercised by a focused smoke test and unit tests, not by the release browser gate. An API/web process can exit after readiness and before/during teardown without its failure becoming the release owner's result, contradicting the lifecycle fix and potentially allowing a false-green or diagnostically opaque run.
**Fix:** Make the global owner await/race the entire Playwright lifetime against supervision, or expose a reporter/fixture-level failure channel that deterministically fails the run on child exit. Remove the swallowing catch and add an acceptance test that kills API after readiness during a browser run and asserts nonzero release exit with the bounded diagnostic.

### CR-06: Startup failure before ownership publication leaks workers and child processes

**File:** `tests/e2e/live-provider-stack.ts:50-65`
**Issue:** The replay worker, API, and web processes are created in local variables, but `owned` is assigned only after every readiness step succeeds. If worker readiness, API readiness, web build, or web readiness throws, the catch calls `stopLiveProviderStack({pg, redis})`; because `owned` is still null, that function removes only containers and cannot stop the already-created worker/API/web children. This leaves processes holding ports and Redis/PostgreSQL connections, contaminating later release runs.
**Fix:** Publish an incrementally populated ownership record before the first fallible allocation, or keep a local resource stack and explicitly close each allocated worker/process in the catch/finally path. Add failure-injection tests at worker-ready, API-ready, web-build, and web-ready checkpoints and assert exact cleanup.

## Warnings

### WR-01: OperationsService leaks its internally created Prisma client

**File:** `apps/api/src/modules/operations/operations.service.ts:108-115`
**Issue:** When no client is injected, the service creates a Prisma client but does not retain ownership separately and does not implement `OnModuleDestroy`. Application shutdown/reload can leave the pool alive, which is particularly damaging in the process-lifecycle scenarios Phase 06 is intended to harden.
**Fix:** Store the owned client, implement `OnModuleDestroy`, and disconnect only when the service created the client. Prefer injecting a singleton database provider managed by the application module.

### WR-02: Serializable consent grants are not retried or mapped to a stable failure contract

**File:** `apps/api/src/modules/privacy/privacy.service.ts:28-49`; `apps/api/src/modules/privacy/privacy.service.ts:142-149`
**Issue:** Withdrawal retries Prisma `P2034`/serialization conflicts, but consent uses the same serializable subject-row transaction without equivalent retry handling. Concurrent consent/withdrawal or duplicate consent requests can surface an unhandled 500 and leave callers without the privacy API's stable correlation-safe error contract.
**Fix:** Apply the same narrowly scoped bounded retry policy to consent, preserve the one-way blocked-subject rule, and map terminal conflicts to a documented safe response with a support correlation ID.

### WR-03: Retained-view identifiers are arbitrary and unbounded

**File:** `apps/api/src/modules/privacy/privacy.service.ts:159-167`; `packages/database/prisma/migrations/20260920_privacy_retention/migration.sql:47-58`
**Issue:** Validation only requires two non-empty strings; PostgreSQL stores both as unbounded `TEXT`. Authenticated callers can persist oversized or unexpected resource categories/identifiers, undermining the declared two-category inventory and creating avoidable storage/operational risk.
**Fix:** Use an allowlisted resource-type enum and bounded canonical identifier syntax/length in both API validation and database constraints. Add rejection tests for unknown types, control characters, and oversized values.

---

_Reviewed: 2026-09-24T08:48:03Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
