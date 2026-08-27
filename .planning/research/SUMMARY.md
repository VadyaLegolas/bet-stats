# Project Research Summary

**Project:** Football Prediction & Value Betting Platform
**Domain:** Auditable football probability and manual-odds value analytics
**Researched:** 2026-08-27
**Confidence:** MEDIUM-HIGH

## Executive Summary

This product should be built as a transparent forecasting workbench, not a tipster feed or bookmaker interface. Its core user loop is: inspect an upcoming fixture, understand a reproducible probability estimate, enter a complete set of decimal odds, see the model-estimated edge, and later verify the frozen forecast against the result. The defensible advantage is not market breadth; it is auditability, calibration, visible data quality, and an honest ability to abstain when evidence is weak.

The recommended implementation is an ESM-first TypeScript modular monolith with a separate pipeline worker: Next.js for the web UI, NestJS for REST and policy enforcement, PostgreSQL/Prisma as the authoritative store, and Redis/BullMQ for retryable scheduled work. Pure domain packages should implement as-of features, Poisson/Elo forecasts, odds normalization, value calculations, settlement, and evaluation. Start with one provider and one competition to prove canonical identity, temporal integrity, quotas, immutable snapshots, and replay before adding fallbacks or enrichment.

The largest risks are temporal leakage, cross-provider identity corruption, uncalibrated probabilities being marketed as value, free-tier coverage assumptions, quota exhaustion, and gambling-adjacent UX that implies certainty. Mitigate them structurally: immutable feature and prediction snapshots, audited reconciliation with ambiguity quarantine, atomic provider budgets, complete odds provenance, walk-forward evaluation with proper scoring rules, visible limited-data states, and server-enforced jurisdiction/content policy.

## Key Findings

### Recommended Stack

Use a single TypeScript toolchain and keep mathematical domain code dependency-light. Modernize the supplied Prisma schema before generating a client: Prisma 7 requires ESM conventions, an explicit generated-client output, `prisma.config.ts`, and the PostgreSQL driver adapter. PostgreSQL holds all durable facts and snapshots; Redis remains disposable coordination infrastructure.

**Core technologies:**

- Node.js 24 LTS and TypeScript 5.9 — one supported runtime and strict type system across apps, workers, and packages.
- pnpm 10 and Turborepo 2 — workspace dependency boundaries and cached task orchestration.
- Next.js 16.2, React 19.2, Tailwind 4, TanStack Query 5, and Recharts 3.8 — responsive analytical UI and performance visualization.
- NestJS 11 REST API — modular composition, validation, policy enforcement, and OpenAPI; use Express 5 unless profiling justifies Fastify.
- PostgreSQL 18 and Prisma 7 LTS — relational integrity, migrations, typed access, and auditable immutable history.
- Redis 8 and BullMQ 6 — schedules, delayed jobs, rate limits, retries, and deduplication; never the source of truth.
- Zod, `decimal.js`, Pino, Cockatiel, Vitest, Testcontainers, Supertest, and Playwright — untrusted-input validation, precise odds math, resilience, observability, and realistic verification.
- Pure TypeScript Poisson/Elo/form/value/evaluation functions — transparent and replayable; defer Python/ML until a challenger proves measurable walk-forward lift.

See [STACK.md](./STACK.md) for version constraints and alternatives.

### Expected Features

**Must have (table stakes):**

- Upcoming-fixture dashboard and match pages with competition/date filters, evidence, freshness, limitations, and limited-data states.
- Canonical league/team/fixture identity with provider references, reconciliation audit history, and an ambiguity review queue.
- Versioned Poisson + Elo + weighted-form forecasts for 1X2, O/U 2.5, and BTTS, with fair odds and confidence components kept separate from event probability.
- Manual complete-market decimal-odds entry, multiplicative no-vig normalization, edge/EV, configurable thresholds, and a first-class no-value result.
- Immutable INITIAL/PRE_MATCH prediction receipts tied to as-of inputs; LINEUP_CONFIRMED only when the lineup is actually confirmed.
- Automated settlement and calibration-first reporting: Brier Score, Log Loss, reliability, sample size, ROI, and Yield; CLV only when comparable timestamped prices exist.
- Responsive, accessible presentation plus persistent responsible-gambling, age, jurisdiction, privacy, and no-certainty controls.

