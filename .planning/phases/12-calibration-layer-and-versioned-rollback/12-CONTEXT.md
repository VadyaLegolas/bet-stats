# Phase 12: Calibration Layer and Versioned Rollback - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning
**Mode:** Decisions taken autonomously by Claude on the user's instruction ("решай все сам"), using recommended defaults and facts measured in Phase 11. No interactive answers; every decision below is auditable and can be reopened. The auto-advance chain (plan -> execute) was deliberately NOT enabled: only context and planning were requested.

<domain>
## Phase Boundary

A user sees calibrated probabilities next to the raw model probabilities with an honest calibrator version label, and an explicit insufficient-data state below minimum thresholds (CALIB-01, CALIB-04). Calibrators are fitted per exact model version on held-out settled windows with minimum-sample gates and structurally cannot be applied to a forecast of another model version (CALIB-02). A promoted calibrator rolls back automatically under materiality and hysteresis gates when holdout Brier regresses; frozen snapshots are never modified (CALIB-03).

Out of scope: changing frozen ForecastSnapshot rows or value receipts, CLV (Phase 13), new markets (Phase 14), the scanner (Phase 15), and any ML library.

</domain>

<decisions>
## Implementation Decisions

### Method
- **D-01:** Platt scaling first, fitted by Newton steps in pure TypeScript in `packages/domain` (no ML libraries). Binary markets (OVER_UNDER_2_5, BTTS) use one Platt scaler on the logit of the positive class. ONE_X_TWO uses one-vs-rest Platt per class (home/draw/away) on class logits, then renormalizes the three calibrated values to sum to 1. Multinomial/vector scaling is deferred. — **Reversibility:** reversible — calibrator math is a versioned pure function.
- **D-02:** Isotonic regression (PAVA) is used only above a configured sample threshold and only when its holdout Brier beats Platt by the materiality margin; otherwise Platt stays. Default thresholds (all in config, see D-07): Platt >= 300 settled outcomes per market, isotonic >= 1500. Phase 11 measured only 110 usable pre-match V1 snapshots and 3 DC snapshots in the real DB, so the honest steady state for a long time is "insufficient data". — **Reversibility:** reversible.
- **D-03:** Markets in scope: ONE_X_TWO, OVER_UNDER_2_5, BTTS (the three score markets already scored by `ForecastScore`). One calibrator per (modelVersion, configHash, market).

### Data and leakage
- **D-04:** Fitting uses PRODUCTION snapshots only (`ForecastSnapshot.origin = PRODUCTION`, added in Phase 11 WR-13) and settled outcomes read through the historical result lineage at the fit `asOf`, never later corrections. BACKTEST snapshots never train a served calibrator (an explicit, separately labelled research option is deferred).
- **D-05:** Chronological split: the fit window ends at T_fit; the holdout is a later window of settled outcomes that did not train the calibrator. A calibrator is promotable only when its holdout sample reaches the minimum and its holdout Brier is not worse than raw by more than the materiality margin.
- **D-06:** Calibrator identity pins `modelVersion` and `configHash` of the forecasts it was fitted on. Applying it to a forecast with a different `modelVersion` or `configHash` is a coded error (`CALIBRATOR_MODEL_MISMATCH`) at the domain function and a database constraint on the link between a forecast's model identity and the promoted calibrator lookup; the API then returns the insufficient/unavailable state, never a silently mismatched calibration. — **Reversibility:** costly — the pinned identity is stored in new tables and referenced by API payloads.

### Policy in configVersion, not hardcoded
- **D-07:** All policy lives in a versioned `calibration-config-v1` object recorded with every fit and promotion: minimum sample sizes (Platt 300, isotonic 1500, holdout 60), materiality 0.002 Brier (same unit as `model-comparison-v2`), rollback hysteresis (3 consecutive evaluations worse than raw by the materiality margin, each with holdout sample >= 30), probability clip epsilon 1e-6, fit cadence daily. Changing any value creates a new config version; old fits stay valid under their own version.

