# Requirements: Football Prediction & Value Betting Platform

**Defined:** 2026-08-27
**Core Value:** Produce honest, reproducible probability estimates whose quality can be measured after every completed match.

## v1 Requirements

### Foundation and Guardrails

- [x] **FOUND-01**: A developer can install, build, lint, test, and run the web, API, worker, and shared packages from one pnpm/Turborepo workspace.
- [x] **FOUND-02**: An operator can start PostgreSQL and Redis locally and verify health for the web, API, worker, database, and queue dependencies.
- [x] **FOUND-03**: The system validates required configuration and secrets at startup without exposing secret values to clients or logs.
- [x] **FOUND-04**: A user sees probabilistic language and a persistent betting-risk disclaimer anywhere a forecast or value result is displayed.
- [x] **FOUND-05**: The API enforces a configurable jurisdiction and age-eligibility policy before exposing betting-related analytics.
- [x] **FOUND-06**: Automated tests reject prohibited guaranteed-profit, guaranteed-win, urgency, or certainty claims in user-facing content.

### Canonical Football Data

- [x] **DATA-01**: A user can view upcoming fixtures for the initial supported competition, filtered by date and competition.
- [x] **DATA-02**: A user can open a fixture and see canonical teams, competition, season, kickoff, status, source provenance, and freshness.
- [x] **DATA-03**: The system maps each provider league, team, player, and fixture reference to a canonical entity without coupling canonical IDs to a provider.
- [x] **DATA-04**: The system reconciles a fixture across providers using canonical teams and a defined kickoff window without creating a duplicate fixture.
- [x] **DATA-05**: An administrator can review ambiguous entity matches and approve, reject, or correct them with an auditable decision history.
- [x] **DATA-06**: The system blocks forecasting for fixtures whose required canonical identity remains ambiguous.
- [x] **DATA-07**: A user can see when fixture data is incomplete, stale, unsupported, or limited rather than seeing missing values represented as zero.
- [x] **DATA-08**: The system records provider capabilities by competition, season, and endpoint before requesting conditionally available data.

### Resilient Historical Pipeline

- [x] **PIPE-01**: The worker synchronizes upcoming fixtures, completed results, and standings through idempotent, retryable jobs.
- [x] **PIPE-02**: The system persists raw-source provenance and capture timestamps needed to audit normalized football facts.
- [x] **PIPE-03**: The system atomically reserves and records request budget per provider, date, and endpoint type before each external call.
- [x] **PIPE-04**: Critical fixture and result calls retain budget priority over lineups, injuries, odds, and secondary statistics.
- [x] **PIPE-05**: The worker uses bounded retries, backoff, and circuit breaking, and exposes degraded provider state without corrupting durable data.
- [x] **PIPE-06**: An operator can replay failed or historical jobs without duplicating canonical facts, ratings, or snapshots.
- [x] **PIPE-07**: A user can view a team's recent match history and its five-match and ten-match weighted form as known at a requested point in time.
- [x] **PIPE-08**: The system calculates chronological Elo, home/away strength, goal rates, rest days, and low-weight H2H without using facts captured after the evaluation cutoff.

### Forecasting and Value Analysis

- [x] **PRED-01**: A user can view normalized home, draw, and away probabilities whose sum satisfies the configured probability invariant.
- [x] **PRED-02**: A user can view Over/Under 2.5 and BTTS Yes/No probabilities derived from a Poisson score matrix covering at least 0:0 through 7:7.
- [x] **PRED-03**: A user can view fair decimal odds corresponding to each supported model probability.
- [x] **PRED-04**: Every forecast is stored as an immutable snapshot linked to its fixture, model version, configuration, as-of cutoff, feature inputs, and source timestamps.
- [x] **PRED-05**: A user can distinguish event probability from confidence and inspect the completeness, lineup, freshness, source-reliability, and model-stability confidence components.
- [x] **PRED-06**: The system creates INITIAL and PRE_MATCH snapshots and creates LINEUP_CONFIRMED only when an official confirmed lineup exists.
- [x] **ODDS-01**: A user can enter a complete mutually exclusive set of positive decimal odds for a supported market and receives actionable validation errors for invalid or incomplete input.
- [x] **ODDS-02**: The system stores manual odds immutably with fixture, market, selection, source, and capture time.
- [x] **ODDS-03**: A user can view multiplicatively normalized no-vig market probabilities for a complete odds book.
- [x] **VALUE-01**: A user can view edge and expected value calculated from one exact prediction snapshot and one exact odds snapshot.
- [x] **VALUE-02**: A user sees a value candidate only when configurable edge, expected-value, confidence, and data-quality gates pass.
- [x] **VALUE-03**: A user sees an explicit no-value or insufficient-evidence state when thresholds or data-quality gates do not pass.
- [x] **VALUE-04**: A user can inspect a reproducible prediction receipt showing the model version, input cutoff, source provenance, assumptions, and odds used for the value result.

