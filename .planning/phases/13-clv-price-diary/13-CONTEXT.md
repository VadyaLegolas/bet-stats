# Phase 13: CLV Price Diary - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning
**Mode:** Decisions taken autonomously by Claude on the user's standing instruction ("решай все сам"), from facts found in the codebase. Auto-advance (plan -> execute) is NOT enabled by this file. Every decision is auditable and can be reopened.

<domain>
## Phase Boundary

An operator records closing-odds observations (CLV-01). A user sees closing-line value per value candidate from de-vigged forecast-time and closing prices on the same line, with explicit unavailable states and nothing synthesized (CLV-02). Observations are append-only and CLV is evaluation-only: it never touches value ranking, scanner ordering or journal decisions (CLV-03).

Out of scope: schema redesign of `ClosingOddsObservation`, automatic odds scraping, the scanner (Phase 15), new markets (Phase 14), changing frozen `ValueSettlement` rows.

## Facts found in the code (not assumptions)

- `ClosingOddsObservation` exists with an immutable trigger (`guard_closing_odds_observation`: no UPDATE/DELETE, decimal odds > 1). No write path exists anywhere.
- `packages/domain/src/evaluation/clv.ts` (`odds-ratio-clv-v1`) computes `candidateOdds / closingOdds - 1` on raw odds, NOT de-vigged, and requires `observationKind = MARKET_CLOSE`.
- `settlement-pipeline.ts` selects the closing observation at settlement: same fixture/market/selection, `oddsFormat = DECIMAL`, `sourceConvention` = snapshot source, `observedAt >= snapshot.submittedAt` and `< kickoff`, latest wins. The `ValueSettlement` trigger enforces the same tuple. Receipts already carry `clvStatus/clvReason/closingOdds/clv`.
- API/UI already expose `clv: { status, reason, value }` per candidate and a scorecard `clv` block (`NO_COMPARABLE_CLOSE`), rendered by `scorecard-dashboard.tsx`.
- `OperatorGuard` (fail-closed 404, operator credential) already protects the model-comparison route and is the established operator pattern.
- `packages/domain/src/odds/normalize.ts` exists (overround handling to reuse for de-vig).

</domain>

<decisions>
## Implementation Decisions

- **D-01 (write path, CLV-01):** Operator-only `POST` closing-odds endpoint guarded by `OperatorGuard` (404 on missing/wrong credential), plus a thin CLI `scripts/closing-odds.mjs` for the same service. One request records the COMPLETE selection set of one market for one fixture at one `observedAt` (ONE_X_TWO 3, OVER_UNDER_2_5 2, BTTS 2), written in one transaction. A partial set is rejected (`INCOMPLETE_MARKET_SET`), because de-vig needs the full market. Reversibility: reversible (service layer).
- **D-02 (validation):** `observedAt` must be a canonical UTC instant; strictly before `kickoffUtc`; not in the future relative to server time; and the write itself must happen before kickoff and before any settlement of that fixture (`RECORDED_AFTER_KICKOFF`, `FIXTURE_ALREADY_SETTLED`). `observationKind` is always `MARKET_CLOSE`, `oddsFormat = DECIMAL`, odds > 1 canonicalized by `canonicalizeDecimalOdds`. `sourceConvention` is required and must be an existing manual-odds source name. Late or retrospective entries are REJECTED, not stored with a flag: that is the "tagged and excluded" rule without a schema change and without hindsight bias. A deferred, separately labelled retrospective import is out of scope.
- **D-03 (idempotency and corrections):** Observation id is a deterministic hash of (fixtureId, market, selection, sourceConvention, observedAt). Identical replay returns the existing rows (200); same key with different odds is `409 CLOSING_OBSERVATION_CONFLICT`. A correction is a NEW observation with a later `observedAt`; the latest pre-kickoff observation wins (matches the settlement query). Nothing is ever updated or deleted.
- **D-04 (de-vigged CLV, CLV-02):** Add `no-vig-clv-v1` as a READ-TIME evaluation layer next to the frozen `odds-ratio-clv-v1`. Both prices are de-vigged by proportional (multiplicative) normalization over the full selection set of the SAME market and the SAME source convention: candidate side from the candidate's `ManualOddsSnapshot`, closing side from the observation set at one `observedAt`. `clv = pClose_fair / pCandidate_fair - 1` on the candidate selection (positive means the market moved toward the selection). Results carry both policy versions and both fair probabilities; the raw odds-ratio value stays in frozen receipts untouched. Unavailable reasons are explicit and typed (missing close, incomplete set at either side, source mismatch, timestamp order, invalid odds); a missing price is never interpolated or synthesized. Reversibility: reversible (versioned pure function).
- **D-05 (evaluation-only, CLV-03):** CLV may be read only by evaluation/scorecard code paths. Enforce structurally: (a) a unit test that scans the import graph so value ranking, candidate generation and (future) scanner/journal modules cannot import the CLV modules or the observation repository; (b) a runtime test that value candidates and their order are byte-identical with and without observations present. No write path may touch `ManualOdds*`, `ValueReceipt`, `ForecastSnapshot`.
- **D-06 (UI):** Reuse the existing scorecard candidate registry and CLV block (Russian copy): show the de-vigged value, the policy label, closing time and source, and the typed reason when unavailable (new reasons added to `CLV_REASON_COPY`). No wording that CLV predicts profit. Operator entry UX is the API plus CLI in this phase; a browser form is deferred unless the Operations page already hosts operator forms (planner checks and records the finding). Responsible-gambling copy stays persistent.
- **D-07 (methodology):** Methodology page gets a CLV section: what CLV is, de-vig method, that it is evaluation-only, that late entries are refused, honest limits (one source convention, small samples, closing price entered manually by an operator).

### Claude's Discretion
Route path and DTO names, deterministic id format, CLI flags, where the read-time computation lives (domain function plus repository read), test fixtures, copy details.

</decisions>

<canonical_refs>
- `.planning/ROADMAP.md` Phase 13, `.planning/REQUIREMENTS.md` CLV-01..03.
- `packages/domain/src/evaluation/clv.ts`, `packages/domain/src/odds/normalize.ts`, `packages/domain/src/odds/contract.ts`.
- `packages/database/prisma/migrations/20260908_phase04_value_settlements/migration.sql` (append-only trigger, settlement closing tuple checks).
- `packages/database/src/evaluation/settlement-pipeline.ts` (closing selection at settlement).
- `apps/api/src/modules/evaluation/evaluation.service.ts`, `apps/api/src/modules/reconciliation/operator.guard.ts`.
- `apps/web/app/scorecards/scorecard-dashboard.tsx`, `apps/web/app/methodology/page.tsx`.
</canonical_refs>

<deferred>
- Retrospective closing-price import with an explicit label.
- Browser form for operator entry.
- CLV on Asian handicap and exact score (Phase 14 markets).
- CLV-based analytics beyond display (anything that could feed ranking is forbidden by D-05).
</deferred>
