---
phase: 02-historical-evidence-pipeline
verified: 2026-08-30T10:50:26Z
status: gaps_found
score: 0/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
decision_coverage:
  honored: 20
  total: 20
  not_honored: []
gaps:
  - truth: "Operators can safely preview, queue, observe, and replay failed or historical work."
    status: failed
    reason: "The production Nest replay service stores previews/statuses only in process-local Maps and reports queued=true without persisting ReplayPlan/SyncRun records or adding BullMQ jobs; the browser also sends offset-less datetime-local values rejected by the API UTC regex."
    artifacts:
      - path: "apps/api/src/modules/replay/replay.service.ts"
        issue: "queue() only updates in-memory Maps; no database or queue dependency exists."
      - path: "apps/web/app/internal/pipeline/replay/page.tsx"
        issue: "datetime-local values are submitted without conversion to explicit UTC ISO instants."
    missing:
      - "Persist previews/replay plans and versioned SyncRun rows transactionally."
      - "Enqueue deterministic BullMQ jobs and read durable status."
      - "Normalize browser timestamps to explicit UTC and exercise the real proxy/API boundary."
  - truth: "Reruns converge without duplicate facts and evidence builds can publish from complete source work."
    status: failed
    reason: "Append-only database triggers contradict both duplicate observation recovery and BUILDING-to-PUBLISHED evidence transitions. Failed and cancelled source runs are also treated as publishable."
    artifacts:
      - path: "packages/database/prisma/migrations/20260829_historical_evidence/migration.sql"
        issue: "SourceObservation and EvidenceBuild reject every UPDATE."
      - path: "workers/data-sync/src/jobs/results.ts"
        issue: "ON CONFLICT DO UPDATE is blocked by SourceObservation_append_only."
      - path: "workers/data-sync/src/jobs/standings.ts"
        issue: "ON CONFLICT DO UPDATE is blocked by SourceObservation_append_only."
      - path: "workers/data-sync/src/jobs/evidence-rebuild.ts"
        issue: "publishBuild requires an UPDATE, and isTerminal accepts FAILED/CANCELLED."
    missing:
      - "Use conflict-do-nothing plus select for immutable observation reuse."
      - "Permit only the intended BUILDING-to-PUBLISHED/FAILED state transition or model publication append-only."
      - "Publish only from SUCCEEDED, complete source runs and retain the prior build otherwise."
      - "Add real PostgreSQL witnesses for duplicate ingestion and publication transitions."
  - truth: "Historical evidence preserves exact UTC dual-time semantics at the persistence boundary."
    status: failed
    reason: "Phase-2 evidence instants are PostgreSQL TIMESTAMP(3) without time zone and Prisma DateTime fields lack @db.Timestamptz; timestamptz inputs therefore depend on the database session timezone."
    artifacts:
      - path: "packages/database/prisma/migrations/20260829_historical_evidence/migration.sql"
        issue: "observedAt, effectiveAt, cutoffs, windows, source and publication times use TIMESTAMP without time zone."
      - path: "packages/database/prisma/schema.prisma"
        issue: "Temporal evidence fields have no explicit Timestamptz native type."
    missing:
      - "Migrate evidence instants to TIMESTAMPTZ(3) and annotate Prisma fields."
      - "Prove cutoff invariance under a non-UTC PostgreSQL session timezone."
  - truth: "Configured competition history and provider recovery are correct across supported lanes and circuit states."
    status: failed
    reason: "Completed results are hardcoded to PL and their schema rejects every other allowlisted competition; HALF_OPEN ingestion bypasses the registry's single-probe lease."
    artifacts:
      - path: "packages/football-data/src/providers/football-data-org/client.ts"
        issue: "fetchCompetitionResults always requests /competitions/PL."
      - path: "packages/football-data/src/providers/football-data-org/schema.ts"
        issue: "result and standings envelopes require competition code PL."
      - path: "workers/data-sync/src/ingestion/runner.ts"
        issue: "HALF_OPEN calls proceed without acquireProbe/releaseProbe ownership."
    missing:
      - "Carry and validate requested competition codes through result/standings calls."
      - "Acquire one half-open probe lease and release it in finally."
      - "Add coverage for every configured competition and concurrent half-open workers."
  - truth: "Users can inspect honest, reproducible component values and provenance at the requested cutoff."
    status: failed
    reason: "The database cannot publish builds; additionally, unmatched provenance leaves non-null component values exposed and structured component values render as [object Object]."
    artifacts:
      - path: "apps/api/src/modules/evidence/evidence.service.ts"
        issue: "Missing source references produce [] but do not null the affected value or set MISSING_TIMESTAMP."
      - path: "apps/web/app/teams/[teamId]/evidence/page.tsx"
        issue: "Generic String(value.value) loses structured field names and units."
    missing:
      - "Fail each component closed when required provenance is absent."
      - "Use discriminated component DTOs and labelled rendering for structured values."
      - "Exercise the page through a real published PostgreSQL build, not only route stubs."