### Layer semantics, rollback, storage
- **D-08:** Calibration is a post-hoc read layer. It never writes to `ForecastSnapshot`, `ForecastMarket`, `SettlementReceipt`, `ForecastScore` or value receipts. Calibrated probabilities are computed when a forecast is read, from the currently promoted calibrator for the forecast's pinned identity. Value/EV candidates keep using raw probabilities in this phase (no change to frozen receipts or published scorecard semantics).
- **D-09:** New append-only tables: `Calibrator` (immutable fit: pinned identity, market, method, parameters, fit window, holdout metrics, config version, hash), `CalibratorEvent` (PROMOTED | ROLLED_BACK | SUPERSEDED with reason and evaluation numbers). The active calibrator for a pinned identity and market is derived from the event log, so rollback is an appended event, never an UPDATE or DELETE. Same trigger style as the settlement tables. Rollback target is the previous promoted calibrator, or "no calibrator" (raw only) when none exists. — **Reversibility:** one-way — new tables and migration are a published schema contract for the API payload and later phases.
- **D-10:** A job in `workers/data-sync` (BullMQ, deterministic job id per (modelVersion, configHash, asOf day)) fits candidates, evaluates the promoted calibrator on the newest holdout, and appends promotion/rollback events. It is idempotent and never runs provider calls. Rollback needs the hysteresis count from D-07; a single bad window does not roll back.

### API and UI
- **D-11:** Forecast API responses add, per market: `rawProbabilities`, `calibration: { state, calibratedProbabilities?, calibratorVersion?, sampleSize?, requiredSample?, reasonCode? }`. `state` is CALIBRATED | INSUFFICIENT_DATA | UNAVAILABLE. Existing fields keep their meaning (raw stays the source of truth).
- **D-12:** UI (Russian text, as per AGENTS.md): the match page shows raw and calibrated side by side with the label "Калибровка v{n}" and the holdout sample; below thresholds it shows "Недостаточно данных для калибровки: нужно не меньше {N} исходов, сейчас {M}". No certainty claims, no "improved accuracy" wording unless the holdout number is shown. The methodology page gets a calibration section (method, thresholds, rollback policy, honest limits). Responsible-gambling copy stays persistent.

### Claude's Discretion
- Exact table/column names, file layout inside `packages/domain/src/calibration/`, Newton iteration limits and convergence tolerance, numerical safeguards for separable data (L2 prior on Platt slope), the test fixtures, and the shape of the job's receipt.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` Phase 12 section and `.planning/REQUIREMENTS.md` CALIB-01..04.
- `packages/domain/src/evaluation/scoring.ts`, `reliability.ts`, `model-comparison.ts` (Brier unit, materiality 0.002, minimum sample logic to mirror).
- `packages/domain/src/forecast/model-version.ts`, `contract.ts` (pinned model identity, config hash).
- `packages/database/prisma/migrations/20261124_phase11_forecast_snapshot_origin/` and `20261123_phase11_settlement_chain_per_forecast/` (origin column, append-only guard style, per-forecast settlement chain).
- `packages/database/src/dixon-coles-repository.ts` (leakage-safe historical read pattern at `asOf`).
- `.planning/phases/11-dixon-coles-model-version/11-VERIFICATION.md` and `deferred-items.md` (what is and is not verified; INCONCLUSIVE real run).

</canonical_refs>

<specifics>
## Specific Ideas / Facts

- Real data volume today: 463 completed matches, 110 usable pre-match V1 snapshots, 57 backtest windows; so CALIB-04 (insufficient data) is the expected state at launch and must be a first-class, tested path, not an edge case.
- A calibrator fitted on `poisson-ensemble-v1` must never serve `dixon-coles-ensemble-v1` (and vice versa); Phase 11 made DC the default, so fits start from the DC pinned identity and V1 stays a rollback/comparison identity.
- Tests must include: Platt recovers a known miscalibration on synthetic data, renormalized 1X2 sums to 1, isotonic monotone, mismatch refusal, insufficient-data state, hysteresis (one bad window does not roll back, three do), append-only guard on the new tables, no write to frozen tables.

</specifics>

<deferred>
## Deferred Ideas

- Multinomial / vector scaling for 1X2.
- Optional, explicitly labelled research calibrators trained on BACKTEST snapshots.
- Calibrating value/EV candidates (would change value receipt semantics; revisit after the calibrator has real holdout evidence).
- Per-league calibrators (sample sizes are far too small today).
- `valueByFixture` multi-receipt fix and the other items in Phase 11 `deferred-items.md`.

</deferred>
