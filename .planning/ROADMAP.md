# Roadmap: Football Prediction & Value Betting Platform — Milestone v1.1

## Overview

Milestone v1.1 (Reliability, Model Quality and Value Experience) continues the phase numbering from the completed v1.0 MVP (Phases 1–6, archived under `.planning/milestones/v1.0-ROADMAP.md`). It hardens the platform an operator can trust (CI gates, verified backups, degradation alerting, performance budgets), raises probability quality with auditable math (Dixon-Coles correction, per-market calibration with versioned rollback), and closes the value-discovery loop for the user (CLV price diary, Asian handicap and exact-score markets, a 7-day value scanner, and an operator-only paper-trading journal). Every new fact stays append-only and versioned; every new user surface keeps the fail-closed honesty and responsible-gambling discipline established in v1.0. Excluded: league expansion, user notifications, user accounts, UI internationalization.

## Phases

- [ ] **Phase 7: CI Pipeline & Quality Gates** - Every push and PR runs a frozen, Linux-based pipeline that gates schema, types, lint, tests, and build before anything else lands.
- [ ] **Phase 8: Backups and Restore Verification** - The operator trusts that PostgreSQL can be restored, proven by scheduled restore drills with visible verification status.
- [ ] **Phase 9: Degradation Alerting** - The operator is told when providers, workers, HTTP error rates, or backups degrade, through durable alerts viewable in the operations center.
- [ ] **Phase 10: Performance Audit and Budgets** - The fixture detail page meets declared Lighthouse budgets, and regressions fail CI instead of shipping.
- [ ] **Phase 11: Dixon-Coles Model Version** - Forecasts can be issued under a corrected, versioned model whose rolling-origin backtests are compared against the frozen baseline before promotion.
- [ ] **Phase 12: Calibration Layer and Versioned Rollback** - Users see calibrated probabilities with honest labels and insufficient-data states, backed by per-model-version calibrators that roll back on measured regression.
- [ ] **Phase 13: CLV Price Diary** - Forecast-time and closing prices are compared per candidate, with honest unavailable states and strict evaluation-only semantics.
- [ ] **Phase 14: Asian Handicap and Exact Score Markets** - Users see and settle Asian handicap and exact-score probabilities derived from the frozen score matrix, with push-aware value receipts.
- [ ] **Phase 15: 7-Day Value Scanner** - Users see one consolidated, freshness-aware list of value candidates across the next seven days without N+1 queries or recompute drift.
- [ ] **Phase 16: Paper-Trading Journal** - The operator records simulated trades against immutable receipts and sees bankroll, drawdown, ROI, and yield with append-only corrections.

## Phase Details

### Phase 7: CI Pipeline & Quality Gates

**Goal**: A developer can rely on one GitHub Actions pipeline that proves the workspace is installable, schema-valid, type-clean, lint-clean, tested (unit + Docker-backed integration on Linux), and buildable on every push and pull request — the safety net all later v1.1 schema/model changes land behind.
**Depends on**: Nothing (first phase of v1.1)
**Requirements**: CI-01, CI-02, CI-03, CI-04
**Success Criteria** (what must be TRUE):

  1. A developer opens a pull request and sees the full pipeline run automatically: frozen-lockfile install, schema verification, typecheck, lint across api/workers/domain/web, unit tests, Docker-backed integration tests, and build.
  2. The integration job runs only on Linux runners, fails loudly (never skips) when Docker is unavailable, and no CI step ever calls a live external provider.
  3. Lint is a required gate covering all workspace packages, and CI-enforced mutation-rejection tests prove snapshot and receipt tables reject UPDATE and DELETE at the database layer.
  4. A deliberate breakage (type error, failing test, mutation on a frozen table) turns the pipeline red and blocks the merge.

**Notes / research flags**: Decide which Playwright E2E subset is portable to the default CI job vs a manually-triggered live smoke — CI must never burn the free-tier provider budget. E2E live-stack tests currently shell out to `cmd.exe` (Windows-only); CI must use the cross-platform `verify-release-integration.mjs` path. Extend the flat ESLint config to `apps/api`, `apps/api-e2e`, `workers/*` before making lint required.
**Plans**: 1/3 plans executed
- [x] 07-01-PLAN.md
- [ ] 07-02-PLAN.md
- [ ] 07-03-PLAN.md

**UI hint**: no

### Phase 8: Backups and Restore Verification

