---
phase: 02-historical-evidence-pipeline
verified: 2026-08-31T03:16:18Z
status: gaps_found
score: 2/5 must-haves verified
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 0/5
  gaps_closed:
    - "Immutable result/standing observation reuse no longer updates append-only SourceObservation rows."
    - "EvidenceBuild now has a guarded BUILDING-to-PUBLISHED/FAILED transition."
    - "Phase-2 evidence instants are migrated and modelled as TIMESTAMPTZ(3)."
    - "Configured competition codes now parameterize result/standing requests."
    - "Replay UI serializes valid local windows as explicit UTC instants."
    - "Evidence projection fails affected components closed and renders typed values."
  gaps_remaining:
    - "Replay worker lifecycle, delivery recovery, endpoint coverage, authorization, and live circuit/quota gating are unsafe."
    - "Retryable synchronization is not operational because SyncAttempt updates are rejected by the applied schema."
  regressions: []
gaps:
  - truth: "Upcoming fixtures, completed results, and standings synchronize through retryable jobs without duplicating durable football facts when rerun."
    status: failed
    reason: "The real BullMQ/PostgreSQL replay lifecycle cannot complete an attempt: the checked-in SyncAttempt append-only trigger rejects the worker's RUNNING-to-SUCCEEDED/FAILED updates. A successful replay exhausts all three deliveries with attempts still RUNNING. Re-delivery also accepts FAILED/CANCELLED runs, and FIXTURES is accepted by the replay API but dead-lettered by the production worker."
    artifacts:
      - path: "packages/database/prisma/migrations/20260829_historical_evidence/migration.sql"
        issue: "SyncAttempt_append_only is still installed and no later migration replaces it with a guarded terminal transition."
      - path: "workers/data-sync/src/queues/index.ts"
        issue: "Worker updates SyncAttempt on both terminal branches and only short-circuits SUCCEEDED runs."
      - path: "workers/data-sync/src/main.ts"
        issue: "No handler exists for accepted FIXTURES replay jobs."
    missing:
      - "Add a forward migration allowing only the required SyncAttempt terminal state transitions."
      - "Lock/check SyncRun state so FAILED, CANCELLED, and SUCCEEDED deliveries are terminal no-ops."
      - "Either implement fixtures replay or remove it from the API/UI contract, then test every selectable endpoint."
  - truth: "An operator can see degraded provider state and replay failed or historical work while critical fixture/result calls retain quota priority over optional enrichment."
    status: failed
    reason: "The public Next proxy forwards its server-held operator credential for every caller; replay confirmation has no recoverable delivery ledger; and live replay substitutes CLOSED/allowance defaults for persisted circuit/budget state. These failures permit unauthorized replay, stranded work, and calls that ignore OPEN/HALF_OPEN or critical-headroom policy."
    artifacts:
      - path: "apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts"
        issue: "Proxy injects OPERATOR_CREDENTIAL without authenticating or authorizing the browser caller."
      - path: "apps/api/src/modules/replay/replay.service.ts"
        issue: "Preview/status use fixed availableCalls/circuit values, and duplicate confirmation does not retry undelivered SyncRuns."
      - path: "workers/data-sync/src/jobs/results.ts"
        issue: "Live replay hard-codes circuit CLOSED and allowance 10."
      - path: "workers/data-sync/src/jobs/standings.ts"
        issue: "Live replay hard-codes circuit CLOSED, allowance 10, and zero critical headroom."
    missing:
      - "Require an actual operator user/session/role at the Next boundary before forwarding any credential."
      - "Use an idempotent transactional outbox or per-run delivery ledger and retry undispatched rows on duplicate confirmation."
      - "Read durable budget/circuit state at preview and execution, wire ProviderCircuitRegistry into replay, and enforce critical headroom before reservation/I/O."
behavior_unverified_items:
  - truth: "A user can view recent team history plus five- and ten-match weighted form as known at a selected point in time."
    test: "With a real published PostgreSQL EvidenceBuild and the application running, open the team evidence page at a fixture cutoff and compare the rendered trace, 5/10 summaries, UTC cutoff, receipts, and limitations with the API response."
    expected: "The browser renders the exact published cutoff data and never substitutes newer evidence; null/limited values remain explicitly qualified."
    why_human: "The real PostgreSQL-to-Nest-to-renderer integration passes, but the browser E2E test intercepts the evidence route with fixture JSON, so no passing test currently exercises the live browser fetch/render path."
