# Phase 14: Asian Handicap and Exact Score Markets - Research

**Researched:** 2026-11-25
**Domain:** Pure-TypeScript derivation of Asian handicap (AH) and exact-score markets from a frozen score matrix, plus the PostgreSQL guard/settlement layer that currently hard-codes three markets
**Confidence:** HIGH (codebase and database facts were read or run this session); MEDIUM on two methodology items flagged in Open Questions

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Score-matrix persistence and legacy snapshots (MKT-05)**
- **D-01:** At issuance, every new `ForecastSnapshot` receipt (Json column, no DDL for the key) gets an optional closed-shape key `scoreMatrix` of version `score-matrix-v1`: `{ version, gridMax, retainedMass, cells: [[home, away, probability], ...], cellsHash }`. `cells` is the full retained grid exactly as the model's renormalised matrix (`packages/domain/src/forecast/model.ts`, the `scoreMatrix` divided by `retainedMass`), persisted as exact doubles, no rounding. Applies to every model version (poisson and Dixon-Coles). Reversibility: one-way — snapshots are immutable, so every row issued from now on carries the key permanently; a shape change later needs a new `score-matrix-v2`, never a rewrite.
- **D-02:** The public forecast DTO is NOT changed. `parseForecastResponse` validates the receipt with `exactKeys` (a closed key set plus the conditional `dixonColes`); the persisted `scoreMatrix` is stripped when the DB receipt is mapped to the DTO, so legacy rows and the web parser keep working untouched. Extended markets are exposed through a separate read endpoint (D-04). The planner/researcher must confirm where the repository maps receipt to DTO (`packages/database/src/forecast-repository.ts`) and that a row with the key still passes validation after stripping.
- **D-03:** Legacy snapshots (no `scoreMatrix`) are re-derived deterministically, fail-closed: rebuild the grid with the same pure function from the receipt's `expectedGoals` (plus `dixonColes.rho` for Dixon-Coles rows), then require the re-derived ONE_X_TWO / OVER_UNDER_2_5 / BTTS probabilities to reproduce the stored `ForecastMarket` probabilities within an absolute tolerance of 1e-9. Any mismatch, missing input, or unknown model version yields `SCORE_MATRIX_UNAVAILABLE` for the extended markets only; the three stored markets are unaffected. No backfill, no UPDATE of existing rows.
- **D-04:** Extended markets are a READ-TIME view over the matrix, never written to `ForecastMarket` (its probabilities contract is the closed key set of the three markets, and `(forecastSnapshotId, market)` is unique). A new read endpoint returns, per forecast, the AH table, the exact-score table, and a typed state `AVAILABLE | UNAVAILABLE` with a reason code. Calibration is NOT applied to extended markets (Phase 12 D-03 keeps calibration on the three scored markets); the view is labelled raw / «без калибровки».

**Asian handicap lines and fair odds (MKT-01)**
- **D-05:** Versioned config `ah-lines-v1`: home-perspective lines from -2.5 to +2.5 in 0.25 steps (21 lines). The away side of a line is the mirror (home -0.75 is away +0.75). Canonical line token: signed decimal with the minimum digits, `0` for the level line, e.g. `-2.5`, `-0.75`, `0`, `+0.25`, `+1`. Any other token is rejected.
- **D-06:** Per line and side, the domain computes a five-way breakdown `WIN, HALF_WIN, PUSH, HALF_LOSS, LOSS` that sums to 1. Whole and half lines produce only WIN/PUSH/LOSS; quarter lines are the equal split of the stake over the two adjacent lines (half-win/half-loss arise there). Rule version `ah-settlement-v1`, shared by display and settlement (one pure function, never re-implemented per layer).
- **D-07:** Push-aware fair decimal odds solve EV = 0 per unit stake: `fairOdds = 1 + (LOSS + HALF_LOSS/2) / (WIN + HALF_WIN/2)`. If `WIN + HALF_WIN/2 == 0` the fair odds are UNAVAILABLE with a typed reason (no Infinity, no NaN). The UI shows the breakdown plus «эффективная вероятность выигрыша» `WIN + HALF_WIN/2`, the push/return probability, and the fair odds.
- **D-08:** The main line is the line minimising `|(WIN + HALF_WIN/2) - (LOSS + HALF_LOSS/2)|` for the home side (ties go to the smaller `|line|`). The match page highlights it and shows the five lines around it by default, with an accessible expander for all 21.

**Exact score buckets (MKT-02)**
- **D-09:** Versioned config `exact-score-buckets-v1`: explicit scorelines 0-0 through 3-3 (16 buckets) plus `OTHER`. Selection ids are `"H-A"` (for example `"2-1"`) and `"OTHER"`. `P(OTHER) = 1 - sum(listed)` is computed from the same renormalised matrix, so the 17 probabilities sum to exactly 1 within floating-point tolerance and tail mass is absorbed consistently; the existing tail warning stays visible. Fair odds are `1 / p` (no push), UNAVAILABLE with a typed reason when `p == 0`.
- **D-10:** UI shows a 4x4 home-by-away table (rows home goals, columns away goals) with probabilities and fair odds in numbers, plus the `OTHER` row. It must not rely on colour alone (accessibility), and Russian copy only.

**Odds books, no-vig, push-aware EV (MKT-03)**
- **D-11:** Market identity: AH is one complete two-way book per line, market id `ASIAN_HANDICAP:<line token>`, selections `HOME` / `AWAY`; exact score is one complete book, market id `EXACT_SCORE`, all 17 selections. The fixed `OddsMarket` union and `MARKET_SELECTIONS` record (`packages/domain/src/odds/contract.ts`, also duplicated in `value/contract.ts` and `evaluation/scoring.ts`) become a single market registry with a `selectionsFor(market)` function so the duplicated tables cannot drift. Validation stays strict: complete set, no duplicates, unknown market or line is `UNSUPPORTED_ODDS_MARKET`.
- **D-12:** No-vig for the new books reuses the existing proportional `normalizeOddsBook`. For AH the normalisation treats the two sides as complementary and ignores push mass; this is a documented approximation used only for overround display and, by Phase 13, CLV. EV never uses de-vigged prices.
- **D-13:** Push-aware EV per unit stake at the operator's quoted decimal odds `o`: `EV = WIN*(o-1) + HALF_WIN*(o-1)/2 - HALF_LOSS/2 - LOSS`, computed with `decimal.js`. Value candidates apply the same value threshold semantics as the existing markets to this EV. The value receipt records the five-way probabilities and an EV policy label `push-aware-ev-v1`. Exact score uses the ordinary `p*o - 1`.
- **D-14:** Closing-odds capture and `no-vig-clv-v1` (Phase 13) accept the new markets from day one, as the roadmap dependency requires. Phase 13 rules are unchanged: operator-only, pre-kickoff, append-only, CLV evaluation-only. The import-graph guard test `tests/unit/clv-evaluation-only.test.ts` must keep passing and must cover any new module so CLV cannot leak into value ranking.

**Settlement (MKT-04)**
- **D-15:** Pure domain functions `settleAsianHandicap(line, side, homeGoals, awayGoals)` returning one of `WIN | HALF_WIN | PUSH | HALF_LOSS | LOSS` plus the return multiplier on a unit stake, and `settleExactScore(selection, homeGoals, awayGoals)` returning `WIN | LOSS` (any unlisted score settles `OTHER`). Versions `ah-settlement-v1` and `exact-score-settlement-v1`. The goals come from the same final score the settlement receipt already uses.
- **D-16:** The money layer is extended by a new policy `flat-one-unit-v2` that supports fractional returns (`returnUnits` of 0, half stake, 1, and so on). `flat-one-unit-v1` (WIN/LOSS/VOID) stays frozen and keeps settling the three existing markets, so no historical settlement is reinterpreted. `ValueSettlement.result` is a string column, so the new result values need no DDL. Aggregation keeps the policy version visible and never silently mixes v1 and v2 rows.
- **D-17:** `ForecastScore` (Brier, log score), Phase 12 calibration, and model comparison stay on the three scored markets; extended markets are not entered into them in this phase. The hardcoded 3-market guard in `packages/database/src/evaluation/settlement-pipeline.ts` (`value === "ONE_X_TWO" || ...`) is split: the score-market guard stays for ForecastScore, and extended markets go through an exhaustive market-family switch with a `never` check, so a market with no settlement rule fails at compile time, plus a test asserting every registered market has a rule. The failure mode noted in the roadmap (runtime-only breakage) must be impossible by construction.

