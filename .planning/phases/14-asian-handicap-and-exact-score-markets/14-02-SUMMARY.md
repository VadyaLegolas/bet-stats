---
phase: 14-asian-handicap-and-exact-score-markets
plan: 02
subsystem: markets-domain
tags: [market-registry, asian-handicap, exact-score, extended-view, odds-validation, fail-closed]

requires:
  - phase: 14-asian-handicap-and-exact-score-markets
    provides: 14-01 score matrix persistence, settleAsianHandicap, ahBreakdown, resolveScoreMatrix, extended-markets tracer route
provides:
  - single market registry (25 canonical ids, selectionsFor) replacing three duplicated selection tables
  - complete odds books of Asian handicap (21 lines) and exact score (17 selections) through parseOddsBook / normalizeOddsBook / drafts
  - closing odds and no-vig CLV accept the new markets via selectionsFor
  - buildAhView (21 lines, five outcomes per side, class, split lines, main line) and exactScoreView (16 scores + OTHER)
  - strict ExtendedMarketsView DTO and closed parser parseExtendedMarketsView; the route serves it
affects: [14-03, 14-04, 14-05, 14-06, 14-07, 14-08]

plan_head_before: 72979411f3a1fbcf25d0ac942a046aed24513ebf
plan_head_after: c705d8a6fab3e962cc442c643bf41412a0d414ae

actuals:
  tokens: 21000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "one registry of market ids; every layer asks selectionsFor, whitelist membership instead of numeric parsing"
    - "dependency-free ah-lines.ts keeps the registry free of the forecast config global Decimal side effect"
    - "strict closed parser of the wire DTO: an unrecognised shape is never AVAILABLE"

key-files:
  created:
    - packages/domain/src/markets/registry.ts
    - packages/domain/src/markets/exact-score.ts
    - packages/domain/src/markets/ah-lines.ts
    - packages/domain/src/markets/extended-view.ts
    - tests/unit/markets-registry.test.ts
    - tests/unit/exact-score.test.ts
    - tests/unit/extended-view.test.ts
  modified:
    - packages/domain/src/markets/asian-handicap.ts
    - packages/domain/src/odds/contract.ts
    - packages/domain/src/odds/draft.ts
    - packages/domain/src/odds/normalize.ts
    - packages/domain/src/value/contract.ts
    - packages/domain/src/value/decision.ts
    - packages/domain/src/forecast/contract.ts
    - packages/domain/src/evaluation/closing-odds.ts
    - packages/domain/src/evaluation/no-vig-clv.ts
    - packages/domain/src/index.ts
    - apps/api/src/modules/forecasts/forecasts.service.ts
    - apps/api/src/modules/value/value.service.ts
    - apps/web/components/enum-labels.ts
    - tests/unit/asian-handicap.test.ts
    - tests/unit/odds-draft.test.ts
    - tests/unit/value.test.ts
    - tests/unit/closing-odds.test.ts
    - tests/unit/no-vig-clv.test.ts
    - tests/integration/score-matrix-persistence.test.ts
    - tests/integration/forecast-api.test.ts

key-decisions:
  - "Main line tie-break beyond D-08 (equal |line| for -L and +L): the smaller (more negative) home line wins; comparison is exact, no tolerance"
  - "ah-lines.ts (token list, whitelist parse, quarter map) split out of asian-handicap.ts so the registry and through it the odds contract do not import forecast/config, whose module load calls Decimal.set globally and would change the precision of isolated odds normalisation (caught by the existing odds-draft overround pins)"
  - "exact-score.ts carries its own Decimal clone with precision 40, pinned equal to FORECAST_CONFIG.decimalPrecision by a unit test, for the same side-effect reason"
  - "AhLineToken narrowed from string to the closed 21-member literal union, so AhMarketId and MarketId are exact types"
  - "value.service rejects a non-core market with UNSUPPORTED_VALUE_MARKET right after the command parse (before any repository read) until plan 14-07"

requirements-completed: [MKT-01, MKT-02]
requirements-partial: [MKT-03]