---

# Phase 2: Historical Evidence Pipeline Verification Report

**Phase Goal:** As a football analytics user, I want to inspect time-correct team evidence and request safe historical replays, so that I can rely on reproducible, quota-aware football history.
**Verified:** 2026-08-31T03:16:18Z
**Status:** gaps_found
**Re-verification:** Yes — after gap-closure plans 02-11 through 02-15

## User Flow Coverage

| Step | Expected | Evidence in the codebase | Status |
| --- | --- | --- | --- |
| Open team evidence at a cutoff | Fixture/evidence route fetches a cutoff-specific projection and renders summaries, trace, receipts, and limitations | `EvidenceService` queries only PUBLISHED builds at `cutoff <= asOf`; the production rebuild/API/render-adapter test passes | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED |
| Preview and confirm a replay | An authorized operator sees real provider state, freezes a bounded dry run, then causes durable work | Durable rows and BullMQ enqueue code exist, but proxy authorization is bypassed and state is fixed/defaulted | ✗ FAILED |
| Observe replay completion | Worker records attempts and terminal run outcome without duplicate durable facts | Targeted PostgreSQL/Redis test fails: terminal attempt updates hit `SyncAttempt_append_only`; all three attempts stay RUNNING | ✗ FAILED |
| Rely on reproducible, quota-aware history | Published evidence is dual-time correct and replay work is safe and observable | Evidence core is proven; the unsafe/non-terminal replay path blocks the promised outcome | ✗ FAILED |

## Goal Achievement

### Observable Truths

| # | Roadmap truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Upcoming fixtures, completed results, and standings synchronize through retryable jobs without duplicating durable football facts when rerun. | ✗ FAILED | `tests/integration/replay.test.ts` ran against real PostgreSQL/Redis: 1/5 failed; the successful lifecycle never reaches SUCCEEDED because `SyncAttempt` updates are forbidden. `FIXTURES` is also selectable but unsupported by the production worker. |
| 2 | An operator can see degraded provider state and replay failed or historical work while critical fixture/result calls retain quota priority over optional enrichment. | ✗ FAILED | Proxy injects the server credential for any caller; queue delivery can strand durable PENDING rows; replay results/standings hard-code CLOSED/10 and standings uses zero headroom. |
| 3 | Every external call is preceded by an atomic provider/date/endpoint budget reservation, and normalized facts retain raw-source provenance and capture time. | ✓ VERIFIED | `runGatedIngestion` reserves before provider construction/I/O; `reserveProviderRequest` locks provider/date/endpoint; results/standings persist raw JSON, hash, bytes, capture/source times and immutable observation references. Targeted budget/resilience tests: 16/16 passed. |
| 4 | A user can view recent team history plus five- and ten-match weighted form as known at a selected point in time. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Real PostgreSQL publication → `EvidenceService` → shared renderer passes (1/1), but the browser E2E supplies mocked route JSON, so a live browser user flow is not exercised. |
| 5 | Elo, home/away strength, goal rates, rest days, and low-weight H2H are chronological and exclude facts captured after the requested cutoff. | ✓ VERIFIED | Eligibility filters both effective and observed instants; focused chronological/form tests passed 11/11, and the PostgreSQL publication test confirms a later correction does not alter an earlier cutoff response. |

