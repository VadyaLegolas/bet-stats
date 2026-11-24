# Phase 14: Asian Handicap and Exact Score Markets - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-25
**Phase:** 14-asian-handicap-and-exact-score-markets
**Areas discussed:** Score-matrix persistence, AH lines and fair odds, Exact-score buckets, Odds books / EV / settlement

---

## Area selection

The four gray areas were offered with a multi-select question. The user did not pick any and instead replied "реши сам" (decide yourself), delegating every decision to Claude. All four areas were therefore decided by Claude from the code scout and prior-phase context (Phases 11, 12, 13).

## Score-matrix persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Optional `scoreMatrix` key in snapshot `receipt` Json, public DTO unchanged | No DDL for the key; matrix stripped before the DTO so `parseForecastResponse` `exactKeys` keeps passing; separate read endpoint | ✓ |
| Widen `ForecastMarket.probabilities` with new market keys | Breaks the closed key set and legacy rows | |
| New `ScoreMatrix` table | DDL and a second source of truth for an immutable snapshot | |

**Legacy snapshots:** re-derive from `expectedGoals` (+ `rho`) and accept only if the three stored markets reproduce within 1e-9; otherwise `SCORE_MATRIX_UNAVAILABLE`. Alternative (backfill) rejected: violates immutable history.

## AH lines and fair odds

| Option | Description | Selected |
|--------|-------------|----------|
| -2.5..+2.5 step 0.25 (21 lines), main line highlighted, 5 shown by default | Covers bookmaker ladders; bounded config `ah-lines-v1` | ✓ |
| Only whole and half lines | Misses quarter-line semantics required by MKT-01 | |
| Unbounded lines | No fixed contract, unbounded cost | |

**Fair odds:** push-aware EV=0 solve, `1 + (LOSS + HALF_LOSS/2) / (WIN + HALF_WIN/2)`. Alternative (ex-push probability only) rejected: hides half-win/half-loss.

## Exact-score buckets

| Option | Description | Selected |
|--------|-------------|----------|
| 0-0..3-3 (16) + `OTHER` | Matches common correct-score books; OTHER = 1 - sum | ✓ |
| 0-0..4-4 + OTHER | Many near-zero cells, harder complete books | |
| Top-N most likely only | Not a stable, complete book | |

## Odds books, EV, settlement

| Option | Description | Selected |
|--------|-------------|----------|
| One complete two-way book per AH line; one 17-selection book for exact score; push-aware EV; settlement into `ValueSettlement` via `flat-one-unit-v2` | Reuses manual odds and value paths; v1 frozen | ✓ |
| Single AH book with many lines | Breaks complete-book validation | |
| Score extended markets in `ForecastScore` now | Push makes Brier ill-defined for AH; would touch calibration/model comparison | |

**No-vig:** reuse proportional normalisation; AH approximation (ignores push mass) documented; EV never uses de-vigged prices.

## Claude's Discretion

Endpoint path and DTO names, module layout, config constant names, `scoreMatrix` schema details and `cellsHash` format, how the market registry replaces the duplicated tables, fair-odds formatting, table markup, fixtures, and the exact migration content from the SQL inventory.

## Deferred Ideas

Scoring/calibration of the extended markets; Asian totals, team totals, half-time and in-play; buckets beyond 3-3; push-aware de-vig; browser closing-odds form; provider odds ingestion.
