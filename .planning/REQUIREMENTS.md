# Requirements: Football Prediction & Value Betting Platform (v1.1)

**Defined:** 2026-10-19
**Milestone:** v1.1 — Reliability, Model Quality and Value Experience
**Core Value:** Produce honest, reproducible probability estimates whose quality can be measured after every completed match.

## v1.1 Requirements

### Delivery Pipeline (CI)

- [x] **CI-01**: A developer can rely on a GitHub Actions pipeline that runs on every push and pull request: frozen-lockfile install, schema verification, typecheck, lint, unit tests, integration tests, and build.
- [x] **CI-02**: Integration tests run on Linux runners with Docker and fail (never skip) when Docker is unavailable; CI never calls live external providers.
- [x] **CI-03**: Lint covers all workspace applications and packages (api, workers, domain, web) before it becomes a required gate.
- [x] **CI-04**: CI-enforced mutation-rejection tests protect immutable snapshot and receipt tables against UPDATE and DELETE at the database layer.

### Backups and Restore Verification (BAK)

- [ ] **BAK-01**: An operator can enable automated PostgreSQL backups (pg_dump custom format) with configurable retention and rotation.
- [ ] **BAK-02**: A scheduled restore drill restores the latest backup into a throwaway PostgreSQL container, applies migrations, runs chain-integrity checks, and records a verification receipt.
- [ ] **BAK-03**: Backup and restore-verification status (last success, age, failures) is visible in the operations center without exposing secrets; never-verified and stale backups render as explicit non-green states.

### Degradation Alerting (ALRT)

- [ ] **ALRT-01**: An operator receives degradation alerts for provider-quota exhaustion, worker job failures and dead letters, sync-run failures, 5xx error spikes, and backup staleness.
- [ ] **ALRT-02**: Alerts are durable PostgreSQL records with deduplication, severity tiers, and transition history; channel delivery is an attempt, never the source of truth.
- [ ] **ALRT-03**: An operator can view active and recent alerts in the operations center with correlation context and redacted secrets.
- [ ] **ALRT-04**: Alert dispatch delivers to a configurable webhook endpoint (optionally SMTP) without leaking secrets or betting data.

### Performance Audit and Budgets (PERF)

- [ ] **PERF-01**: A user receives a fixture detail page that meets configured Lighthouse performance budgets measured as a median-of-3 audit against the production build, with before/after metrics recorded.
- [ ] **PERF-02**: Lighthouse assertions run in CI against key pages and fail on budget regression.

### Dixon-Coles Model Version (MODEL)

- [ ] **MODEL-01**: The forecast model applies a Dixon-Coles low-score correlation correction with a pinned tau convention and a bounded rho; tests prove rho=0 reproduces the Poisson model, the score matrix sums to 1, and draw probability rises for the documented sign.
- [ ] **MODEL-02**: Probabilities produced under the corrected model are issued under a new model version identity across the whole stack (snapshots, backtests, comparisons, validators) in one coherent pass.
- [ ] **MODEL-03**: An operator can compare rolling-origin backtest metrics of the new model version against the frozen baseline before it becomes the production default.

### Probability Calibration (CALIB)

- [ ] **CALIB-01**: A user can see calibrated probabilities (Platt first; isotonic only above a configured sample threshold) alongside raw model probabilities with a calibrator version label.
- [ ] **CALIB-02**: The system fits calibrators per exact model version on held-out settled windows with minimum-sample gates and structurally refuses calibrators whose pinned model version does not match the served forecast.
- [ ] **CALIB-03**: A promoted calibrator rolls back automatically under materiality and hysteresis gates when holdout Brier regresses; frozen snapshots are never modified.
- [ ] **CALIB-04**: Below minimum sample thresholds, the user sees an explicit insufficient-data-to-calibrate state instead of a fitted layer.

### CLV Price Diary (CLV)

- [ ] **CLV-01**: An operator can record a closing-odds observation per fixture, market, and selection with a UTC observed-at timestamp validated as pre-kickoff and pre-settlement.
- [ ] **CLV-02**: A user can see closing-line value per value candidate computed from de-vigged forecast-time and closing prices on the same line; a missing closing price renders as explicit unavailable and is never synthesized.
- [ ] **CLV-03**: Closing observations are append-only, and CLV never influences value ranking, scanner ordering, or journal decisions; it is evaluation-only.

### New Markets: Asian Handicap and Exact Score (MKT)