**Score:** 2/5 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `workers/data-sync/src/jobs/{results,standings}.ts` | Reservation-first, provenance-preserving result/standing ingestion | ✓ VERIFIED | Substantive and wired to PostgreSQL; `ON CONFLICT DO NOTHING` + unique-key reuse avoids immutable observation updates. |
| `workers/data-sync/src/queues/index.ts` | Durable replay attempts and terminal SyncRun state | ✗ STUB AT RUNTIME | Code is substantive and connected, but both terminal attempt updates contradict the applied trigger. |
| `apps/api/src/modules/replay/replay.service.ts` | Safe preview/confirm/status backed by database and queue | ⚠️ HOLLOW | Persists preview/plan/run rows, but reports provider state from defaults and cannot recover partial delivery. |
| `apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts` | Authorized private proxy | ✗ UNSAFE WIRING | Directly forwards `OPERATOR_CREDENTIAL` without a user authorization check. |
| `workers/data-sync/src/jobs/evidence-rebuild.ts` → `apps/api/src/modules/evidence/evidence.service.ts` | Published, cutoff-aware evidence projection | ✓ VERIFIED | Real PostgreSQL build/publish/query witness passed. |
| `apps/web/app/teams/[teamId]/evidence/page.tsx` | User-visible typed evidence fields and units | ⚠️ PRESENT, LIVE FLOW UNEXERCISED | Imports shared DTO and renders all variants, but only mocked-route browser coverage exists. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| Replay browser page | Next proxy → Nest replay controller | UTC body and server proxy | ✗ NOT SAFE | UTC conversion is wired, but the proxy acts as an unauthenticated operator deputy. |
| Replay confirmation | ReplayPlan/SyncRun → BullMQ → Worker | Deterministic job ID and durable rows | ✗ PARTIAL | Delivery occurs after commit without a recoverable outbox; actual worker terminal update fails. |
| Worker | Provider circuit/budget gate | `runReplayResultJob` / `runReplayStandingsJob` | ✗ NOT WIRED | Production replay bypasses the registry and durable quota state by passing fixed CLOSED/default values. |
| ResultVersion/SourceObservation | EvidenceBuild → Nest projection → shared renderer | Cutoff SQL and discriminated DTO | ✓ WIRED | Real PostgreSQL integration passes; browser-level fetch is separately unverified. |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| Replay status | `SyncRun` / `SyncAttempt` | PostgreSQL plus BullMQ worker | Terminal writes are rejected by database trigger | ✗ DISCONNECTED |
| Evidence projection | components/receipt | ResultVersion joined to SourceObservation, then EvidenceBuild | Real PostgreSQL publication test | ✓ FLOWING |
| Component provenance | `sourceRefs` | staged component tuple → receipt input | Payload identity is omitted from join tuple | ⚠️ WARNING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Durable replay lifecycle | `node node_modules/vitest/vitest.mjs run tests/integration/replay.test.ts --project integration` | 1 failed / 5; three attempts remained RUNNING | ✗ FAIL |
| Atomic provider reservation and generic circuit policy | `node node_modules/vitest/vitest.mjs run tests/integration/provider-budget-order.test.ts tests/integration/provider-resilience.test.ts --project integration` | 16 passed | ✓ PASS |
| Dual-time chronology and weighted form | `node node_modules/vitest/vitest.mjs run tests/unit/chronological-features.test.ts tests/unit/form.test.ts --project unit` | 11 passed | ✓ PASS |
| Published evidence at exact cutoff | `node node_modules/vitest/vitest.mjs run tests/integration/evidence-publication.test.ts --project integration` | 1 passed | ✓ PASS |
| Temporal migration/provenance contract | `node node_modules/vitest/vitest.mjs run tests/integration/temporal-provenance.test.ts --project integration` | 9 passed | ✓ PASS |
| Phase 1 security regression | `node node_modules/vitest/vitest.mjs run tests/integration/phase-01-security.test.ts --project integration` | 5 passed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| PIPE-01 | 02-05, 02-06, 02-11, 02-12 | Idempotent retryable fixture/result/standing jobs | ✗ BLOCKED | Observation reuse and competition routing work, but replay attempts cannot terminate and selectable FIXTURES jobs dead-letter. |
| PIPE-02 | 02-05, 02-11, 02-15 | Raw provenance and capture timestamps | ✓ SATISFIED (warning) | Immutable raw observations and dual-time fields are persisted; component projection join should also include `payloadHash` to avoid an ambiguous receipt match. |
| PIPE-03 | 02-03, 02-06 | Atomic reservation before every external call | ✓ SATISFIED | Reservation lock/insert precedes provider construction; focused tests pass. |
| PIPE-04 | 02-03, 02-06, 02-07 | Critical fixture/result budget priority | ✗ BLOCKED | Generic gate supports priority, but live replay injects `criticalHeadroom: 0` / fixed allowance and can bypass actual policy. |
| PIPE-05 | 02-04, 02-07, 02-12, 02-14 | Retry/backoff, circuit/degraded state | ✗ BLOCKED | Runtime lifecycle failure, fixed circuit state, and missing live HALF_OPEN ownership invalidate the operator path. |
| PIPE-06 | 02-04, 02-09, 02-13, 02-14 | Safe failed/historical replay | ✗ BLOCKED | Authorization bypass, delivery gaps, unsupported endpoint, and failed terminal lifecycle make replay unsafe. |
| PIPE-07 | 02-08, 02-09, 02-15 | User-visible recent history and 5/10 form | ? NEEDS HUMAN | Data and renderer are proven, but the browser test mocks the endpoint instead of exercising real fetch/rendering. |
| PIPE-08 | 02-08, 02-11, 02-15 | Chronological cutoff-safe derived features | ✓ SATISFIED | Unit and real PostgreSQL cutoff tests pass. |