**Goal**: An operator can enable automated PostgreSQL backups and trust them because a scheduled restore drill proves every backup actually restores — with never-verified and stale states rendered honestly in the operations center.
**Depends on**: Nothing (parallel-safe with Phases 7 and 10; must land before any phase that changes schema or model code)
**Requirements**: BAK-01, BAK-02, BAK-03
**Success Criteria** (what must be TRUE):

  1. An operator can enable automated `pg_dump -Fc` backups with configurable retention and rotation, running without the application stack.
  2. A scheduled restore drill restores the latest backup into a throwaway PostgreSQL container, applies migrations, runs chain-integrity checks, and records a verification receipt.
  3. The operations center shows backup and restore-verification status (last success, age, failures) without exposing secrets; never-verified and stale backups render as explicit non-green states.

**Notes / research flags**: Operator decisions needed before planning — RPO target (daily dump vs WAL shipping) and off-host storage destination for the actual single-Windows-host deployment. Redis is never backed up. No pgBackRest/Barman/SaaS (overkill, paid).
**Plans**: TBD
**UI hint**: no

### Phase 9: Degradation Alerting

**Goal**: An operator is proactively told when the platform degrades — provider-quota exhaustion, worker failures and dead letters, sync-run failures, 5xx spikes, and backup staleness — with PostgreSQL as the source of truth and the operations center as the operator's view.
**Depends on**: Phase 7 (CI-gated schema changes), Phase 8 (backup/restore age is a critical alert signal)
**Requirements**: ALRT-01, ALRT-02, ALRT-03, ALRT-04
**Success Criteria** (what must be TRUE):

  1. Each configured degradation signal (quota exhaustion, job failures/dead letters, sync-run failures, 5xx spikes, backup staleness) produces a durable alert record with deduplication, severity tiers, and transition history.
  2. An operator can view active and recent alerts in the operations center with correlation context and redacted secrets.
  3. Alert dispatch delivers to a configurable webhook endpoint (optionally SMTP) without leaking secrets or betting data; a failed channel delivery never loses the alert, because detection lives in PostgreSQL.
  4. Probes and alerting never call live external providers and per-job failures do not create alert fatigue.

**Notes / research flags**: Channel choice (webhook vs SMTP free-tier) and its rate limits need runtime verification at implementation time. BullMQ `QueueEvents` for job signals; native `fetch` for webhook dispatch.
**Plans**: TBD
**UI hint**: yes

### Phase 10: Performance Audit and Budgets

**Goal**: A user gets a fixture detail page that meets declared Lighthouse performance budgets — measured honestly as median-of-3 before/after deltas — and budget regressions fail CI instead of shipping.
**Depends on**: Phase 7 (CI is where the budget assertion runs); parallel-safe with Phases 8 and 9
**Requirements**: PERF-01, PERF-02
**Success Criteria** (what must be TRUE):

  1. The fixture detail page meets configured Lighthouse performance budgets measured as a median-of-3 audit against the production build, with before/after metrics recorded honestly (no composite-score chasing).
  2. Lighthouse assertions run in CI against key pages and fail the build on budget regression, so later UI phases (scanner, journal, new markets) inherit the discipline.

**Notes / research flags**: Research gap to resolve at planning — STACK.md/ARCHITECTURE.md verify Recharts is absent from the repo; do not add a charting library (it would blow the budget); if Recharts unexpectedly exists, the fix strategy becomes dynamic-import-per-widget. Target component: ~39 KB client `forecast-workbench.tsx`.
**Plans**: TBD
**UI hint**: yes

### Phase 11: Dixon-Coles Model Version

**Goal**: Forecast probabilities can be issued under a new, versioned Dixon-Coles-corrected model with a pinned τ convention, and an operator can prove via rolling-origin backtests that it beats (or honestly fails to beat) the frozen Poisson baseline before it becomes the production default.
**Depends on**: Phase 7 (every model change lands behind CI; hash/mutation gates)
**Requirements**: MODEL-01, MODEL-02, MODEL-03
**Success Criteria** (what must be TRUE):

  1. The forecast model applies the Dixon-Coles low-score correction with a pinned τ convention and bounded ρ; tests prove ρ=0 reproduces the Poisson model, the score matrix sums to 1, and draw probability rises for the documented sign.
  2. Probabilities produced under the corrected model carry a new model-version identity across the whole stack — snapshots, backtests, comparisons, validators — widened in one coherent pass (no partial compile).
  3. An operator can compare rolling-origin backtest metrics of the new version against the frozen baseline, and the methodology card names the exact integration and its limitations (e.g. neutral on O/U 2.5).

