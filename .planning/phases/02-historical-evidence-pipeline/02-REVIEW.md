---
phase: 02-historical-evidence-pipeline
reviewed: 2026-08-31T03:06:45Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - packages/database/prisma/migrations/20260830_phase02_temporal_repair/migration.sql
  - packages/database/prisma/schema.prisma
  - workers/data-sync/src/jobs/results.ts
  - workers/data-sync/src/jobs/standings.ts
  - workers/data-sync/src/jobs/evidence-rebuild.ts
  - workers/data-sync/src/ingestion/runner.ts
  - tests/integration/temporal-provenance.test.ts
  - tests/integration/migration-empty.test.ts
  - packages/football-data/src/provider.interface.ts
  - packages/football-data/src/providers/football-data-org/client.ts
  - packages/football-data/src/providers/football-data-org/schema.ts
  - packages/football-data/src/providers/football-data-org/normalize.ts
  - tests/unit/provider-contract.test.ts
  - tests/integration/provider-resilience.test.ts
  - packages/database/prisma/migrations/20260830_phase02_replay_preview/migration.sql
  - apps/api/src/modules/replay/replay.service.ts
  - apps/api/src/modules/replay/replay.controller.ts
  - apps/api/src/app.module.ts
  - workers/data-sync/src/queues/index.ts
  - workers/data-sync/src/main.ts
  - tests/integration/replay.test.ts
  - apps/web/app/internal/pipeline/replay/page.tsx
  - apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts
  - tests/integration/replay-boundary.test.ts
  - tests/e2e/pipeline-replay.spec.ts
  - apps/api/package.json
  - workers/data-sync/package.json
  - packages/domain/src/evidence/contract.ts
  - apps/api/src/modules/evidence/evidence.service.ts
  - apps/web/app/teams/[teamId]/evidence/page.tsx
  - tests/integration/evidence-publication.test.ts
  - tests/integration/evidence-api.test.ts
  - tests/e2e/team-evidence.spec.ts
findings:
  critical: 6
  warning: 1
  info: 0
  total: 7
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-08-31T03:06:45Z
**Depth:** standard  
**Files Reviewed:** 33
**Status:** issues_found

## Summary

The gap-closure fixes the original direct persistence and projection defects: immutable observation reuse, `TIMESTAMPTZ(3)` evidence instants, complete-successful publication, UTC browser replay times, competition parameterization, and typed evidence/provenance rendering are now present.

The durable replay path is still not shippable. Its database lifecycle conflicts with the checked-in append-only trigger (confirmed by the real PostgreSQL/Redis suite), its Next proxy acts as an unauthenticated operator deputy, and queue delivery/state/circuit wiring can create stranded or unsafe work.

Command executed: `node node_modules/vitest/vitest.mjs run tests/integration/replay.test.ts --project integration`. Result: **1 failed / 5 tests**. The BullMQ lifecycle test left all three attempts `RUNNING` and the run `RUNNING`; PostgreSQL rejected the Worker’s `SyncAttempt.update()` calls.

## Previous Findings Reassessment

| Previous finding | Status after 02-11…02-15 | Evidence |
|---|---|---|
| CR-01 durable replay was process-local/no-op | **Partially resolved; remaining blocker** | Preview/plan/run rows and BullMQ enqueue now exist, but CR-01 through CR-04 below prevent reliable or authorized execution. |
| CR-02 EvidenceBuild transition was impossible | **Resolved** | The temporal repair replaces the blanket trigger with the guarded `BUILDING -> PUBLISHED|FAILED` transition; the PostgreSQL publication witness succeeds. |
| CR-03 idempotent observation recovery updated immutable observations | **Resolved** | Result and standings persistence use `ON CONFLICT DO NOTHING RETURNING`, then a unique-key select. |
| CR-04 failed/cancelled source work could publish | **Resolved in rebuild; reintroduced in Worker lifecycle** | `isCompleteSuccessfulRun()` rejects terminal failures, but a delivered job can change a terminal run back to `SUCCEEDED` (CR-06). |
| CR-05 replay UI sent offset-less datetimes | **Resolved** | The UI freezes `datetime-local` values as explicit UTC ISO instants before preview. |
| CR-06 competition path was hardcoded to PL | **Resolved** | The allowlist is passed to result/standings URLs and matched in response schemas. |
| CR-07 persistence lost timezone semantics | **Resolved for Phase-2 evidence fields** | The forward migration and Prisma schema use `TIMESTAMPTZ(3)`; PostgreSQL session-timezone coverage is present. |
| WR-01 object values rendered as `[object Object]` | **Resolved** | The shared discriminated evidence contract renders named fields and units. |
| WR-02 missing provenance left a computed value visible | **Resolved, with collision risk remaining** | Projection nulls an affected value, but WR-01 below still uses an ambiguous provenance join key. |
| WR-03 half-open workers lacked a probe lease | **Not resolved in the live replay path** | The generic runner has a lease, but production replay jobs hard-code `CLOSED` and never supply a registry (CR-05). |
| WR-04 tests replaced production boundaries | **Partially resolved** | A real proxy/Redis/PostgreSQL test was added, but the replay integration test now fails and does not cover authorization or delivery recovery. |

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: SyncAttempt append-only trigger prevents every replay from reaching a terminal state

**Classification:** BLOCKER
**File:** `workers/data-sync/src/queues/index.ts:81-89`
**Issue:** The Worker creates a `RUNNING` attempt, then updates it to `SUCCEEDED` or `FAILED`. `SyncAttempt_append_only` in `20260829_historical_evidence/migration.sql:68` forbids every update and no gap-closure migration removes or narrows that trigger. Consequently, successful executions cannot record success; the catch path cannot record failure either. The real container test demonstrates the effect: all three attempts remain `RUNNING` and the `SyncRun` remains `RUNNING`.

