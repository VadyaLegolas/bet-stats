# Architecture Research

**Domain:** Football prediction & value-betting platform — integration architecture for v1.1 milestone (10 features)
**Researched:** 2026-10-19
**Confidence:** HIGH for codebase-verified integration points; MEDIUM for external practice recommendations (per source-hierarchy seam: verified websearch → MEDIUM)

## System Overview

Existing v1.0 system (verified against source — do not re-research) with v1.1 additions marked `+`:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ apps/web (Next.js 16.3.3 App Router)                                       │
│  public: / /fixtures /fixtures/[id] /scorecards /methodology               │
│  operator: /internal/operations /internal/reconciliation /internal/pipeline│
│  /internal-api/* proxy routes (operator HMAC proxy auth for /internal)     │
│  + /scanner (new page, F9)   + /internal/journal (new, F10)                │
│  + alert tab inside /internal/operations (F3)   + LHCI job (F4)            │
├────────────────────────────────────────────────────────────────────────────┤
│ apps/api (NestJS 11)                                                       │
│  modules: fixtures forecasts odds value evaluation operations privacy      │
│  providers replay reconciliation eligibility health media                  │
│  + value scanner endpoint in ValueModule (F9)                              │
│  + closing-odds/diary endpoints in OddsModule (F7)                         │
│  + JournalModule @OperatorGuard (F10)   + AlertsModule (F3)                │
│  + calibration read paths in Forecasts/Evaluation (F5)                     │
├────────────────────────────────────────────────────────────────────────────┤
│ workers/data-sync (BullMQ: sync-critical/standard/optional, settlement,    │
│  backtest)                                                                 │
│  + alert-evaluation tick + webhook dispatch (F3, new queue or inline tick) │
│  + calibration fit/promote job (F5, backtest-queue cadence pattern)        │
│  + model version selector: poisson-ensemble-v1 | dixon-coles-ensemble-v1   │
│    (F6)                                                                    │
├────────────────────────────────────────────────────────────────────────────┤
│ packages/domain (pure TS)                                                  │
│  forecast/{model,config,contract} value/odds evaluation/{scoring,clv,...}  │
│  + dixon-coles tau + model-version union (F6)                              │
│  + calibration {isotonic,platt} fit/apply (F5)                             │
│  + market/selection unions + MARKET_SELECTIONS + SCORE_CLASS_ORDER (F8)    │
│  + AH line & exact-score bucket config (F8)                                │
├────────────────────────────────────────────────────────────────────────────┤
│ packages/database (Prisma 7 + PostgreSQL 18) — source of truth             │
│  ForecastSnapshot (immutable) ForecastMarket ValueReceipt (immutable)      │
│  SettlementReceipt ForecastScore ValueSettlement ClosingOddsObservation    │
│  ProviderQuotaObservation/RouteAttempt/RequestReservation  SyncRun         │
│  + DDL: CalibrationVersion, CalibrationApply, OpsAlert,                    │
│    OpsAlertTransition, OpsAlertDelivery, BackupVerificationReceipt,        │
│    PaperTrade (5 migrations, see Integration Points)                       │
│  + optional index on Fixture(kickoffUtc)/ValueReceipt(outcome,createdAt)   │
├────────────────────────────────────────────────────────────────────────────┤
│ infra: docker-compose.yml (postgres 18.6, redis 8.2) docker-compose.       │
│  operator.yml   + backup service + backup volume + restore-verify script   │
│    (F2)   + docker-compose.prod.yml (small prod stack, F2)                  │
│  + .github/workflows/ci.yml, lighthouse.yml (F1, F4) — no CI exists today  │
└────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities (existing anchors reused by v1.1)

| Component | Responsibility | v1.1 consumers |
|-----------|----------------|----------------|
| `ForecastSnapshot` + `ForecastMarket` | Immutable forecast identity (modelVersion/modelHash/configHash/inputHash/evidenceFingerprint) + per-market probability rows | F6 (new model version rows), F8 (new market rows), F5 (read-side calibration), F9 (scanner reads) |
| `ValueReceipt` / `ValueSettlement` | Immutable value candidate + append-only flat-unit settlement incl. `clvStatus/clvReason/clv` fail-closed fields | F7 (closing input), F9 (scanner source), F10 (journal FK) |
| `ClosingOddsObservation` | Timestamped price with `observationKind` (`MANUAL`\|`MARKET_CLOSE`); consumed by settlement's raw-SQL closing join | F7 (diary writes — table exists, **no API writes it today**) |
| `ForecastScore` | Append-only Brier/LogLoss per (settlement, market, formulaHash), indexed by modelVersion | F5 training/eval set, F6 A/B cohorts |
| `OperationsService`/`/internal/operations` | Operator overview with `impact: BLOCKING\|DEGRADED`, secret-safe rendering | F3 alert list + backup status, F2 receipts |
| `ProviderQuotaObservation` + budget reservations | Durable quota evidence per provider/endpoint | F3 quota signal |
| BullMQ inspector pattern (`getFailed`, reconcile timers in `queues/index.ts`) | Dead-letter evidence + reconciliation | F3 worker-failure signal |
| `OperatorGuard` + `/internal-api/*` proxy + Zod env (`packages/config`) | Operator auth contour, secret-safe config | F3/F7/F10 endpoints and pages |
| `ForecastOrchestrator` + `backtests.ts` rolling-origin | Versioned forecast issuance, leakage-safe evaluation | F6 (MODEL_VERSION_MISMATCH check to widen), F5 (fit/eval cadence) |

## Recommended Project Structure (new artifacts only)

```
.github/workflows/
├── ci.yml                        # F1: install→schema→typecheck→lint→unit→integration→build
└── lighthouse.yml                # F4: LHCI against `next start`, 3 runs median
lighthouserc.json / budgets.json  # F4: assertions + resource budgets (repo root)
infra/
├── docker-compose.yml            # F2 MODIFIED: + postgres-backup service, backups volume
├── docker-compose.prod.yml       # F2 NEW: small production stack (api/web/worker/pg/redis)
└── backup/
    ├── pg-backup.sh              # F2: pg_dump -Fc + rotation (keep N daily / M weekly)
    └── verify-restore.mjs        # F2: shadow-postgres restore + sentinel queries + receipt
apps/api/src/modules/
├── alerts/                       # F3 NEW: alerts.{module,controller,service,signals}.ts
├── journal/                      # F10 NEW: journal.{module,controller,service}.ts
├── odds/closing-odds.controller.ts  # F7 MODIFIED OddsModule (+ diary read routes)
├── value/value.service.ts        # F9 MODIFIED: + listCandidates(windowDays) query
└── evaluation/…                  # F5 MODIFIED: calibrated scorecard facets (read-only)
workers/data-sync/src/
├── jobs/alerts.ts                # F3 NEW: signal evaluators + dedup + dispatch
├── jobs/calibration.ts           # F5 NEW: fit → promote/rollback receipts
└── main.ts                       # F3/F5 MODIFIED: register tick + queue wiring
packages/domain/src/
├── forecast/dixon-coles.ts       # F6 NEW: tau(0-0,1-0,0-1,1-1; λh,λa,ρ) + version union
├── forecast/model.ts             # F6 MODIFIED: modelVersion union, matrix gen with τ
├── calibration/{isotonic,platt,contract}.ts  # F5 NEW: pure fit/apply + version identity
├── odds/contract.ts              # F8 MODIFIED: OddsMarket/selections/MARKET_SELECTIONS
├── forecast/contract.ts          # F8 MODIFIED: MARKET_SELECTIONS + DTO validation
└── evaluation/scoring.ts         # F8 MODIFIED: SCORE_CLASS_ORDER for new markets
packages/database/prisma/migrations/  # 5 new migrations (see Integration Points)
apps/web/app/
├── scanner/page.tsx              # F9 NEW (server component, scorecards pattern)
├── internal/journal/page.tsx     # F10 NEW (client, OperatorGuard contour)
├── internal/operations/…         # F3 MODIFIED: alerts + backup status tab
└── fixtures/[fixtureId]/page.tsx # F4 MODIFIED: parallel fetch, cache shaping, JS trim
```

### Structure Rationale

- **Alerts live in `apps/api` + a worker tick, not a new service:** signals are Postgres/Redis-derived; a separate deployable would add ops surface for zero isolation benefit.
- **Calibration is a domain package, not a worker-local script:** fit/apply must be pure, property-tested, and reusable by backtests, API read paths, and the fit job identically.
- **Backups stay in `infra/` + `scripts/`:** they are host-level concerns that must run without the app stack (a broken deploy must not break backup/restore).
- **Journal under `/internal/` (not public contour):** paper trading is operator-only, no user accounts; reuses HMAC proxy auth verbatim.

## Architectural Patterns

### Pattern 1: Versioned identity instead of mutation (used by F5, F6, F8, F10)

**What:** Every derived or generated artifact carries `(version, hash-of-inputs)` and new facts supersede old via `supersedes*Id` chains — never UPDATE.
**When:** Anywhere a value could change over time (model code, config, calibration params, manual corrections).
**Trade-offs:** Row counts grow and readers must be supersession-aware; in exchange, evaluation stays auditable and backtests reproducible.

```typescript
// F6: widen the literal union, keep hashes as the identity
export const MODEL_VERSIONS = ["poisson-ensemble-v1", "dixon-coles-ensemble-v1"] as const;
export type ModelVersion = (typeof MODEL_VERSIONS)[number];
// ForecastSnapshot uniqueness [fixtureId, kind, cutoff, modelHash, configHash, inputHash, …]
// already yields distinct immutable rows per model version — no schema change needed.
```

### Pattern 2: Derived-not-mutated for frozen snapshots (F5, F8)

**What:** Calibrated probabilities and backfilled markets are **new tables keyed to** `forecastSnapshotId`, never written into the frozen snapshot's `probabilities` Json or its `ForecastMarket` children.
**When:** Feature needs historical frozen data in a new shape.
**Trade-offs:** An extra join and one more DDL; avoids breaking snapshot identity, unique constraints, and the append-only audit story.

### Pattern 3: Post-hoc calibration layer, NOT a new model version (F5 — key decision)

**What:** Calibration (isotonic/Platt) is a monotone transform stored as its own `CalibrationVersion` (method, scope, params, fit-window, training-score fingerprint, `fitModelVersion`) with append-only `CalibrationApply` outputs; raw snapshot probabilities remain the canonical model output.
**Why not a new modelVersion:** (a) model version answers "what generated these probabilities" — calibration answers "how are they re-mapped"; rollback must be independent; (b) `ForecastScore` rows and value receipts reference modelVersion — baking calibration in would fork snapshot identity on every recalibration; (c) it lets raw and calibrated be displayed side-by-side (honest-display constraint).
**Rollback:** promote/rollback = append-only state transition on `CalibrationVersion` gated by holdout Brier vs raw on the trailing settled window; failure falls back to raw (fail-closed to uncalibrated, never to a worse calibrator).

### Pattern 4: Fail-closed derived display (F7, F8, F5)

**What:** A derived value renders only when its full provenance validates; otherwise an explicit typed "unavailable" reason is shown (existing `ClvUnavailableReason`, `ForecastAvailabilityEntryDto`, `DataStateNotice` patterns).
**When:** CLV without comparable closing price, AH/exact-score for legacy snapshots without persisted matrix, calibrated view without an active version for that modelVersion.

### Pattern 5: Signal → durable receipt → operator channel (F3, F2)

**What:** Detection never lives only in a channel: evaluator detects → writes append-only durable row (dedup fingerprint) → dispatch webhook/email with `OpsAlertDelivery` attempt evidence → ops page renders rows (secret-safe: channel URL/credentials only in Zod env, never in DTOs).
**Trade-offs:** One write amplification per alert; gives audit + dedup + channel-agnostic delivery consistent with provider attempt-evidence patterns.

## Data Flow

### Existing core flow (unchanged)

```
provider sync (budget-reserved) → EvidenceBuild → ForecastOrchestrator
  → ForecastSnapshot+ForecastMarket (frozen) → manual odds → ValueReceipt
  → settlement queue → SettlementReceipt + ForecastScore + ValueSettlement
```

### New/changed flows

1. **F6 model track:** `config flag FORECAST_MODEL_VERSION` → orchestrator selects `createForecast` variant → DC tau applied to matrix cells {0-0,1-0,0-1,1-1} → same snapshot write path (new modelHash/configHash) → downstream cohorts split automatically by `ForecastScore.modelVersion`.
2. **F5 calibration track:** `settlement → ForecastScore (raw, append-only)` → weekly/after-settlement fit job (leakage-safe: only scores with kickoff < now, per modelVersion+market) → `CalibrationVersion` FITTED → evaluation harness compares holdout Brier vs raw → PROMOTED or REJECTED (append-only) → read paths expose calibrated alongside raw; value decisions unchanged until an explicit `value-policy-v2` adopts them (new receipts, supersession — future, not v1.1 default).
3. **F7 CLV diary:** operator enters closing price → OddsModule validates per `clv.ts` (DECIMAL, sourceConvention match, pre-kickoff, kind=MARKET_CLOSE) → `ClosingOddsObservation` insert → existing settlement SQL join picks latest closing ≥ submittedAt < kickoff → `ValueSettlement.clvStatus/clv` fail-closed as today. Intermediate diary entries reuse `observationKind='MANUAL'` (never used for CLV math). Forecast-time price needs no new capture — `ManualOddsSnapshot.submittedAt` is already the candidate instant.
4. **F8 markets:** (persist matrix — see gap below) → at issuance derive `ASIAN_HANDICAP_<line>` + `EXACT_SCORE` bucket probabilities from score matrix → `ForecastMarket` rows via existing write path → odds books for those markets via existing ManualOddsSnapshot path (once `MARKET_SELECTIONS` widened) → value receipts unchanged → settlement `resultOutcome` + `SCORE_CLASS_ORDER` widened (AH push → non-financial/VOID-class, stake return excluded from ROI denominators).
5. **F9 scanner:** `ValueReceipt ⋈ Fixture` where `kickoffUtc ∈ [now, now+7d]`, `outcome='VALUE_CANDIDATE'`, `supersededBy IS NULL` → cursor-paged DTO → `/internal-api/value/candidates` → `/scanner` server component. Read-only, zero provider calls.
6. **F10 journal:** operator POST trade (valueReceiptId FK) → append-only `PaperTrade` → on read, join latest non-superseded `ValueSettlement` by valueReceiptId → bankroll/drawdown/ROI aggregates computed in service SQL (small volume; no queue, no cache required).
7. **F3 alerting:** periodic worker tick reads signals (quota observations, BullMQ failed counts, SyncRun terminal failures, backup-receipt age, Redis per-minute 5xx buckets fed by a NestJS exception filter) → dedup → `OpsAlert` insert → webhook/email dispatch (`OpsAlertDelivery`) → `/internal/operations` alert tab.

## Scaling Considerations

| Scale | Adjustment |
|-------|------------|
| Now (single operator, ≤ 5 leagues) | Everything fits: scanner = indexed SQL, calibration fit = PAV/logistic over ~10⁴ rows (ms), journal aggregates = one query, alert tick = 60s interval. No queues added beyond one optional dispatch queue. |
| 10× fixtures/volume | Scanner needs composite index (kickoff window + outcome); calibration fit moves fully into backtest-queue worker; webhook dispatch needs rate limiting + BullMQ retry. |
| 100× or public user traffic | Alert evaluator becomes its own worker process; LHCI budgets already prevent client-JS regressions; backup rotation volume growth bounded; consider materialized scanner view. (Not a v1.1 concern — no user accounts by decree.) |

**First bottleneck:** none of the 10 features adds provider load — budget reservations untouched. **Second:** `ForecastScore` table growth drives calibration fit time (bounded by fit-window, not table size).

## Anti-Patterns

### Anti-Pattern 1: Writing calibration/new markets into frozen snapshots
**What:** Updating `ForecastSnapshot.probabilities` or appending `ForecastMarket` rows to an already-issued snapshot.
**Why it's wrong:** Violates the uniqueness/identity contract (`modelHash+configHash+inputHash` identity), breaks reproducibility of value receipts and backtests computed against the original row.
**Do this instead:** Persist the score matrix **at issuance going forward** (Pattern 2); for legacy snapshots derive on demand from `receipt.expectedGoals` (exact for `poisson-ensemble-v1`: independent Poisson + `retained-mass-v1` normalization are fully determined by λ) or show a typed unavailable state.

### Anti-Pattern 2: Fitting calibration across mixed model versions
**What:** Training one calibrator on a `ForecastScore` pool containing both Poisson-v1 and Dixon-Coles rows.
**Why it's wrong:** The calibrator absorbs the old model's bias, then mis-calibrates the new one; rollback signals become meaningless.
**Do this instead:** `CalibrationVersion.fitModelVersion` column with a partial unique index on active-per-(modelVersion, market); fit job filters cohorts explicitly. **This is why Dixon-Coles (F6) must land before calibration promotion (F5).**

### Anti-Pattern 3: Alert state in Redis / channel-only alerting
**What:** Storing firing state in the disposable Redis cache or only posting to a webhook.
**Why it's wrong:** Redis is documented never-source-of-truth; a missed webhook is unrecoverable and unauditable.
**Do this instead:** Postgres `OpsAlert` (dedup fingerprint) is the state; webhook/email are delivery attempts with receipts; ops page reads the DB.

### Anti-Pattern 4: CI that calls live providers or assumes the Windows host
**What:** Tests requiring `FOOTBALL_DATA_API_TOKEN`/`API_FOOTBALL_API_KEY`, `.bat`/`.ps1` steps, or `D:\` paths in the workflow.
**Why it's wrong:** Burns free-tier budget, fails on clean Linux runners, breaks `frozen-lockfile` hermeticity.
**Do this instead:** CI env passes placeholder-free config (existing suite already runs hermetically via Testcontainers); portability checks as plain `node`/`pnpm` scripts; live-evidence Playwright configs stay out of the default CI job.

### Anti-Pattern 5: Exact-score/AH odds books violating book completeness
**What:** Partial or line-inconsistent books feeding noVig/overround normalization.
**Why it's wrong:** `parseOddsDraft` requires exact selection-set match; a subset book silently corrupts overround and edges.
**Do this instead:** Versioned market config defines AH line set and exact-score **bucket list including an `OTHER` catch-all**; model buckets = book buckets exactly; AH push resolves to the existing NON_FINancial/VOID settlement class so ROI stays honest. *(Design decision — flag for phase-level research in F8.)*

## Integration Points

Per feature: **NEW** vs **MODIFIED** explicit; DDL = Prisma migration.

| # | Feature | NEW components | MODIFIED components | DDL / migrations | Data-flow change |
|---|---------|----------------|---------------------|------------------|------------------|
| 1 | CI pipeline | `.github/workflows/ci.yml`; optional `scripts/ci/*` portability shims | `turbo.json`/root `package.json` only if a `ci` script alias is wanted; any Linux-incompatible tests | none | Adds gate: frozen-lockfile → schema validate → typecheck → lint → unit → integration (Testcontainers; Docker preinstalled on ubuntu-latest) → build. Playwright E2E as separate opt-in job. |
| 2 | Backups + restore verify | `infra/backup/pg-backup.sh`, `infra/backup/verify-restore.mjs`, `infra/docker-compose.prod.yml`, backup service+volume in compose, scheduled GH Actions restore-verify job (optional) | `infra/docker-compose.yml` (backup sidecar) | optional `BackupVerificationReceipt` (append-only: dumpId, sha, rowCountSentinels, duration, ok) — feeds ops page + F3 backup-age signal | Postgres→dump→shadow-restore→receipt. **Redis deliberately not backed up.** Rotation in-script. |
| 3 | Degradation alerting | `apps/api/src/modules/alerts/*`; `workers/data-sync/src/jobs/alerts.ts`; signal adapters (quota, dead-letter, SyncRun, 5xx Redis buckets from API exception filter) | `app.module.ts` (register), `packages/config` env (`ALERT_WEBHOOK_URL`, thresholds — secret-safe), `workers/main.ts` tick, `/internal/operations` page + proxy route | `OpsAlert` (dedup fingerprint unique), `OpsAlertTransition` (ACK/RESOLVED append-only), `OpsAlertDelivery` (attempt evidence) | signals → durable alert → channel dispatch → operator list. No provider calls; respects OperatorGuard + no-store headers. |
| 4 | Lighthouse perf `/fixtures/[id]` | `lighthouserc.json`, `budgets.json`, `.github/workflows/lighthouse.yml` | `apps/web/app/fixtures/[fixtureId]/page.tsx` (parallelize `load`+`loadForecasts` — currently sequential; `React.cache` memoization; fetch shaping respecting eligibility 1h-stamp freshness), `forecast-workbench.tsx` (defer below-fold panels / `next/dynamic`), maybe API cache headers on non-eligibility fixture payload | none | Measure→fix→assert loop. Read Next 16.3 docs in `node_modules/next/dist/docs/` before touching Next APIs (AGENTS.md mandate). Recharts stays client-only+lazy if introduced. |
| 5 | Calibration layer | `packages/domain/src/calibration/*` (isotonic PAV, Platt, version identity), `workers/jobs/calibration.ts` (fit→evaluate→promote/rollback), read paths in Evaluation/Forecasts services | scorecards UI (calibrated vs raw facet), methodology card, `packages/config` (active calibration policy) | `CalibrationVersion` (method, scope, params Json, fitWindow, trainingScoreHash, fitModelVersion, state, `supersedesId`), `CalibrationApply` (snapshot×market→calibrated prob, unique per calVersion) — or compute-on-read first, materialize later | Fit strictly on settled `ForecastScore` (leakage-safe, per modelVersion); promotion gated by holdout Brier; display always labels raw vs calibrated; **value receipts untouched in v1.1** (no silent edge changes). |
| 6 | Dixon-Coles model | `packages/domain/src/forecast/dixon-coles.ts` (τ formulas, bounded-ρ) | `forecast/model.ts` + `forecast/contract.ts` + `evaluation/forecast-orchestrator.ts` (MODEL_VERSION_MISMATCH), `workers/jobs/{forecasts,forecast-sweep,forecasts,backtests}.ts`, `apps/api/forecasts.service.ts`, `methodology/model-card.ts`, `FORECAST_CONFIG` (ρ + configVersion→v2, configHash changes), env model selector; ~10 test files pinning the literal | none (snapshot uniqueness absorbs new modelHash/configHash) | New immutable snapshots `dixon-coles-ensemble-v1`; rollback = config flip (old rows remain valid); A/B via existing backtest + scorecard `modelVersion` cohorts. τ(0,0)=1-λhλaρ, τ(0,1)=1+λhρ, τ(1,0)=1+λaρ, τ(1,1)=1-ρ, clamp ≥0. |
| 7 | CLV price diary | `closing-odds.controller.ts` (+ diary read routes) in OddsModule; operator entry UI (workbench operator section or `/internal` panel); `internal-api` proxy route | `odds.module.ts`, evaluation scorecard CLV aggregates, enum labels | **none required** — `ClosingOddsObservation` already fits (`MANUAL` vs `MARKET_CLOSE`); optional index verify on `(fixtureId, market, selection, observedAt)` | Entry→validation per `clv.ts`→append-only observation→existing settlement join→`ValueSettlement` CLV fail-closed. Closing capture covers new markets from day one if F7 precedes F8. |
| 8 | New markets (AH, exact score) | market/line/bucket config in domain; derivation from score matrix | `forecast/{model,contract}.ts` + `odds/contract.ts` unions + `MARKET_SELECTIONS`, `evaluation/scoring.ts` `SCORE_CLASS_ORDER`, `settlement-pipeline.ts` `resultOutcome`+`isScoreMarket` (hardcoded guard — **throws INVALID_SCORE_MARKET if missed**), `value` decision per-market thresholds (`value-policy-v2`), workbench odds form/labels (auto from `MARKET_SELECTIONS`), `SCORE_CLASS_ORDER`-driven ForecastScore | **score-matrix persistence gap (see below)**; optional `DerivedForecastMarket` only if historical backfill is required | At issuance derive new-market probabilities from persisted matrix → normal snapshot/odds/value/settlement chain; AH push → VOID/non-financial class (stake returned, excluded from ROI); exact score = configured buckets + `OTHER`. |
| 9 | Value scanner | `GET value-receipts/candidates` (ValueModule), `internal-api/value/candidates/route.ts`, `apps/web/app/scanner/page.tsx` | `value.service.ts` | indexes: `ValueReceipt(outcome, createdAt)` + verify `Fixture(kickoffUtc)` — cross-fixture window join | Forward-looking read of superseded-aware `VALUE_CANDIDATE` rows, 7-day kickoff window, cursor paging like `evaluation.valueCandidates` (which is **settled-history only** — different query, don't overload it). Zero provider calls; EligibilityGuard applies. |
| 10 | Paper-trading journal | `apps/api/src/modules/journal/*` (OperatorGuard), `/internal/journal` page, `internal-api/journal` route | scorecards/scanner cross-links (read) | `PaperTrade` (valueReceiptId FK Restrict, stakeUnits, recordedAt, `supersedesPaperTradeId?`, receipt Json; append-only corrections) — aggregates computed on read | Record→immutable link→resolution derived from latest non-superseded `ValueSettlement`; bankroll/drawdown/ROI from flat-unit math consistent with `ValueSettlement.stakeUnits` conventions; no automated wagering, operator-gated, no user accounts. |

### Critical integration findings (verified in source)

1. **The score matrix is never persisted today.** `ForecastSnapshot.probabilities` stores the markets record; `receipt` holds `expectedGoals`+`adjustments` only; `scoreMatrix` exists only inside `ForecastDraft` memory (`model.ts:149-179`). F8 therefore must either (a) persist the 64-cell matrix into the snapshot `receipt` Json at issuance (**recommended — no DDL**, but `parseForecastResponse` uses `exactKeys`, so the new key must be optional-with-derivation for legacy rows), or (b) deterministically re-derive from `receipt.expectedGoals` for `poisson-ensemble-v1` (exact — independent Poisson + `retained-mass-v1`), failing closed for anything else.
2. **`modelVersion` is hard-pinned as a string literal in ≥10 files** (orchestrator throws `MODEL_VERSION_MISMATCH`; backtest plans reject other versions; contract validator, API service, sweep jobs, model card, E2E queries). F6 must widen a shared union in one pass — partial widening compiles nowhere.
3. **`ClosingOddsObservation` has no write API** — integration tests insert it with raw SQL. F7 is wiring + validation + UX, not schema.
4. **`evaluation/value-candidates` already exists but is settlement-history** (cursor on `settledAt` over `ValueSettlement`). The scanner is a distinct forward-looking query over `ValueReceipt` — new endpoint, not an extension.
5. **`settlement-pipeline.ts` market guard is a hardcoded 3-market check** — adding markets without widening `isScoreMarket`/`resultOutcome`/`SCORE_CLASS_ORDER` fails settlement at runtime, not compile time.

## Build Order

```
Wave 0 — independent foundations (parallelizable):
  P1  CI pipeline (F1)            ← first: gates every later phase with tests
  P2  Backups + restore verify (F2)  (∥ P1, ∥ P4)
  P4  Fixture-page perf + LHCI (F4)  (∥ P1, P2 — touches only web + workflows)

Wave 1:
  P3  Degradation alerting (F3)   ← after P2 (backup-age is a signal; ops-center
                                     patterns reused); after P1 (CI-gated)

Wave 2 — model quality track (strict order):
  P5  Dixon-Coles new model version (F6)
  P6  Calibration layer + versioned rollback (F5)
        depends on P5: calibrators are fitted PER modelVersion; fitting on v1
        then switching models invalidates them (Anti-Pattern 2).
        P5→P6 also gives the final generator's full cohort as fit data.

Wave 3 — value experience track (order within wave matters):
  P7  CLV price diary (F7)        ← before P8: closing-price capture then
                                     covers AH/exact-score selections day one;
                                     before P10: journal displays CLV per trade.
  P8  New markets AH + exact score (F8)  ← after P5 ideally (derive from the
                                     active model's matrix); after P7 (CLV/journal
                                     settlement joins keyed by market/selection).
                                     Largest spec surface (lines/buckets/push) —
                                     needs its own phase research spike.
  P9  Value scanner (F9)          ← after P8: scanner should list all markets
                                     from day one instead of migrating the page.
  P10 Paper-trading journal (F10) ← last: links ValueReceipts (all markets),
                                     shows CLV (P7), picker can deep-link scanner (P9).

Parallel-safe pairs: (P1,P2,P4) ∥ early P5 scoping; P3 ∥ P5/P7;
                     P9 ∥ P10 implementation after P8 lands.
```

**Ordering rationale:** CI first because F5–F10 all land high-risk schema/contract changes behind the 351+ unit suite and Testcontainers gates. Backups before alerting because backup-age is an alert signal and restore-verification receipts are ops-center content. Model track (F6→F5) precedes market track because derived markets and calibrators both key off the *active* generator; CLV (F7) precedes markets and journal because it is pure wiring over an existing table that every later settlement displays. Scanner after markets so the 7-day window query is written once against the final market set; journal last because it is a pure consumer of ValueReceipts + ValueSettlements + CLV.

## Sources

- Codebase verification at `D:\Documents\Atom\bet-stats` (schema.prisma, domain forecast/value/odds/evaluation, queues, ops/value/evaluation controllers, settlement-pipeline, workbench) — **HIGH** (primary evidence for all integration points).
- Testcontainers on GitHub Actions — Docker official blog + devops-monk tutorial + Docker docs cache guide (**MEDIUM**, verified websearch: runners ship Docker preinstalled; pulled-image caching needs explicit save/load).
- PostgreSQL backup/restore — official `pg_dump` docs + community shadow-restore patterns (pgbackrest-compose-ops, ticket-board backup-restore) (**MEDIUM**, verified).
- Lighthouse CI — official LHCI docs (getting-started/configuration) + treosh/lighthouse-ci-action README (**MEDIUM**, verified: 3-run median, two-tier error/warn assertions, budget.json).
- Calibration — Niculescu-Mizil & Caruana "Predicting Good Probabilities" (ICML'05), scikit-learn calibration guide (**MEDIUM**, verified: isotonic overfits small samples → Platt fallback; Brier-gated promotion).
- Dixon-Coles — Dixon & Coles (1997); R `goalmodel` dixoncoles.R exact τ formulas; arXiv 2307.02139 rolling-window practice (**MEDIUM**, verified: τ formulas cross-checked across 3 independent implementations).

---
*Architecture research for: bet-stats v1.1 milestone integration*
*Researched: 2026-10-19*
