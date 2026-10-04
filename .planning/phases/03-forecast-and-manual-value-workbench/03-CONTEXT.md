# Phase 3: Forecast and Manual Value Workbench - Context

**Gathered:** 2026-09-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a policy-gated fixture workbench in which a user can inspect an immutable, cutoff-correct Poisson/Elo/form forecast, enter one complete manual decimal-odds book, and receive a reproducible value-candidate, no-value, or insufficient-evidence result. Settlement, performance scoring, automated odds ingestion, additional competitions, and lineup/injury enrichment remain later-phase work.

</domain>

<decisions>
## Implementation Decisions

### Forecast Model and Probability Contract
- **D-01:** V1 uses one transparent, versioned ensemble: a Poisson score matrix covering 0:0 through 7:7 supplies score-derived markets, while Elo, recent form, venue strength, goal rates, rest, and low-weight H2H adjust expected goals through explicit bounded configuration. Raw component inputs and every transformation parameter remain receipt-visible.
- **D-02:** The published 1X2 distribution is normalized to a strict configured tolerance, and Over/Under 2.5 plus BTTS Yes/No are derived from the same score matrix. Tail mass outside 7:7 is measured and disclosed; it may be normalized under a versioned rule but never silently discarded.
- **D-03:** Fair decimal odds are the reciprocal of the final published event probability, computed with decimal-safe boundary handling. Unsupported or zero probability produces unavailable rather than infinity or a fabricated number.
- **D-04:** Missing or weak evidence is never imputed as neutral zero. The forecast may remain inspectable with limitations, but any component that violates configured minimum evidence or freshness rules contributes to an explicit insufficient-evidence gate.

### Immutable Snapshot Lifecycle and Confidence
- **D-05:** Prediction snapshots are append-only and uniquely identify fixture, snapshot kind, model version, configuration hash, as-of cutoff, evidence-build IDs, exact feature inputs, source timestamps, generated probabilities, confidence components, assumptions, and creation time. Corrections create a new snapshot; they never mutate an issued receipt. — **Reversibility:** one-way — changing snapshot identity or mutability after Phase 4 begins would require migrating historical evaluations and break receipt reproducibility.
- **D-06:** INITIAL is the first eligible forecast; PRE_MATCH is the latest scheduled cutoff before kickoff; LINEUP_CONFIRMED is created only from an official confirmed-lineup observation. Re-running the same logical kind/input/config returns the existing snapshot, while changed inputs or config create a new immutable revision.
- **D-07:** Event probability and confidence are separate. Confidence is a versioned aggregate of completeness, lineup availability, freshness, source reliability, and model stability; the UI always shows the components and never converts confidence into certainty language.
- **D-08:** Forecast generation fails closed for unresolved canonical identity, unavailable required evidence, post-cutoff inputs, or ineligible jurisdiction/age state. Stale or limited evidence follows configurable gates and remains visible with machine-readable reasons.

### Manual Odds Book and Normalization
- **D-09:** Odds entry is market-at-a-time and requires the complete mutually exclusive selection set: Home/Draw/Away, Over/Under 2.5, or BTTS Yes/No. Every value must be finite decimal odds greater than 1.00; field errors identify missing, malformed, duplicate, or out-of-range selections before submission.
- **D-10:** A submitted manual odds book is an immutable snapshot tied to fixture, market, selection odds, user-entered source label, capture time, and schema/version metadata. Editing creates a replacement snapshot and leaves the prior observation auditable. — **Reversibility:** costly — mutable odds would invalidate value receipts and later settlement/CLV comparisons.
- **D-11:** The MVP uses multiplicative normalization across the complete book (`(1/odds) / sum(1/odds)`) and displays both bookmaker implied probability and normalized no-vig probability, plus total overround. Partial books are saved only as drafts outside analysis and cannot produce value output.
- **D-12:** The user compares one explicitly selected forecast snapshot with one explicitly selected odds snapshot; the server does not silently switch either input when newer snapshots appear.

### Value Decision and User Experience
- **D-13:** Edge is model probability minus normalized market probability; expected value is `modelProbability * decimalOdds - 1`. Calculations retain full precision and round only for display.
- **D-14:** A value candidate appears only when edge, expected value, minimum confidence, and data-quality gates all pass for the exact snapshot pair. Thresholds and gate versions are stored in the receipt. A positive EV alone is not sufficient.
- **D-15:** The workbench leads with the three-state outcome: value candidate, no value, or insufficient evidence. It then shows market comparison, confidence breakdown, evidence/model explanation, and an expandable immutable receipt. No state uses stake sizing, urgency, guaranteed-profit language, or automatic wagering cues.
- **D-16:** No-value explains that the evidence was sufficient but configured thresholds were not met. Insufficient-evidence lists the failed evidence/confidence/data-quality gates and does not rank a near-miss as a recommendation.
- **D-17:** The prediction receipt is downloadable/copyable as structured JSON and human-readable on screen, including IDs and versions for exact forecast, odds, model/config, cutoff, sources, assumptions, formulas, thresholds, and gate outcomes.

