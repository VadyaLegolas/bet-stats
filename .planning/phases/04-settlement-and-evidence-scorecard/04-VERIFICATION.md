---
phase: 04-settlement-and-evidence-scorecard
verified: 2026-09-09T09:03:30Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 7/8
  gaps_closed:
    - "EVAL-06 now has durable PostgreSQL receipts, bounded BullMQ production execution, non-empty scored correction lineage and matched model comparison."
  gaps_remaining: []
  regressions: []
---

# Phase 4: Settlement and Evidence Scorecard Verification Report

**Phase Goal:** As a user, I want to review settled frozen forecasts, so that I can judge predictive and financial quality.
**Verified:** 2026-09-09T09:03:30Z
**Status:** passed
**Re-verification:** Yes — after EVAL-06 gap closure

## User Flow Coverage

| Step | Expected | Evidence | Status |
|---|---|---|---|
| Open scorecards | Protected `/scorecards` route loads an exact cohort | `apps/web/app/scorecards/page.tsx`; production Chromium journey | ✓ |
| Review predictive evidence | Health, sample sizes, Brier, Log Loss and reliability are rendered from the API | `evaluation.service.ts`, `scorecard-dashboard.tsx`; API/DOM parity E2E | ✓ |
| Review financial evidence | Candidate ledger, one-unit P/L, ROI/Yield and CLV state are visible | `/evaluation/value-candidates`; production Chromium pagination/reconciliation | ✓ |
| Judge quality | User can judge settled production forecasts without unsupported claims | Health-first states, denominators and responsible-use copy verified | ✓ |

The interactive scorecard flow and the separate scored rolling-origin evaluation path are complete.

## Goal Achievement

### Observable Truths / Requirements

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | EVAL-01: all result lifecycle states resolve under explicit versioned rules | ✓ VERIFIED | `settlement.ts` closed policy; PostgreSQL security matrix and settlement suites passed. |
| 2 | EVAL-02: only the exact frozen eligible pre-match forecast is scored | ✓ VERIFIED | Exact caller-supplied ID, kind/state/cutoff checks; hostile mismatch tests and source-bound DB guards passed. |
| 3 | EVAL-03: Brier and Log Loss are visible by exact cohort with sample size | ✓ VERIFIED | Versioned formulas and immutable ForecastScore facts flow through guarded API to DOM; API/DOM parity passed. |
| 4 | EVAL-04: reliability buckets expose calibration direction | ✓ VERIFIED | Deterministic buckets, counts, means, observed frequency and direction; unit, integration and accessible-table E2E passed. |
| 5 | EVAL-05: frozen value candidates expose per-result and aggregate flat-unit performance | ✓ VERIFIED | Immutable ValueSettlement facts, cursor ledger and aggregate reconciliation passed in PostgreSQL and Chromium. |
| 6 | EVAL-06: backtests/model comparisons execute chronological production-equivalent evaluation | ✓ VERIFIED | Plan 04-09 adds durable PostgreSQL admission/evaluation receipts, shared production forecast repository, bounded BullMQ queue/consumer, exact `evaluationAsOf` result resolution, non-empty score lineage, correction revisions and matched comparison. Fresh PostgreSQL+Redis suites passed 7/7. |
| 7 | EVAL-07: weak/empty cohorts suppress or label claims | ✓ VERIFIED | Versioned cohort gate plus exact UNAVAILABLE/LIMITED/AVAILABLE states; no filter broadening in E2E. |
| 8 | EVAL-08: CLV is fail-closed without comparable timestamped prices | ✓ VERIFIED | Exact tuple/timestamp rules, persisted unavailable reasons and UI unavailable state passed. |