---

# Phase 2: Historical Evidence Pipeline Verification Report

**Phase Goal:** As a football analytics user, I want to inspect time-correct team evidence and request safe historical replays, so that I can rely on reproducible, quota-aware football history.
**Verified:** 2026-08-30T10:50:26Z
**Status:** gaps_found
**Re-verification:** No — initial goal-backward verification after canonical MVP goal correction

## User Flow Coverage

| Step | Expected | Evidence | Status |
|---|---|---|---|
| Open evidence from a fixture | Both teams link to an evidence page carrying kickoff as `asOf` | Fixture detail and evidence routes are present and wired; browser contract exists | ✓ VERIFIED |
| Inspect time-correct evidence | The selected cutoff shows published 5/10 form, components, trace, limitations, and provenance | UI/API projections exist, but the real migration prevents `EvidenceBuild` publication and timezone semantics are unsafe | ✗ FAILED |
| Request a safe replay | Preview a bounded window, confirm once, and observe durable work | Offset-less form timestamps are rejected; production API persists/enqueues nothing | ✗ FAILED |
| Outcome | Rely on reproducible, quota-aware football history | Core durable publication, idempotent ingestion, competition routing, and replay paths are broken | ✗ FAILED |

## Goal Achievement

### Observable Truths

| # | Roadmap truth | Status | Evidence |
|---|---|---|---|
| 1 | Upcoming fixtures, results, and standings synchronize through retryable jobs without duplicate durable facts | ✗ FAILED | Queue code exists, but result/standings duplicate recovery executes an UPDATE forbidden by the checked-in append-only trigger; result calls are hardcoded to PL. |
| 2 | Operators see degraded state and safely replay work while critical calls retain priority | ✗ FAILED | Priority policy is substantive, but replay API is process-local/no-op and HALF_OPEN workers bypass single-probe ownership. |
| 3 | Every external call is atomically reserved and facts retain raw provenance/capture time | ✗ FAILED | Reservation-before-provider wiring is present and tested, but persisted temporal instants lose explicit timezone semantics, so exact capture/effective instants are not invariant. |
| 4 | Users view recent history and weighted 5/10 form as known at a selected time | ✗ FAILED | Pure calculations and projection tests pass; the real EvidenceBuild trigger prevents publication, so the production data flow is hollow. |
| 5 | Elo/strength/goals/rest/H2H are chronological and exclude post-cutoff facts | ✗ FAILED | Pure chronological tests pass, but failed/cancelled partial runs are publishable and database cutoff instants are timezone-dependent. |