- [ ] **MKT-01**: A user can view Asian handicap probabilities and fair odds derived from the frozen score matrix, including quarter-line push and half-bet semantics.
- [ ] **MKT-02**: A user can view exact-score probabilities derived from the frozen score matrix for a configured bucket list including an explicit other-tail catch-all.
- [ ] **MKT-03**: An operator can enter complete odds books for Asian handicap and exact-score markets with the existing validation and no-vig normalization, and receive value receipts with push-aware expected value.
- [ ] **MKT-04**: Settlement resolves Asian handicap push, half-win, and half-loss outcomes and exact-score outcomes under explicit versioned rules inside the scorecard pipeline.
- [ ] **MKT-05**: The score matrix needed by new markets is persisted at forecast issuance or deterministically re-derived fail-closed for legacy snapshots.

### Value Scanner (SCAN)

- [ ] **SCAN-01**: A user can view a consolidated list of value candidates for the next seven days across fixtures and markets with fixture, market, selection, edge, expected value, and odds source.
- [ ] **SCAN-02**: The scanner displays stored receipt edges byte-for-byte without recomputation, with freshness demotion and explicit empty versus unavailable states.
- [ ] **SCAN-03**: The scanner page complies with responsible-gambling copy rules (no urgency or certainty claims, persistent disclaimers) and issues no N+1 query patterns.

### Paper-Trading Journal (JRN)

- [ ] **JRN-01**: An operator can record a paper (simulated) trade linked to an immutable value receipt with flat-unit and fractional-Kelly stake sizing capped at one quarter.
- [ ] **JRN-02**: The operator can see bankroll and unit curves, drawdown, ROI, and yield with push-aware denominators, sample gates, and explicit exclusion of pending and void trades.
- [ ] **JRN-03**: Trades are append-only with supersession corrections; the journal is clearly labeled as a simulation with Russian units/simulation vocabulary and no deposit or withdrawal verbs.
- [ ] **JRN-04**: Journal data never leaks into public read models or the privacy-sensitive contour.

## Future Requirements (deferred)

- League expansion (second divisions) — deferred beyond v1.1.
- User-facing notifications (Telegram/email) — deferred beyond v1.1.
- User accounts and consent-scoped personalization — deferred beyond v1.1 (v2.0 candidate, ACCT-01/ACCT-02).
- UI internationalization (EN locale) — deferred beyond v1.1.
- Advanced overround normalization (Shin, power methods) and licensed closing-line feeds (MODEL-02/MODEL-03 from v2.0 list).
- Isotonic upgrade trigger at >=1,000 settled outcomes per market cohort.
- Python/ML challenger model service (MODEL-01 from v2.0 list).

## Out of Scope

- Automatic bet placement or bookmaker execution — the platform stays analytical; the journal is explicitly simulated.
- Paid data, odds, or xG providers — free tiers and manual odds only.
- User notifications of any kind in this milestone — alerting is operator-only.
- Guaranteed-win, urgency, or certainty language on any new surface — rejected by the copy test suite.
- Mutating frozen snapshots or receipts for any convenience — change is always a superseding append-only row.

## Traceability

_Milestone v1.1 roadmap (2026-10-19): every requirement maps to exactly one phase._

| Requirement | Phase | Status |
|-------------|-------|--------|
| CI-01 | Phase 7 | Complete |
| CI-02 | Phase 7 | Complete |
| CI-03 | Phase 7 | Complete |
| CI-04 | Phase 7 | Complete |
| BAK-01 | Phase 8 | Pending |
| BAK-02 | Phase 8 | Pending |
| BAK-03 | Phase 8 | Pending |
| ALRT-01 | Phase 9 | Pending |
| ALRT-02 | Phase 9 | Pending |
| ALRT-03 | Phase 9 | Pending |
| ALRT-04 | Phase 9 | Pending |
| PERF-01 | Phase 10 | Pending |
| PERF-02 | Phase 10 | Pending |
| MODEL-01 | Phase 11 | Pending |
| MODEL-02 | Phase 11 | Pending |
| MODEL-03 | Phase 11 | Pending |
| CALIB-01 | Phase 12 | Pending |
| CALIB-02 | Phase 12 | Pending |
| CALIB-03 | Phase 12 | Pending |
| CALIB-04 | Phase 12 | Pending |
| CLV-01 | Phase 13 | Pending |
| CLV-02 | Phase 13 | Pending |
| CLV-03 | Phase 13 | Pending |
| MKT-01 | Phase 14 | Pending |
| MKT-02 | Phase 14 | Pending |
| MKT-03 | Phase 14 | Pending |
| MKT-04 | Phase 14 | Pending |
| MKT-05 | Phase 14 | Pending |
| SCAN-01 | Phase 15 | Pending |
| SCAN-02 | Phase 15 | Pending |
| SCAN-03 | Phase 15 | Pending |
| JRN-01 | Phase 16 | Pending |
| JRN-02 | Phase 16 | Pending |
| JRN-03 | Phase 16 | Pending |
| JRN-04 | Phase 16 | Pending |

**Coverage: 35/35 v1.1 requirements mapped — no orphans, no duplicates.**
