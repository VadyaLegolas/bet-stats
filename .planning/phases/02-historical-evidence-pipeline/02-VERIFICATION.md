---
phase: 02-historical-evidence-pipeline
verified: 2026-09-01T09:05:00+02:00
status: gaps_found
score: 0/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
requirements:
  PIPE-01: blocked
  PIPE-02: blocked
  PIPE-03: satisfied
  PIPE-04: satisfied
  PIPE-05: satisfied
  PIPE-06: blocked
  PIPE-07: blocked
  PIPE-08: blocked
decision_coverage: { honored: 20, total: 20, not_honored: [] }
re_verification:
  previous_status: gaps_found
  previous_score: 2/5
  gaps_closed:
    - "Guarded replay attempts, terminal redelivery no-ops, durable delivery recovery, live policy gating, FIXTURES dispatch, ingress authorization, payload identity, and a non-intercepted browser witness now exist."
  gaps_remaining:
    - "Evidence rebuild is not scoped to the requested team."
    - "Fixture replay remains hard-coded to the Premier League endpoint."
    - "Fresh-preview replay confirmation is not idempotent by logical key."
    - "Expected API validation errors are plain Error instances."
    - "Malformed persisted receipts are silently rewritten."
  regressions: []
gaps:
  - truth: "Upcoming fixtures, completed results, and standings synchronize correctly through retryable jobs."
    status: failed
    reason: "FIXTURES replay accepts seven competitions but always calls the PL-only endpoint; non-PL replay can complete with zero fixtures."
    artifacts:
      - path: "workers/data-sync/src/jobs/fixtures.ts"
        issue: "Calls fetchPremierLeagueFixtures() and filters the PL response afterward."
      - path: "packages/football-data/src/providers/football-data-org/client.ts"
        issue: "Fixture URL is hard-coded to /competitions/PL/matches."
    missing:
      - "Use a competition-parameterized fixture request and fail classified on mismatch."
  - truth: "An operator can replay failed or historical work idempotently."
    status: failed
    reason: "A fresh preview for an existing logical input gets revision 1 again when newRevision is false, violating ReplayPlan(logicalKey, revision) uniqueness."
    artifacts:
      - path: "apps/api/src/modules/replay/replay.service.ts"
        issue: "Duplicate lookup is previewId-scoped, not logicalKey-scoped."
    missing:
      - "Return the existing logical-key plan under the advisory lock and add a fresh-preview idempotency test."
  - truth: "Published evidence retains exact immutable source provenance."
    status: failed
    reason: "Evidence projection filters malformed receipt inputs and casts the altered receipt as valid."
    artifacts:
      - path: "apps/api/src/modules/evidence/evidence.service.ts"
        issue: "asReceipt uses candidate.inputs.filter(isEvidenceSourceRef) instead of strict atomic validation."
    missing:
      - "Reject the whole malformed receipt into null/LIMITED and test mixed valid/malformed inputs."
  - truth: "A user can inspect correct team history and chronological derived features."
    status: failed
    reason: "Evidence SQL filters only by cutoff, not teamId; unrelated fixtures are folded as away matches for the requested team."
    artifacts:
      - path: "workers/data-sync/src/jobs/evidence-rebuild.ts"
        issue: "No homeTeamId/awayTeamId predicate and only cutoff is bound."
    missing:
      - "Filter by requested team before ranking, bind teamId, and add a two-team publication test."
  - truth: "Replay and evidence validation failures are safe client errors."
    status: failed
    reason: "Validation helpers return plain Error objects; Nest maps these paths to HTTP 500."
    artifacts:
      - path: "apps/api/src/modules/replay/replay.service.ts"
        issue: "replayError is not an HttpException."
      - path: "apps/api/src/modules/evidence/evidence.service.ts"
        issue: "contractError is not an HttpException."
    missing:
      - "Map validation codes to disclosure-safe Nest HttpException responses and add real HTTP tests."
---

# Phase 2: Historical Evidence Pipeline Verification Report

**Phase Goal:** As a football analytics user, I want to inspect time-correct team evidence and request safe historical replays, so that I can rely on reproducible, quota-aware football history.
**Verified:** 2026-09-01T09:05:00+02:00
**Status:** gaps_found
**Re-verification:** Yes — after plans 02-16 through 02-22

## User Flow Coverage

