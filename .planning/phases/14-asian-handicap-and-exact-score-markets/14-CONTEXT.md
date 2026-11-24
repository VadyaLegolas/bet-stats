# Phase 14: Asian Handicap and Exact Score Markets - Context

**Gathered:** 2026-11-25
**Status:** Ready for planning

<domain>
## Phase Boundary

A user can view, price, and settle Asian handicap (AH) and exact-score probabilities derived from the frozen score matrix, with zero new data cost and with quarter-line push / half-bet semantics handled correctly end to end. Covers MKT-01..MKT-05:

- derive AH and exact-score probabilities and fair odds from the score matrix (view);
- persist the matrix at issuance, or deterministically re-derive it fail-closed for legacy snapshots;
- let an operator enter complete odds books for the new markets (existing validation, no-vig normalisation) and receive push-aware value receipts;
- settle AH push / half-win / half-loss and exact-score outcomes under explicit versioned rules in the settlement pipeline.

The three existing scored markets (ONE_X_TWO, OVER_UNDER_2_5, BTTS), their ForecastScore/Brier scoring, Phase 12 calibration and model comparison are NOT changed. Asian totals, in-play markets, and probabilistic scoring of the new markets are out of scope (see Deferred).

The user delegated the decisions of this discussion to Claude ("реши сам"); all decisions below are Claude's, grounded in the code scout and Phases 11-13.

</domain>

<decisions>
## Implementation Decisions

### Score-matrix persistence and legacy snapshots (MKT-05)
- **D-01:** At issuance, every new `ForecastSnapshot` receipt (Json column, no DDL for the key) gets an optional closed-shape key `scoreMatrix` of version `score-matrix-v1`: `{ version, gridMax, retainedMass, cells: [[home, away, probability], ...], cellsHash }`. `cells` is the full retained grid exactly as the model's renormalised matrix (`packages/domain/src/forecast/model.ts`, the `scoreMatrix` divided by `retainedMass`), persisted as exact doubles, no rounding. Applies to every model version (poisson and Dixon-Coles). — **Reversibility:** one-way — snapshots are immutable, so every row issued from now on carries the key permanently; a shape change later needs a new `score-matrix-v2`, never a rewrite.
- **D-02:** The public forecast DTO is NOT changed. `parseForecastResponse` validates the receipt with `exactKeys` (a closed key set plus the conditional `dixonColes`); the persisted `scoreMatrix` is stripped when the DB receipt is mapped to the DTO, so legacy rows and the web parser keep working untouched. Extended markets are exposed through a separate read endpoint (D-04). The planner/researcher must confirm where the repository maps receipt to DTO (`packages/database/src/forecast-repository.ts`) and that a row with the key still passes validation after stripping.
- **D-03:** Legacy snapshots (no `scoreMatrix`) are re-derived deterministically, fail-closed: rebuild the grid with the same pure function from the receipt's `expectedGoals` (plus `dixonColes.rho` for Dixon-Coles rows), then require the re-derived ONE_X_TWO / OVER_UNDER_2_5 / BTTS probabilities to reproduce the stored `ForecastMarket` probabilities within an absolute tolerance of 1e-9. Any mismatch, missing input, or unknown model version yields `SCORE_MATRIX_UNAVAILABLE` for the extended markets only; the three stored markets are unaffected. No backfill, no UPDATE of existing rows.
- **D-04:** Extended markets are a READ-TIME view over the matrix, never written to `ForecastMarket` (its probabilities contract is the closed key set of the three markets, and `(forecastSnapshotId, market)` is unique). A new read endpoint returns, per forecast, the AH table, the exact-score table, and a typed state `AVAILABLE | UNAVAILABLE` with a reason code. Calibration is NOT applied to extended markets (Phase 12 D-03 keeps calibration on the three scored markets); the view is labelled raw / «без калибровки».