### the agent's Discretion
- Exact bounded adjustment weights, probability tolerance, tail-mass warning threshold, confidence aggregation weights, and value thresholds, provided they are versioned, research-backed, configurable, and covered by deterministic/property tests.
- Exact responsive card/table layout, chart choice, microcopy, and progressive disclosure within the established accessibility and responsible-gambling patterns.
- Exact API resource names and database table names, provided snapshot pairing and append-only receipt semantics remain explicit.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Acceptance
- `.planning/ROADMAP.md` — Phase 3 boundary, dependency, goal, and observable success criteria.
- `.planning/REQUIREMENTS.md` — PRED-01 through PRED-06, ODDS-01 through ODDS-03, and VALUE-01 through VALUE-04 are authoritative.
- `.planning/PROJECT.md` — core value, responsible-gambling limits, immutable-snapshot requirement, and V1 model decision.
- `.planning/phases/02-historical-evidence-pipeline/02-CONTEXT.md` — inherited as-of evidence, replay, provenance, limitation, and rebuild contracts.
- `SPEC.md` — product model formulas, manual-odds workflow, confidence, value thresholds, and MVP boundaries.

### Architecture and Live Contracts
- `ARCHITECTURE.md` — target prediction, persistence, API, and web boundaries.
- `MONOREPO_STRUCTURE.md` — intended package ownership and application layout.
- `packages/database/prisma/schema.prisma` — live canonical fixture, source observation, evidence-build, and component schema to extend.
- `packages/domain/src/evidence/contract.ts` — cutoff-correct evidence projection and source-receipt contract.
- `packages/domain/src/evidence/features.ts` — deterministic feature calculations consumed by forecasting.
- `packages/domain/src/forecast-eligibility.ts` — existing fail-closed canonical identity gate.
- `apps/api/src/modules/evidence/evidence.service.ts` — live as-of evidence lookup and limitation projection pattern.
- `apps/web/app/fixtures/[fixtureId]/page.tsx` — existing fixture detail integration point for the workbench.

### Research Constraints
- `.planning/research/ARCHITECTURE.md` — modular boundaries and immutable temporal data guidance.
- `.planning/research/PITFALLS.md` — leakage, misleading probability, claims, and data-quality failure modes.
- `.planning/research/STACK.md` — TypeScript, decimal arithmetic, Recharts, testing, and persistence recommendations.
- `.planning/research/SUMMARY.md` — consolidated product and implementation conclusions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/domain/src/evidence/*`: pure, cutoff-aware form/Elo/strength/goal/rest/H2H calculations with source references and limitation reasons.
- `packages/database/prisma/schema.prisma`: canonical Fixture, SourceObservation, EvidenceBuild, and EvidenceComponent foundations for immutable prediction inputs.
- `apps/api/src/modules/evidence/*`: validated as-of query and server projection pattern.
- `apps/web/components/evidence-state-notice.tsx`: established limited/stale/pending state presentation.
- `apps/web/app/fixtures/[fixtureId]/page.tsx`: natural entry point for forecast, odds, and value analysis.

### Established Patterns
- PostgreSQL owns durable truth; calculations are deterministic and receipts point to exact append-only inputs.
- All analytical reads are cutoff-aware; unknown, missing, stale, and limited states remain distinct and are never zero-filled.
- Eligibility and canonical identity fail closed before protected analytics are exposed.
- Trust metadata and risk disclosures appear beside the data they qualify.

### Integration Points
- `packages/domain`: probability distributions, score matrix, confidence, odds normalization, EV/edge, gates, and strict DTO parsers.
- `packages/database`: prediction, manual-odds, and value-receipt append-only models plus constraints and migrations.
- `apps/api`: forecast generation/read, odds submission, snapshot comparison, and receipt endpoints behind eligibility policy.
- `apps/web`: fixture analysis workbench, validation, confidence/evidence explanation, outcome states, and receipt view.
- `workers/data-sync`: scheduled INITIAL/PRE_MATCH generation using Phase 2 published evidence; confirmed-lineup generation remains capability-gated for Phase 5 data availability.

</code_context>

<specifics>
## Specific Ideas

- One score matrix should explain every supported score-derived market, avoiding contradictory probabilities across separate calculators.
- The user should always be able to answer “which forecast, which odds, which evidence, which thresholds?” from a single receipt.
- Abstention is a first-class successful result, not an error or a hidden empty state.

</specifics>

<deferred>
## Deferred Ideas

- Settlement, scoring, calibration, ROI/Yield, rolling-origin backtests, and CLV — Phase 4.
- Automated provider odds, official lineup/injury enrichment, snapshot comparison across evidence updates, and additional competitions — Phase 5.
- Stake sizing, bankroll optimization, automatic wager placement, live/in-play signals, and personalized betting prompts — out of MVP scope.

</deferred>

---

*Phase: 3-Forecast and Manual Value Workbench*
*Context gathered: 2026-09-05*