**Should have (competitive):**

- Reproducible prediction receipts with model/config and source provenance.
- Provider-aware evidence trails and data-quality filtering.
- Snapshot-delta explanations and per-league/per-market suitability gates.
- Audited reconciliation administration and a versioned methodology/model-card page.
- Alternative overround methods and additional derived markets after the core score matrix is validated.

**Defer (v2+):**

- Paid/licensed automated odds and CLV feeds, accounts and saved histories, Python/ML challengers, broader competitions, and personalization.
- Automatic bet placement, live/in-play signals, parlays, staking advice, tipster/social mechanics, urgency notifications, unofficial live scraping, and guaranteed-pick language should remain excluded.

See [FEATURES.md](./FEATURES.md) for dependency and priority detail.

### Architecture Approach

Build a modular monolith with one web app, one API, and one independently runnable pipeline worker. Domain packages remain framework-free; provider ports normalize external payloads, a separate policy layer owns coverage and quotas, reconciliation owns canonical identity, and PostgreSQL commits durable facts before jobs are acknowledged. Use small idempotent at-least-once jobs with deterministic IDs plus database guards. Append immutable facts and derive rebuildable read models.

**Major components:**

1. Web — fixture discovery, analysis, manual odds, performance, degraded states, and responsible-use messaging.
2. API — versioned queries/manual commands, validation, authentication and region policy, and job enqueueing.
3. Pipeline worker — provider sync, reconciliation, as-of features, forecasts, result resolution, ratings, and evaluation.
4. Provider gateway and policy — adapters, runtime capability matrix, atomic quota reservation, raw audit, retries, and circuit state.
5. Reconciliation — external-reference-first matching, ambiguity quarantine, reviewed merge/split decisions, and canonical writes.
6. Prediction/value/evaluation packages — deterministic math and settlement operating only on explicit immutable snapshots.
7. Database and observability — constraints, append-only repositories, health, correlations, provider metrics, and rebuildable projections.

Key patterns are ports/adapters, staged idempotent jobs, as-of feature contracts, immutable prediction/odds/outcome facts, transactional reconciliation, and versioned DTOs that do not leak Prisma or provider objects. See [ARCHITECTURE.md](./ARCHITECTURE.md).

### Critical Pitfalls

1. **Temporal leakage** — require `asOf` in every feature query, persist inputs and source timestamps, replay chronologically, and use rolling-origin evaluation only.
2. **Cross-provider identity corruption** — resolve exact external references first, quarantine ambiguity, preserve decisions and reversals, and block forecasting for unresolved entities.
3. **Miscalibrated or false value claims** — enforce probability invariants, validate complete odds books, link exact prediction/odds snapshots, freeze selection rules, and report calibration/sample size before ROI claims.
4. **Coverage and quota failure** — probe real provider capabilities per competition/season, represent missingness explicitly, reserve budgets atomically before calls, and prioritize fixtures/results over optional enrichment.
5. **Responsible-gambling reduced to copy** — enforce jurisdiction and policy server-side, test prohibited claims across all surfaces, show uncertainty and losing history, and keep execution/urgency/personalized staking out of scope.

See [PITFALLS.md](./PITFALLS.md) for warning signs and recovery strategies.

## Implications for Roadmap

Based on the combined dependencies, use seven vertical phases.

### Phase 1: Product Guardrails and Walking Skeleton

**Rationale:** Legal/product constraints and runtime conventions affect every later contract; Prisma modernization is cheapest before the first generated client.
**Delivers:** pnpm/Turbo workspace; web, API, and worker health paths; PostgreSQL/Redis; validated config; CI; core IDs/market enums; jurisdiction/content decision record.
**Addresses:** Responsible-use foundation and deployment skeleton.
**Avoids:** Prisma 6-era lock-in, framework leakage, client-only region controls, and late compliance redesign.

