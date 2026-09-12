# Roadmap: Football Prediction & Value Betting Platform

## Overview

The MVP grows from one trustworthy, policy-compliant fixture path into an auditable forecasting workbench. Each phase closes a user-visible loop: canonical fixture discovery, chronological evidence, frozen forecasts with manual-odds value analysis, post-match measurement, provider-aware breadth, and finally a release-ready experience with operational controls.

## Phases

- [x] **Phase 1: Trustworthy Fixture Discovery** - Users can browse one supported competition through a healthy, policy-compliant system with canonical identities and visible data quality. (completed 2026-08-29)
- [x] **Phase 2: Historical Evidence Pipeline** - Users and operators can rely on replayable chronological history and leakage-safe team features. (completed 2026-09-05)
- [x] **Phase 3: Forecast and Manual Value Workbench** - Users can inspect frozen probabilities, enter odds, and receive reproducible value or abstention results. (completed 2026-09-08)
- [x] **Phase 4: Settlement and Evidence Scorecard** - Users can see how frozen forecasts and value candidates performed under chronological evaluation. (completed 2026-09-09)
- [ ] **Phase 5: Provider-Aware Coverage and Enrichment** - Users gain fallback competitions and evidence updates without losing canonical identity or visibility into limitations.
- [ ] **Phase 6: Release Experience and Operations** - Users and operators can safely use, understand, monitor, and verify the complete MVP on mobile and desktop.

## Phase Details

### Phase 1: Trustworthy Fixture Discovery

**Goal:** As a football analytics user, I want to discover upcoming fixtures with canonical identities, provenance, limitations, and policy-compliant access, so that I can trust the data before using betting analytics.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08
**Success Criteria** (what must be TRUE):

  1. A developer can install, build, lint, test, and run the web, API, worker, database, and queue from the shared workspace, with clear health and configuration failures that never reveal secrets.
  2. An eligible user can filter upcoming fixtures for the initial competition and open a fixture showing canonical participants, kickoff, status, provenance, and freshness.
  3. Users see explicit incomplete, stale, unsupported, or limited-data states, while unresolved canonical ambiguity blocks forecasting instead of producing misleading data.
  4. An administrator can review ambiguous provider matches and leave an auditable approve, reject, or correction decision without creating duplicate canonical entities.
  5. Betting analytics are server-gated by configurable jurisdiction and age policy, and every forecast/value surface uses probabilistic language, persistent risk disclosure, and automated rejection of prohibited certainty claims.

**Plans**: 12/12 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Establish the pinned root workspace and local PostgreSQL/Redis dependencies.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Scaffold the compile-safe Next.js and NestJS processes.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Scaffold worker/config packages and deterministic test harnesses.

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Prove the first browser-to-API Premier League fixture tracer and redacted readiness.

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-05-PLAN.md — Materialize provider-independent canonical identity and auditable reconciliation.
- [x] 01-08-PLAN.md — Implement five honest data states and configured freshness.

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01-06-PLAN.md — Persist provider capability and atomic provider/date/endpoint reservations.
- [x] 01-09-PLAN.md — Enforce deny-by-default eligibility and responsible copy.

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 01-07-PLAN.md — Enforce capability and reservations on football-data.org fixture ingestion.

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 01-10-PLAN.md — Complete canonical fixture discovery and detail journeys.
- [x] 01-11-PLAN.md — Deliver protected append-only ambiguity review.

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 01-12-PLAN.md — Close held-out security, UI, and source-coverage validation.

**UI hint**: yes

### Phase 2: Historical Evidence Pipeline

**Goal**: As a football analytics user, I want to inspect time-correct team evidence and request safe historical replays, so that I can rely on reproducible, quota-aware football history.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08
**Success Criteria** (what must be TRUE):

  1. Upcoming fixtures, completed results, and standings synchronize through retryable jobs without duplicating durable football facts when rerun.
  2. An operator can see degraded provider state and replay failed or historical work while critical fixture/result calls retain quota priority over optional enrichment.
  3. Every external call is preceded by an atomic provider/date/endpoint budget reservation, and normalized facts retain raw-source provenance and capture time.
  4. A user can view recent team history plus five- and ten-match weighted form as known at a selected point in time.
  5. Elo, home/away strength, goal rates, rest days, and low-weight H2H are chronological and exclude facts captured after the requested cutoff.

**Plans**: 28/28 plans executed; final phase verification pending