**Notes / research flags**: Open product decision for discuss/spec — hybrid Elo/form-derived λ,μ + fitted per-league ρ (recommended, labeled as hybrid) vs full DC attack/defence refit (risks double-counting home advantage). ρ fitting window and decay selection are project-specific. `modelVersion` is hard-pinned as a string literal in ≥10 files — must widen the shared union in one pass.
**Plans**: TBD
**UI hint**: no

### Phase 12: Calibration Layer and Versioned Rollback

**Goal**: A user sees calibrated probabilities next to raw model probabilities with an honest version label, while the operator trusts that calibrators are fitted per exact model version on held-out data and roll back automatically when measured quality regresses.
**Depends on**: Phase 11 (calibrators fit the final model pipeline; fitting on v1-Poisson then switching models invalidates them)
**Requirements**: CALIB-01, CALIB-02, CALIB-03, CALIB-04
**Success Criteria** (what must be TRUE):

  1. A user sees calibrated probabilities (Platt first; isotonic only above a configured sample threshold) alongside raw probabilities with a calibrator version label, and sees an explicit insufficient-data-to-calibrate state below minimum thresholds.
  2. Calibrators are fitted per exact model version on held-out settled windows with minimum-sample gates, and the system structurally refuses calibrators whose pinned model version does not match the served forecast.
  3. A promoted calibrator rolls back automatically under materiality and hysteresis gates when holdout Brier regresses; frozen snapshots are never modified — calibration is a post-hoc layer, not a new model version.

**Notes / research flags**: Policy decisions to record in `configVersion`, not hardcode — min cohort sizes, rollback materiality thresholds, fit cadence. 1X2 3-class renormalization strategy needs design. PAVA isotonic + Platt Newton steps are pure TypeScript in `packages/domain` — no ML libraries.
**Plans**: TBD
**UI hint**: yes

### Phase 13: CLV Price Diary

**Goal**: A user can judge closing-line value on every value candidate from a recorded pre-kickoff closing price, with explicit unavailable states when no comparable price exists — and CLV remains strictly evaluation-only.
**Depends on**: Phase 7 (CI); parallel-safe with Phases 11–12 (pure wiring over the existing `ClosingOddsObservation` table)
**Requirements**: CLV-01, CLV-02, CLV-03
**Success Criteria** (what must be TRUE):

  1. An operator can record a closing-odds observation per fixture, market, and selection with a UTC observed-at timestamp validated as pre-kickoff and pre-settlement.
  2. A user sees closing-line value per value candidate computed from de-vigged forecast-time and closing prices on the same line; a missing closing price renders as explicit unavailable and is never synthesized.
  3. Closing observations are append-only, and no test or integration path lets CLV influence value ranking, scanner ordering, or journal decisions — it is evaluation-only.

**Notes / research flags**: `ClosingOddsObservation` already exists (schema fits) but has **no write API today** — this phase is wiring + validation + UX, not schema. Validation rules are already coded in `clv.ts`. Retrospective observations must be tagged and excluded (no hindsight/survivorship).
**Plans**: TBD
**UI hint**: yes

### Phase 14: Asian Handicap and Exact Score Markets

**Goal**: A user can view, price, and settle Asian handicap and exact-score probabilities derived from the frozen score matrix — zero new data cost — with quarter-line push/half-bet semantics handled correctly end to end.
**Depends on**: Phase 11 (derive from the corrected score matrix), Phase 13 (settlement joins keyed by market/selection; closing capture covers new selections from day one)
**Requirements**: MKT-01, MKT-02, MKT-03, MKT-04, MKT-05
**Success Criteria** (what must be TRUE):

  1. A user views Asian handicap probabilities and fair odds with quarter-line push and half-bet semantics, and exact-score probabilities for a configured bucket list including an explicit other-tail catch-all, all derived from the frozen score matrix.
  2. An operator enters complete odds books for the new markets with existing validation and no-vig normalization and receives value receipts with push-aware expected value.
  3. Settlement resolves AH push, half-win, and half-loss and exact-score outcomes under explicit versioned rules in the scorecard pipeline; the score matrix is persisted at issuance or deterministically re-derived fail-closed for legacy snapshots.