| Step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Open evidence at a cutoff | Selected-team evidence crosses PostgreSQL → Nest → Next → browser | Live Playwright passes, but rebuild SQL is not team-scoped | ✗ FAILED |
| Inspect reproducible evidence | Components retain the exact immutable receipt | Payload identity is exact, but malformed receipt inputs are silently dropped | ✗ FAILED |
| Preview and confirm replay | Equivalent work queues once | Same-preview duplicate works; fresh equivalent preview collides on revision 1 | ✗ FAILED |
| Correct invalid input | Invalid input produces actionable client errors | Plain `Error` reaches Nest's HTTP 500 handler | ✗ FAILED |
| Outcome | User can rely on reproducible, quota-aware history | Budget/circuit and browser plumbing work, but data correctness and replay safety fail | ✗ FAILED |

## Goal Achievement

### Observable Truths

| # | Roadmap truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Upcoming fixtures, completed results, and standings synchronize through retryable jobs without duplicating durable facts. | ✗ FAILED | Fixture replay always calls PL (`fixtures.ts:76`, `client.ts:27-34`) even when other competitions are accepted. |
| 2 | Operator sees degraded state and safely replays work while critical calls retain priority. | ✗ FAILED | Policy/headroom and gateway are wired, but fresh-preview confirmation violates logical-key idempotency (`replay.service.ts:130-132`). |
| 3 | Calls reserve budget atomically and facts retain provenance/capture time. | ✗ FAILED | Reservation-first is proven; the conjunctive truth fails because `asReceipt` rewrites malformed provenance (`evidence.service.ts:52-57`). |
| 4 | User views recent team history plus 5/10 weighted form at a selected time. | ✗ FAILED | Browser wiring passes, but unrelated fixtures are included and treated as away matches. |
| 5 | Elo, strengths, goal rates, rest days and H2H are chronological and cutoff-safe. | ✗ FAILED | Cutoff ordering passes, but every feature can be computed from unrelated teams. |

**Score:** 0/5 truths verified. Each roadmap criterion is conjunctive and has an observable blocker.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `workers/data-sync/src/jobs/{fixtures,results,standings}.ts` | Retryable reservation-first multi-competition sync | ⚠️ PARTIAL | Results/standings parameterize competition; fixtures is PL-only. |
| Replay queue/delivery/attempt modules | Durable lifecycle and recovery | ✓ VERIFIED | Guarded terminal transitions, redelivery no-ops and delivery recovery are substantive and tested. |
| Durable replay policy modules | Circuit/headroom/degraded-state enforcement | ✓ VERIFIED | API and all replay handlers consume versioned durable policy. |
| `workers/data-sync/src/jobs/evidence-rebuild.ts` | Team-scoped dual-time publication | ✗ BROKEN | Cutoff is bound; teamId is not a SQL predicate or parameter. |
| `apps/api/src/modules/evidence/evidence.service.ts` | Strict provenance projection | ✗ PARTIAL | Exact payload join exists; receipt parsing is lossy. |
| Live Next/Nest evidence path | Real browser cutoff rendering | ✓ VERIFIED | Independent Playwright stack passed 2/2 and cleaned its container. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| Provider call | Atomic reservation | ingestion policy | ✓ WIRED | Denial occurs before provider creation/I/O. |
| Fixture replay input | Competition endpoint | fixture provider | ✗ NOT WIRED | Only `fetchPremierLeagueFixtures()` exists. |
| Requested team | Result query | `loadEligibleMatches` | ✗ NOT WIRED | Adapter supplies only cutoff. |
| Replay logical key | Existing ReplayPlan | queue transaction | ✗ PARTIAL | Existing plan is checked by previewId only. |
| Stored receipt | API projection | `asReceipt` | ✗ UNSAFE | Invalid entries are removed instead of invalidating the receipt. |
| EvidenceBuild | Nest → Next → Chromium | live Playwright | ✓ WIRED | Non-intercepted 2/2 pass. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Status |
| --- | --- | --- | --- |
| Evidence rebuild | `matches` | ResultVersion + Fixture + SourceObservation | ✗ real but wrong scope |
| Receipt projection | `receipt.inputs` | persisted receipt component | ✗ real but silently transformed |
| Browser evidence | summaries/trace/receipt | PostgreSQL → Nest → Next | ✓ flowing for seeded data |
| Replay status | policy/delivery/execution | durable policy + ReplayDelivery + SyncRun/Attempt | ✓ flowing |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Chronology and weighted form | `node node_modules/vitest/vitest.mjs run tests/unit/chronological-features.test.ts tests/unit/form.test.ts --project unit` | 11 passed | ✓ PASS |
| Evidence API/publication | `node node_modules/vitest/vitest.mjs run tests/integration/evidence-api.test.ts tests/integration/evidence-publication.test.ts --project integration` | 13 passed | ✓ PASS, but missing unrelated-team and mixed-malformed-receipt cases |
| Live evidence user flow | `node node_modules/@playwright/test/cli.js test --config playwright.live-evidence.config.ts tests/e2e/team-evidence-live.spec.ts --project=chromium` | 2 passed | ✓ PASS |
| Harness cleanup | `docker ps -a --filter name=bet-stats-live-evidence-` | no rows | ✓ PASS |