- [x] 02-16-PLAN.md
- [x] 02-17-PLAN.md
- [x] 02-18-PLAN.md
- [x] 02-19-PLAN.md
- [x] 02-20-PLAN.md
- [x] 02-21-PLAN.md
- [x] 02-22-PLAN.md

**Wave 19** *(gap closure; blocked on Wave 18 completion)*

- [x] 02-23-PLAN.md
- [x] 02-24-PLAN.md
- [x] 02-25-PLAN.md

**Wave 20** *(blocked on Wave 19 completion)*

- [x] 02-26-PLAN.md

**Wave 22** *(gap closure; depends on 02-26, effective DAG wave 21)*

- [x] 02-27-PLAN.md — Stable replay policy identity with fresh per-unit admission.

**Wave 23** *(blocked on 02-27 completion)*

- [x] 02-28-PLAN.md — Recoverable execution leases, fenced publication and hard-crash recovery.

- [x] 02-11-PLAN.md
- [x] 02-12-PLAN.md
- [x] 02-13-PLAN.md
- [x] 02-14-PLAN.md
- [x] 02-15-PLAN.md

**Wave 1**

- [x] 02-01-PLAN.md

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md
- [x] 02-03-PLAN.md

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-04-PLAN.md

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-05-PLAN.md

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02-06-PLAN.md

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 02-07-PLAN.md

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 02-08-PLAN.md

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 02-09-PLAN.md

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 02-10-PLAN.md

**UI hint**: yes

### Phase 3: Forecast and Manual Value Workbench

**Goal**: As a football analytics user, I want to compare a frozen forecast with manual odds, so that I can see a reproducible value or abstention result.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: PRED-01, PRED-02, PRED-03, PRED-04, PRED-05, PRED-06, ODDS-01, ODDS-02, ODDS-03, VALUE-01, VALUE-02, VALUE-03, VALUE-04
**Success Criteria** (what must be TRUE):

  1. A user can inspect normalized 1X2, Over/Under 2.5, and BTTS probabilities, derived fair odds, and the Poisson/Elo/form evidence behind them.
  2. A user can distinguish event probability from confidence and inspect completeness, lineup, freshness, source-reliability, and model-stability components.
  3. INITIAL and PRE_MATCH forecasts are immutable receipts tied to model/configuration, cutoff, feature inputs, and source timestamps; LINEUP_CONFIRMED exists only with an official confirmed lineup.
  4. A user can enter a complete positive decimal-odds book, correct actionable validation errors, and inspect its immutable provenance and multiplicatively normalized no-vig probabilities.
  5. The exact forecast and odds snapshots produce edge and expected value, with a candidate shown only when all gates pass and an explicit no-value or insufficient-evidence result otherwise.

**Plans**: 12 plans (7 complete, 5 gap-closure)

- [x] 03-01-PLAN.md
- [x] 03-02-PLAN.md
- [x] 03-03-PLAN.md
- [x] 03-04-PLAN.md
- [x] 03-05-PLAN.md
- [x] 03-06-PLAN.md
- [x] 03-07-PLAN.md
- [x] 03-08-PLAN.md — Bind official lineup provenance and serialize forecast revisions
- [x] 03-09-PLAN.md — Harden canonical, provenance-complete, fixture-scoped manual odds
- [x] 03-10-PLAN.md — Make value receipts selection-aware and database-verifiable
- [x] 03-11-PLAN.md — Discover issued forecasts at their exact immutable identities
- [x] 03-12-PLAN.md — Prove all repaired boundaries in integration and browser flows

**UI hint**: yes

### Phase 4: Settlement and Evidence Scorecard

**Goal:** As a user, I want to review settled frozen forecasts, so that I can judge predictive and financial quality.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, EVAL-06, EVAL-07, EVAL-08
**Success Criteria** (what must be TRUE):

  1. Completed, postponed, cancelled, abandoned, and void fixtures resolve under explicit versioned rules against the exact frozen pre-match prediction.
  2. A user can view Brier Score and Log Loss by model version, competition, market, and period with the cohort sample size.
  3. A user can inspect reliability buckets and identify under-confident or over-confident cohorts.
  4. Frozen value candidates show per-result unit profit/loss and aggregate ROI and Yield with denominators and sample sizes; weak cohorts are labeled or suppressed.
  5. Backtests use rolling-origin chronology and production-equivalent as-of features, while CLV is shown only when comparable timestamped prices exist and explicitly unavailable otherwise.

**Plans**: 9/9 plans executed

Plans:

