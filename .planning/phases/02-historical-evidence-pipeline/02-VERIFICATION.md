---
phase: 02-historical-evidence-pipeline
verified: 2026-09-05T15:22:19+02:00
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
requirements:
  PIPE-01: satisfied
  PIPE-02: satisfied
  PIPE-03: satisfied
  PIPE-04: satisfied
  PIPE-05: satisfied
  PIPE-06: satisfied
  PIPE-07: satisfied
  PIPE-08: satisfied
decision_coverage: { honored: 20, total: 20, not_honored: [] }
re_verification:
  previous_status: gaps_found
  previous_score: 3/5
  gaps_closed:
    - "Multi-unit replay keeps a stable configured-policy approval while every unit evaluates current quota and circuit observations."
    - "A BullMQ delivery reclaims a crash-left RUNNING SyncRun through a bounded, fenced execution lease."
  gaps_remaining: []
  regressions: []
---

# Phase 2: Historical Evidence Pipeline Verification Report

**Phase Goal:** As a football analytics user, I want to inspect time-correct team evidence and request safe historical replays, so that I can rely on reproducible, quota-aware football history.
**Verified:** 2026-09-05T15:22:19+02:00
**Status:** passed
**Re-verification:** Yes — after plans 02-27/02-28 and review fixes through `360852e`

## User Flow Coverage

| Step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Inspect team evidence at a cutoff | Only eligible facts for the requested team contribute | Team/cutoff SQL plus chronological tests | ✓ VERIFIED |
| Inspect provenance | Capture/effective times and source identity survive projection | Strict receipts flow from PostgreSQL to API | ✓ VERIFIED |
| Run historical replay | Equivalent work converges; sequential units survive changing observations | New and legacy three-unit production-boundary tests | ✓ VERIFIED |
| Preserve live safety | Current circuit/quota/headroom can stop each unit before I/O | Fresh snapshot evaluation and fenced reservation tests | ✓ VERIFIED |
| Recover after worker death | Expired RUNNING ownership is reclaimed; stale owners cannot write | Real process-kill recovery and lease fencing tests | ✓ VERIFIED |

## Goal Achievement

### Observable Truths

| # | Roadmap success criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Fixtures, results and standings synchronize through retryable jobs without duplicate durable facts. | ✓ VERIFIED | Deterministic identities and canonical uniqueness remain wired; hard-kill recovery records `WORKER_LEASE_EXPIRED` then one success. |
| 2 | Operator sees degraded state and safely replays work while critical calls retain quota priority. | ✓ VERIFIED | Stable approval excludes volatile observations; every unit still evaluates live circuit/quota state. |
| 3 | Calls follow atomic budget reservation and facts retain provenance/capture time. | ✓ VERIFIED | Jobs reserve through `context.admitRequest()` before provider I/O and publish facts/terminal success in one fenced transaction. |
| 4 | User sees recent team history and weighted 5/10 form at a selected cutoff. | ✓ VERIFIED | Team-scoped evidence SQL, form components and API projection are substantive and tested. |
| 5 | Chronological features exclude post-cutoff facts. | ✓ VERIFIED | Eligibility requires both `effectiveAt` and `observedAt` at or before cutoff; all feature folds consume that ordered set. |

**Score:** 5/5 truths verified (0 behavior-unverified).

### Gap Re-verification

| Previous gap | Actual implementation | Behavioral proof | Verdict |
| --- | --- | --- | --- |
| Mutable quota/circuit fields self-invalidated later units | `projectReplayProviderPolicyIdentity()` hashes only stable configured fields; worker separately evaluates the complete fresh snapshot | Three sequential units pass under `identity-v2` and validated legacy approvals; an intervening OPEN circuit blocks the next unit | ✓ CLOSED |
| Crash-left RUNNING could not be reclaimed | Claim atomically waits on active leases, expires the old attempt, rotates the token and allocates the next DB attempt under row lock | OS-killed worker is replaced; run reaches one terminal success and old attempt is `FAILED/WORKER_LEASE_EXPIRED` | ✓ CLOSED |

### Required Artifacts

| Artifact | Status | Details |
| --- | --- | --- |
| `packages/domain/src/replay-provider-policy.ts` | ✓ VERIFIED | Stable identity projection, canonical `identity-v2`, exact legacy validation. |
| `workers/data-sync/src/resilience/provider-policy.ts` | ✓ VERIFIED | Validates approval, compares current identity, evaluates full live observations per unit. |
| `workers/data-sync/src/queues/replay-execution.ts` | ✓ VERIFIED | DB-clock claim/reclaim, heartbeat, admission, publication and failure fencing. |
| `workers/data-sync/src/queues/index.ts` | ✓ VERIFIED | BullMQ wait/reclaim, deterministic classification and exhausted-delivery reconciliation. |
| `packages/database/prisma/migrations/20260904_phase02_sync_run_execution_lease/migration.sql` | ✓ VERIFIED | Forward backfill, lease-shape constraint, guarded transitions and index. |
| `tests/integration/replay-crash-recovery.test.ts` | ✓ VERIFIED | Real PostgreSQL/Redis/BullMQ plus OS-killed child and owned cleanup. |