**Database**
- **D-18:** The `scoreMatrix` receipt key itself needs no DDL, but earlier migrations hardcode the market lists in SQL (`20260905_phase03_forecast_value_snapshots`, `20260908_phase03_value_identity_gap`, `20260908_phase04_value_settlements`, `20260908_phase04_z_score_facts`). The researcher must inventory every CHECK/trigger/function that pins markets or selections and decide the minimal forward migration. Any widening is an append-only forward migration verified with Testcontainers PostgreSQL (real constraints, no SQLite), with the append-only triggers left intact. Reversibility: one-way — a published migration cannot be edited; it must be superseded by a later one.

**UI and methodology**
- **D-19:** The match page (`apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx`) gets two sections below the existing markets: «Азиатский гандикап» (the line table of D-08, five-way breakdown, fair odds) and «Точный счёт» (D-10). All user-facing text in Russian; raw enum codes never shown (extend `apps/web/components/enum-labels.ts`, including the AH result and the new reason codes, typed so a new code breaks the build). `SCORE_MATRIX_UNAVAILABLE` copy: «Для этого прогноза расширенные рынки недоступны: матрица счёта не была сохранена».
- **D-20:** The manual odds form and the value table accept the new markets. Value rows for AH show the five-way breakdown and one plain sentence explaining push and half-win/half-loss; no wording that promises profit, and the persistent responsible-gambling disclaimers stay unchanged.
- **D-21:** `MODEL_CARD` is bumped (a new minor version) and `/methodology` gets a section on extended markets: derivation from the frozen matrix, quarter-line semantics, the five-way breakdown, the push-aware fair-odds and EV formulas, the AH no-vig approximation, exact-score buckets and `OTHER`, raw-not-calibrated, and honest limits (the matrix is the model's, not market-implied; small samples; legacy forecasts unavailable).

**Tests (mandatory pins)**
- **D-22:** For all 21 lines the five-way breakdown sums to 1; home line `L` and away line `-L` are exact mirrors; the level line (0) pushes exactly on a draw; integer lines push exactly on the margin; a quarter line equals the average of its two adjacent lines' return; exact-score probabilities sum to 1; a persisted matrix reproduces the three stored markets bit-for-bit; the legacy re-derive path accepts a reproducing snapshot and rejects a mismatching one (`SCORE_MATRIX_UNAVAILABLE`); settlement table tests cover every result for every line class; every registered market has a settlement rule; a snapshot with `scoreMatrix` still passes `parseForecastResponse` after stripping, and a legacy snapshot is unchanged.

### Claude's Discretion
Endpoint path and DTO names for the extended-markets read, the module layout under `packages/domain` (for example `markets/` or `extended-markets/`), config constant names, the exact shape of the `cellsHash` and `scoreMatrix` Zod schema, how the market registry replaces the three duplicated selection tables, the decimal formatting of fair odds, expander and table markup details, fixtures, and the exact migration content found by the D-18 inventory.

### Deferred Ideas (OUT OF SCOPE)
- Probabilistic scoring (log loss / RPS) and calibration of the extended markets, and including them in model comparison — a later phase once enough settled AH/exact-score samples exist.
- Asian totals (quarter-line over/under), team totals, half-time and in-play markets.
- Correct-score buckets beyond 3-3, or per-league bucket lists.
- A push-aware proper de-vig for AH books (instead of the documented proportional approximation).
- A browser form for closing odds (still blocked by the bodyless signed proxy; entry stays API/CLI as in Phase 13).
- Automatic ingestion of AH/exact-score odds from a provider (MVP stays manual odds only).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MKT-01 | View AH probabilities and fair odds from the frozen score matrix with quarter-line push/half-bet semantics | Pure `ah-settlement-v1` breakdown function verified in-session (SQL/JS parity over 5082 combinations, sums to 1 within 2.2e-16); fair-odds and main-line formulas; read-endpoint DTO shape (Code Examples, Architecture) |
| MKT-02 | View exact-score probabilities for a configured bucket list with explicit OTHER | `exact-score-buckets-v1` derivation from the same matrix; OTHER = max(0, 1 - sum(16)); note that the retained-mass renormalisation, not OTHER, absorbs the tail (Pitfall 9) |
| MKT-03 | Operator enters complete odds books for new markets with existing validation and no-vig, gets push-aware value receipts | Registry replacing three duplicated tables; `guard_value_pair` DB blocker inventory and replacement design; push-aware `decideExtendedValue`; edge definition recommendation (Open Question 1) |
| MKT-04 | Settlement resolves AH push/half-win/half-loss and exact score under explicit versioned rules in the scorecard pipeline | Real failure path is SQL (`persist_value_settlement` / `guard_value_settlement` / `ValueSettlement_result_check`), not the TS `isScoreMarket` guard; `flat-one-unit-v2` + `persist_value_settlement_v2` design; policy-mix hazards in `evaluation.service.ts` |
| MKT-05 | Score matrix persisted at issuance or deterministically re-derived fail-closed for legacy snapshots | Stored `receipt` column is the whole DTO; top-level `scoreMatrix` key; four strip/parse sites; jsonb double round-trip verified bit-exact; `buildScoreMatrix` extraction for re-derive; 1e-9 tolerance rationale |
</phase_requirements>

## Summary

The mathematics of this phase is small and was verified in-session: the five-way AH breakdown, quarter-line splitting, fair odds, and main-line selection are a few dozen lines of pure TypeScript over the existing `ForecastDraft.scoreMatrix` (64 cells, row-major home-outer/away-inner, already divided by `retainedMass`). A JS implementation and an equivalent PostgreSQL function agreed on all 5082 (line x side x score 0..10) combinations; breakdown sums deviate from 1 by at most 2.2e-16. Almost all of the phase's risk is not in the math but in the plumbing that assumes exactly three markets: PostgreSQL triggers and functions, the stored-receipt strictness of `parseForecastResponse`, hashed config objects that must not be touched, and aggregation code that silently mixes settlement policies.

Three findings change the plan shape. (1) The "hardcoded 3-market guard" in `settlement-pipeline.ts` (`isScoreMarket`) only runs over `ForecastMarket` rows, which under D-04 stay at three markets, so widening it is not the fix. The real runtime failure is in SQL: `persist_value_settlement` computes `result_value` with a three-market `CASE` that yields NULL for any other market, `guard_value_settlement` hard-codes `flat-one-unit-v1`, and `ValueSettlement_result_check` only allows `WIN/LOSS/VOID`. Because the pipeline settles inside one Serializable transaction, a single extended `VALUE_CANDIDATE` receipt would abort the entire fixture settlement, including the three-market scores. (2) `guard_value_pair` requires a `ForecastMarket` row and recomputes EV as `p*o - 1` with `fairOdds = 1/p`, so no extended `ValueReceipt` can be inserted today and the push-aware EV would be rejected even if it could; this needs a forward migration. (3) `ForecastSnapshot.receipt` stores the whole published DTO, so the persisted `scoreMatrix` must be a top-level key of that stored envelope and stripped at four code sites, one of which (`forecast-comparison.service.ts`) spreads the raw row into a DTO.

**Primary recommendation:** Build a pure `packages/domain/src/markets/` module (registry, score matrix, AH, exact score) first; then one forward migration that widens the value guard, the settlement guard/persist function, and the result CHECK together, with the SQL AH verifier proven against the TS function; keep `MARKET_SELECTIONS`, `SCORE_CLASS_ORDER`, and `FORECAST_CONFIGS` byte-identical so no hash changes.

## Project Constraints (from AGENTS.md)

- All user-facing text, UI copy, comments in user-facing components, and agent replies in Russian; code identifiers, file names, and commit messages in English (`AGENTS.md` Conventions).
- GSD workflow enforcement: file edits only through a GSD command (`/gsd-quick`, `/gsd-debug`, `/gsd-execute-phase`).
- Stack is fixed: pnpm workspaces + Turborepo, Next.js/React/TypeScript, NestJS, PostgreSQL/Prisma, Redis/BullMQ, `decimal.js` for exact decimals. Real PostgreSQL for integration tests (no SQLite).
- Responsible gambling: no automatic wagering, no certainty claims, persistent disclaimers; value copy never promises profit.
- Data integrity: immutable snapshots, append-only history, no retrospective mutation of predictions.
- Model integrity: probability quality is measured by proper scores, not hit rate; extended markets are explicitly NOT scored in this phase.
- `apps/web/AGENTS.md` (loaded by the harness): this Next.js has breaking changes; read the relevant guide under `apps/web/node_modules/next/dist/docs/` before writing web code. The planner must put that read at the top of every web task.
- A stale repo copy exists at `.claude/worktrees/goofy-khayyam-742851/`; ignore it in greps and never edit it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Score-matrix build, AH/exact-score derivation, settlement rules, EV | Domain package (pure TS) | — | One pure function shared by display, value, and settlement (D-06); no I/O |
| Matrix persistence at issuance | Database package (`forecast-repository.ts`) | Domain (shape + hash) | Persistence belongs to the repository; the shape and hash belong to the domain |
| Receipt-to-DTO stripping | Domain (one helper) | Database/API read sites | A single helper prevents four sites drifting |
| Legacy re-derive and fail-closed state | Domain resolver | Database repository supplies raw rows | Pure comparison of re-derived vs stored markets |
| Extended-markets read endpoint | API / Backend (`forecasts` module) | Database repository | Same eligibility guard and caching headers as other forecast reads |
| Value decision for extended markets | Domain `value/` | API `value.service.ts` | Push-aware EV and gates are domain policy |
| Value/settlement integrity (append-only, arithmetic) | Database (triggers/functions) | — | Established pattern: SQL independently verifies what TS produced |
| Settlement orchestration | Database package `settlement-pipeline.ts` | Domain rules | TS is the producer of the result; SQL is the verifier |
| Aggregation without policy mixing | API `evaluation.service.ts` | Domain `financial.ts` | v1 and v2 must be separated at the query |
| UI sections, form, labels | Frontend server (SSR page fetch) + client island | Browser (toggle/expander state) | UI-SPEC: server-side fetch, no client loading state, no UI arithmetic |
| Methodology/model card | Domain `model-card.ts` + web page | — | Existing model-card pattern |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `decimal.js` | 10.6.0 [VERIFIED: packages/domain/package.json:25] | Exact decimals for fair odds, EV, returns | Already the money path in `financial.ts`, `normalize.ts`, `decision.ts` |
| TypeScript | 5.9.3 [VERIFIED: package.json devDependencies] | Exhaustive `never` switches for market families | D-17 requires compile-time exhaustiveness |
| Vitest | 4.1.11 [VERIFIED: package.json devDependencies] | Unit (`--project unit`) and integration (`--project integration`) | Existing two-project config in `vitest.config.ts` |
| PostgreSQL | 18 (`postgres:18-alpine` image present and run in-session) | Guards/functions verified against a real migrated database | Project constraint |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` sha256 via existing `canonicalSha256` | built-in | `cellsHash` | Reuse `forecast/canonical-json.ts`; never a second hasher |
| Playwright | 1.62.1 [VERIFIED: package.json] | Interactive UI behaviour (toggle, expander, focus) | Existing E2E; there is no DOM test library (see Pitfall 11) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written closed-shape parser (domain pattern `exactKeys`) | Zod for the `scoreMatrix` schema | The domain package has no Zod dependency (only `decimal.js`); CONTEXT mentions Zod as discretion, but adding it widens the domain dependency surface for ~30 lines of validation. Use the hand-written pattern. |
| Testing Library + jsdom for UI-SPEC "component tests" | `renderToStaticMarkup` + Playwright | Neither `@testing-library` nor jsdom/happy-dom is installed [VERIFIED: ls node_modules/@testing-library failed; grep of package.json]. Existing UI tests use `renderToStaticMarkup`. Do not add a dependency. |

**Installation:** none. This phase installs no external packages.

## Package Legitimacy Audit

No external packages are installed by this phase. `@testing-library/*`, `jsdom`, and `zod` (in the domain package) are explicitly NOT recommended. The legitimacy gate (`package-legitimacy check`) is therefore not applicable.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
ISSUANCE (write path)
 ForecastOrchestrator.run
   -> createForecast (model.ts)  --buildScoreMatrix(expectedGoals, rho)-->  scoreMatrix (64 cells, renormalised)
   -> draft DTO (public shape, unchanged)  +  scoreMatrix v1 {cells, retainedMass, cellsHash}
   -> repository.publish(draft, { origin, scoreMatrix })
        issuance self-check: core markets re-summed from persisted cells === draft.markets (exact)
        INSERT ForecastSnapshot.receipt = { ...draftDto, scoreMatrix }   (top-level key, no DDL)

READ (extended-markets view)
 GET fixtures/:fixtureId/forecasts/:forecastId/extended-markets   (EligibilityGuard, no-store)
   -> repository.findStoredForecast(id) { receipt envelope, ForecastMarket probabilities }
   -> resolveScoreMatrix():
        persisted key present  -> parse closed shape, verify cellsHash, verify core markets (1e-12) -> source PERSISTED
        absent                 -> rebuild from receipt.receipt.expectedGoals (+ dixonColes.rho),
                                  require 3 markets within 1e-9 -> source REDERIVED
        anything else          -> UNAVAILABLE (SCORE_MATRIX_UNAVAILABLE; detail code to operator log only)
   -> ExtendedMarketsView { AH 21 lines x both sides, mainLine, exact score 16 + OTHER, tail, provenance }
   -> web page.tsx (server) fetches per listed forecast -> workbench props (no client fetch)

VALUE (operator)
 POST odds (market id from registry, complete book) -> normalizeOddsBook -> ManualOddsSnapshot (no DDL)
 POST value-receipts -> extended path: resolveScoreMatrix -> decideExtendedValue (push-aware EV, gates)
   -> ValueReceipt INSERT -> guard_value_pair (NEW extended branch) verifies against odds snapshot and matrix

SETTLEMENT
 settlement-pipeline processRevision
   -> ForecastScore loop over ForecastMarket rows (3 markets, unchanged, isScoreMarket kept)
   -> value loop: for each VALUE_CANDIDATE
        family switch (exhaustive, never): CORE -> persist_value_settlement (v1, unchanged)
                                           EXTENDED -> settleExtendedMarket() (pure TS) -> persist_value_settlement_v2(..., p_result)
        SQL guard_value_settlement (v2 branch) independently recomputes the result and the return arithmetic
```

### Recommended Project Structure
```
packages/domain/src/
├── markets/
│   ├── registry.ts        # MarketFamily, market id parse/format, selectionsFor(), AH line tokens (21), settlementPolicyFor()
│   ├── score-matrix.ts    # buildScoreMatrix (extracted from createForecast), core markets from matrix, score-matrix-v1 parse/hash, resolveScoreMatrix
│   ├── asian-handicap.ts  # AH_LINES_V1, breakdown, fair odds, main line, settleAsianHandicap, lineClass, adjacentLines
│   ├── exact-score.ts     # EXACT_SCORE_BUCKETS_V1, probabilities, OTHER, settleExactScore
│   └── extended-view.ts   # ExtendedMarketsView DTO + builder + strict parser
├── value/extended-decision.ts   # decideExtendedValue (push-aware EV); under value/ so the CLV guard test auto-covers it
└── evaluation/financial.ts      # + flat-one-unit-v2 (fractional returns), v1 untouched
packages/database/
├── prisma/migrations/20261126_phase14_extended_markets/migration.sql
└── src/extended-markets-repository.ts   # raw receipt + ForecastMarket read for the resolver
apps/api/src/modules/forecasts/          # new GET :forecastId/extended-markets in the existing controller
```

### Pattern 1: Stored-envelope split (the one strip helper)
**What:** `ForecastSnapshot.receipt` holds the whole DTO (`receipt: response as never`, `forecast-repository.ts:86`) and the Dixon-Coles repository documents that `expectedGoals` lives at `receipt.receipt.expectedGoals` [VERIFIED: packages/database/src/dixon-coles-repository.ts:38-47]. Add `scoreMatrix` as a sibling top-level key of that envelope and read every row through one helper `splitStoredForecast(raw): { dto: unknown; scoreMatrix: unknown | undefined }` that returns a shallow copy without the key.
**When to use:** at all four read sites: `forecast-repository.ts:50` (`toDto`), `value.service.ts:94` (`findForecast`), `forecast-comparison.service.ts:58` (`findExact` spreads `row.receipt` into a DTO later parsed by `compareForecastPair`), and the extended-markets repository. `publish` line 89 parses the in-memory `response` that never carries the key, so it is safe.
**Why top-level, not `receipt.receipt`:** the nested object is the public `ForecastReceiptDto`; the DB guard `guard_forecast_snapshot` only inspects `NEW.receipt->>'officialLineupObservationId'` on insert, so a new top-level key needs no DDL [VERIFIED: packages/database/prisma/migrations/20261124_phase11_forecast_snapshot_origin/migration.sql:59-61].
**Plumbing:** extend `ForecastPublishContext` (currently `{ origin }`, `forecast-orchestrator.ts:40-42`) with an optional `scoreMatrix`, so every existing one-argument `publish` test double stays valid.

### Pattern 2: Producer in TS, verifier in SQL
The existing settlement path lets SQL recompute `expected_result` from `ResultVersion` and reject mismatches (`guard_value_settlement`). Keep that discipline for v2: TS (`settleExtendedMarket`) is the only producer of the result and passes it to `persist_value_settlement_v2(..., p_result)`; the SQL guard recomputes the result independently and rejects a mismatch. The SQL verifier is validated against the TS function by an exhaustive parity test (Code Examples). Money arithmetic (`returnUnits`, `profitUnits`) is computed in SQL from `(result, odds)` exactly like v1, and the TS twin uses a high-precision Decimal clone for the parity test (Pitfall 8).

### Pattern 3: Market registry with family switch
`registry.ts` exports `MarketFamily = "ONE_X_TWO" | "OVER_UNDER_2_5" | "BTTS" | "ASIAN_HANDICAP" | "EXACT_SCORE"`, `parseMarketId(id): { family; line? } | null` (whitelist, never a numeric parse), `selectionsFor(id): readonly string[] | null`, and `settlementPolicyFor(id): "flat-one-unit-v1" | "flat-one-unit-v2"`. A single `switch (family)` with `const _exhaustive: never = family` is the compile-time guarantee of D-17. Keep the exported `MARKET_SELECTIONS` as the frozen three-core-market table (see Pitfall 5) and make `forecast/contract.ts`'s private table and `value/contract.ts`'s `SELECTIONS` derive from it; do NOT derive `SCORE_CLASS_ORDER` (Pitfall 4).

### Anti-Patterns to Avoid
- **Writing extended probabilities into `ForecastMarket`:** violates D-04 and the closed key set, and would put them under `ForecastScore`.
- **Re-implementing AH rules in the UI or the value layer:** the DTO must carry per-side breakdowns, effective win probability, fair odds, `lineClass`, adjacent lines, and `mainLine` (UI-SPEC "UI arithmetic prohibition").
- **Adding the AH/exact-score config into `FORECAST_CONFIG`/`DIXON_COLES_CONFIG`:** those objects are hashed (`forecastConfigHashFor`), so any added key changes `configHash`, breaks `CONFIG_HASH_MISMATCH` identity and every calibrator pinned by `configHash`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hashing the matrix | Another hasher or `JSON.stringify` ordering | `canonicalSha256` (`forecast/canonical-json.ts`) | Key order is by UTF-16 code unit and host-independent |
| De-vig for new books | New normaliser | `normalizeOddsBook` via `selectionsFor()` | D-12; only the selection ordering source changes |
| Exact money arithmetic | `number` math for returns | `decimal.js` (and SQL `numeric` for persisted values) | Returns are persisted as strings and compared exactly by guards |
| Append-only enforcement | App-level checks | Existing triggers (`reject_append_only_change`, `ValueSettlement_guarded_append_only`) | Must stay intact (D-18) |
| Closed-shape validation | Ad-hoc `in` checks | The `exactKeys` pattern from `forecast/contract.ts:73-76` | Same strictness as the DTO |
| Market id parsing | `parseFloat` on the line | Membership in the 21 canonical tokens | Rejects `+1.00`, `0.0`, `-0`, `1e0` by construction |

**Key insight:** every multi-market assumption in this codebase is duplicated across TS, SQL, labels, tests, and CLI help text. The registry removes the TS duplicates, but the SQL copies and the pinned hashes are the real hazard.

## Common Pitfalls

### Pitfall 1: The real settlement failure is in SQL, not in `isScoreMarket`
**What goes wrong:** An extended `VALUE_CANDIDATE` receipt makes `persist_value_settlement` evaluate its three-market `CASE` to NULL (`20260908_phase04_value_settlements/migration.sql:79`), `result` violates `NOT NULL`/`CHECK`, and the whole Serializable settlement transaction rolls back, including the ForecastScore rows of the three markets.
**Why it happens:** `isScoreMarket` (`settlement-pipeline.ts:64-66`) is applied only to rows of `ForecastMarket` (line 259-260), which stay at three markets under D-04. The values loop (lines 275-293) selects every `VALUE_CANDIDATE` regardless of market and calls the v1 SQL function.
**How to avoid:** Keep `isScoreMarket` as is; branch the values loop by market family before calling SQL; widen guard, persist function and CHECK in the same migration as the value-guard widening, and never land the value widening without the settlement widening.
**Warning signs:** `value result identity is inconsistent` or a NOT NULL violation on `ValueSettlement.result` in settlement logs.

### Pitfall 2: `guard_value_pair` blocks every extended value receipt
**What goes wrong:** The current definition (last replaced in `20260908_phase03_value_receipt_guard_path`) requires a `ForecastMarket` row for `(forecastSnapshotId, market)`, requires `modelProbability` to equal that row's probability, `fairOdds = 1/p`, `edge = p - noVig`, `expectedValue = p*o - 1` within 1e-12 [VERIFIED: migration.sql:28-69]. An AH receipt has no `ForecastMarket` row and a push-aware EV, so it is rejected.
**How to avoid:** `CREATE OR REPLACE FUNCTION guard_value_pair()` with the v1 branch kept logically identical (copy from the guard-path migration) and a new branch for `EXACT_SCORE` and `ASIAN_HANDICAP:<token>`; see the design in Code Examples. The trigger `ValueReceipt_validate_pair` is not recreated.

### Pitfall 3: Persisted `scoreMatrix` breaks every `parseForecastResponse` of a raw row
**What goes wrong:** `parseForecastResponse` rejects unknown top-level keys (`UNKNOWN_FORECAST_RESPONSE_KEY`, `contract.ts:146`). Any code that passes `row.receipt` straight in fails for new rows only, which a legacy-only test suite would not notice.
**How to avoid:** the single split helper (Pattern 1) plus a regression test that publishes a snapshot, reads it through `listIssued`, `findIssued`, the value repository, and the comparison repository, and asserts the DTO equals the pre-phase shape.

### Pitfall 4: Changing `SCORE_CLASS_ORDER` changes `SCORE_FORMULA_HASH`
**What goes wrong:** `SCORE_FORMULA_HASH` is the sha256 of `JSON.stringify(FORMULA_RECEIPT)` including `classOrder` [VERIFIED: packages/domain/src/evaluation/scoring.ts:6-24]. Refactoring that table to derive from the registry can alter key order or content, producing a new hash; `ForecastScore` is unique on `(settlementReceiptId, market, formulaHash)` and stores the old hash.
**How to avoid:** leave `SCORE_CLASS_ORDER` literal. Pin the current hash in a test: `sha256:c55c278db1513776c2776a4e1a79ff9f1b2e0194a1d6c2d67d7abdf63457f4af` [VERIFIED: computed in-session by replicating `FORMULA_RECEIPT` from scoring.ts:15-20].

### Pitfall 5: Widening `MARKET_SELECTIONS` rewrites the model card and breaks pinned tests
**What goes wrong:** `model-card.ts` line 165 renders `${market} — ${selections.length}` for every entry of `MARKET_SELECTIONS`, and `tests/unit/model-card.test.ts:198` iterates the same table. `calibration-panel.tsx` indexes it with a core market.
**How to avoid:** keep `MARKET_SELECTIONS` exported, typed `Readonly<Record<ForecastMarket, readonly ForecastSelection[]>>`, with unchanged content; add `selectionsFor()` for everything else. Widen `OddsMarket`/`OddsSelection` to finite literal unions (3 + `EXACT_SCORE` + 21 `ASIAN_HANDICAP:<token>` markets; the 7 core selections + 17 exact-score selections), and fix the resulting compile errors by typing core-only code with `ForecastMarket`/`ForecastSelection` (for example `MARKET_LABELS`, `SELECTION_LABELS` in `enum-labels.ts:13-14`).

### Pitfall 6: Scorecard aggregation silently mixes policies
**What goes wrong:** `loadCohort` queries `valueSettlement` without a policy filter when `market === "all"` and stamps every row `policyVersion: "flat-one-unit-v1"` [VERIFIED: apps/api/src/modules/evaluation/evaluation.service.ts:160-186]; `listValueCandidates` does the same for `pageTotals` (line 253 area) and exposes neither `market` nor `policyVersion` on `ValueCandidateRow`. Once v2 rows exist, ROI/yield of the three-market cohort would include AH rows relabelled v1.
**How to avoid:** add `policyVersion: "flat-one-unit-v1"` to the cohort `where` (cohorts are the three scored markets, D-17); add `market` and `policyVersion` to `ValueCandidateRow`; compute `pageTotals` per policy (UI-SPEC requires one line per policy). The SQL views `current_value_settlements` and `current_value_settlement_aggregate` also sum across policies but are used only by one integration test and no application code [VERIFIED: grep]; leave them and add a note in the migration header.

### Pitfall 7: Hashed config objects
Do not add anything to `FORECAST_CONFIG`/`FORECAST_CONFIGS`; the new versioned configs live in `markets/` (see Anti-Patterns). Add a test that `forecastConfigHashFor` for both model versions equals its pre-phase value.

### Pitfall 8: Decimal precision and the two arithmetic worlds
**What goes wrong:** `canonicalizeDecimalOdds` accepts up to 107 integer digits and 20 fractional digits (`odds/contract.ts:16-18`), but default `Decimal` precision is 20 significant digits. `(o + 1) / 2` or `o - 1` on such inputs rounds in TS while SQL `numeric` is exact; v1 guards compare returns with exact `<>`.
**How to avoid:** the v2 SQL function computes `returnUnits`/`profitUnits` itself from the result and the odds (as v1 does); TS never supplies money strings to SQL. The pure TS twin (`settleFlatOneUnitV2`) uses `Decimal.clone({ precision: 200 })` and is parity-tested against SQL on ordinary and pathological odds. EV for the value receipt may use default precision (the guard tolerance is 1e-12).

### Pitfall 9: Tail wording in UI-SPEC is not accurate
**What goes wrong:** UI-SPEC says the tail «входит в строку "Любой другой счёт"». Under `retained-mass-v1` the matrix is divided by `retainedMass` (`model.ts:163-164`), so the beyond-grid tail mass is spread proportionally over ALL cells, listed ones included; `OTHER = 1 - sum(16)` contains the renormalised 4+ goal cells, not the original tail.
**How to avoid:** use honest wording, for example «Хвост за пределами сетки 0–7 уже учтён нормировкой на сохранённую массу», in the tail line and in `/methodology`. Flagged to the planner because UI-SPEC is approved and copy is user-facing.

### Pitfall 10: Floating-point edge in OTHER
`1 - sum(16)` could be a tiny negative on a pathological grid. Clamp with `Math.max(0, ...)` and assert in a unit test that the 17 values sum to 1 within 1e-12 for lambda in the allowed bounds `[0.2, 4]`.

### Pitfall 11: No DOM test library
UI-SPEC's "component tests" for expander, side toggle, focus retention, and `aria-expanded` cannot run on `renderToStaticMarkup`. Put all logic (windowing, row model, labels, line labels) into pure functions that are unit-tested, render initial and alternate states through explicit props (`initialSide`, `initialExpanded`) via `renderToStaticMarkup`, and cover click/focus behaviour in a Playwright spec. Also remember `responsible-copy.test.ts` scans every `.tsx` under `apps/web/app` and `apps/web/components` for English prohibited tokens including standalone `lock` and `sure`; avoid those words in identifiers and strings.

### Pitfall 12: Extra time and penalties in the stored result
**What goes wrong:** results are normalised from football-data.org `score.fullTime` only [VERIFIED: packages/football-data/src/providers/football-data-org/normalize.ts:61-62]. The v4 docs state fullTime is the final score and their sample shows `fullTime` 7-6 with `regularTime` 1-1, `extraTime` 0-0, `penalties` 6-5 [CITED: docs.football-data.org/general/v4/overtime.html]. UEFA knockout matches that reach extra time or a shoot-out therefore carry a score that is not the 90-minute score, which is the usual basis for AH and exact-score. This pre-existing limitation already affects 1X2, totals, and BTTS; AH and exact score add money-like semantics on top.
**How to avoid:** do not widen scope to fix ingestion; add an honest limitation sentence to `/methodology` and the settlement rule doc (`ah-settlement-v1` is "on the stored final score"), and record it as a follow-up. See Open Question 2.

### Pitfall 13: Extended receipts written but CLV/closing mismatched
Closing observations are keyed by the market string, and the Phase 13 repository, validator, and CLI all call `Object.hasOwn(MARKET_SELECTIONS, market)`; after the registry change these must use `selectionsFor()`. The CLI help, the `UNSUPPORTED_MARKET` copy in `scripts/closing-odds.mjs` (line 17 and 30), and `docs/closing-odds-operator.md` list exactly three markets and are pinned by tests; update them together.

## Code Examples

### Persisted matrix, closed shape (D-01)
```ts
// Source: derived from packages/domain/src/forecast/model.ts:156-164 (grid construction and renormalisation)
export const SCORE_MATRIX_VERSION = "score-matrix-v1" as const;
export interface ScoreMatrixV1 {
  readonly version: typeof SCORE_MATRIX_VERSION;
  readonly gridMax: 7;
  readonly retainedMass: number;
  /** Row-major (home outer, away inner), exactly the renormalised cells. 64 entries. */
  readonly cells: readonly (readonly [number, number, number])[];
  readonly cellsHash: string; // canonicalSha256({ version, gridMax, cells })
}
```
Parser rules: exact key set, `version` literal, `gridMax === 7`, `cells.length === 64`, cell `i` has `home === floor(i/8)` and `away === i % 8`, every probability finite in [0,1], recompute `cellsHash` and compare, `retainedMass` finite in (0,1]. Issuance self-check: core markets re-summed from the persisted cells with the same `sumWhere` order must equal `draft.markets` with `===` before the INSERT is attempted.

### jsonb round-trip of doubles (verified)
A probe sent 67 grid cells plus `1e-300`, `5e-324`, `1e-7` through `JSON.stringify` -> `'...'::jsonb` -> text -> `JSON.parse` on `postgres:18-alpine`: all 201 numbers identical under `Object.is` [VERIFIED: in-session probe]. Persisted cells therefore round-trip bit-exactly through jsonb, which is what makes the D-22 "bit-for-bit" pin achievable for persisted matrices. Legacy re-derivation cannot promise bit-exactness (it recomputes `Math.exp` and `**`, which are not guaranteed identical across engines or platforms [ASSUMED]), which is why D-03 uses 1e-9.

### Asian handicap pure function (verified against SQL)
```ts
// Source: in-session prototype; 5082 line x side x (0..10)x(0..10) combinations matched the SQL twin with 0 mismatches
const legs = (line: number) => (Number.isInteger(line * 2) ? [line] : [line - 0.25, line + 0.25]);
export function settleAsianHandicap(line: number, side: "HOME" | "AWAY", home: number, away: number): AhResult {
  const margin = side === "HOME" ? home - away : away - home;
  const sideLine = side === "HOME" ? line : -line;
  let w = 0, p = 0, l = 0;
  const ls = legs(sideLine);
  for (const leg of ls) { const adj = margin + leg; if (adj > 0) w++; else if (adj === 0) p++; else l++; }
  const n = ls.length;
  if (w === n) return "WIN"; if (l === n) return "LOSS"; if (p === n) return "PUSH";
  if (l === 0) return "HALF_WIN"; if (w === 0) return "HALF_LOSS";
  throw new Error("AH_WIN_LOSS_MIX"); // unreachable: adjacent quarter legs never straddle
}
// Return multiplier per unit stake at decimal odds o: WIN o | HALF_WIN (o+1)/2 | PUSH 1 | HALF_LOSS 1/2 | LOSS 0
// Canonical token: line === 0 ? "0" : `${line > 0 ? "+" : "-"}${Math.abs(line)}`  -> -2.5 -2.25 -2 -1.75 ... 0 +0.25 ... +2 +2.25 +2.5
```
Verified properties on a synthetic matrix: breakdown sums to 1 within 2.2e-16 on all 21 lines; a quarter-line return equals the average of its adjacent lines' returns with error 0; home line `L` and away side mirror (WIN <-> LOSS, HALF_WIN <-> HALF_LOSS) are the same cell sets, so summing cells in the same order makes the mirror bit-identical. Sample outputs: `-0.75 HOME 1-0 = HALF_WIN`, `-0.25 HOME 0-0 = HALF_LOSS`, `0 HOME 1-1 = PUSH`, `-1 HOME 1-0 = PUSH`. Main line on that sample: `-0.25`; fair odds `1 + (LOSS + HL/2)/(WIN + HW/2)`.

Quarter-line semantics are the standard half-on-each-adjacent-line rule [CITED: en.wikipedia.org/wiki/Asian_handicap, sportmonks.com/glossary/asian-handicap]; since bookmakers' own rules govern real payouts, `ah-settlement-v1` is the project's explicit versioned rule.

### SQL verifier (verified on postgres:18-alpine)
```sql
-- Source: in-session; signed tokens cast cleanly ('+0.25'::numeric = 0.25, '0'::numeric = 0), substring(market from 16) strips 'ASIAN_HANDICAP:'
CREATE FUNCTION ah_result(p_line numeric, p_side text, p_home int, p_away int) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE margin numeric; side_line numeric; w int := 0; p int := 0; l int := 0; n int; leg numeric; adj numeric;
BEGIN
  margin := CASE p_side WHEN 'HOME' THEN p_home - p_away WHEN 'AWAY' THEN p_away - p_home END;
  side_line := CASE p_side WHEN 'HOME' THEN p_line WHEN 'AWAY' THEN -p_line END;
  IF margin IS NULL THEN RETURN NULL; END IF;
  FOREACH leg IN ARRAY CASE WHEN (side_line*2) = trunc(side_line*2) THEN ARRAY[side_line] ELSE ARRAY[side_line-0.25, side_line+0.25] END LOOP
    adj := margin + leg;
    IF adj > 0 THEN w := w+1; ELSIF adj = 0 THEN p := p+1; ELSE l := l+1; END IF;
  END LOOP;
  n := w+p+l;
  RETURN CASE WHEN w=n THEN 'WIN' WHEN l=n THEN 'LOSS' WHEN p=n THEN 'PUSH' WHEN l=0 THEN 'HALF_WIN' WHEN w=0 THEN 'HALF_LOSS' END;
