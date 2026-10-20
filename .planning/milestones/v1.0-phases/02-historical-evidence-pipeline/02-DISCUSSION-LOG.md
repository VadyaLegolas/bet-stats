# Phase 2: Historical Evidence Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-29
**Phase:** 2-Historical Evidence Pipeline
**Areas discussed:** Chronological evidence contract, Queue and quota priorities, Failure recovery and replay, Team evidence presentation

---

## Chronological Evidence Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Dual-time cutoff | Require both event/effective time and observed-at time to be no later than cutoff; append corrections | ✓ |
| Event time only | Allow later-captured facts when their match occurred earlier | |
| Latest corrected record | Rewrite history with the newest known value | |

**User's choice:** Auto-selected recommended default: dual-time cutoff with append/version semantics.
**Notes:** This is the strongest leakage-safe contract and supports reproducible feature snapshots.

---

## Queue and Quota Priorities

| Option | Description | Selected |
|--------|-------------|----------|
| Three priority lanes | Critical results/fixtures, standard standings, optional enrichment; reserve critical headroom | ✓ |
| Single FIFO queue | Treat all endpoint work equally | |
| Queue per endpoint | Isolate mechanically without a shared business-priority policy | |

**User's choice:** Auto-selected recommended default: explicit priority lanes with durable quota policy.
**Notes:** Extends the Phase 1 reservation-before-I/O invariant and prevents optional calls starving essential history.

---

## Failure Recovery and Replay

| Option | Description | Selected |
|--------|-------------|----------|
| Bounded retry plus DLQ | Backoff with jitter, classified failures, replay manifest, deterministic identity | ✓ |
| Retry forever | Keep transient work alive indefinitely | |
| Manual rerun only | Require operators to reconstruct failed inputs | |

**User's choice:** Auto-selected recommended default: bounded retry, dead-letter visibility, and idempotent replay.
**Notes:** Fact and provenance writes remain atomic; derived features publish only after a complete terminal source window.

---

## Team Evidence Presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Summary plus trace | Five/ten-match summaries with chronological rows, cutoff, sources, sample size, and limitations | ✓ |
| Summary only | Show compact aggregates without their input trace | |
| Raw table only | Show matches without the requested derived summaries | |

**User's choice:** Auto-selected recommended default: compact summaries backed by a reproducible trace.
**Notes:** Weak samples remain visible and labeled; missing observations are never converted to zero.

## the agent's Discretion

- Concrete BullMQ topology and numeric resilience defaults within the locked priority/fail-closed contract.
- Versioned numeric defaults for form, Elo, strength, and H2H after phase research.
- Exact accessible visual styling consistent with the Phase 1 fixture surfaces.

## Deferred Ideas

- Forecast/value behavior remains Phase 3.
- Evaluation and rolling-origin scoring remain Phase 4.
- Provider fallback and optional enrichment remain Phase 5.