### Test Quality Audit

| Test File | Linked Req | Active | Skipped | Circular | Assertion Level | Verdict |
| --- | --- | ---: | ---: | --- | --- | --- |
| `tests/integration/replay.test.ts` | PIPE-01, PIPE-05, PIPE-06 | 5 | 0 | No | Behavioral | BLOCKER — true integration assertion fails. |
| `tests/integration/provider-budget-order.test.ts` + `provider-resilience.test.ts` | PIPE-03, PIPE-04, PIPE-05 | 16 | 0 | No | Behavioral | Valid for generic gate only; does not cover live replay wiring. |
| `tests/integration/evidence-publication.test.ts` | PIPE-02, PIPE-07, PIPE-08 | 1 | 0 | No | Behavioral | Valid PostgreSQL/service/renderer boundary witness. |
| `tests/e2e/team-evidence.spec.ts` | PIPE-07 | 6 | 0 | No | Browser behavior over mocked API | WARNING — fixtures intercept the evidence route, so it cannot prove the live data-flow. |

No disabled requirement-linked tests or unreferenced `TBD`/`FIXME`/`XXX` markers were found in Phase-2 implementation files. The replay test is not a false green: its active terminal-state assertion directly exposed the applied-schema contradiction.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| `packages/database/prisma/migrations/20260829_historical_evidence/migration.sql` | 68 | blanket `SyncAttempt_append_only` trigger | 🛑 BLOCKER | Makes worker terminal success/failure updates impossible. |
| `apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts` | 4-12 | server credential forwarded without caller authorization | 🛑 BLOCKER | Unauthenticated callers can perform operator actions. |
| `apps/api/src/modules/replay/replay.service.ts` | 57-64, 83-99 | default provider state and no delivery recovery | 🛑 BLOCKER | Misreports degradation and strands committed work. |
| `workers/data-sync/src/main.ts` | 18-20 | selectable `FIXTURES` branch missing | 🛑 BLOCKER | Normal replay request is guaranteed to dead-letter. |
| `workers/data-sync/src/jobs/{results,standings}.ts` | 71-73 | hard-coded CLOSED/default quota policy | 🛑 BLOCKER | Replays bypass real circuit/headroom policy. |
| `apps/api/src/modules/evidence/evidence.service.ts` | 71-76 | provenance join omits payload identity | ⚠️ WARNING | Same tuple with different hashes can project the wrong receipt payload. |

### Human Verification Required After Gap Closure

### 1. Live team-evidence page

**Test:** Publish a known evidence build in PostgreSQL, open the actual team evidence route at that cutoff, and compare every rendered summary, trace, limitation, source reference, and UTC cutoff against the API response.

**Expected:** The browser displays only the selected published cutoff data, including explicit null/limited states; it never substitutes newer data.

**Why human:** Current E2E coverage intercepts the API with fixture JSON. It verifies presentation but not the live browser data path.

### Gaps Summary

The persistence and evidence fixes from plans 02-11, 02-12, and 02-15 are real and have targeted passing witnesses. The phase nevertheless misses its MVP outcome because the operator replay path is neither safe nor reliably terminal. The two root causes are (1) a state-machine/schema contradiction plus incomplete delivery/endpoint handling and (2) a missing authorization and live provider-policy boundary. These block PIPE-01, PIPE-04, PIPE-05, and PIPE-06 and therefore prevent reliance on reproducible, quota-aware history.

**Next action:** Use `$gsd-plan-phase 2 --gaps` to produce focused closure plans for the two structured gaps. The plan must include real PostgreSQL/Redis tests for both `SyncAttempt` terminal branches, terminal redelivery no-ops, partial enqueue recovery, all selectable endpoints, unauthorized proxy rejection, and live OPEN/HALF_OPEN/headroom behavior. Then rerun code review and this verification. Do not advance to Phase 3.

---

_Verified: 2026-08-31T03:16:18Z_
_Verifier: the agent (gsd-verifier)_