END $$;
```
Before casting a market tail, the guard must first require `market ~ '^ASIAN_HANDICAP:(0|[+-](0\.25|0\.5|0\.75|1|1\.25|1\.5|1\.75|2|2\.25|2\.5))$'` (and `market = 'EXACT_SCORE'` for the other family) so malformed ids fail with a clear message rather than a cast error. The return arithmetic in SQL: `WIN -> o`, `HALF_WIN -> (o+1)/2`, `PUSH -> 1`, `HALF_LOSS -> 0.5`, `LOSS -> 0`, `stakeUnits '1'`, `profit = return - 1` (v1 precedent: `trim_scale(...)::text`).

### Push-aware fair odds and EV
```ts
// Source: CONTEXT D-07, D-13; solves EV(o) = 0:  o*(W + HW/2) = (W + HW/2) + HL/2 + L
const eff = (b) => new Decimal(b.WIN).plus(new Decimal(b.HALF_WIN).div(2));
const lose = (b) => new Decimal(b.LOSS).plus(new Decimal(b.HALF_LOSS).div(2));
fairOdds = eff.isZero() ? null /* reason NO_WIN_PROBABILITY */ : new Decimal(1).plus(lose.div(eff)).toString();
ev = WIN*(o-1) + HALF_WIN*(o-1)/2 - HALF_LOSS/2 - LOSS;   // PUSH contributes 0
```

### Design of the replaced `guard_value_pair` (extended branch)
For `market = 'EXACT_SCORE'` or the AH pattern: (1) same identity checks as v1 (issued forecast, odds snapshot fixture and market, `forecast_state = 'ISSUED'`); (2) the selection exists in `ManualOddsSnapshot.receipt->'selections'` and `decimalOdds`/`noVigProbability` equal the snapshot values (these are recomputable); (3) do NOT require a `ForecastMarket` row; (4) read the recorded breakdown from `receipt->'extended'` (AH) and check each in [0,1] summing to 1 within 1e-9; recompute `expectedValue`, `fairOdds`, and `edge` from the recorded numbers and compare with tolerance 1e-12 (exact score: `p*o-1`, `1/p`, `p - noVig`); (5) matrix binding: if the forecast row has `receipt->'scoreMatrix'->>'cellsHash'`, require `receipt->'extended'->'matrix'->>'cellsHash'` to equal it with `source = 'PERSISTED'` and recompute the probability from the persisted cells with the same SQL `ah_result` (so persisted-matrix receipts are independently verified); otherwise require `source = 'REDERIVED'` and accept the recorded numbers on self-consistency only. NULL `fairOdds` is permitted for the extended branch when the recorded reason is `NO_WIN_PROBABILITY`/`ZERO_PROBABILITY` (the column is nullable).

### Settlement migration shape
One forward migration (`20261126_phase14_extended_markets`, sorts after `20261125_phase12_calibrator_transitions`): helper functions; `CREATE OR REPLACE guard_value_pair`; `CREATE OR REPLACE guard_value_settlement` (v1 branch logically unchanged, v2 branch new, selected by `NEW."policyVersion"`); `ALTER TABLE "ValueSettlement" DROP CONSTRAINT "ValueSettlement_result_check"` then re-add with `('WIN','LOSS','VOID','HALF_WIN','HALF_LOSS','PUSH')`; new `persist_value_settlement_v2(p_id, p_settlement_id, p_value_id, p_odds_selection_id, p_closing_id, p_supersedes, p_result)` locking on `...:flat-one-unit-v2`. Leave `persist_value_settlement` (6 args), `ForecastScore_market_check`, `guard_forecast_score`, `ClosingOddsObservation`, and `ManualOdds*` untouched. The UNIQUE `(settlementReceiptId, valueReceiptId, policyVersion)` already lets v1 and v2 coexist; the TS `stableId` must include the policy string.

## Database Inventory (D-18, verified against a migrated PostgreSQL 18 database)

All 34 migrations were applied with `prisma migrate deploy` to a throwaway `postgres:18-alpine` and the catalog was queried.

| Object | What pins markets/selections | Action |
|--------|------------------------------|--------|
| `guard_value_pair()` (trigger `ValueReceipt_validate_pair`) | needs `ForecastMarket` row; `p*o-1`, `1/p`, `p-noVig` | Replace (extended branch) |
| `guard_value_settlement()` (trigger `ValueSettlement_guarded_append_only`) | three-market `CASE` for expected result; `policyVersion = 'flat-one-unit-v1'`; return = odds/1/0 | Replace (v1 branch kept, v2 branch added) |
| `persist_value_settlement` (6 args) | three-market `CASE` and `flat-one-unit-v1` literal | Keep untouched for v1; add `persist_value_settlement_v2` |
| `ValueSettlement_result_check` | `result IN ('WIN','LOSS','VOID')` | Drop and re-add widened |
| `ForecastScore_market_check`, `guard_forecast_score`, `persist_forecast_score` | three scored markets | Keep (D-17) |
| `Calibrator_market_check`, `CalibratorEvent_market_check` | three markets | Keep (D-17) |
| `ManualOddsSnapshot`, `ManualOddsSelection`, `ClosingOddsObservation`, `ValueReceipt`, `ForecastMarket` | no market/selection CHECK; `decimalOdds ~ '^[0-9]+(\.[0-9]+)?$'` only | None |
| `guard_forecast_snapshot()` | inspects only `receipt->>'officialLineupObservationId'` on insert | None |
| Views `current_value_settlements`, `current_value_settlement_aggregate` | sum all policies | Leave; header note |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Three fixed markets in four duplicated tables | One registry plus a frozen core table | This phase | Exhaustive family switch; no drift |
| Settlement result computed only in SQL | TS producer, SQL verifier with parity test | This phase | One rule, defence in depth |
| One flat-stake policy (WIN/LOSS/VOID) | `flat-one-unit-v2` with fractional returns for extended markets | This phase | v1 history never reinterpreted |

**Deprecated/outdated:** the font row of `10-UI-SPEC.md` (UI-SPEC 14 notes it is stale); UI-SPEC's «Vitest + Testing Library» wording for component tests (not installed).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | AH `edge` should be `conditionalWinProbability - noVigProbability` with `conditionalWinProbability = p_eff / (p_eff + l_eff)` (design recommendation; D-13 does not define edge) | Open Question 1 | Wrong edge can falsely fail or pass the 0.03 gate on lines with large push mass (e.g. level line) |
| A2 | `Math.exp` and `**` are not bit-identical across engines/platforms, hence the 1e-9 legacy tolerance | Code Examples | If they are identical, the tolerance could be tighter; no correctness risk |
| A3 | Prisma `Json` reads return the same doubles that jsonb stores (verified at PostgreSQL text level only, not through the Prisma adapter) | Code Examples | A driver that parses numbers differently would break the bit-for-bit pin; the integration test will catch it |
| A4 | Playwright E2E can seed and run on the developer machine (Phase 7 notes say the live stack shells out to `cmd.exe`, Windows-only, and CI uses a different path) | Validation Architecture | Interaction tests might need a CI-portable harness |
| A5 | Suggested 4-plan decomposition and wave order (domain, data path, web, methodology/docs/e2e) | Summary | Plan sizing only |
| A6 | Exact score also settles under `flat-one-unit-v2` (all extended markets use v2) | Open Question 4 | If exact score stays v1, the v1 SQL guard needs widening instead |

## Open Questions

1. **AH `edge` definition (needs confirmation before planning the value receipt).**
   - What we know: the v1 guard enforces `edge = modelProbability - noVigProbability`; UI-SPEC says the UI shows whatever the receipt records and omits the row if absent. D-12 says the AH no-vig treats the two sides as complementary and ignores push mass.
   - What's unclear: with `modelProbability = p_eff = W + HW/2`, `p_eff - noVig` is not comparable to an implied probability that ignores push; on the level line (push about 25%) it would be roughly -0.10 on a fair price.
   - Recommendation: `modelProbability := p_eff`, `edge := p_eff/(p_eff + l_eff) - noVigProbability`, record `formulas` entries and `edgeDefinition: "conditional-win-probability-minus-no-vig"` in the receipt, same 0.03/0.05 thresholds. Mark as a decision for the discuss step if the user wants to override.
2. **Extra time and penalties.** The stored score is `fullTime`; for UEFA knockout ties it may include extra time and shoot-out goals. Recommendation: document as a limitation now (methodology and `ah-settlement-v1` description), schedule an ingestion follow-up (store `regularTime`), do not fix in Phase 14.
3. **SQL independent AH verifier versus D-06 wording ("never re-implemented per layer") and D-18 "minimal migration".** Recommendation: keep the SQL verifier because every existing market is SQL-verified and `ValueSettlement` is the money ledger; the TS function stays the only producer and an exhaustive parity test (21 lines x 2 sides x 0..10 x 0..10) prevents drift. Fallback if time-boxed: SQL checks only that `result` is in the five-value set and the arithmetic is consistent. The planner should state which option it chose.
4. **Exact score under v2.** Recommendation: yes, family-to-policy mapping stays deterministic (`settlementPolicyFor`). It costs only the v2 branch.
5. **Top-level `scoreMatrix` versus `receipt.receipt.scoreMatrix`.** Recommendation: top-level of the stored envelope (Pattern 1). CONTEXT's phrase "snapshot receipt" is ambiguous; both need the strip helper, top-level keeps `ForecastReceiptDto` untouched.
6. **Tail wording** in UI-SPEC (Pitfall 9): confirm the replacement copy.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | yes | v24.22.0 (engine `>=24 <25`) | — |
| pnpm | scripts | yes | 10.34.5 | — |
| Docker daemon | PostgreSQL integration tests, migration verification | yes | 29.9.3, server running; images `postgres:18-alpine`, `postgres:18.6-alpine`, `redis:8-alpine` present | — |
| Playwright browsers | interaction E2E | not probed | package 1.62.1 | Pure-function and static-markup tests cover logic; run E2E in the release gate |
| Dev database container | do not touch | running (`football-prediction-platform-postgres-1`) | 18.6 | Use throwaway containers as the existing tests do |

Integration tests start their own container with raw `docker run` (not the Testcontainers library) and run `prisma migrate deploy` from `packages/database` [VERIFIED: tests/integration/value-settlement.test.ts:20-38]. Follow the same helper pattern for new integration files.

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (`unit` and `integration` projects), plus web tests via `pnpm --filter @bet-stats/web test`, plus Playwright |
| Config file | `vitest.config.ts`, `apps/web/vitest.config.ts` (`app/**/*.test.ts`, `components/**/*.test.ts` only) |
| Quick run command | `pnpm exec vitest run --project unit <files>` (verified: 2 files, 60 tests, ~2 s) |
| Full suite command | `pnpm test` (unit + web), `pnpm test:integration` (needs Docker), `pnpm typecheck` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MKT-01 | 21 lines sum to 1; mirror bit-identical; level line pushes on draw; integer lines push on margin; quarter = average of adjacent; fair odds formula; unavailable reason; main line + tie to smaller abs line | unit | `pnpm exec vitest run --project unit tests/unit/asian-handicap.test.ts` | Wave 0 |
| MKT-01 | Read view DTO builder and strict parser; both sides, lineClass, adjacent lines | unit | `... tests/unit/extended-view.test.ts` | Wave 0 |
| MKT-02 | 17 probabilities sum to 1 within 1e-12 for lambda in [0.2, 4]; OTHER clamp; `p == 0` fair odds unavailable | unit | `... tests/unit/exact-score.test.ts` | Wave 0 |
| MKT-03 | Registry: 25 market ids, whitelist tokens (`+1.00`, `-0`, `0.0` rejected), complete/duplicate/unknown book errors keep codes; `normalizeOddsBook` on AH and 17-way books | unit | `... tests/unit/markets-registry.test.ts`, `tests/unit/odds-draft.test.ts` | Wave 0 / exists |
| MKT-03 | Push-aware EV and gates; five-way recorded; policy label `push-aware-ev-v1`; exact-score `p*o-1` | unit | `... tests/unit/extended-value-decision.test.ts` | Wave 0 |
| MKT-03 | Extended `ValueReceipt` accepted by new `guard_value_pair`; tampered EV, fair odds, matrix hash, odds mismatch all rejected; v1 regression unchanged | integration | `pnpm exec vitest run --project integration tests/integration/extended-markets-guards.test.ts tests/integration/value-receipt.test.ts` | Wave 0 / exists |
| MKT-03 | Odds submit and value compare API for `ASIAN_HANDICAP:-0.75` and `EXACT_SCORE`; closing odds accepted for new markets; CLV reader on AH | integration | `... tests/integration/extended-markets-api.test.ts` | Wave 0 |
| MKT-04 | Settlement table for every result per line class; every registered market has a rule; `flat-one-unit-v2` returns; v1 frozen | unit | `... tests/unit/extended-settlement.test.ts`, `tests/unit/financial-evaluation.test.ts` | Wave 0 / exists |
| MKT-04 | TS vs SQL parity over 21 x 2 x 11 x 11 and exact score; `persist_value_settlement_v2` accepts and guard rejects wrong result; pipeline settles a mixed fixture (3-market scores plus AH plus exact score) in one run; aggregation never mixes policies | integration | `... tests/integration/extended-settlement-pipeline.test.ts` | Wave 0 |
| MKT-05 | Persisted matrix reproduces the three stored markets exactly; cellsHash tamper rejected; `parseForecastResponse` passes after strip at all four read sites; legacy snapshot unchanged | unit + integration | `... tests/unit/score-matrix.test.ts`, `tests/integration/score-matrix-persistence.test.ts` | Wave 0 |
| MKT-05 | Legacy re-derive accepts reproducing snapshot (poisson and Dixon-Coles incl. `out-of-band-zero`), rejects mismatch, unknown model, missing inputs | unit | `... tests/unit/score-matrix.test.ts` | Wave 0 |
| Guards | CLV import-graph guard stays green and covers `value/extended-decision.ts`; `SCORE_FORMULA_HASH` pin; `forecastConfigHashFor` pins | unit | `... tests/unit/clv-evaluation-only.test.ts tests/unit/evaluation.test.ts` | exists (add pins) |
| UI | Labels exhaustive (`enum-labels.test.ts`), 21 AH line labels, 17 exact-score labels, no label equals its raw code; static markup of both sections in AVAILABLE, UNAVAILABLE, fair-odds-unavailable states; value outcome with and without breakdown; copy gate and raw-enum scan; design-token pairs on `--color-accent-soft` | unit | `pnpm --filter @bet-stats/web test` and `pnpm exec vitest run --project unit tests/unit/extended-markets-ui.test.tsx tests/unit/responsible-copy.test.ts` | exists / Wave 0 |
| UI | Toggle, expander (`aria-expanded`, focus kept), line select, 17-input focus-first-invalid, compare button disabled; axe scan | e2e (manual-tier) | `pnpm exec playwright test -c playwright.config.ts tests/e2e/extended-markets.spec.ts` | Wave 0 |
| Methodology | `model-card-v1.4.0`, section ids with `extended-markets` between `calibration` and `clv`, changeHistory entry | unit | `... tests/unit/model-card.test.ts tests/unit/inner-pages-design-ui.test.tsx` | exists (update pins) |

### Sampling Rate
- **Per task commit:** `pnpm exec vitest run --project unit <touched test files>` (seconds)
- **Per wave merge:** `pnpm test` plus the new integration files with Docker (`pnpm exec vitest run --project integration <files>`, about 1 to 2 minutes each because each file starts PostgreSQL), plus `pnpm typecheck`
- **Phase gate:** `pnpm test`, `pnpm test:integration`, `pnpm typecheck`, `pnpm build`, and the Phase 10 perf harness re-run if the page changed, before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/markets-registry.test.ts`, `asian-handicap.test.ts`, `exact-score.test.ts`, `score-matrix.test.ts`, `extended-view.test.ts`, `extended-value-decision.test.ts`, `extended-settlement.test.ts`
- [ ] `tests/integration/extended-markets-guards.test.ts`, `extended-settlement-pipeline.test.ts`, `score-matrix-persistence.test.ts`, `extended-markets-api.test.ts`
- [ ] `tests/unit/extended-markets-ui.test.tsx`, `tests/e2e/extended-markets.spec.ts`
- [ ] Pins added to existing tests: `SCORE_FORMULA_HASH` literal, `forecastConfigHashFor` for both models, `createForecast` bit-identity before/after extracting `buildScoreMatrix` (same fixtures, `inputHash`, markets, `scoreMatrix` all equal)
- [ ] Framework install: none

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no new auth); closing-odds stays behind the existing operator guard | existing `OperatorGuard` |
| V3 Session Management | no | — |
| V4 Access Control | yes | New read endpoint under the same `EligibilityGuard` as other forecast reads, `Cache-Control: private, no-store`; no new operator surface |
| V5 Input Validation | yes | Closed-set market id and selection whitelists (21 canonical tokens, 16 scorelines plus `OTHER`), strict closed-shape parser for `scoreMatrix`, existing `exactKeys` and `canonicalizeDecimalOdds` limits; SQL guard validates the market with a regex before any cast |
| V6 Cryptography | no secrets; sha256 integrity hash only | existing `canonicalSha256` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged or malformed market id reaching SQL casts (`ASIAN_HANDICAP:abc`) | Tampering | Whitelist in TS and regex precheck in SQL; parameterised queries only |
| Tampered stored matrix or receipt | Tampering | Append-only triggers kept; `cellsHash` recomputed on read; core markets re-summed on read; unavailable state fails closed |
| Value receipt with inconsistent EV or breakdown | Tampering | New `guard_value_pair` branch recomputes from odds snapshot and persisted matrix |
| Wrong settlement result written to the money ledger | Tampering | SQL guard recomputes result and return arithmetic; parity test |
| Oversized JSON in `receipt` | DoS | Exactly 64 cells enforced by parser |
| Probability copy implying certainty or profit | Repudiation/ethics | Copy gate extended; persistent disclosure untouched; raw enum scan |
| Leakage of CLV into value ranking | Information disclosure | `clv-evaluation-only` import-graph test; keep new modules free of CLV imports |