### Key Links and Data Flow

| From | To | Via | Status |
| --- | --- | --- | --- |
| Approved preview | Current configured policy | Stable identity fingerprint with legacy compatibility | ✓ WIRED |
| Each replay unit | Provider I/O | Fresh policy evaluation, owner assertion, atomic reservation | ✓ WIRED |
| BullMQ redelivery | Expired RUNNING run | Row lock, expiry, old-attempt failure, token rotation | ✓ WIRED |
| Current execution owner | Facts and terminal state | Token/time predicate plus one publication transaction | ✓ WIRED |
| Production preview/confirm/outbox | SyncRun | Canonical `${logicalId}:replay` identity | ✓ WIRED |
| Result history | Evidence API | Cutoff/team SQL, feature fold, published receipt | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Result | Status |
| --- | --- | --- |
| Policy, replay, lease, hard crash, empty/populated migration | Combined run: 62/70; all lease/crash/migration/policy files passed. Eight boundary cases encountered accumulated test reservations. | ⚠️ HARNESS ISOLATION |
| Same eight boundary cases on a fresh database | 8/8 passed | ✓ PASS |
| New/legacy three-unit replay, intervening denial, production logical key | Passed in production boundary | ✓ PASS |
| Chronology, provider contracts and evidence functions | 86/86 unit tests passed | ✓ PASS |

The full boundary file does not clear every successful request reservation, so late tests can exhaust the shared test allowance. This is a test-isolation warning: every affected behavior passes on a fresh database and no production must-have is unverified.

### Probe Execution

No probe scripts are declared. Phase verification uses the runnable Vitest integration and migration suites.

### Test Quality Audit

| Area | Active | Skipped/todo | Circular | Assertion strength | Verdict |
| --- | --- | --- | --- | --- | --- |
| Stable policy/live admission | Yes | 0 | No | Behavioral/value | ✓ SUFFICIENT |
| Lease fencing/exhaustion | Yes | 0 | No | Transactional transitions | ✓ SUFFICIENT |
| Hard crash recovery | Yes | 0 | No | Process-level behavior | ✓ SUFFICIENT |
| Empty/populated migration | Yes | 0 | No | Schema/data invariants | ✓ SUFFICIENT |
| Chronological evidence | Yes | 0 | No | Value/ordering | ✓ SUFFICIENT |

No disabled requirement tests, circular oracle generation, or unreferenced `TBD`/`FIXME`/`XXX` markers were found.

### Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| PIPE-01 | ✓ SATISFIED | Durable attempts, crash reclaim, bounded exhaustion and canonical idempotency. |
| PIPE-02 | ✓ SATISFIED | Raw payload, hash, capture/effective times and exact receipts retained. |
| PIPE-03 | ✓ SATISFIED | Atomic provider/date/endpoint reservation precedes every external call. |
| PIPE-04 | ✓ SATISFIED | Lane and critical headroom remain enforced for every unit. |
| PIPE-05 | ✓ SATISFIED | Durable circuits, retry classification, leases and dead-letter terminalization are tested. |
| PIPE-06 | ✓ SATISFIED | Bounded replay uses deterministic identity, live safety checks and recoverable execution. |
| PIPE-07 | ✓ SATISFIED | Team-scoped history and weighted five/ten-match form are exposed at cutoff. |
| PIPE-08 | ✓ SATISFIED | Versioned chronological features exclude facts unknown at cutoff. |

All PIPE-01 through PIPE-08 are claimed; none are orphaned.

### Decision Coverage

`check.decision-coverage-verify` reports 20/20 trackable CONTEXT decisions honored.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| `tests/integration/replay-boundary.test.ts` | Successful cases share a daily allowance without complete per-test reservation cleanup | ⚠️ Warning | Full-file result is order-sensitive; isolated behavior checks pass. |

### Human Verification Required

None. This infrastructure phase has automated evidence for its state transitions, crash, migration and chronology invariants.

### Deferred Items

None. Later phases consume these contracts and do not own the replay guarantees.

### Gaps Summary

No blocking gaps remain. Both replay lifecycle failures are closed with code, database constraints and independent behavioral evidence.

---

_Verified: 2026-09-05T15:22:19+02:00_
_Verifier: the agent (gsd-verifier)_