**Score:** 8/8 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/domain/src/evaluation/*` | Versioned settlement, scoring, reliability, financial, CLV and backtest contracts | ✓ VERIFIED | Substantive, exported, and covered by value/behavior assertions. |
| Phase 4 Prisma schema and migrations | Append-only receipts/facts with source guards | ✓ VERIFIED | Fresh PostgreSQL migration and hostile-write matrix passed. |
| `packages/database/src/evaluation/settlement-pipeline.ts` | Result-to-settlement-to-score/value application service | ✓ VERIFIED | Wired from result publication through BullMQ settlement consumer; retries/corrections tested. |
| `apps/api/src/modules/evaluation/*` | Guarded canonical scorecard and ledger APIs | ✓ VERIFIED | Module wired into AppModule; private/no-store responses; real Prisma queries. |
| `apps/web/app/scorecards/*` | Health-first evidence dashboard | ✓ VERIFIED | Server fetch → rendered metrics/buckets/ledger; production Chromium passed. |
| `workers/data-sync/src/jobs/backtests.ts` plus Backtest tables | Durable production rolling-origin evaluator | ✓ VERIFIED | Database-backed repository, compact hash-verified queue payload, production consumer and non-empty score enforcement are wired and tested. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Result publication | Settlement facts | deterministic settlement queue → database pipeline | ✓ WIRED | `results.ts` enqueues; `main.ts` registers consumer/service. |
| SettlementReceipt | ForecastScore / ValueSettlement | transactional append-only pipeline | ✓ WIRED | Source IDs and supersession lineage verified against PostgreSQL. |
| Scorecard page | Evaluation API | no-store server fetch | ✓ WIRED | Real Nest/Next/PostgreSQL E2E passed. |
| API aggregates | Visible dashboard | DTO → health/metric/table/ledger render | ✓ WIRED | Exact API/DOM counts and totals reconciled. |
| Backtest plan | Durable evaluated backtest | worker queue → repository → score facts | ✓ WIRED | `main.ts` composes shared forecast/settlement repositories with the backtest worker; correction leaves and comparisons consume persisted non-empty score IDs. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Scorecard dashboard | health, denominators, metrics, buckets, financial, CLV | Next fetch → Nest EvaluationService → Prisma leaf facts | Yes | ✓ FLOWING |
| Candidate ledger | items/pageTotals/cursor | Nest API → Prisma ValueSettlement joins | Yes | ✓ FLOWING |
| Backtest window/evaluation receipts | forecastSnapshotId / resultVersionId / settlementReceiptId / scoreIds | BullMQ → shared forecast repository → settlement pipeline → PostgreSQL evaluation revision | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Phase 4 domain/UI contracts | `vitest` on five Phase 4 unit files | 53/53 passed | ✓ PASS |
| PostgreSQL threat and invariant matrix | `vitest tests/integration/phase-04-security.test.ts` | 4/4 passed | ✓ PASS |
| Phase-specific integration suites | seven settlement/scoring/reliability/value/backtest/API/pipeline files | 25/25 passed | ✓ PASS |
| Production scorecard journey | `playwright test tests/e2e/evidence-scorecard.spec.ts --project=chromium` | 3/3 passed | ✓ PASS |
| Workspace type safety | `pnpm typecheck` | 7/7 packages passed; Node 25 vs declared Node 24 warning only | ✓ PASS |
| Scored production backtests | `vitest` on `backtest-production.test.ts` and `backtest-origin.test.ts` | 7/7 passed with fresh PostgreSQL 18 and Redis 8 | ✓ PASS |

### Test Quality Audit

| Test Area | Linked Req | Active | Skipped | Circular | Assertion Level | Verdict |
|---|---|---:|---:|---:|---|---|
| Settlement/security | EVAL-01,02 | active | 0 | 0 | Behavioral + PostgreSQL rejection | Strong |
| Scores/reliability | EVAL-03,04,07 | active | 0 | 0 | Golden values + aggregate parity | Strong |
| Financial/CLV | EVAL-05,08 | active | 0 | 0 | Exact Decimal values + reason codes | Strong |
| Rolling origin | EVAL-06 | active | 0 | 0 | Real Redis delivery + PostgreSQL score/correction/comparison behavior | Strong |
| Browser acceptance | EVAL-03,04,05,07,08 | active | 0 | 0 | Real API/DOM behavior | Strong |

**Disabled requirement tests:** 0. **Circular patterns:** 0. EVAL-06 is proven through both shared-orchestrator parity tests and a real Redis/PostgreSQL production-path integration suite.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| — | — | No blocking debt, stub or hollow data-flow pattern found | — | — |

No unreferenced TBD/FIXME/XXX markers, disabled requirement tests, placeholder UI, or hardcoded empty production scorecard data were found.

### Decision Coverage

All 12 trackable CONTEXT.md decisions are honored by shipped artifacts according to `check.decision-coverage-verify`.

### Human Verification Required

None. The user-visible flow, mobile hierarchy and keyboard-accessible disclosure were exercised in production Chromium.

### Gaps Summary

All eight EVAL requirements are substantively implemented and wired. The original EVAL-06 gap is closed by Plan 04-09: admitted chronological plans persist before enqueue, consumers load hash-matched plans, forecasts use the shared production as-of repository, exact historical result leaves are selected at `evaluationAsOf`, score IDs are required non-empty, corrections append audit revisions, and compatible completed plans yield denominator-bearing Brier/Log Loss comparisons without superiority claims.

No actionable or deferred gaps remain.

---

_Verified: 2026-09-09T09:03:30Z_
_Verifier: the agent (gsd-verifier)_