### Probe Execution

No Phase-02 `probe-*.sh` is declared or present. N/A.

### Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| PIPE-01 | ✗ BLOCKED | Non-PL fixture replay calls PL and can false-succeed. |
| PIPE-02 | ✗ BLOCKED | Storage is immutable, but malformed receipt projection rewrites provenance. |
| PIPE-03 | ✓ SATISFIED | Atomic provider/date/endpoint reservation precedes provider I/O. |
| PIPE-04 | ✓ SATISFIED | Durable policy enforces critical headroom before I/O. |
| PIPE-05 | ✓ SATISFIED | Bounded retry/backoff, guarded attempts, circuits and classified status are wired. |
| PIPE-06 | ✗ BLOCKED | Fresh-preview idempotency, non-PL fixture behavior and HTTP validation fail. |
| PIPE-07 | ✗ BLOCKED | Live UI works, but underlying evidence includes unrelated fixtures. |
| PIPE-08 | ✗ BLOCKED | Dual-time ordering works, but derived features use a non-team-scoped set. |

All PIPE-01 through PIPE-08 are claimed by Phase-02 plans; no orphaned requirements were found.

### Test Quality Audit

| Test file | Linked req | Active | Skipped | Circular | Level | Verdict |
| --- | --- | ---: | ---: | --- | --- | --- |
| `tests/integration/replay.test.ts` | PIPE-03/04/05/06 | 13 | 0 | No | Behavioral | WARNING — no fresh-preview same-logical-key test. |
| `tests/integration/evidence-publication.test.ts` | PIPE-02/07/08 | 2 | 0 | No | Behavioral | WARNING — one fixture/team cannot expose cross-team contamination. |
| `tests/integration/evidence-api.test.ts` | PIPE-02/07/08 | 5 | 0 | No | Value/behavioral | WARNING — no mixed valid/malformed receipt test. |
| `tests/e2e/team-evidence-live.spec.ts` | PIPE-07/08 | 2 | 0 | No | Browser behavioral | PASS for live wiring/cutoff; seed does not prove team isolation. |

Disabled requirement tests: 0. Circular expected-value generation: 0. Green suites miss exactly the three adversarial cases above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | ---: | --- | --- | --- |
| `workers/data-sync/src/jobs/evidence-rebuild.ts` | 14, 83 | cutoff-only SQL; teamId not bound | 🛑 BLOCKER | Cross-team evidence contamination. |
| `workers/data-sync/src/jobs/fixtures.ts` | 76 | PL-only call behind multi-competition replay | 🛑 BLOCKER | Empty false-success outside PL. |
| `apps/api/src/modules/replay/replay.service.ts` | 130-132 | ordinary fresh preview forces revision 1 | 🛑 BLOCKER | Logical replay uniqueness failure. |
| `apps/api/src/modules/replay/replay.service.ts` | 46 | plain Error as status carrier | 🛑 BLOCKER | Validation becomes HTTP 500. |
| `apps/api/src/modules/evidence/evidence.service.ts` | 41-56 | plain Error and lossy receipt filter | 🛑 BLOCKER | Misclassified input and rewritten provenance. |

No unreferenced `TBD`, `FIXME`, `XXX` markers or skipped requirement-linked tests were found.

### Decision Coverage

All 20 trackable `02-CONTEXT.md` decisions are honored by shipped artifacts (non-blocking gate).

### Human Verification Required

None now. The previously unverified live browser path has a passing independent witness. Code defects must be fixed before further UAT.

### Deferred Items

None. Phase 3 depends on trustworthy Phase-2 evidence and does not own these gaps.

### Gaps Summary

Phase 02 must not advance. The delivery ledger, circuit policy, gateway, payload-identity join and live browser gate are genuine closures, but five shipping blockers remain. Most severe: a visually correct page can display chronologically valid data derived from unrelated teams. Fixture replay also false-succeeds outside PL, replay idempotency breaks across equivalent previews, client validation becomes 500, and malformed provenance is silently rewritten.

Structured gaps are in frontmatter for `$gsd-plan-phase 2 --gaps`.

---

_Verified: 2026-09-01T09:05:00+02:00_
_Verifier: the agent (gsd-verifier)_