### Phase 2: Canonical Data and Provider Contracts

**Rationale:** Forecasts are meaningless until fixture identity, provenance, coverage, and temporal facts are trustworthy.
**Delivers:** One competition through football-data.org; raw audit; canonical league/team/fixture schema; external refs; reconciliation review; capability matrix; upcoming-fixtures API and limited-data UI.
**Addresses:** Fixture dashboard, canonical reconciliation, provider evidence, freshness states.
**Avoids:** Duplicate/mismerged entities, assumed free-tier coverage, missing-as-zero errors, and ambiguous fixture uniqueness.

### Phase 3: Resilient Historical Pipeline

**Rationale:** Chronological team state and reliable ingestion must precede prediction.
**Delivers:** Results sync, atomic quota ledger, small idempotent BullMQ jobs, retries/circuits, replay tooling, team history, Elo/form/home-away/rest features with enforced `asOf`.
**Addresses:** Reliable provider collection and baseline analytical inputs.
**Avoids:** Quota exhaustion, one giant sync job, at-least-once duplication, stale state, and temporal leakage foundations.

### Phase 4: Forecast Receipt and Manual Value Analysis

**Rationale:** This is the smallest complete product loop once trustworthy history exists.
**Delivers:** Immutable feature and prediction snapshots; Poisson/Elo/form probabilities for 1X2, O/U 2.5, and BTTS; match explanations; manual complete-market odds; no-vig, edge, EV, thresholds, abstention; prediction/odds-linked candidates.
**Addresses:** Core probabilities, fair odds, manual odds, value detection, confidence explanation, and prediction receipts.
**Avoids:** Mutable/output-only forecasts, incoherent odds inputs, false-value lineage, and confidence/probability conflation.

### Phase 5: Settlement, Backtesting, and Calibration Gate

**Rationale:** Close the evidence loop before expanding providers, competitions, markets, or models.
**Delivers:** Explicit settlement for completed/postponed/cancelled/void cases; per-snapshot Brier and Log Loss; reliability tables; chronological replay; frozen candidate ROI/Yield; sample/cohort quality gates; performance UI.
**Addresses:** Forecast scorecard, value-result tracking, calibration-first dashboard, and per-market suitability.
**Avoids:** Accuracy-only claims, test-set calibration, selection bias, mutable-history backtests, and ROI without denominators.

### Phase 6: Fallbacks and Pre-match Enrichment

**Rationale:** Multi-provider complexity should be added only after single-provider identity and evaluation are proven.
**Delivers:** API-Football routing and coverage budgets; TheSportsDB-assisted identity review; EL/UECL degraded states; PRE_MATCH and conditional LINEUP_CONFIRMED snapshots; delta explanations and data-quality filters.
**Addresses:** Provider fallback, conditional lineups, wider competition support, and snapshot comparison.
**Avoids:** Provider-ID coupling, silent coverage loss, auto-accepted fuzzy matches, and enrichment blocking the fixture/results baseline.

### Phase 7: Release UX and Operational Hardening

**Rationale:** Release claims and reliability must be validated against real accumulated data and failure states.
**Delivers:** Responsive/accessibility polish, model card, prohibited-claims tests, server-side jurisdiction gate, consent/retention boundaries, queue/provider alerts, dead-letter/replay operations, end-to-end release checks.
**Addresses:** Trustworthy public presentation, methodology, operational admin, and responsible-gambling requirements.
**Avoids:** Misleading green-value UX, hidden degradation, urgency patterns, leaked keys, public job triggering, and unreviewed behavioral-data collection.

### Phase Ordering Rationale