coverage:
  - id: D1
    description: "One registry of 25 market ids; whitelist parse rejects +1.00, 0.0, -0, 1e0, unknown lines; frozen three-market table pinned byte for byte, SCORE_CLASS_ORDER untouched"
    requirement: "MKT-03"
    verification:
      - kind: unit
        ref: "tests/unit/markets-registry.test.ts"
        status: pass
      - kind: unit
        ref: "tests/unit/model-card.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Complete AH and exact score books validate with the old error codes and normalise proportionally; drafts accept only known selections"
    requirement: "MKT-03"
    verification:
      - kind: unit
        ref: "tests/unit/markets-registry.test.ts#odds books of the new markets, tests/unit/odds-draft.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Value command, closing-odds validation and no-vig CLV route through selectionsFor with unchanged check order; CLV import graph stays evaluation-only"
    requirement: "MKT-03"
    verification:
      - kind: unit
        ref: "tests/unit/value.test.ts, closing-odds.test.ts, no-vig-clv.test.ts, clv-evaluation-only.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Asian handicap on 21 lines: five outcomes sum to 1 within 1e-12, AWAY is the bitwise mirror of HOME, push only on the draw / margin, quarter line = average of neighbours, main line and tie-break, class and split lines"
    requirement: "MKT-01"
    verification:
      - kind: unit
        ref: "tests/unit/asian-handicap.test.ts#buildAhView"
        status: pass
    human_judgment: false
  - id: D5
    description: "Exact score: 16 scores + OTHER sum to 1 within 1e-12 for lambda in [0.2, 4] (poisson and dixon-coles), OTHER >= 0, ZERO_PROBABILITY instead of Infinity"
    requirement: "MKT-02"
    verification:
      - kind: unit
        ref: "tests/unit/exact-score.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "ExtendedMarketsView: strict closed parser rejects extra keys, 20 lines, 16 cells, off-whitelist tokens, probabilities outside [0,1], bad sums; the real route response (PERSISTED, REDERIVED, UNAVAILABLE) passes the parser on real PostgreSQL"
    requirement: "MKT-01"
    verification:
      - kind: unit
        ref: "tests/unit/extended-view.test.ts"
        status: pass
      - kind: integration
        ref: "tests/integration/score-matrix-persistence.test.ts#2, #3, #6, #9, #10"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-25
status: complete
---

# Phase 14 Plan 02: Market registry, Asian handicap and exact score views Summary

**One registry of 25 market ids replaces the duplicated selection tables, complete Asian handicap (21 lines) and exact score (17 selections) books are accepted by odds validation, closing odds and no-vig CLV, and `GET .../extended-markets` now serves a strict `ExtendedMarketsView` with all 21 handicap lines, the main line and 16 exact scores plus OTHER, all computed in the domain.**

## Accomplishments

- `registry.ts`: `parseMarketId` (whitelist: three core ids, `EXACT_SCORE`, `ASIAN_HANDICAP:<token>` from the 21-token list; `+1.00`, `0.0`, `-0`, `1e0`, `-2.75`, lower case are rejected), `selectionsFor`, `isCoreMarket`, `marketFamilyOf`, `ALL_MARKET_IDS` (25). `CORE_MARKET_SELECTIONS` is the only definition of the frozen table, re-exported from `odds/contract.ts` as `MARKET_SELECTIONS` (same object; `model-card.ts` and its test unchanged; `JSON.stringify` pinned).
- `odds/contract.ts`, `draft.ts`, `normalize.ts`, `value/contract.ts`, `forecast/contract.ts`, `evaluation/closing-odds.ts`, `evaluation/no-vig-clv.ts` use the registry; error codes (`UNSUPPORTED_ODDS_MARKET`, `INCOMPLETE_ODDS_BOOK`, `DUPLICATE_ODDS_SELECTION`, `UNSUPPORTED_VALUE_MARKET`, `MARKET_SELECTION_MISMATCH`, `UNSUPPORTED_MARKET`, `INCOMPLETE_MARKET_SET`, `CANDIDATE_SET_INCOMPLETE`) and check order are unchanged. De-vig for AH is the same proportional `normalizeOddsBook` (documented approximation, used only for overround display and CLV).
- `asian-handicap.ts`: `buildAhView`, `mainAhLine`, `lineClassOf`, `splitLinesOf`; still a single settlement function (`settleAsianHandicap`), no second implementation of the rules anywhere in `packages/domain`.
- `exact-score.ts`: `EXACT_SCORE_BUCKETS_V1`, `parseExactScoreSelection`, `exactScoreView` (16 cells read from the grid in registry order, `OTHER = max(0, 1 - sum)`, fair odds `1/p` or `ZERO_PROBABILITY`).
- `extended-view.ts`: DTO, builders and the closed parser (`INVALID_EXTENDED_MARKETS_VIEW`).

## ExtendedMarketsView shape

```
AVAILABLE: { version: "extended-markets-view-v1", state: "AVAILABLE", source: "PERSISTED"|"REDERIVED",
  rules: { ahLines: "ah-lines-v1", ahSettlement: "ah-settlement-v1", exactScoreBuckets: "exact-score-buckets-v1", scoreMatrix: "score-matrix-v1" },
  calibration: "NONE", tail: { retainedMass, tailMass, warning },
  asianHandicap: { mainLine: <token>, lines: [21 x { homeLine, awayLine, lineClass: WHOLE|HALF|QUARTER,
      sides: { HOME|AWAY: { breakdown: {WIN,HALF_WIN,PUSH,HALF_LOSS,LOSS}, effectiveWinProbability,
               fairOdds: {status:"AVAILABLE",odds}|{status:"UNAVAILABLE",reason:"NO_WIN_PROBABILITY"}, splitLines: [tokens] } } }] },
  exactScore: { cells: [16 x { selection:"H-A", homeGoals, awayGoals, probability, fairOdds }],
                other: { selection:"OTHER", probability, fairOdds } } }
UNAVAILABLE: { version, state: "UNAVAILABLE", reason: "SCORE_MATRIX_UNAVAILABLE" }
```