### Settlement, Backtesting, and Calibration

- [x] **EVAL-01**: The system resolves completed, postponed, cancelled, abandoned, and void fixtures using explicit versioned settlement rules.
- [x] **EVAL-02**: The system scores the exact frozen pre-match prediction rather than recomputing it with later data.
- [x] **EVAL-03**: A user can view Brier Score and Log Loss by model version, competition, market, and evaluation period with sample size.
- [x] **EVAL-04**: A user can view calibration/reliability results by probability bucket and identify under-confident or over-confident cohorts.
- [x] **EVAL-05**: A user can view the outcome and unit profit/loss of each frozen value candidate and aggregate ROI and Yield with denominator and sample size.
- [x] **EVAL-06**: Backtests and model comparisons use chronological rolling-origin evaluation and enforce the same as-of feature contract as production.
- [x] **EVAL-07**: The system suppresses or labels performance/value claims when configured minimum sample-size or calibration-quality gates are not met.
- [x] **EVAL-08**: CLV is displayed only when comparable timestamped market prices exist; it is otherwise explicitly unavailable.

### Provider Fallback and Enrichment

- [x] **PROV-01**: The system uses football-data.org as primary for configured top-five leagues and Champions League fixtures and standings.
- [x] **PROV-02**: The system can route eligible top-five/UCL requests to API-Football fallback without changing canonical fixture or team identity.
- [x] **PROV-03**: The system can use API-Football as the primary source for configured Europa League and Conference League data.
- [x] **PROV-04**: A user sees a limited-data state for Europa League or Conference League when API-Football is unavailable because no production fallback exists.
- [x] **PROV-05**: The system calls lineup, injury, odds, or detailed-statistics endpoints only when the provider capability record confirms coverage and budget policy permits the call.
- [x] **PROV-06**: A user can compare INITIAL, PRE_MATCH, and available LINEUP_CONFIRMED snapshots and see which evidence changed the forecast.
- [ ] **PROV-07**: TheSportsDB can suggest names and logos for reconciliation review but cannot supply production match statistics or silently approve ambiguous matches.

### Release Experience and Operations

- [ ] **UX-01**: A user can use fixture, match analysis, manual odds, value, and performance workflows on mobile and desktop with keyboard-accessible controls and readable charts.
- [ ] **UX-02**: A user can view a versioned methodology/model-card page explaining inputs, exclusions, confidence, limitations, evaluation, and responsible-use policy.
- [ ] **OPS-01**: An operator can inspect job failures, dead-lettered work, provider health, quota consumption, data-quality errors, and correlation identifiers without exposing secrets.
- [ ] **OPS-02**: An operator can safely retry or replay failed ingestion/evaluation work and verify that durable facts and immutable snapshots remain consistent.
- [ ] **OPS-03**: Release verification covers the complete fixture-to-forecast-to-manual-odds-to-settlement workflow and representative provider degradation states.
- [ ] **PRIV-01**: The system does not persist user betting-related history without explicit consent and a documented retention boundary.

## v2 Requirements

### Accounts and Personalization

- **ACCT-01**: A user can create an account and save followed competitions, fixtures, and analysis history with explicit consent.
- **ACCT-02**: A user can configure privacy, retention, and notification preferences for saved activity.

### Data and Models