- Identity, provenance, and `asOf` semantics are upstream of every model and evaluation result.
- Reliable historical state precedes prediction; immutable prediction/odds facts precede settlement and performance reporting.
- Evaluation precedes breadth so new providers, leagues, markets, or models cannot outrun evidence quality.
- Provider fallbacks and lineup enrichment are delayed until the canonical single-provider path can be replayed and audited.
- Responsible-use policy starts in Phase 1 and receives a release-wide enforcement pass in Phase 7.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 2:** Live-key provider capability probes, competition/season/round/leg identity, raw payload retention, and reconciliation thresholds are project-specific.
- **Phase 5:** Market settlement rules, calibration acceptance thresholds, confidence intervals, and minimum cohort sizes require domain decisions.
- **Phase 6:** Current API-Football coverage, reset semantics, fallback behavior, and lineup completeness are time-sensitive and must be reverified.
- **Phase 7:** Launch jurisdiction, age assurance, consent, retention, claims policy, and support-resource requirements need legal/privacy review.

Phases with standard patterns (skip research-phase unless requirements change):

- **Phase 1:** Monorepo bootstrap, service health, Prisma 7 modernization, configuration, and CI are well documented.
- **Phase 3:** BullMQ idempotency, transactional quota reservation, retries, circuit breakers, and as-of repository patterns are established.
- **Phase 4:** Poisson/Elo arithmetic, immutable append workflows, odds validation, multiplicative no-vig, edge, and EV are explicit and testable.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core versions and compatibility are supported by official runtime/framework/database documentation; refresh exact patch versions when locking dependencies. |
| Features | MEDIUM | Strong alignment between project intent and current competitors, but target segment, default explanation depth, and manual-odds UX lack direct user validation. |
| Architecture | MEDIUM-HIGH | Modular-monolith, append-only, ports/adapters, and idempotent pipeline patterns are well established; football identity and retention details remain project-specific. |
| Pitfalls | MEDIUM-HIGH | Risks are consistent across official ML, provider, queue, identity, and regulator guidance; exact thresholds and jurisdiction obligations remain unresolved. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- Launch user segment and jurisdiction — validate before finalizing explanation depth, onboarding, age assurance, consent, and regional gating.
- Real provider coverage — probe representative competitions/seasons with actual plan credentials immediately before Phase 2/6 planning.
- Canonical fixture identity — define season, stage, round, leg, postponement, neutral venue, and provider correction semantics before migrations harden.
- Raw payload retention — choose PostgreSQL JSON versus object storage, with checksum, provenance, redaction, and retention rules.
- Snapshot lifecycle — define whether `FINAL` means final pre-kickoff or remove it; outcomes must remain separate.
- Settlement taxonomy — specify every market selection and postponed/cancelled/abandoned/void rule before evaluation.
- Validation gates — choose minimum sample sizes, calibration thresholds, confidence intervals, and rules for disabling weak league/market cohorts.
- Manual odds UX — usability-test complete-market entry and error prevention on mobile.

## Sources

### Primary (HIGH confidence)

- Project sources: `SPEC.md`, root `ARCHITECTURE.md`, `MONOREPO_STRUCTURE.md`, `schema.prisma`, and `.planning/PROJECT.md` — intended product, constraints, architecture, and schema gaps.
- Official Node.js, TypeScript, Next.js, React, Tailwind, NestJS, Prisma, PostgreSQL, Redis, BullMQ, TanStack Query, and Recharts documentation — runtime versions, compatibility, migration, queue, and UI stack decisions.
- Official football-data.org and API-Football pricing/policy material — quota and plan constraints; actual competition coverage still requires runtime probing.
- Official scikit-learn documentation — leakage, time-aware evaluation, calibration, Brier Score, and Log Loss principles.
- UK Gambling Commission guidance — misleading marketing and age/jurisdiction context; launch-market legal review remains mandatory.

### Secondary (MEDIUM confidence)

- MetricKick and Sportmonks product/documentation pages — current prediction-product table stakes, value/no-value patterns, and performance presentation.
- FIFA Connect Data and IPTC SportsML — identity and sports-event normalization guidance.
- GamCare safer-gambling guidance — future support and self-exclusion context.

### Tertiary (LOW confidence)

- None used as a roadmap dependency. Unofficial sources such as Understat remain optional, offline, and disabled by default.

---
*Research completed: 2026-08-27*
*Ready for roadmap: yes*
