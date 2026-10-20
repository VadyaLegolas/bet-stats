---
phase: 06-release-experience-and-operations
fixed_at: 2026-09-24T08:55:00Z
review_path: .planning/phases/06-release-experience-and-operations/06-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 06: Code Review Fix Report

**Fixed at:** 2026-09-24T08:55:00Z
**Source review:** `.planning/phases/06-release-experience-and-operations/06-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 9
- Fixed: 9
- Skipped/deferred: 0
- Verification environment: main checkout (`workflow.use_worktrees=false`)

## Fixed Issues

### CR-02: Superseded-policy consent continues to authorize personal-history retention

**Files modified:** `apps/api/src/modules/privacy/privacy.service.ts`, `tests/integration/privacy-retention.test.ts`
**Commit:** db18139
**Applied fix:** Bound status and retained-history writes to the exact current policy version, effective timestamp, and duration. Added a PostgreSQL transition oracle proving a superseded consent cannot authorize a write.
**Verification:** `vitest run --project integration tests/integration/privacy-retention.test.ts --reporter=dot` — 23/23 passed.

### WR-01: OperationsService leaks its internally created Prisma client

**Files modified:** `apps/api/src/modules/operations/operations.service.ts`, `tests/integration/operator-overview.test.ts`
**Commit:** f72d504
**Applied fix:** Track internal Prisma ownership explicitly, implement `OnModuleDestroy`, and disconnect only the internally created client.
**Verification:** `vitest run --project integration tests/integration/operator-overview.test.ts --reporter=dot` — 6/6 passed.

### WR-02: Serializable consent grants are not retried or mapped to a stable failure contract

**Files modified:** `apps/api/src/modules/privacy/privacy.service.ts`, `tests/unit/privacy-consent-retry.test.ts`
**Commit:** 7e6a213
**Applied fix:** Added bounded retries for Prisma serialization/deadlock conflicts and a correlation-safe `CONSENT_CONFLICT` terminal response.
**Verification:** unit oracle 2/2 passed; privacy PostgreSQL integration 23/23 passed.

### CR-01: Privacy signatures can be replayed across endpoints

**Files modified:** `apps/api/src/modules/privacy/privacy.service.ts`, `apps/web/app/internal-api/privacy/[[...path]]/route.ts`, `tests/unit/privacy-proxy-assertion.test.ts`
**Commit:** 220df05
**Applied fix:** Trusted-proxy canonical assertion plus Redis-backed one-time nonce consumption and endpoint/body replay rejection.
**Verification:** unit 2/2; API/web typechecks passed.

### CR-03: Expired personal history is retained indefinitely

**Files modified:** `workers/data-sync/src/jobs/retention-purge.ts`, `workers/data-sync/src/main.ts`, Prisma schema/forward migration, privacy integration test
**Commit:** 0b37f6d
**Applied fix:** Startup/daily idempotent expiry purge with durable atomic audit counts.
**Verification:** PostgreSQL 18 integration 24/24; worker typecheck and Prisma validation passed.

### CR-04: D-16 release matrix did not exercise production boundaries

**Files modified:** `tests/e2e/release-degradation.spec.ts`, `tests/e2e/live-provider-stack.ts`
**Commit:** cd9a825
**Applied fix:** Replaced direct failure seeding with production circuit/provider parsing, replay API and owned BullMQ worker paths, including immutable facts and real dead-letter assertions.
**Verification:** desktop Chromium production replay boundary 2/2; other matrix cases 5/5 on owned PostgreSQL 18/Redis 8 stack.

### CR-05: Post-readiness API/web failures were swallowed

**Files modified:** `tests/e2e/live-provider-stack.ts`, `tests/e2e/live-release-stack.ts`, `tests/unit/release-db-lifecycle.test.ts`
**Commit:** 733400f
**Applied fix:** Armed fatal supervision for the entire Playwright lifetime with sibling termination and bounded diagnostics.
**Verification:** lifecycle/child-kill oracle 5/5; workspace typecheck passed.

### CR-06: Startup failure before ownership publication leaked resources

**Files modified:** `tests/e2e/live-provider-stack.ts`
**Commit:** ed49cb3
**Applied fix:** Published ownership after every allocation so worker/API/web readiness and build failures share exact cleanup.
**Verification:** lifecycle oracle 4/4; workspace typecheck passed.

### WR-03: Retained-view identifiers were arbitrary and unbounded

**Files modified:** privacy service, Prisma schema, forward migration, unit test
**Commit:** 7ef872b
**Applied fix:** Closed `RESULT` enum and canonical 1–128 character identifier enforced by API and PostgreSQL.
**Verification:** unit 4/4; Prisma validation and API typecheck passed.

## Skipped Issues

None — all in-scope findings were fixed.

<!-- Historical deferred entries replaced by verified fixes above.

### CR-01: Privacy signatures can be replayed across endpoints

**Reason:** Requires coordinated trusted-proxy signing, method/path/body canonicalization, and server-side one-time nonce consumption. A partial API-only change would leave the confused-deputy boundary open.

### CR-03: Expired personal history is retained indefinitely

**Reason:** Requires an owned purge scheduler, durable audit counts, and PostgreSQL time-boundary tests; no safe existing scheduler contract was present.

### CR-04: D-16 release matrix does not exercise production failure boundaries

**Reason:** Requires rebuilding four scenarios through provider/admission/BullMQ/replay production entry points. Direct database inserts were not accepted as substitute evidence.

### CR-05: Post-readiness failures are swallowed by the Playwright owner

**Reason:** Requires lifetime supervision wired into the Playwright owner plus a child-kill acceptance test.

### CR-06: Startup failure before ownership publication leaks resources

**Reason:** Requires incremental ownership and failure injection at worker-ready, API-ready, web-build, and web-ready checkpoints.

### WR-03: Retained-view identifiers are arbitrary and unbounded

**Reason:** Requires an agreed resource-type enum and a new forward database migration; editing an already-applied migration is unsafe.
-->

---

_Fixed: 2026-09-24T08:55:00Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
