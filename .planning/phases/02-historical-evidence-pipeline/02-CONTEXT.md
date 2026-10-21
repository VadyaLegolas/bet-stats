# Phase 2: Historical Evidence Pipeline - Context

**Gathered:** 2026-08-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a replayable, quota-aware historical data path for upcoming fixtures, completed results, and standings, then expose chronological team evidence and leakage-safe derived features as known at a requested cutoff. This phase owns durable observations, job reliability, replay semantics, and as-of feature contracts; forecast generation, manual odds/value analysis, provider fallback breadth, and optional lineup/injury enrichment remain later-phase work.

</domain>

<decisions>
## Implementation Decisions

### Chronological Evidence Contract
- **D-01:** Every source observation records provider, endpoint, capture time, source update time when available, payload hash, and raw payload or an immutable raw reference. Normalized facts must remain traceable to the exact observation that produced them.
- **D-02:** As-of eligibility uses a dual-time rule: both the football event/effective time and the system's `observedAt` time must be at or before the requested cutoff. A later correction may improve current truth but cannot enter an earlier feature view. — **Reversibility:** one-way — changing temporal semantics after derived evidence is stored would invalidate historical features and require rebuilding every affected snapshot.
- **D-03:** Corrections append a new observation and version or supersede normalized fact state; they do not destructively rewrite evidence previously visible to an as-of query.
- **D-04:** Team features are deterministic pure calculations over an explicitly ordered eligible match set. Stable tie-breaking is kickoff, capture time, then canonical fixture ID.
- **D-05:** Five- and ten-match weighted form use the most recent eligible completed matches with recency weighting, actual sample size, and no padding. Missing matches remain missing rather than becoming zero.
- **D-06:** Elo, home/away strength, goal rates, rest days, and low-weight H2H share one cutoff-aware feature contract and return component values, sample counts, window boundaries, source timestamps, and limitation reasons.

### Queue and Quota Priorities
- **D-07:** Scheduled and replay work uses explicit critical, standard, and optional lanes. Results and fixture continuity are critical; standings are standard; lineups, injuries, odds, and secondary statistics are optional and remain out of the Phase 2 live path.
- **D-08:** Job IDs are deterministic from provider, competition/season, endpoint, requested window, and logical run purpose. Retrying or replaying the same logical unit reuses its identity unless the operator explicitly starts a new revision.
- **D-09:** Provider budget policy reserves headroom for critical work. Optional or lower-priority work is rejected before provider construction or I/O when consuming it could starve critical fixture/result calls. — **Reversibility:** costly — changing priority semantics later affects queue topology, reservation accounting, operator controls, and historical incident interpretation.
- **D-10:** Every provider call continues to require an atomic durable reservation keyed by provider, provider-local reset date, endpoint class, and job identity. Reservation outcomes and quota state are operator-visible.
- **D-11:** Cache hits may avoid a provider call but cannot manufacture a reservation. Cache entries carry provider, capture time, expiry, and payload identity; PostgreSQL remains authoritative for durable facts and audit history.

### Failure Recovery and Replay
- **D-12:** Automatic retries are bounded and use exponential backoff with jitter. Non-retryable validation/identity failures fail immediately; repeated transient failures enter a dead-letter state with correlation ID, classified reason, attempt history, and replay parameters.
- **D-13:** Circuit breakers are scoped by provider and endpoint family, expose closed/open/half-open state, and block new I/O before budget is spent while degraded state remains visible.
- **D-14:** A normalized fact and its provenance are committed atomically. Derived feature publication occurs only after the requested source window reaches a declared terminal state, so users never receive an unlabeled partial recomputation.
- **D-15:** Operator replay supports failed jobs and bounded historical windows, defaults to dry-run impact reporting, and preserves the original logical identity for idempotent reprocessing. A forced new revision must be explicit and auditable.
- **D-16:** Replay can repair current normalized truth and recompute derived features, but it cannot mutate immutable observations or any future prediction snapshot. Phase 2 must provide the deterministic rebuild contract consumed by later phases.

### Team Evidence Experience
- **D-17:** The user-facing team evidence view leads with five- and ten-match summaries and a chronological match trace. It always shows the selected cutoff, timezone, sample size, freshness, provenance, and any limitation state beside the numbers they qualify.
- **D-18:** Users can choose or arrive from a fixture with a requested as-of instant; the server normalizes it to UTC and echoes the resolved instant. The UI never silently substitutes the current latest state for an invalid or unsupported cutoff.
- **D-19:** Weak or incomplete samples remain visible with explicit sample counts and limitation wording. Unsupported components are `null`/unavailable with a reason, never zero-filled or rolled into a misleading aggregate.
- **D-20:** Evidence details expose the inputs needed to reproduce each feature without presenting a forecast, betting recommendation, or future Phase 3 confidence score.

