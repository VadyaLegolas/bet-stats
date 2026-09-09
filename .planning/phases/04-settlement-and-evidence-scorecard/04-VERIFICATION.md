---
phase: 04-settlement-and-evidence-scorecard
verified: 2026-09-09T03:45:11Z
status: gaps_found
score: 7/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "EVAL-06: Backtests and model comparisons use chronological rolling-origin evaluation and the production-equivalent as-of feature contract."
    status: failed
    reason: "Chronology and forecast-path parity exist, but the backtest runner is not wired into a production queue/consumer or durable repository, and every completed window records an empty scoreIds array. It therefore creates forecasts but does not perform the scored evaluation or model comparison required by EVAL-06."
    artifacts:
      - path: "workers/data-sync/src/jobs/backtests.ts"
        issue: "createBacktestJob/runBacktestPlan are referenced only by tests; main.ts and queues/index.ts register no backtest worker or queue. Line 75 always persists scoreIds: []."
      - path: "packages/database/prisma/schema.prisma"
        issue: "BacktestPlan/BacktestWindow tables exist, but no production BacktestReceiptRepository implementation reads or writes them."
    missing:
      - "Implement and export a database-backed BacktestReceiptRepository for BacktestPlan and BacktestWindow."
      - "Register a bounded BullMQ backtest queue and consumer in the data-sync worker composition root."
      - "Settle/score each completed backtest forecast against the eligible historical result and persist non-empty score IDs, then expose comparison-ready aggregates."
      - "Add a PostgreSQL integration witness that invokes the production worker path and proves persisted scored rolling-origin results and model comparison output."
---

# Phase 4: Settlement and Evidence Scorecard Verification Report

**Phase Goal:** As a user, I want to review settled frozen forecasts, so that I can judge predictive and financial quality.
**Verified:** 2026-09-09T03:45:11Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## User Flow Coverage

| Step | Expected | Evidence | Status |
|---|---|---|---|
| Open scorecards | Protected `/scorecards` route loads an exact cohort | `apps/web/app/scorecards/page.tsx`; production Chromium journey | ✓ |
| Review predictive evidence | Health, sample sizes, Brier, Log Loss and reliability are rendered from the API | `evaluation.service.ts`, `scorecard-dashboard.tsx`; API/DOM parity E2E | ✓ |
| Review financial evidence | Candidate ledger, one-unit P/L, ROI/Yield and CLV state are visible | `/evaluation/value-candidates`; production Chromium pagination/reconciliation | ✓ |
| Judge quality | User can judge settled production forecasts without unsupported claims | Health-first states, denominators and responsible-use copy verified | ✓ |

The interactive scorecard flow is complete. The separate rolling-origin evaluation contract is not production-complete; see EVAL-06 below.

## Goal Achievement

### Observable Truths / Requirements

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | EVAL-01: all result lifecycle states resolve under explicit versioned rules | ✓ VERIFIED | `settlement.ts` closed policy; PostgreSQL security matrix and settlement suites passed. |
| 2 | EVAL-02: only the exact frozen eligible pre-match forecast is scored | ✓ VERIFIED | Exact caller-supplied ID, kind/state/cutoff checks; hostile mismatch tests and source-bound DB guards passed. |
| 3 | EVAL-03: Brier and Log Loss are visible by exact cohort with sample size | ✓ VERIFIED | Versioned formulas and immutable ForecastScore facts flow through guarded API to DOM; API/DOM parity passed. |
| 4 | EVAL-04: reliability buckets expose calibration direction | ✓ VERIFIED | Deterministic buckets, counts, means, observed frequency and direction; unit, integration and accessible-table E2E passed. |
| 5 | EVAL-05: frozen value candidates expose per-result and aggregate flat-unit performance | ✓ VERIFIED | Immutable ValueSettlement facts, cursor ledger and aggregate reconciliation passed in PostgreSQL and Chromium. |
| 6 | EVAL-06: backtests/model comparisons execute chronological production-equivalent evaluation | ✗ FAILED | Shared forecast path and leakage checks pass, but there is no production backtest worker/repository and `runBacktestPlan` completes with `scoreIds: []`. |
| 7 | EVAL-07: weak/empty cohorts suppress or label claims | ✓ VERIFIED | Versioned cohort gate plus exact UNAVAILABLE/LIMITED/AVAILABLE states; no filter broadening in E2E. |
| 8 | EVAL-08: CLV is fail-closed without comparable timestamped prices | ✓ VERIFIED | Exact tuple/timestamp rules, persisted unavailable reasons and UI unavailable state passed. |