### Asian handicap lines and fair odds (MKT-01)
- **D-05:** Versioned config `ah-lines-v1`: home-perspective lines from -2.5 to +2.5 in 0.25 steps (21 lines). The away side of a line is the mirror (home -0.75 is away +0.75). Canonical line token: signed decimal with the minimum digits, `0` for the level line, e.g. `-2.5`, `-0.75`, `0`, `+0.25`, `+1`. Any other token is rejected.
- **D-06:** Per line and side, the domain computes a five-way breakdown `WIN, HALF_WIN, PUSH, HALF_LOSS, LOSS` that sums to 1. Whole and half lines produce only WIN/PUSH/LOSS; quarter lines are the equal split of the stake over the two adjacent lines (half-win/half-loss arise there). Rule version `ah-settlement-v1`, shared by display and settlement (one pure function, never re-implemented per layer).
- **D-07:** Push-aware fair decimal odds solve EV = 0 per unit stake: `fairOdds = 1 + (LOSS + HALF_LOSS/2) / (WIN + HALF_WIN/2)`. If `WIN + HALF_WIN/2 == 0` the fair odds are UNAVAILABLE with a typed reason (no Infinity, no NaN). The UI shows the breakdown plus «эффективная вероятность выигрыша» `WIN + HALF_WIN/2`, the push/return probability, and the fair odds.
- **D-08:** The main line is the line minimising `|(WIN + HALF_WIN/2) - (LOSS + HALF_LOSS/2)|` for the home side (ties go to the smaller `|line|`). The match page highlights it and shows the five lines around it by default, with an accessible expander for all 21.

### Exact score buckets (MKT-02)
- **D-09:** Versioned config `exact-score-buckets-v1`: explicit scorelines 0-0 through 3-3 (16 buckets) plus `OTHER`. Selection ids are `"H-A"` (for example `"2-1"`) and `"OTHER"`. `P(OTHER) = 1 - sum(listed)` is computed from the same renormalised matrix, so the 17 probabilities sum to exactly 1 within floating-point tolerance and tail mass is absorbed consistently; the existing tail warning stays visible. Fair odds are `1 / p` (no push), UNAVAILABLE with a typed reason when `p == 0`.
- **D-10:** UI shows a 4x4 home-by-away table (rows home goals, columns away goals) with probabilities and fair odds in numbers, plus the `OTHER` row. It must not rely on colour alone (accessibility), and Russian copy only.

### Odds books, no-vig, push-aware EV (MKT-03)
- **D-11:** Market identity: AH is one complete two-way book per line, market id `ASIAN_HANDICAP:<line token>`, selections `HOME` / `AWAY`; exact score is one complete book, market id `EXACT_SCORE`, all 17 selections. The fixed `OddsMarket` union and `MARKET_SELECTIONS` record (`packages/domain/src/odds/contract.ts`, also duplicated in `value/contract.ts` and `evaluation/scoring.ts`) become a single market registry with a `selectionsFor(market)` function so the duplicated tables cannot drift. Validation stays strict: complete set, no duplicates, unknown market or line is `UNSUPPORTED_ODDS_MARKET`.
- **D-12:** No-vig for the new books reuses the existing proportional `normalizeOddsBook`. For AH the normalisation treats the two sides as complementary and ignores push mass; this is a documented approximation used only for overround display and, by Phase 13, CLV. EV never uses de-vigged prices.
- **D-13:** Push-aware EV per unit stake at the operator's quoted decimal odds `o`: `EV = WIN*(o-1) + HALF_WIN*(o-1)/2 - HALF_LOSS/2 - LOSS`, computed with `decimal.js`. Value candidates apply the same value threshold semantics as the existing markets to this EV. The value receipt records the five-way probabilities and an EV policy label `push-aware-ev-v1`. Exact score uses the ordinary `p*o - 1`.
- **D-14:** Closing-odds capture and `no-vig-clv-v1` (Phase 13) accept the new markets from day one, as the roadmap dependency requires. Phase 13 rules are unchanged: operator-only, pre-kickoff, append-only, CLV evaluation-only. The import-graph guard test `tests/unit/clv-evaluation-only.test.ts` must keep passing and must cover any new module so CLV cannot leak into value ranking.

### Settlement (MKT-04)
- **D-15:** Pure domain functions `settleAsianHandicap(line, side, homeGoals, awayGoals)` returning one of `WIN | HALF_WIN | PUSH | HALF_LOSS | LOSS` plus the return multiplier on a unit stake, and `settleExactScore(selection, homeGoals, awayGoals)` returning `WIN | LOSS` (any unlisted score settles `OTHER`). Versions `ah-settlement-v1` and `exact-score-settlement-v1`. The goals come from the same final score the settlement receipt already uses.
- **D-16:** The money layer is extended by a new policy `flat-one-unit-v2` that supports fractional returns (`returnUnits` of 0, half stake, 1, and so on). `flat-one-unit-v1` (WIN/LOSS/VOID) stays frozen and keeps settling the three existing markets, so no historical settlement is reinterpreted. `ValueSettlement.result` is a string column, so the new result values need no DDL. Aggregation keeps the policy version visible and never silently mixes v1 and v2 rows.
- **D-17:** `ForecastScore` (Brier, log score), Phase 12 calibration, and model comparison stay on the three scored markets; extended markets are not entered into them in this phase. The hardcoded 3-market guard in `packages/database/src/evaluation/settlement-pipeline.ts` (`value === "ONE_X_TWO" || ...`) is split: the score-market guard stays for ForecastScore, and extended markets go through an exhaustive market-family switch with a `never` check, so a market with no settlement rule fails at compile time, plus a test asserting every registered market has a rule. The failure mode noted in the roadmap (runtime-only breakage) must be impossible by construction.