### the agent's Discretion
- Exact BullMQ queue names, concurrency values, retry counts, backoff constants, and circuit thresholds, provided they are configurable, bounded, tested, and preserve the priority and fail-closed contracts above.
- Exact form weighting curve, Elo starting value/K-factor, minimum sample labels, and H2H weight, provided all parameters are versioned and deterministic and research validates defensible defaults.
- Exact card/table styling and responsive layout within the established accessible fixture UI patterns.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Acceptance
- `.planning/ROADMAP.md` — Phase 2 boundary, dependency, goal, and observable success criteria.
- `.planning/REQUIREMENTS.md` — PIPE-01 through PIPE-08 are the authoritative Phase 2 requirements.
- `.planning/PROJECT.md` — core value, constraints, exclusions, and project-level decisions.
- `.planning/phases/01-trustworthy-fixture-discovery/01-CONTEXT.md` — locked identity, provenance, capability, freshness, and responsible-access contracts inherited from Phase 1.
- `SPEC.md` — product data-source roles, feature definitions, reliability expectations, and MVP boundaries.

### Architecture and Data Contracts
- `ARCHITECTURE.md` — target ingestion, queue, provider, caching, and chronological feature architecture.
- `MONOREPO_STRUCTURE.md` — intended worker, API, domain, provider, and database package boundaries.
- `packages/database/prisma/schema.prisma` — live Phase 1 schema to extend with observations, results, standings, job state, and temporal feature metadata.
- `workers/data-sync/src/jobs/fixtures.ts` — existing capability-gated, reservation-first, idempotent canonical fixture ingestion pattern.
- `packages/domain/src/request-budget.ts` — existing atomic durable reservation contract.
- `packages/football-data/src/provider.interface.ts` — current normalized provider boundary that Phase 2 must extend without leaking provider IDs into canonical domain data.

### Research Constraints
- `.planning/research/ARCHITECTURE.md` — modular boundaries, temporal/audit requirements, and implementation-order guidance.
- `.planning/research/PITFALLS.md` — leakage, quota, provider degradation, and replay failure modes.
- `.planning/research/STACK.md` — BullMQ/Redis/PostgreSQL and testing recommendations.
- `.planning/research/SUMMARY.md` — consolidated architectural and domain conclusions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `workers/data-sync/src/jobs/fixtures.ts`: reservation-before-I/O flow, canonical external-reference lookup, advisory-lock idempotency, transactional fact/provenance persistence.
- `packages/domain/src/request-budget.ts`: atomic PostgreSQL reservation with job-key reuse and allowance enforcement.
- `packages/database/prisma/schema.prisma`: canonical league/season/team/fixture identities, provider capabilities, request reservations, and immutable fixture provenance foundation.
- `packages/football-data/src/provider.interface.ts`: validated normalized fixture DTO and provider port to extend for results and standings.
- `apps/api/src/modules/fixtures/*` and `apps/web/app/fixtures/*`: established server projection and trust-state presentation patterns for linking team evidence from fixture pages.

### Established Patterns
- PostgreSQL is authoritative; Redis/BullMQ coordinates disposable work and must not own historical truth.
- Provider capability evaluation and durable budget reservation occur before provider construction or I/O.
- Canonical IDs remain provider-independent, raw provenance is retained, unknown identity blocks downstream analytics, and missing values remain null.
- Public trust metadata is rendered beside the data it qualifies; server responses use no-store paths where freshness and eligibility matter.

### Integration Points
- `workers/data-sync`: real BullMQ bootstrap, result/standings jobs, retry/circuit/DLQ policy, replay orchestration, and feature rebuild jobs.
- `packages/database`: observation/result/standing/job-state/derived-feature schema, constraints, indexes, and migrations.
- `packages/domain`: as-of eligibility, chronological ordering, form/Elo/strength/goal/rest/H2H pure functions, versioned configuration, and limitation contracts.
- `packages/football-data`: normalized result and standings provider DTOs plus raw capture metadata.
- `apps/api` and `apps/web`: cutoff-aware team evidence resource and responsive evidence view linked from canonical fixtures.

</code_context>

<specifics>
## Specific Ideas

- The central product promise is not merely a latest team rating; it is the ability to reproduce what the system could honestly know at a selected instant.
- A replay should be boring: same logical input yields the same durable facts and features, with duplicate attempts visible in operations but not duplicated in football history.
- Degraded, partial, stale, and unsupported evidence are first-class results and must remain distinguishable from genuine zero values.

</specifics>

<deferred>
## Deferred Ideas

- Forecast probabilities, immutable prediction snapshots, confidence composition, manual odds, and value gates — Phase 3.
- Settlement scoring, calibration, ROI/Yield, and rolling-origin backtests — Phase 4, consuming this phase's as-of contract.
- API-Football fallback, Europa/Conference League breadth, lineup/injury/odds enrichment, and TheSportsDB assistance — Phase 5.

</deferred>

---

*Phase: 2-Historical Evidence Pipeline*
*Context gathered: 2026-08-29*
