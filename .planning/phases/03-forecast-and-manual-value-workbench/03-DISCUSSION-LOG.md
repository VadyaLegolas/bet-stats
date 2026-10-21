# Phase 3: Forecast and Manual Value Workbench - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-05
**Phase:** 3-Forecast and Manual Value Workbench
**Areas discussed:** Forecast model and probability contract, Immutable snapshot lifecycle and confidence, Manual odds book and normalization, Value decision and user experience

---

## Forecast Model and Probability Contract

| Option | Description | Selected |
|--------|-------------|----------|
| One coherent score-matrix model | Use a versioned Poisson matrix with bounded Elo/form/evidence adjustments and derive all supported markets from it | ✓ |
| Separate model per market | Independently calculate 1X2, totals, and BTTS | |
| Show forecast only with perfect evidence | Suppress every limited-data forecast | |

**User's choice:** Auto-selected the recommended coherent, transparent model.
**Notes:** Preserve tail mass, normalization invariants, unavailable values, and exact receipt inputs.

---

## Immutable Snapshot Lifecycle and Confidence

| Option | Description | Selected |
|--------|-------------|----------|
| Append-only typed snapshots | INITIAL, PRE_MATCH, and evidence-qualified LINEUP_CONFIRMED receipts with revisions | ✓ |
| Mutable latest forecast | Replace the current prediction whenever evidence changes | |
| Confidence folded into probability | Adjust displayed probability according to confidence | |

**User's choice:** Auto-selected append-only snapshots and separate confidence.
**Notes:** Same logical inputs are idempotent; changes create a new revision. LINEUP_CONFIRMED requires an official observation.

---

## Manual Odds Book and Normalization

| Option | Description | Selected |
|--------|-------------|----------|
| Complete market-at-a-time book | Validate every mutually exclusive selection, store immutably, and normalize multiplicatively | ✓ |
| Analyze partial books | Calculate value as soon as any selection is entered | |
| Mutable odds record | Keep one editable latest odds row per fixture | |

**User's choice:** Auto-selected complete immutable books with multiplicative no-vig normalization.
**Notes:** Exact forecast and odds snapshots must be explicitly paired; drafts cannot produce analysis.

---

## Value Decision and User Experience

| Option | Description | Selected |
|--------|-------------|----------|
| Three-state gated result | Value, no value, or insufficient evidence with stored threshold decisions | ✓ |
| Rank every positive EV | Show all positive calculations as candidates | |
| Binary bet/no-bet tip | Collapse evidence and thresholds into a recommendation | |

**User's choice:** Auto-selected the auditable three-state result.
**Notes:** No stake advice, urgency, certainty, or automatic wagering. Receipt is both human-readable and structured.

## the agent's Discretion

- Exact versioned weights, tolerances, warning thresholds, API naming, and responsive presentation details within the locked contracts.

## Deferred Ideas

- Phase 4: settlement and performance evaluation.
- Phase 5: provider odds and official lineup/injury enrichment.
- Out of scope: stake sizing, automatic wagering, and live betting signals.