**Score:** 0/5 truths verified (0 present-but-behavior-unverified)

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `workers/data-sync/src/queues/index.ts` | Deterministic lanes and bounded delivery | ⚠️ PARTIAL | Substantive BullMQ wiring exists; downstream durable replay/status and half-open gating are incomplete. |
| `workers/data-sync/src/jobs/results.ts`, `standings.ts` | Idempotent atomic fact/provenance persistence | ✗ BROKEN | Real duplicate path conflicts with immutable observation trigger. |
| Historical evidence migration/schema | Immutable dual-time facts and publishable builds | ✗ BROKEN | TIMESTAMP lacks timezone; EvidenceBuild transition is impossible. |
| `workers/data-sync/src/jobs/evidence-rebuild.ts` | Publish complete deterministic builds only | ✗ BROKEN | FAILED/CANCELLED qualify and publication conflicts with trigger. |
| Evidence domain functions | Weighted form and chronological components | ✓ VERIFIED | Substantive pure implementations; targeted chronological tests pass. |
| Evidence API/web page | Cutoff-aware real-data projection | ⚠️ HOLLOW | Wired to Prisma/API, but no real build can reach PUBLISHED; projection integrity issues remain. |
| Replay API/web page | Durable preview/queue/status flow | ✗ BROKEN | UI/API contract mismatch and in-memory no-op queueing. |

## Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Ingestion runner | Budget → provider | reserve before `providerFactory()`/I/O | ✓ WIRED | Ordering is explicit and integration tests cover denial/convergence paths. |
| Result/standings jobs | PostgreSQL observations/facts | transaction + conflict recovery | ✗ NOT WORKING | Conflict UPDATE is rejected by the migration trigger. |
| Source runs | Evidence publication | BUILDING → stage → PUBLISHED | ✗ NOT WORKING | Trigger rejects the required update; failed/cancelled states are accepted. |
| Replay UI | Replay API | Next proxy POST | ✗ NOT WORKING | `datetime-local` payload fails UTC regex. |
| Replay API | PostgreSQL/BullMQ | persist plan/run + enqueue | ✗ NOT WIRED | No Prisma or BullMQ dependency/call in `ReplayService`. |
| Evidence page | Nest evidence API → Prisma | no-store fetch and published build query | ⚠️ HOLLOW | Fetch/query wiring exists, but production publication cannot create a visible build. |

## Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces real usable data | Status |
|---|---|---|---|---|
| Team evidence page | evidence components/trace | Next fetch → Nest → Prisma `EvidenceBuild(PUBLISHED)` | No, publication transition is database-blocked | ✗ DISCONNECTED |
| Replay workspace | preview/queue/status | Browser → proxy → Nest in-memory Maps | Preview is ephemeral; queue has no worker/durable effect | ⚠️ STATIC |
| Result history | observation/result versions | provider → reservation → transaction | First insert can persist; identical rerun fails at trigger | ✗ BROKEN |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Chronological calculations, worker replay contract, evidence API projection | `node node_modules/vitest/vitest.mjs run tests/unit/chronological-features.test.ts tests/integration/replay.test.ts tests/integration/evidence-api.test.ts` | 3 files, 16 tests passed in 5.52s | ✓ PASS, but mocks/in-memory boundaries do not cover the production failures above |
| Initial standard command | `pnpm exec vitest run ...` | Failed: `vitest` executable shim not recognized | ℹ️ ENVIRONMENT |
| Real PostgreSQL publication/duplicate replay | No named test exercises the checked-in trigger with these production methods | Missing behavioral witness | ✗ FAIL |

## Probe Execution

No Phase-2 probe scripts are declared. Verification used code inspection plus named behavioral tests.

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| PIPE-01 | ✗ BLOCKED | Retry queues exist, but duplicate observation ingestion fails and multi-competition result sync is hardcoded to PL. |
| PIPE-02 | ✗ BLOCKED | Raw payload/hash/linkage exist, but exact capture-time auditability is not timezone invariant. |
| PIPE-03 | ✓ SATISFIED | Capability/circuit/policy/cache precede atomic reservation; provider construction and I/O follow reservation. |
| PIPE-04 | ✓ SATISFIED | Durable lane policy/headroom keeps fixture/result calls above lower-priority work; tests cover concurrency and configured allowance. |
| PIPE-05 | ✗ BLOCKED | Bounded retries/circuit registry exist, but HALF_OPEN ownership is not enforced through ingestion and durable/operator projection is incomplete. |
| PIPE-06 | ✗ BLOCKED | Production replay reports success without durable plan/run creation or BullMQ enqueue; duplicate fact path is broken. |
| PIPE-07 | ✗ BLOCKED | UI and pure 5/10 functions exist, but no build can become published in the real database. |
| PIPE-08 | ✗ BLOCKED | Pure feature tests pass, but failed/cancelled source windows may publish and persistence can shift cutoff instants. |