**Score:** 7/8 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/domain/src/evaluation/*` | Versioned settlement, scoring, reliability, financial, CLV and backtest contracts | ✓ VERIFIED | Substantive, exported, and covered by value/behavior assertions. |
| Phase 4 Prisma schema and migrations | Append-only receipts/facts with source guards | ✓ VERIFIED | Fresh PostgreSQL migration and hostile-write matrix passed. |
| `packages/database/src/evaluation/settlement-pipeline.ts` | Result-to-settlement-to-score/value application service | ✓ VERIFIED | Wired from result publication through BullMQ settlement consumer; retries/corrections tested. |
| `apps/api/src/modules/evaluation/*` | Guarded canonical scorecard and ledger APIs | ✓ VERIFIED | Module wired into AppModule; private/no-store responses; real Prisma queries. |
| `apps/web/app/scorecards/*` | Health-first evidence dashboard | ✓ VERIFIED | Server fetch → rendered metrics/buckets/ledger; production Chromium passed. |
| `workers/data-sync/src/jobs/backtests.ts` plus Backtest tables | Durable production rolling-origin evaluator | ✗ PARTIAL | Pure runner exists, but production registration/repository/scoring are absent. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Result publication | Settlement facts | deterministic settlement queue → database pipeline | ✓ WIRED | `results.ts` enqueues; `main.ts` registers consumer/service. |
| SettlementReceipt | ForecastScore / ValueSettlement | transactional append-only pipeline | ✓ WIRED | Source IDs and supersession lineage verified against PostgreSQL. |
| Scorecard page | Evaluation API | no-store server fetch | ✓ WIRED | Real Nest/Next/PostgreSQL E2E passed. |
| API aggregates | Visible dashboard | DTO → health/metric/table/ledger render | ✓ WIRED | Exact API/DOM counts and totals reconciled. |
| Backtest plan | Durable evaluated backtest | worker queue → repository → score facts | ✗ NOT_WIRED | No production queue/consumer/repository; empty `scoreIds`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Scorecard dashboard | health, denominators, metrics, buckets, financial, CLV | Next fetch → Nest EvaluationService → Prisma leaf facts | Yes | ✓ FLOWING |
| Candidate ledger | items/pageTotals/cursor | Nest API → Prisma ValueSettlement joins | Yes | ✓ FLOWING |
| Backtest window receipt | forecastSnapshotId / scoreIds | in-memory interface callback only | Forecast yes; scores always empty | ✗ DISCONNECTED evaluation output |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Phase 4 domain/UI contracts | `vitest` on five Phase 4 unit files | 53/53 passed | ✓ PASS |
| PostgreSQL threat and invariant matrix | `vitest tests/integration/phase-04-security.test.ts` | 4/4 passed | ✓ PASS |
| Phase-specific integration suites | seven settlement/scoring/reliability/value/backtest/API/pipeline files | 25/25 passed | ✓ PASS |
| Production scorecard journey | `playwright test tests/e2e/evidence-scorecard.spec.ts --project=chromium` | 3/3 passed | ✓ PASS |
| Workspace type safety | `pnpm typecheck` | 7/7 packages passed; Node 25 vs declared Node 24 warning only | ✓ PASS |

### Test Quality Audit

| Test Area | Linked Req | Active | Skipped | Circular | Assertion Level | Verdict |
|---|---|---:|---:|---:|---|---|
| Settlement/security | EVAL-01,02 | active | 0 | 0 | Behavioral + PostgreSQL rejection | Strong |
| Scores/reliability | EVAL-03,04,07 | active | 0 | 0 | Golden values + aggregate parity | Strong |
| Financial/CLV | EVAL-05,08 | active | 0 | 0 | Exact Decimal values + reason codes | Strong |
| Rolling origin | EVAL-06 | active | 0 | 0 | Call-trace/identity parity only | Insufficient for production scored backtest |
| Browser acceptance | EVAL-03,04,05,07,08 | active | 0 | 0 | Real API/DOM behavior | Strong |

**Disabled requirement tests:** 0. **Circular patterns:** 0. The EVAL-06 tests prove helper parity and rejection rules but do not prove a production consumer or scored/comparable backtest result.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `workers/data-sync/src/jobs/backtests.ts` | 75 | Completed window is written with `scoreIds: []` | 🛑 Blocker | Backtest produces an immutable forecast but no evaluated score or comparison evidence. |

No unreferenced TBD/FIXME/XXX markers, disabled requirement tests, placeholder UI, or hardcoded empty production scorecard data were found.

### Decision Coverage

All 12 trackable CONTEXT.md decisions are honored by shipped artifacts according to `check.decision-coverage-verify`. This warning-only heuristic does not override the concrete EVAL-06 wiring gap.

### Human Verification Required

None. The user-visible flow, mobile hierarchy and keyboard-accessible disclosure were exercised in production Chromium.

### Gaps Summary

Settlement, proper scores, reliability, financial evidence, CLV gating and the user-facing scorecard are substantively implemented and independently pass their behavioral checks. The phase cannot pass yet because the planned rolling-origin path stops at forecast creation: it has no production queue/repository wiring and stores no score facts, so it cannot deliver durable evaluated backtests or model comparisons.

The gap is not explicitly deferred by Phase 5 or Phase 6 roadmap criteria.

---

_Verified: 2026-09-09T03:45:11Z_
_Verifier: the agent (gsd-verifier)_