- [x] 04-01-PLAN.md — Append-only settlement receipts bound to exact frozen forecasts
- [x] 04-02-PLAN.md — Versioned Brier and Log Loss facts
- [x] 04-03-PLAN.md — Reliability buckets and honest cohort-health gates
- [x] 04-04-PLAN.md — Flat-unit value settlement and fail-closed CLV
- [x] 04-05-PLAN.md — Leakage-safe rolling-origin backtests
- [x] 04-06-PLAN.md — Guarded URL-stable evidence scorecard API and UI
- [x] 04-07-PLAN.md — PostgreSQL security matrix and production Chromium acceptance
- [x] 04-08-PLAN.md — Idempotent result-to-settlement-to-score/value worker pipeline
- [x] 04-09-PLAN.md — Production scored rolling-origin worker and matched model comparison

**UI hint**: yes

### Phase 5: Provider-Aware Coverage and Enrichment

**Goal**: Users can access configured competition breadth and pre-match evidence updates while provider failures remain visible and canonical identities remain stable.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07
**Success Criteria** (what must be TRUE):

  1. Top-five leagues and Champions League use football-data.org primarily and can fall back to API-Football without changing canonical fixture or team identity.
  2. Europa League and Conference League use API-Football, and users see an explicit limited-data state when that no-fallback source is unavailable.
  3. Optional lineup, injury, odds, and detailed-statistics calls occur only when recorded coverage and budget policy permit them.
  4. A user can compare INITIAL, PRE_MATCH, and available LINEUP_CONFIRMED snapshots and see which evidence changed the forecast.
  5. TheSportsDB may suggest reconciliation names and logos for administrator review but cannot supply match statistics or silently resolve ambiguity.

**Plans**: 3/10 plans executed

Plans:

**Wave 1**

- [x] 05-01-PLAN.md — Promote the provider-neutral contract and add the strict API-Football core adapter.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Persist migration-proven route, attempt, quota and throttle evidence.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-06-PLAN.md — Provide server-authoritative exact forecast-pair comparison.
- [ ] 05-09-PLAN.md — Produce the redacted provider-policy probe and register its authenticated approval boundary in the production Nest graph.

**Wave 4** *(routing/enrichment blocked on 05-09; UI comparison blocked on 05-06)*

- [ ] 05-03-PLAN.md — Route core ingestion with canonical-identity-safe fallback and no-fallback outcomes.
- [ ] 05-04-PLAN.md — Admit and schedule quota-safe optional pre-match enrichment.
- [ ] 05-07-PLAN.md — Deliver URL-stable accessible forecast comparison UI.

**Wave 5** *(blocked on core routing)*

- [ ] 05-05-PLAN.md — Surface exact provider degradation states on fixture collection and detail.

**Wave 6** *(blocked on routing, enrichment, provider-state and comparison UI)*

- [ ] 05-08-PLAN.md — Add suggestion-only TheSportsDB review and server-side logo validation.

**Wave 7** *(blocked on suggestion/logo service and authenticated provider module registration)*

- [ ] 05-10-PLAN.md — Register the validated provider-logo HTTP boundary and close held-out security/UI acceptance.

**UI hint**: yes

### Phase 6: Release Experience and Operations

**Goal**: Users and operators can safely understand, operate, and verify the complete fixture-to-evaluation experience across supported devices and failure states.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: UX-01, UX-02, OPS-01, OPS-02, OPS-03, PRIV-01
**Success Criteria** (what must be TRUE):

  1. A user can complete fixture, analysis, manual-odds, value, and performance workflows on mobile and desktop with keyboard-accessible controls and readable charts.
  2. A user can read a versioned methodology/model card covering inputs, exclusions, confidence, limitations, evaluation, and responsible use.
  3. An operator can inspect failures, dead letters, provider health, quotas, data-quality errors, and correlation IDs without secrets being exposed.
  4. An operator can safely retry ingestion and evaluation work and verify that durable facts and immutable snapshots remain consistent.
  5. Release checks exercise the complete fixture-to-forecast-to-odds-to-settlement loop and provider degradation states, while betting-related history is not retained without explicit consent and a documented boundary.

**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Trustworthy Fixture Discovery | 12/12 | Complete    | 2026-08-29 |
| 2. Historical Evidence Pipeline | 28/28 | Complete    | 2026-09-05 |
| 3. Forecast and Manual Value Workbench | 12/12 | Complete    | 2026-09-08 |
| 4. Settlement and Evidence Scorecard | 9/9 | Complete    | 2026-09-09 |
| 5. Provider-Aware Coverage and Enrichment | 3/10 | In Progress|  |
| 6. Release Experience and Operations | 0/TBD | Not started | - |