**Notes / research flags**: Research explicitly flags this phase for its own research spike — score-matrix persistence key shape (the recommended no-DDL approach: optional key in snapshot `receipt` Json — must satisfy `parseForecastResponse`'s `exactKeys` validation on legacy rows), AH line set, exact-score bucket list + `OTHER`, push-aware EV display. `settlement-pipeline.ts` has a hardcoded 3-market guard — missing the widening fails settlement at runtime, not compile time. Largest spec surface of the milestone; keep standalone.
**Plans**: TBD
**UI hint**: yes

### Phase 15: 7-Day Value Scanner

**Goal**: A user sees one consolidated, trustworthy list of value candidates across the next seven days — stored receipt edges rendered byte-for-byte, freshness demoted honestly, and responsible-gambling copy enforced.
**Depends on**: Phase 10 (bundle budget applies as the page is built), Phase 14 (the window query is written once against the final market set)
**Requirements**: SCAN-01, SCAN-02, SCAN-03
**Success Criteria** (what must be TRUE):

  1. A user views a consolidated list of value candidates for the next seven days across fixtures and markets with fixture, market, selection, edge, expected value, and odds source.
  2. The scanner displays stored receipt edges byte-for-byte without recomputation, with freshness demotion and explicit empty-versus-unavailable states — never an edge-sorted "best bets" leaderboard.
  3. The page complies with responsible-gambling copy rules (no urgency or certainty claims, persistent disclaimers) and issues no N+1 query patterns.

**Notes / research flags**: `evaluation/value-candidates` is settled-history only — the scanner is a distinct forward-looking query over `ValueReceipt`; new endpoint, don't overload it. Extend the prohibited-vocabulary suite and Russian-copy checks in this phase.
**Plans**: TBD
**UI hint**: yes

### Phase 16: Paper-Trading Journal

**Goal**: The operator validates the whole value loop without wagering — recording simulated trades against immutable receipts and reading honest bankroll, drawdown, ROI, and yield statistics with append-only corrections.
**Depends on**: Phase 13 (journal shows CLV per trade), Phase 14 (journal settles AH push/half-loss correctly), Phase 15 (scanner deep-links) — Phase 15 and Phase 16 implementations may run in parallel after Phase 14 lands
**Requirements**: JRN-01, JRN-02, JRN-03, JRN-04
**Success Criteria** (what must be TRUE):

  1. An operator records a paper (simulated) trade linked to an immutable value receipt with flat-unit and fractional-Kelly stake sizing capped at one quarter.
  2. The operator sees bankroll and unit curves, drawdown, ROI, and yield with push-aware denominators, sample gates, and explicit exclusion of pending and void trades.
  3. Trades are append-only with supersession corrections (a mutation-rejection test proves it in CI), the journal is clearly labeled as a simulation with Russian units/simulation vocabulary and no deposit or withdrawal verbs, and journal data never leaks into public read models or the privacy-sensitive contour.

**Notes / research flags**: `PaperTrade` append-only DDL with FK Restrict to `valueReceiptId`; JournalModule behind the existing OperatorGuard contour; `/internal/journal` page. Kelly ≤ ¼ is descriptive, never advice. Extend the RG copy suite in this phase.
**Plans**: TBD
**UI hint**: yes

## Parallelism and Dependency Notes

- **Wave 0 (parallel-safe):** Phases 7, 8, and 10 touch disjoint surfaces (CI workflows, infra/backup, web pages) and can run concurrently.
- **Safety-net ordering:** CI → backups → alerting — gates before risk, recovery before mutation, observability before model changes. Backup staleness becomes an alert signal.
- **Non-negotiable model ordering:** Phase 11 → Phase 12 — calibrators are fitted per model version; any earlier fit is invalidated by the model bump.
- **Value-loop ordering:** Phase 13 → Phase 14 → Phase 15 → Phase 16 closes the loop in dependency order; Phases 15/16 may implement in parallel after Phase 14.
- **Optional merges (not applied):** Phases 7+8 ("operational foundation") and Phases 15+16 ("value loop closing") are safe merges if fewer phases are preferred. Phases 11/12 stay separate (different failure modes, HIGH+MEDIUM sizes); Phase 14 stays standalone (largest spec surface).

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. CI Pipeline & Quality Gates | 1/3 | In Progress | - |
| 8. Backups and Restore Verification | 0/0 | Not started | - |
| 9. Degradation Alerting | 0/0 | Not started | - |
| 10. Performance Audit and Budgets | 0/0 | Not started | - |
| 11. Dixon-Coles Model Version | 0/0 | Not started | - |
| 12. Calibration Layer and Versioned Rollback | 0/0 | Not started | - |
| 13. CLV Price Diary | 0/0 | Not started | - |
| 14. Asian Handicap and Exact Score Markets | 0/0 | Not started | - |
| 15. 7-Day Value Scanner | 0/0 | Not started | - |
| 16. Paper-Trading Journal | 0/0 | Not started | - |
