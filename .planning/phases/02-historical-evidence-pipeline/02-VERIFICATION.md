---
phase: 02-historical-evidence-pipeline
verified: 2026-09-04T20:47:33+02:00
status: gaps_found
score: 3/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
requirements:
  PIPE-01: blocked
  PIPE-02: satisfied
  PIPE-03: satisfied
  PIPE-04: satisfied
  PIPE-05: blocked
  PIPE-06: blocked
  PIPE-07: satisfied
  PIPE-08: satisfied
decision_coverage: { honored: 20, total: 20, not_honored: [] }
re_verification:
  previous_status: gaps_found
  previous_score: 0/5
  gaps_closed:
    - "Evidence selection is scoped to the requested team before ranking."
    - "Fixture replay uses the requested allowlisted competition and bounded dates."
    - "Fresh equivalent previews converge on the existing logical-key replay plan."
    - "Replay and evidence validation errors use disclosure-safe Nest 4xx exceptions."
    - "Malformed persisted evidence receipts are rejected atomically."
  gaps_remaining:
    - "Mutable quota/circuit state is included in the replay-policy fingerprint, so later replay units can self-invalidate after the first reservation."
    - "A BullMQ stalled retry cannot reclaim a SyncRun left RUNNING by a crashed process."
  regressions: []
gaps:
  - truth: "Multi-unit replay remains valid after earlier units mutate live quota or circuit state."
    status: failed
    reason: "The worker compares a fresh snapshot fingerprint with the preview fingerprint, but the fingerprint includes mutable reserved, remaining, availableForLane, circuit timestamps and validUntil."
    artifacts:
      - path: "packages/domain/src/replay-provider-policy.ts"
        issue: "fingerprintReplayProviderPolicy excludes only observedAt."
      - path: "workers/data-sync/src/resilience/provider-policy.ts"
        issue: "Every unit requires fresh mutable fingerprint equality before admission."
      - path: "packages/database/src/replay-provider-policy.ts"
        issue: "The snapshot derives hashed fields from the live reservation count."
    missing:
      - "Separate stable policy/configuration identity from live capacity and circuit observations."
      - "Evaluate fresh circuit state and atomically reserve quota for every unit."
      - "Add a sequential integration test with at least three replay units."
  - truth: "A replay job recovers after its worker crashes while SyncRun is RUNNING."
    status: failed
    reason: "A recovered BullMQ processor accepts only PENDING. It treats the crash-left RUNNING row as duplicate and succeeds without resetting, reclaiming, or terminating it."
    artifacts:
      - path: "workers/data-sync/src/queues/index.ts"
        issue: "Claim logic returns false for every non-PENDING state; SyncRun/SyncAttempt have no execution ownership lease/token."
      - path: "packages/database/prisma/schema.prisma"
        issue: "ReplayDelivery has a delivery lease, but SyncRun execution has no recoverable lease."
    missing:
      - "Add a bounded execution lease/token or safe stale-RUNNING reconciliation."
      - "Fence terminal transitions by the current execution owner."
      - "Add a process-level crash/stall recovery test with exactly one terminal transition."
---

# Phase 2: Historical Evidence Pipeline Verification Report

**Phase Goal:** As a football analytics user, I want to inspect time-correct team evidence and request safe historical replays, so that I can rely on reproducible, quota-aware football history.
**Verified:** 2026-09-04T20:47:33+02:00
**Status:** gaps_found
**Re-verification:** Yes — after gap-closure plans 02-23 through 02-26

## User Flow Coverage

| Step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Inspect one team's evidence at a cutoff | Only that team's eligible results feed trace and features | `evidence-rebuild.ts:14-18,84-105`; unrelated-team test passed | ✓ VERIFIED |
| Inspect exact provenance | Corrupt receipts are not partially rewritten | Shared strict `parseEvidenceReceipt`; API tests passed | ✓ VERIFIED |
| Confirm equivalent replay | Same logical input converges without duplicate work | `replay.service.ts:128-147`; fresh-preview test passed | ✓ VERIFIED |
| Replay non-PL fixtures | Requested competition/window reaches the generalized provider | `fixtures.ts:52-112`; production wiring is present | ✓ VERIFIED |
| Recover replay processing | Stalled BullMQ work completes after process crash | `queues/index.ts:71-89` treats recovered RUNNING as duplicate | ✗ FAILED |
| Outcome | History is reproducible and safely replayable | Evidence correctness is repaired, but multi-unit and crash recovery invariants fail | ✗ FAILED |

## Goal Achievement

### Observable Truths

| # | Roadmap success criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Fixtures, results and standings synchronize through retryable jobs without duplicate durable facts. | ✗ FAILED | Ordinary reruns are deterministic, but a crash after RUNNING cannot be reclaimed (`queues/index.ts:71-89`). |
| 2 | Operator sees degraded state and safely replays work while critical calls retain priority. | ✗ FAILED | Visibility/priority are wired, but later replay units can self-reject when the first reservation changes the hashed live state. |
| 3 | Calls follow atomic budget reservation and facts retain provenance/capture time. | ✓ VERIFIED | Gated ingestion reserves before provider construction/I/O; strict receipt parsing preserves immutable evidence. |
| 4 | User sees team history and weighted 5/10 form at a selected cutoff. | ✓ VERIFIED | SQL binds cutoff and team ID before ranking; publication/API tests passed. |
| 5 | Chronological features exclude post-cutoff facts. | ✓ VERIFIED | Dual-time feature contract remains tested and team contamination is excluded before calculation. |

**Score:** 3/5 truths verified.

### Original Five Gaps