No additional Phase-2 requirements are orphaned from plans. REQUIREMENTS.md still labels PIPE-01..08 Pending, consistent with this failed verification.

### Decision Coverage

`check.decision-coverage-verify` found textual artifact coverage for all 20 decisions (20/20). This is advisory only; actual runtime contradictions to D-02, D-13, D-14, D-15, D-16, D-19, and D-20 are documented above.

## Test Quality Audit

| Test set | Linked requirements | Disabled | Circular | Strongest assertion | Verdict |
|---|---|---:|---:|---|---|
| Chronological unit tests | PIPE-07/08 | 0 | 0 | Value/property invariants | PASS for pure functions |
| Ingestion/replay integration tests | PIPE-01..06 | 0 | 0 | Behavioral with injected/in-memory boundaries | INSUFFICIENT for checked-in DB/API wiring |
| Evidence/replay E2E | PIPE-05..08 | 0 | 0 | User-flow assertions against route stubs | WARNING — stubs accept payloads the production API rejects and cannot prove durable enqueue/publication |

**Disabled tests on requirements:** 0  
**Circular patterns detected:** 0  
**Insufficient production-boundary assertions:** 4 — duplicate immutable observation, EvidenceBuild transition, real replay enqueue/status, and browser timestamp payload.

## Anti-Patterns Found

No unreferenced `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, placeholder UI, or disabled requirement tests were found. The blocking problems are substantive correctness and wiring defects, not visible debt markers.

## Prohibition Review

The three Plan 02-01 prohibitions remain non-authoritative LLM-judgment items and are not silently passed:

- No automatic wagering/certainty/hidden-risk surface was found in Phase-2 files, but final responsible-copy judgment remains human.
- Missing evidence is intended to remain null, but the API currently preserves computed values when provenance is missing; this prohibition is not satisfied.
- Redis/BullMQ is not the historical source of truth, but the production replay API currently substitutes ephemeral Maps for the durable operational ledger; human review is recommended after repair.

## Human Verification Required After Gap Closure

### Responsive evidence hierarchy

**Test:** Inspect representative full, limited, pending, and unavailable evidence at 320/768/1440px and 200% zoom.  
**Expected:** Cutoff, sample sizes, provenance, limitations, components, and trace remain readable without page-level horizontal scroll.  
**Why human:** `02-VALIDATION.md` explicitly defers final dense-data visual hierarchy judgment.

Automated gaps take precedence, so the canonical overall status remains `gaps_found` rather than `human_needed`.

## Deferred Item Filter

No gap is deferred. Phase 3 consumes trustworthy Phase-2 evidence; Phase 5 adds provider breadth/fallback but does not repair Phase-2's allowlisted competition routing, durable replay, publication, or dual-time correctness contract.

## Gaps Summary and Next Action

Five grouped blockers prevent the phase goal: replay is a false-success no-op; immutable triggers contradict idempotent ingestion and publication; timestamps violate exact dual-time semantics; competition/circuit behavior is incomplete; and the user evidence projection is hollow/unsafe at the real production boundary.

**Next action:** run `$gsd-plan-phase 2 --gaps`, implement the structured gaps above, add real PostgreSQL/Redis/proxy integration witnesses, rerun code review, then rerun Phase-2 verification. Do not advance to Phase 3 because it depends on reproducible Phase-2 evidence.

---

_Verified: 2026-08-30T10:50:26Z_  
_Verifier: gsd-verifier_
