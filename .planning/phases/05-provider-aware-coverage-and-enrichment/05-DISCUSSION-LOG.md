# Phase 5: Provider-Aware Coverage and Enrichment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-09
**Phase:** 05-provider-aware-coverage-and-enrichment
**Areas discussed:** Provider routing and fallback, degradation visibility, optional enrichment admission, forecast revision comparison, TheSportsDB reconciliation role

---

## Provider routing and fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit versioned routing policy | Route by competition and endpoint; fallback only on classified failure/coverage/policy causes and retain the route receipt. | ✓ |
| Opportunistic fallback | Try providers in order whenever a call fails, with minimal persisted routing detail. | |
| Provider-specific fixture copies | Keep separate provider identities and reconcile only in presentation. | |

**User's choice:** Auto-selected the explicit versioned routing policy (recommended default).
**Notes:** This preserves canonical identities and makes fallback reproducible.

---

## Degradation visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Typed honest states | Distinguish limited, unavailable, stale, unsupported, and pending with source timestamps and reasons. | ✓ |
| One degraded state | Collapse all provider failures into a generic warning. | |
| Hide unavailable competitions | Remove competitions until data returns. | |

**User's choice:** Auto-selected typed honest states (recommended default).
**Notes:** Europa League and Conference League explicitly show the no-fallback condition.

---

## Optional enrichment admission

| Option | Description | Selected |
|--------|-------------|----------|
| Capability plus budget plus circuit | Require all three current policy decisions before every optional call. | ✓ |
| Capability only | Call whenever provider metadata claims endpoint support. | |
| Best-effort calls | Attempt optional endpoints and react only after quota/provider errors. | |

**User's choice:** Auto-selected capability plus budget plus circuit (recommended default).
**Notes:** Critical fixture/result allowance keeps priority; unknown or stale capability fails closed.

---

## Forecast revision comparison

| Option | Description | Selected |
|--------|-------------|----------|
| Stable pairwise delta | User selects two exact immutable snapshots and sees evidence, confidence, expected-goals, limitation, and probability deltas. | ✓ |
| Latest-only summary | Show only the newest snapshot with a prose change summary. | |
| Timeline without exact pairing | Display revisions chronologically but calculate no exact deltas. | |

**User's choice:** Auto-selected stable pairwise delta (recommended default).
**Notes:** Missing snapshot kinds show concrete reasons and are never synthesized.

---

## TheSportsDB reconciliation role

| Option | Description | Selected |
|--------|-------------|----------|
| Review-only suggestions | Names, aliases, and logos become provenance-bearing candidates requiring an append-only administrator decision. | ✓ |
| Automatic high-score match | Auto-approve suggestions above a confidence threshold. | |
| General enrichment provider | Permit TheSportsDB facts to enter live match evidence. | |

**User's choice:** Auto-selected review-only suggestions (recommended default).
**Notes:** The provider never supplies statistical authority or silently mutates canonical identity.

## the agent's Discretion

- Versioned operational thresholds and timing values.
- Accessible visual form for snapshot deltas and provider-state detail.

## Deferred Ideas

- Phase 6 owns release-wide operations, mobile polish, methodology, and full release certification.
- Paid/live/automatic wagering capabilities remain outside the MVP.