| Previous gap | Closure evidence | Verdict |
| --- | --- | --- |
| Cross-team evidence contamination | SQL has `(homeTeamId=$2 OR awayTeamId=$2)` and binds `teamId`; unrelated-team test passed | ✓ CLOSED |
| PL-only fixture replay | `fetchCompetitionFixtures` receives validated competition/date bounds and rejects mismatch | ✓ CLOSED |
| Fresh-preview logical-key collision | Advisory lock plus logical-key ReplayPlan lookup precedes allocation | ✓ CLOSED |
| Validation became HTTP 500 | Services emit allowlisted `BadRequestException`/`ConflictException`; HTTP test passed | ✓ CLOSED |
| Lossy receipt projection | `parseEvidenceReceipt` rejects the complete receipt; malformed cases passed | ✓ CLOSED |

### Required Artifacts

| Artifact | Status | Details |
| --- | --- | --- |
| `workers/data-sync/src/jobs/evidence-rebuild.ts` | ✓ VERIFIED | Team-scoped, cutoff-bound and wired to feature calculations. |
| `apps/api/src/modules/evidence/evidence.service.ts` | ✓ VERIFIED | Strict receipt parser and safe exceptions are used. |
| `apps/api/src/modules/replay/replay.service.ts` | ✓ VERIFIED | Logical-key duplicate return occurs before side-effect allocation. |
| `workers/data-sync/src/jobs/fixtures.ts` | ✓ VERIFIED | Generalized provider is wired after admission with scope validation. |
| `workers/data-sync/src/resilience/provider-policy.ts` | ✗ BROKEN | Conflates stable approval identity with mutable operational state. |
| `workers/data-sync/src/queues/index.ts` | ✗ BROKEN | Durable RUNNING execution has no lease/reclaim path. |

### Key Links and Data Flow

| From | To | Via | Status |
| --- | --- | --- | --- |
| Requested team/cutoff | Eligible results | SQL `$2`/`$1` before ranking | ✓ WIRED |
| Persisted receipt | API response | strict parser | ✓ WIRED |
| Replay logical key | Existing plan | advisory lock + logical-key lookup | ✓ WIRED |
| Replay unit | Competition provider | validated `RequestedDateWindow` | ✓ WIRED |
| Approved policy | Fresh unit admission | mutable snapshot equality | ✗ INCORRECT |
| BullMQ retry | RUNNING SyncRun | PENDING-only claim | ✗ NOT RECOVERABLE |

Real evidence and fixture data flow from PostgreSQL/provider into durable facts. The two failed links terminate operational progress: mutable policy identity blocks later units, and a stalled retry stops at the RUNNING row.

### Behavioral Spot-Checks

| Behavior | Result | Status |
| --- | --- | --- |
| Evidence isolation, receipt rejection, logical-key replay, safe HTTP errors | 43 focused integration tests passed outside the boundary harness | ✓ PASS |
| Production replay boundary | Independent rerun: 1 pass/13 failures because local boundary returned 404 or did not reach terminal state while dependencies reported unavailable | ⚠️ HARNESS INCONCLUSIVE |
| Multi-unit fingerprint stability | First reservation changes fields included in the next unit's required fingerprint | ✗ FAIL |
| Stalled-job recovery | RUNNING fails the PENDING-only claim and returns `{duplicate:true}` with no reclaim | ✗ FAIL |

### Test Quality Audit

No skipped/todo requirement tests or unreferenced `TBD`/`FIXME`/`XXX` markers were found. Existing tests cover graceful failures and delivery leases, but no active test covers sequential multi-unit policy mutation or a worker-process crash after RUNNING. These are blocker-level test gaps because production tracing disproves both invariants.

### Requirements Coverage

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| PIPE-01 | ✗ BLOCKED | Crash-stalled RUNNING work is unrecoverable. |
| PIPE-02 | ✓ SATISFIED | Exact provenance/capture time retained; malformed receipts fail closed. |
| PIPE-03 | ✓ SATISFIED | Atomic reservation precedes admitted external calls. |
| PIPE-04 | ✓ SATISFIED | Critical headroom and priority are evaluated before provider I/O. |
| PIPE-05 | ✗ BLOCKED | Graceful retry exists, but process-crash recovery violates durable retryability. |
| PIPE-06 | ✗ BLOCKED | Logical-key idempotency is fixed, but multi-unit self-invalidation and stalled recovery make replay unsafe. |
| PIPE-07 | ✓ SATISFIED | Team-scoped history and 5/10 form are exposed at cutoff. |
| PIPE-08 | ✓ SATISFIED | Leakage-safe chronological features use eligible team facts. |

All PIPE-01 through PIPE-08 are claimed; none are orphaned.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| `packages/domain/src/replay-provider-policy.ts:45-47` | Mutable state hashed as identity | 🛑 BLOCKER | Valid multi-unit work can reject itself. |
| `workers/data-sync/src/queues/index.ts:71-89` | Non-PENDING treated as duplicate without execution ownership | 🛑 BLOCKER | Crash leaves replay permanently RUNNING while BullMQ reports success. |

### Decision Coverage

All 20 trackable CONTEXT decisions are represented in shipped artifacts. This non-blocking heuristic does not override the observed defects.

### Human Verification Required

None. Remaining failures are deterministic backend correctness defects.

### Deferred Items

None. Later phases consume trustworthy history and do not own these replay guarantees.

### Gaps Summary and Next Action

Plans 02-23 through 02-26 close all five previous gaps. Phase 02 still must not advance: stable multi-unit policy identity and stalled RUNNING recovery are required for safe retryable replay.

**Next command:** `$gsd-plan-phase 02 --gaps`

---

_Verified: 2026-09-04T20:47:33+02:00_
_Verifier: the agent (gsd-verifier)_
