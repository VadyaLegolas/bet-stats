# Phase 4: Settlement and Evidence Scorecard - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Resolve fixture outcomes against exact frozen Phase 3 snapshots, calculate leakage-safe forecast and value-performance metrics, and expose evidence-backed scorecards. This phase does not add markets, providers, staking advice, or automatic betting.

</domain>

<decisions>
## Implementation Decisions

### Settlement truth and lifecycle
- **D-01:** Settlement is append-only and versioned; corrections create linked revisions and never rewrite an earlier settlement. — **Reversibility:** one-way — changing this later would require migrating the audit history and published evaluation identities.
- **D-02:** Only an exact frozen pre-match forecast snapshot is scoreable. Missing or ambiguous eligible snapshots produce an explicit unscored reason, never an implicit “latest” choice.
- **D-03:** Completed fixtures settle normally; postponed fixtures remain pending; cancelled, abandoned, and void fixtures resolve to explicit non-scored/non-financial states under a versioned policy.

### Metrics and cohorts
- **D-04:** Brier Score and Log Loss use server-owned formulas with versioned configuration and are grouped by model version, competition, market, and explicit UTC period.
- **D-05:** Every aggregate displays its denominator and sample size. Empty and weak cohorts render honest unavailable/limited states rather than zero or a performance claim.
- **D-06:** Reliability uses deterministic probability buckets with observed frequency, forecast mean, count, and under/over-confidence direction; bucket edges and minimum counts are versioned.

### Value performance and CLV
- **D-07:** Per-result P/L uses a transparent flat one-unit convention for frozen `VALUE_CANDIDATE` receipts only; ROI and Yield disclose numerator, denominator, count, and settlement policy version.
- **D-08:** No bankroll sizing, staking strategy, personalized recommendation, or guaranteed-profit language is introduced.
- **D-09:** CLV is computed only from comparable market, selection, source convention, and timestamped price observations; otherwise the UI states exactly why CLV is unavailable.

### Backtesting and presentation
- **D-10:** Backtests use chronological rolling-origin windows and call the same as-of feature and forecast contracts as production; no random split and no post-cutoff evidence.
- **D-11:** The primary UI starts with cohort health and sample-size warnings, then scorecards and reliability charts; exact snapshot, formula, and version details remain available through progressive disclosure.
- **D-12:** Filters have stable URL/query identity and default to the broadest honest cohort that meets quality gates; no silent substitution when filters produce insufficient data.

### the agent's Discretion
- Exact visual composition of scorecards and charts, provided denominators, unavailable states, confidence warnings, and responsible-use copy remain prominent.
- Exact bucket count and minimum-sample defaults may be selected during research, but must be versioned and supported by sensitivity tests.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and requirements
- `.planning/PROJECT.md` — core value, responsible-use boundaries, and validated Phase 3 decisions.
- `.planning/REQUIREMENTS.md` § Settlement, Backtesting, and Calibration — EVAL-01 through EVAL-08.
- `.planning/ROADMAP.md` § Phase 4 — goal and success criteria.

### Frozen-source contracts
- `.planning/phases/03-forecast-and-manual-value-workbench/03-CONTEXT.md` — immutable forecast/odds/value decisions inherited by settlement.
- `.planning/phases/03-forecast-and-manual-value-workbench/03-SECURITY.md` — trust boundaries that evaluation must preserve.
- `.planning/phases/03-forecast-and-manual-value-workbench/03-VALIDATION.md` — canonical Phase 3 behavioral witnesses.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/domain/src/forecast/` — deterministic probability and immutable receipt contracts to score without recomputation.
- `packages/domain/src/value/` — selection-aware value receipts and gate outcomes for financial settlement.
- `packages/database/prisma/schema.prisma` — canonical fixtures, immutable snapshots, revisions, and audit relations.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` — established probability/confidence, limitations, and progressive-disclosure patterns.

### Established Patterns
- Exact DTO parsing, content-addressed identities, append-only revisions, UTC timestamps, Decimal at odds/P&L boundaries, and PostgreSQL-enforced invariants.
- Server-owned calculations exposed through guarded no-store Nest/Next routes.
- Vitest domain/integration tests plus production-backed Playwright acceptance flows.

### Integration Points
- Result ingestion and fixture lifecycle feed versioned settlement.
- ForecastSnapshot, OddsSnapshot, and ValueReceipt are immutable evaluation inputs.
- New scorecard endpoints and pages extend the existing guarded analytics surface.

</code_context>

<specifics>
## Specific Ideas

- Treat “unavailable” and “insufficient sample” as first-class outputs with reasons.
- Reliability charts must make calibration direction understandable without implying certainty.
- Every metric should be replayable from persisted source IDs and a versioned formula receipt.

</specifics>

<deferred>
## Deferred Ideas

- Additional goal lines, double chance, and team totals remain deferred until these settlement/calibration rules are verified.
- Personalized staking, bankroll optimization, alerts, and automatic wagering remain out of scope.

</deferred>

---

*Phase: 04-settlement-and-evidence-scorecard*
*Context gathered: 2026-09-08*