### Database
- **D-18:** The `scoreMatrix` receipt key itself needs no DDL, but earlier migrations hardcode the market lists in SQL (`20260905_phase03_forecast_value_snapshots`, `20260908_phase03_value_identity_gap`, `20260908_phase04_value_settlements`, `20260908_phase04_z_score_facts`). The researcher must inventory every CHECK/trigger/function that pins markets or selections and decide the minimal forward migration. Any widening is an append-only forward migration verified with Testcontainers PostgreSQL (real constraints, no SQLite), with the append-only triggers left intact. — **Reversibility:** one-way — a published migration cannot be edited; it must be superseded by a later one.

### UI and methodology
- **D-19:** The match page (`apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx`) gets two sections below the existing markets: «Азиатский гандикап» (the line table of D-08, five-way breakdown, fair odds) and «Точный счёт» (D-10). All user-facing text in Russian; raw enum codes never shown (extend `apps/web/components/enum-labels.ts`, including the AH result and the new reason codes, typed so a new code breaks the build). `SCORE_MATRIX_UNAVAILABLE` copy: «Для этого прогноза расширенные рынки недоступны: матрица счёта не была сохранена».
- **D-20:** The manual odds form and the value table accept the new markets. Value rows for AH show the five-way breakdown and one plain sentence explaining push and half-win/half-loss; no wording that promises profit, and the persistent responsible-gambling disclaimers stay unchanged.
- **D-21:** `MODEL_CARD` is bumped (a new minor version) and `/methodology` gets a section on extended markets: derivation from the frozen matrix, quarter-line semantics, the five-way breakdown, the push-aware fair-odds and EV formulas, the AH no-vig approximation, exact-score buckets and `OTHER`, raw-not-calibrated, and honest limits (the matrix is the model's, not market-implied; small samples; legacy forecasts unavailable).

### Tests (mandatory pins)
- **D-22:** For all 21 lines the five-way breakdown sums to 1; home line `L` and away line `-L` are exact mirrors; the level line (0) pushes exactly on a draw; integer lines push exactly on the margin; a quarter line equals the average of its two adjacent lines' return; exact-score probabilities sum to 1; a persisted matrix reproduces the three stored markets bit-for-bit; the legacy re-derive path accepts a reproducing snapshot and rejects a mismatching one (`SCORE_MATRIX_UNAVAILABLE`); settlement table tests cover every result for every line class; every registered market has a settlement rule; a snapshot with `scoreMatrix` still passes `parseForecastResponse` after stripping, and a legacy snapshot is unchanged.

### Claude's Discretion
Endpoint path and DTO names for the extended-markets read, the module layout under `packages/domain` (for example `markets/` or `extended-markets/`), config constant names, the exact shape of the `cellsHash` and `scoreMatrix` Zod schema, how the market registry replaces the three duplicated selection tables, the decimal formatting of fair odds, expander and table markup details, fixtures, and the exact migration content found by the D-18 inventory.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` — Phase 14 goal, success criteria, and research flags (matrix persistence key shape, AH line set, exact-score buckets, push-aware EV display, hardcoded 3-market guard in `settlement-pipeline.ts`).
- `.planning/REQUIREMENTS.md` — MKT-01 through MKT-05.
- `.planning/PROJECT.md` — constraints (data cost, model integrity, responsible gambling).
- `AGENTS.md` — Russian user-facing text, English identifiers and commit messages.

### Prior decisions carried forward
- `.planning/phases/11-dixon-coles-model-version/11-CONTEXT.md` — corrected score matrix, `MODEL_VERSIONS`, versioned config pattern, immutable history (D-04), receipt provenance block.
- `.planning/phases/12-calibration-layer-and-versioned-rollback/12-CONTEXT.md` — calibration scope is the three scored markets (D-03); calibration is a read layer that never writes snapshots (D-08).
- `.planning/phases/13-clv-price-diary/13-CONTEXT.md` — closing capture, `no-vig-clv-v1`, CLV evaluation-only guard (D-05).
- `.planning/phases/13-clv-price-diary/13-VERIFICATION.md` — verified state of closing capture and CLV.
- `docs/closing-odds-operator.md` — operator procedure for closing odds, to be extended for the new markets.

### Code to read before planning
- `packages/domain/src/forecast/model.ts` — score matrix construction, renormalisation by retained mass, tail handling.
- `packages/domain/src/forecast/contract.ts` — `parseForecastResponse` and its `exactKeys` receipt/markets validation (must not break on legacy rows).
- `packages/domain/src/odds/contract.ts`, `packages/domain/src/odds/normalize.ts` — market/selection registry, book validation, proportional no-vig.
- `packages/domain/src/value/contract.ts`, `packages/domain/src/evaluation/scoring.ts` — duplicated market/selection tables to unify.
- `packages/domain/src/evaluation/financial.ts` — `settleFlatOneUnit`, `FlatOneUnitReceipt`, `aggregateFlatOneUnit` (v1 WIN/LOSS/VOID).
- `packages/domain/src/evaluation/closing-odds.ts`, `packages/domain/src/evaluation/no-vig-clv.ts` — Phase 13 modules that must accept the new markets.
- `packages/database/src/evaluation/settlement-pipeline.ts` — hardcoded 3-market guard and outcome resolution.
- `packages/database/src/forecast-repository.ts` — receipt persistence and DTO mapping.
- `packages/database/prisma/schema.prisma` — `ForecastSnapshot`, `ForecastMarket`, `ManualOddsSnapshot`, `ManualOddsSelection`, `ValueReceipt`, `ValueSettlement`, `ForecastScore`.
- `packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots`, `20260908_phase03_value_identity_gap`, `20260908_phase04_value_settlements`, `20260908_phase04_z_score_facts` — SQL that pins markets/selections.
- `tests/unit/clv-evaluation-only.test.ts` — import-graph guard that must stay green.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx`, `apps/web/components/enum-labels.ts`, `apps/web/app/methodology/page.tsx`, `packages/domain/src/methodology/model-card.ts` — UI, Russian labels, methodology and model card.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scoreMatrix` in `forecast/model.ts` (cells with `homeGoals`, `awayGoals`, `probability`, already renormalised by retained mass): the single source for every new market.
- `normalizeOddsBook`, `parseOddsBook`, `canonicalizeDecimalOdds`: reuse for the new books once market identity is generalised.
- `decimal.js` money path in `financial.ts`: extend for fractional returns.
- Phase 13 closing-odds repository/service/CLI and the read-time `no-vig-clv` reader: reuse for the new markets.
- Existing scorecard candidate registry and `enum-labels.ts` typed `Record` pattern for Russian labels.

### Established Patterns
- Versioned policy objects recorded with results (`ah-lines-v1`, `exact-score-buckets-v1`, `ah-settlement-v1`, `push-aware-ev-v1`, `flat-one-unit-v2`), never silent redefinition of a frozen version.
- Immutable, append-only history: no UPDATE of snapshots, receipts, settlements; new behaviour = new version.
- Optional conditional receipt keys with a closed key set (`dixonColes` precedent) validated by `exactKeys`.
- Read-time derived layers that never write to snapshot tables (Phase 12 calibration, Phase 13 CLV).
- Strict typed reason codes, never Infinity/NaN, never interpolation.

### Integration Points
- Forecast issuance path (orchestrator and `forecast-repository.ts`): persist `scoreMatrix`.
- New extended-markets read endpoint in `apps/api` beside the forecasts module.
- Manual odds submission and value generation (`apps/api/src/modules/odds`, `.../value`): widen market identity, push-aware EV.
- `settlement-pipeline.ts`: extended-market settlement into `ValueSettlement`.
- Web: match page sections, odds form, value table, methodology and model card.

</code_context>

<specifics>
## Specific Ideas

No specific requirements from the user beyond delegating the decisions ("реши сам"). The roadmap's recommended no-DDL matrix key and its call for an explicit `OTHER` tail were followed as written.

</specifics>

<deferred>
## Deferred Ideas

- Probabilistic scoring (log loss / RPS) and calibration of the extended markets, and including them in model comparison — a later phase once enough settled AH/exact-score samples exist.
- Asian totals (quarter-line over/under), team totals, half-time and in-play markets.
- Correct-score buckets beyond 3-3, or per-league bucket lists.
- A push-aware proper de-vig for AH books (instead of the documented proportional approximation).
- A browser form for closing odds (still blocked by the bodyless signed proxy; entry stays API/CLI as in Phase 13).
- Automatic ingestion of AH/exact-score odds from a provider (MVP stays manual odds only).

### Reviewed Todos (not folded)
None matched this phase.

</deferred>

---

*Phase: 14-Asian Handicap and Exact Score Markets*
*Context gathered: 2026-11-25*