## Sources

### Primary (HIGH confidence)
- Repository files read this session: `packages/domain/src/forecast/model.ts`, `forecast/contract.ts`, `odds/contract.ts`, `odds/normalize.ts`, `value/contract.ts`, `value/decision.ts`, `evaluation/financial.ts`, `evaluation/scoring.ts`, `evaluation/closing-odds.ts`, `evaluation/no-vig-clv.ts`, `evaluation/forecast-orchestrator.ts`; `packages/database/src/forecast-repository.ts`, `evaluation/settlement-pipeline.ts`, `dixon-coles-repository.ts`; migrations `20260905_phase03_forecast_value_snapshots`, `20260908_phase03_value_identity_gap`, `20260908_phase03_value_receipt_guard_path`, `20260908_phase04_value_settlements`, `20260908_phase04_z_score_facts`, `20261124_phase11_forecast_snapshot_origin`; `apps/api/src/modules/evaluation/evaluation.service.ts`; `tests/unit/clv-evaluation-only.test.ts`, `tests/integration/value-settlement.test.ts`.
- Live probes: throwaway `postgres:18-alpine` (jsonb double round-trip, numeric casts of signed tokens, AH SQL/JS parity, full migration catalog inventory); `pnpm exec vitest run --project unit` quick-run check.

### Secondary (MEDIUM confidence)
- [football-data.org: dealing with scores](https://docs.football-data.org/general/v4/overtime.html) — `fullTime`, `regularTime`, `extraTime`, `penalties`; the "includes shoot-out" reading comes from a worked sample, not an explicit statement.
- [Wikipedia: Asian handicap](https://en.wikipedia.org/wiki/Asian_handicap) and [Sportmonks glossary](https://www.sportmonks.com/glossary/asian-handicap/) — quarter-line stake splitting.

### Tertiary (LOW confidence)
- None relied upon.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; versions read from package files.
- Architecture: HIGH — every blocker was read in source and the database objects were confirmed against a migrated catalog.
- Pitfalls: HIGH for items 1-8, 10, 11, 13 (verified in code or by probe); MEDIUM for 9 and 12 (copy accuracy and provider semantics need a decision).

**Research date:** 2026-11-25
**Valid until:** 2026-12-25 (stable internal codebase; re-check only if Phases 15-16 or another migration touch value/settlement SQL first)