**Fix:** Replace the blanket `SyncAttempt` trigger with a database-guarded state transition (for example `RUNNING -> SUCCEEDED|FAILED` only, while identity/start fields stay immutable), then add a PostgreSQL test covering both Worker terminal branches.

### CR-02: Public Next replay proxy bypasses the operator authorization boundary

**Classification:** BLOCKER
**File:** `apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts:3-15`
**Issue:** Any caller of the public Next route receives the server-side `OPERATOR_CREDENTIAL` forwarded as `x-operator-credential`. The Nest `OperatorGuard` protects the direct controller, but this proxy supplies valid credentials without checking an authenticated user, role, or session. An unauthenticated internet caller can therefore create replays, consume provider quota, and inspect replay status.

**Fix:** Protect the Next route with the application’s real operator session/role check before forwarding. Do not use a server-held API credential as proof that the browser caller is an operator; return 404/403 before proxying for unauthenticated callers. Add an integration test for an unauthenticated proxy request.

### CR-03: Queue-delivery failure strands committed replay runs permanently

**Classification:** BLOCKER
**File:** `apps/api/src/modules/replay/replay.service.ts:79-99`
**Issue:** `queue()` commits the preview consumption, `ReplayPlan`, and every `SyncRun` before enqueueing. If a queue add fails after the first run (or before any run), the catch merely marks that one row `RETRYABLE` and returns 503. A repeated confirmation takes the duplicate branch at lines 83-85 and never retries delivery because lines 98-99 enqueue only non-duplicates. Multi-unit plans can therefore run partially while the remaining durable runs remain `PENDING` forever.

**Fix:** Use a transactional outbox/delivery ledger and a retrying dispatcher, or make duplicate confirmations enqueue every run whose durable delivery state is not `DELIVERED`. Track delivery per run, make the repair idempotent with the deterministic job ID, and test failure after the first of two enqueues followed by recovery.

### CR-04: The replay UI defaults to an endpoint the Worker deliberately dead-letters

**Classification:** BLOCKER
**File:** `apps/web/app/internal/pipeline/replay/page.tsx:85`
**Issue:** The visible endpoint selector defaults to `FIXTURES`, and `ReplayService` explicitly accepts `FIXTURES` (`replay.service.ts:8,40`). `startReplayWorker()` only routes `RESULTS` and `STANDINGS`; all other values throw `UNSUPPORTED_REPLAY_ENDPOINT` (`workers/data-sync/src/main.ts:18-20`). Thus a normal first-time replay submission is accepted and queued, then guaranteed to exhaust retries and dead-letter.

**Fix:** Implement a fixtures replay handler with the same durable completion semantics, or remove `FIXTURES` from the API allowlist and UI until it exists. Add a production Worker test for every selectable endpoint.

### CR-05: Live replay bypasses provider circuit state, quota state, and HALF_OPEN ownership

**Classification:** BLOCKER
**File:** `workers/data-sync/src/jobs/results.ts:71-73`
**Issue:** The generic gate now supports a registry-owned HALF_OPEN lease, but replay jobs pass `circuit: "CLOSED"` and do not pass a `CircuitProbeRegistry`; standings does the same at `standings.ts:71-72`. No production code constructs or wires `ProviderCircuitRegistry` into these paths. In parallel, preview evaluates fixed defaults (`availableCalls = 100`, `circuit = "CLOSED"`) rather than the persisted provider budget/circuit state (`replay.service.ts:57-64`). A replay can therefore be approved and issue provider calls while the real circuit is OPEN/HALF_OPEN or its allowance is exhausted.

**Fix:** Obtain the durable provider budget/circuit projection before preview and at execution, wire the registry/circuit policy through the actual Worker job inputs, and deny/defer before reservation when it is OPEN or a HALF_OPEN lease is unavailable. Expose only that verified state to the UI and cover it with two concurrent production Workers.

### CR-06: A redelivered job can revive FAILED or CANCELLED source work and make it publishable

**Classification:** BLOCKER
**File:** `workers/data-sync/src/queues/index.ts:69-83`
**Issue:** Only `SUCCEEDED` returns early. For a `FAILED` or `CANCELLED` run, the Worker still executes provider I/O and then unconditionally updates the run to `SUCCEEDED` at line 82. Once CR-01 is repaired (or if a database role bypasses the trigger), a stale/redelivered/manual BullMQ job can convert failed or cancelled source work into a complete successful run. The evidence gate then accepts it, defeating the repaired failed/cancelled publication contract.

**Fix:** Lock the run in the initial transaction and proceed only from `PENDING`/`RUNNING`; treat `FAILED`, `CANCELLED`, and `SUCCEEDED` as terminal no-ops. Make the terminal transition conditional in SQL/Prisma and add redelivery tests for both terminal failure states.

## Warnings

### WR-01: Component provenance joins do not include the payload identity

**Classification:** WARNING
**File:** `workers/data-sync/src/jobs/evidence-rebuild.ts:131`
**Issue:** Staged component `sourceTimes` retains only `fixtureId`, `effectiveAt`, and `observedAt`. The API later finds a receipt input by that same three-field tuple (`apps/api/src/modules/evidence/evidence.service.ts:71-76`), even though the immutable source identity also includes `payloadHash` and `payloadBytes`. Two corrections for the same fixture captured at the same instant can be projected with the wrong receipt payload while still appearing valid.

**Fix:** Persist `payloadHash` (and preferably `payloadBytes`) in each component source reference, require an exact identity match in `sourceRefs()`, and add a collision fixture with the same fixture/effective/observed times but two different hashes.

---

_Reviewed: 2026-08-31T03:06:45Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