- **MODEL-01**: An analyst can evaluate a Python/ML challenger against the frozen V1 baseline and promote it only after measurable walk-forward improvement.
- **MODEL-02**: A user can compare multiplicative, Shin, and power-method overround normalization when sample evidence supports the choice.
- **MODEL-03**: The system can ingest licensed automated odds history and calculate reliable closing-line value.
- **MODEL-04**: The system can add further goal lines, double-chance, and team-total markets after settlement and calibration rules are verified.
- **DATA-09**: The system can add more competitions only after provider coverage, identity semantics, and evaluation cohorts are validated.

### Responsible Gambling

- **SAFE-01**: A user can self-exclude from betting-related analytics.
- **SAFE-02**: A user can configure activity limits and safer-gambling reminders without urgency or engagement pressure.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automatic bet placement or bookmaker execution | The product is an analytical workbench, not a wagering agent. |
| Guaranteed picks, profit claims, or certainty language | Conflicts with probabilistic evidence and responsible-gambling requirements. |
| Live/in-play betting signals | Requires different data latency, licensing, risk, and operational guarantees. |
| Parlays, staking advice, bankroll optimization, or tipster mechanics | Encourages prescriptive wagering and distracts from forecast calibration. |
| Paid providers in MVP | Initial value must be validated without recurring data cost. |
| Unofficial live scraping as a required path | Availability and Terms-of-Service risk make it unsuitable for a reliable MVP dependency. |
| Current-season FBref advanced stats | The source is historical-only after its 2026 data-license change. |
| StatsBomb Open Data in the live pipeline | It is limited historical training/calibration data, not current production coverage. |
| Black-box ML in V1 | A transparent Poisson/Elo baseline must be measured before adding complexity. |
| Urgency notifications or personalized wagering prompts | Incompatible with the intended responsible-use experience. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| FOUND-06 | Phase 1 | Complete |
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 1 | Complete |
| DATA-04 | Phase 1 | Complete |
| DATA-05 | Phase 1 | Complete |
| DATA-06 | Phase 1 | Complete |
| DATA-07 | Phase 1 | Complete |
| DATA-08 | Phase 1 | Complete |
| PIPE-01 | Phase 2 | Complete |
| PIPE-02 | Phase 2 | Complete |
| PIPE-03 | Phase 2 | Complete |
| PIPE-04 | Phase 2 | Complete |
| PIPE-05 | Phase 2 | Complete |
| PIPE-06 | Phase 2 | Complete |
| PIPE-07 | Phase 2 | Complete |
| PIPE-08 | Phase 2 | Complete |
| PRED-01 | Phase 3 | Complete |
| PRED-02 | Phase 3 | Complete |
| PRED-03 | Phase 3 | Complete |
| PRED-04 | Phase 3 | Complete |
| PRED-05 | Phase 3 | Complete |
| PRED-06 | Phase 3 | Complete |
| ODDS-01 | Phase 3 | Complete |
| ODDS-02 | Phase 3 | Complete |
| ODDS-03 | Phase 3 | Complete |
| VALUE-01 | Phase 3 | Complete |
| VALUE-02 | Phase 3 | Complete |
| VALUE-03 | Phase 3 | Complete |
| VALUE-04 | Phase 3 | Complete |
| EVAL-01 | Phase 4 | Complete |
| EVAL-02 | Phase 4 | Complete |
| EVAL-03 | Phase 4 | Complete |
| EVAL-04 | Phase 4 | Complete |
| EVAL-05 | Phase 4 | Complete |
| EVAL-06 | Phase 4 | Complete |
| EVAL-07 | Phase 4 | Complete |
| EVAL-08 | Phase 4 | Complete |
| PROV-01 | Phase 5 | Complete |
| PROV-02 | Phase 5 | Complete |
| PROV-03 | Phase 5 | Complete |
| PROV-04 | Phase 5 | Complete |
| PROV-05 | Phase 5 | Complete |
| PROV-06 | Phase 5 | Complete |
| PROV-07 | Phase 5 | Pending |
| UX-01 | Phase 6 | Pending |
| UX-02 | Phase 6 | Pending |
| OPS-01 | Phase 6 | Pending |
| OPS-02 | Phase 6 | Pending |
| OPS-03 | Phase 6 | Pending |
| PRIV-01 | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 56 total
- Mapped to phases: 56
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-27*
*Last updated: 2026-08-27 after roadmap creation*