Exact score fair odds: `{status:"AVAILABLE",odds}` or `{status:"UNAVAILABLE",reason:"ZERO_PROBABILITY"}`. `tail` comes from the stored forecast DTO. The tracer shape of 14-01 (`lines[].line/home/away`) is replaced; `ahLineView` stays exported for 14-01 tests.

## Main line tie-break (decision beyond D-08)

Main line = home-side line minimising `|(WIN + HALF_WIN/2) - (LOSS + HALF_LOSS/2)|` (exact comparison). On equal gaps the smaller `|line|` wins; if `-L` and `+L` tie, the smaller (more negative) home line wins.

## apps/web files touched (types only)

`OddsMarket`/`OddsSelection` renamed to `ForecastMarket`/`ForecastSelection` (no behaviour or text change): `apps/web/components/enum-labels.ts`, `apps/web/app/fixtures/[fixtureId]/calibration-panel.tsx`, `forecast-comparison-panel.tsx`, `forecast-workbench.tsx`, `workbench-format.ts`, `apps/web/app/scorecards/scorecard-dashboard.tsx`. No Next.js API used or changed, so the framework docs were not needed.

## Task Commits

1. `cc5e73b` feat(14-02): add market registry and accept extended markets in odds books
2. `2760495` feat(14-02): route value, closing and no-vig modules through the market registry
3. `c705d8a` feat(14-02): derive full Asian handicap and exact score views

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Registry import chain installed a global Decimal precision on the odds modules**
- **Found during:** Task 1 (`tests/unit/odds-draft.test.ts` overround pins turned red)
- **Issue:** `registry.ts` importing `asian-handicap.ts` loaded `forecast/config.ts`, whose top level calls `Decimal.set({precision: 40})`; isolated odds normalisation then produced 40-digit overrounds instead of the pinned 20-digit values.
- **Fix:** new dependency-free `markets/ah-lines.ts` (token list, whitelist parse, quarter map); `asian-handicap.ts` re-exports it, so every 14-01 import path is unchanged. `exact-score.ts` uses its own Decimal clone (precision 40), pinned to `FORECAST_CONFIG.decimalPrecision` by a test.
- **Files modified:** packages/domain/src/markets/ah-lines.ts (new), asian-handicap.ts, exact-score.ts, registry.ts
- **Commit:** cc5e73b

**2. [Rule 3 - Blocking] Type-only fix in `value/decision.ts`**
- `decideValue` indexed `forecast.markets[odds.market]` with the widened market id; added an `isCoreMarket` guard (a non-core market yields the existing `MARKET_SELECTION_MISMATCH` quality reason; core behaviour unchanged). File not in the plan's list. Commit 2760495.

**3. [Rule 2 - Test coverage] `forecast-api` integration test extended**
- Added two assertions (extra `EXACT_SCORE` key and a missing core market both give `INVALID_FORECAST_PROBABILITY`) to cover plan Test 4 of Task 2. Commit 2760495.

### Process note

For Task 2 the implementation edits were made before the new tests were written (the tests were then added and pass); the red-first order was followed in Task 1 and the Task 3 tests were written before the Task 3 implementation (suite run green after implementation, the first run).

**Total:** 3 auto-fixed, none changing plan contracts.

## Verification

- Unit project: 84 files passed, 1 skipped, 1355 tests passed, 2 skipped (full run).
- `pnpm --filter @bet-stats/web test`: 209 passed. `pnpm typecheck`: 7/7 tasks successful (the corrupted `.next` problem recorded in 14-01 does not occur in the fresh worktree). `pnpm lint`: 0 errors.
- Integration on a disposable PostgreSQL 18 container: `score-matrix-persistence` 10/10, `forecast-api` 8/8; no leftover containers; dev database untouched.

## Deferred / Out-of-scope Issues

None new. `scripts/closing-odds.mjs` still knows only three markets (plan 14-07). `value.service` rejects non-core markets until 14-07.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register (T-14-05 whitelist parse, T-14-06 closed view parser, T-14-07 single registry with the frozen table pinned by a JSON literal; no new dependencies).

## Self-Check: PASSED

- Created files exist: registry.ts, exact-score.ts, ah-lines.ts, extended-view.ts, markets-registry/exact-score/extended-view tests.
- Commits `cc5e73b`, `2760495`, `c705d8a` are ancestors of HEAD; `git rev-list --count` from the ledger base is 3.
