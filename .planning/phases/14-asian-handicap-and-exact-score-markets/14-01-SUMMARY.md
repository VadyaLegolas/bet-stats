---
phase: 14-asian-handicap-and-exact-score-markets
plan: 01
subsystem: forecast-markets
tags: [score-matrix, asian-handicap, prisma-json, nestjs, postgres, fail-closed]

requires:
  - phase: 11-dixon-coles-model-version
    provides: corrected score matrix, MODEL_VERSIONS, dixonColes provenance in receipt
  - phase: 12-calibration-layer-and-versioned-rollback
    provides: calibration scope limited to the three scored markets
provides:
  - buildScoreMatrix extracted from createForecast bit-identically
  - score-matrix-v1 sealed grid persisted in the receipt Json of every new ForecastSnapshot
  - splitStoredForecast as the single strip point on every receipt reader
  - resolveScoreMatrix with PERSISTED and fail-closed REDERIVED paths
  - Asian handicap core (ah-lines-v1, ah-settlement-v1, breakdown, push-aware fair odds)
  - GET fixtures/:fixtureId/forecasts/:forecastId/extended-markets (tracer: line 0)
affects: [14-02, 14-03, 14-04, 14-05, 14-06, 14-07, 14-08]

plan_head_before: c6a702c551b0f7c5a0e5f386874cf690c2b948b0
plan_head_after: 87c8932afa4fd8d31992f57b11ffdef2bf6e1abb

actuals:
  tokens: 19500
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "persisted derived data lives as a top-level sibling key of the stored DTO envelope and is stripped by one helper"
    - "fail-closed read path: present-but-invalid key never falls back to re-derivation"
    - "typed AVAILABLE/UNAVAILABLE response, internal reason code only in the operator log"

key-files:
  created:
    - packages/domain/src/markets/score-matrix.ts
    - packages/domain/src/markets/asian-handicap.ts
    - tests/unit/score-matrix.test.ts
    - tests/unit/asian-handicap.test.ts
    - tests/integration/score-matrix-persistence.test.ts
  modified:
    - packages/domain/src/forecast/model.ts
    - packages/domain/src/evaluation/forecast-orchestrator.ts
    - packages/domain/src/index.ts
    - packages/database/src/forecast-repository.ts
    - packages/database/src/index.ts
    - apps/api/src/modules/forecasts/forecasts.controller.ts
    - apps/api/src/modules/forecasts/forecasts.service.ts
    - apps/api/src/modules/forecasts/forecast-comparison.service.ts
    - apps/api/src/modules/value/value.service.ts
    - tests/unit/forecast-v1-regression.test.ts
    - tests/unit/evaluation.test.ts
    - tests/unit/forecast-model-version.test.ts

key-decisions:
  - "A5: scoreMatrix sits at the top level of the stored envelope (next to id, probabilities, receipt), not inside receipt.receipt, so the public ForecastReceiptDto is unchanged"
  - "resolveScoreMatrix input carries modelVersion and the DTO receipt block; the repository returns raw material (findStoredForecast) and the service resolves"
  - "retainedMass of a sealed matrix is validated in (0, 1]; with lambda in [0.2, 4] the margin to float error is about 1e-10, so the strict bound cannot reject a real forecast"

requirements-completed: [MKT-05, MKT-01]

coverage:
  - id: D1
    description: "createForecast output is bit-identical before and after extracting buildScoreMatrix (poisson, dixon-coles rho>0, rho<0, out-of-band-zero)"
    requirement: "MKT-05"
    verification:
      - kind: unit
        ref: "tests/unit/forecast-v1-regression.test.ts#createForecast whole-result golden hashes"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every new ForecastSnapshot stores a sealed 64-cell score-matrix-v1 in the receipt; the public DTO keeps its shape on every reader"
    requirement: "MKT-05"
    verification:
      - kind: integration
        ref: "tests/integration/score-matrix-persistence.test.ts#1, #3, #7"
        status: pass
    human_judgment: false
  - id: D3
    description: "Legacy snapshots are re-derived within 1e-9 or reported UNAVAILABLE; tampered keys never fall back; no write ever"
    requirement: "MKT-05"
    verification:
      - kind: unit
        ref: "tests/unit/score-matrix.test.ts#resolveScoreMatrix (legacy re-derivation, D-03)"
        status: pass
      - kind: integration
        ref: "tests/integration/score-matrix-persistence.test.ts#8, #9, #10"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tracer: Asian handicap line 0 (home) returned over HTTP from the stored matrix with five outcomes summing to 1 and fair odds"
    requirement: "MKT-01"
    verification:
      - kind: integration
        ref: "tests/integration/score-matrix-persistence.test.ts#2"
        status: pass
    human_judgment: false
  - id: D5
    description: "SCORE_FORMULA_HASH and forecastConfigHashFor of both models pinned as literals"
    requirement: "MKT-05"
    verification:
      - kind: unit
        ref: "tests/unit/evaluation.test.ts, tests/unit/forecast-model-version.test.ts#pins both config hashes"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-25
status: complete
---

# Phase 14 Plan 01: Score matrix persistence and extended-markets tracer Summary

**The 8x8 score grid is now sealed (`score-matrix-v1`, sha256 over exact doubles) into the receipt of every new forecast snapshot, read back through one strip helper on every reader, and served by `GET .../extended-markets`, which returns Asian handicap line 0 computed from the stored grid; legacy snapshots are re-derived fail-closed within 1e-9.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-11-25
- **Tasks:** 2 (tracer + auto)
- **Files modified:** 17 (5 created, 12 modified)
- **Commits:** 4 (measured from the plan ledger: `c6a702c..87c8932`)

## Accomplishments

- `buildScoreMatrix` extracted from `createForecast` with identical operation order; whole-result golden hashes were committed BEFORE the extraction and did not change.
- `ForecastOrchestrator.run` seals the matrix (`buildScoreMatrixV1`), proves with `===` that all seven core probabilities are reproducible from it (`assertCoreMarketsReproduced`), and hands it to `publish(draft, { origin, scoreMatrix })`. Both production and backtest origins carry it.
- The repository writes `receipt = { ...dto, scoreMatrix }`; collision and existing-snapshot branches return the stored row unchanged (no UPDATE, no key appended).
- `splitStoredForecast` is the only place the key is removed; `findStoredForecast(id)` is the new repository method behind the route.
- `resolveScoreMatrix`: PERSISTED path (closed parse, recomputed seal, three markets re-summed within 1e-12) and REDERIVED path (same pure builder over `expectedGoals` and the recorded rho, all seven probabilities within 1e-9). A present-but-invalid key returns UNAVAILABLE without trying re-derivation.
- `asian-handicap.ts`: `AH_LINES_V1` (21 canonical tokens), whitelist `parseAhLineToken`, `settleAsianHandicap` (`ah-settlement-v1`, throws `AH_WIN_LOSS_MIX`), `AH_RETURN_SHARES`, `ahBreakdown`, `ahFairOdds` (decimal.js, typed `NO_WIN_PROBABILITY` instead of Infinity/NaN), `ahLineView`.
- Route under `EligibilityGuard`, `Cache-Control: private, no-store, max-age=0`, 400 `INVALID_FORECAST_ID`, 404 `FORECAST_NOT_FOUND` for missing / not ISSUED / not PRODUCTION / foreign fixture.

## Golden hashes (captured on HEAD `c6a702c`, before touching model.ts; commit `526c1eb`)

`canonicalSha256(createForecast(...))` over the whole result (fixture and evidence of `forecast-v1-regression.test.ts`):

| Case | Hash |
|---|---|
| poisson-ensemble-v1 | `sha256:5af24e7de701457ccc21f3401a42a159d1d6cee8294bd89d459e6b2b01fba773` |
| dixon-coles rho = +0.05 | `sha256:044fee611ab24ff8aebbd104362e5c85533ac28a5cdfa7f26b08900400131c65` |
| dixon-coles rho = -0.08 | `sha256:c79ede4c81c35b7a5e9641b345fef98495b9a96f6f4e24ad6c381194c347751e` |
| dixon-coles fitted rho 0.99 (method `out-of-band-zero`) | `sha256:48f67d711c66843bbb0e967dda6b0658fee0b3294e4fbfd38952865980382803` |

Pinned in Task 2 (configs untouched, `git diff c6a702c -- config.ts scoring.ts` is empty):

- `SCORE_FORMULA_HASH = sha256:c55c278db1513776c2776a4e1a79ff9f1b2e0194a1d6c2d67d7abdf63457f4af`
- `forecastConfigHashFor("poisson-ensemble-v1") = sha256:a08ff17e4ec37822ccce0b68a7ed24ad33c21c5732e2ee812645cac4cc159581`
- `forecastConfigHashFor("dixon-coles-ensemble-v1") = sha256:ff891567ab4c5358db44e98175174b94190ad8ea321db88d6c83419ea0871a72`

No pre-existing "chain-hash" tests exist to cross-check the dixon-coles value against; the poisson literal matches the one already in `forecast-v1-regression.test.ts`.

## Places that unwrap `ForecastSnapshot.receipt` (searched `.receipt` in apps/api and packages/database)

| Place | Handling |
|---|---|
| `packages/database/src/forecast-repository.ts` `toDto` (findIssued, listIssued, publish collision/existing branches) | `splitStoredForecast(row.receipt).dto` |
| `packages/database/src/forecast-repository.ts` `findStoredForecast` (new) | split, DTO parsed, raw `scoreMatrix` returned separately |
| `apps/api/src/modules/value/value.service.ts` `findForecast` | `parseForecastResponse(splitStoredForecast(row.receipt).dto)` |
| `apps/api/src/modules/forecasts/forecast-comparison.service.ts` `findExact` | `splitStoredForecast(row.receipt).dto` plus `state` |
| `packages/database/src/dixon-coles-repository.ts` | reads only `receipt.receipt.expectedGoals`; extra top-level key is irrelevant, untouched |
| `fixtures.service.ts`, `replay.service.ts`, `calibration-fit-data.ts` (explicit select without `receipt`), `settlement-pipeline.ts`, `forecast-sweep.ts` | do not read the forecast receipt as a DTO; untouched |

## Tracer response shape

```json
{
  "state": "AVAILABLE",
  "source": "PERSISTED",
  "asianHandicap": { "lines": [ {
    "line": "0",
    "home": { "breakdown": { "WIN": 0, "HALF_WIN": 0, "PUSH": 0, "HALF_LOSS": 0, "LOSS": 0 },
              "effectiveWinProbability": 0, "fairOdds": { "status": "AVAILABLE", "odds": "..." } },
    "away": { "...": "same shape" }
  } ] }
}
```

(numbers illustrative; `source` is `REDERIVED` for legacy rows). Unavailable: `{ "state": "UNAVAILABLE", "reason": "SCORE_MATRIX_UNAVAILABLE" }` with HTTP 200.

## Internal UNAVAILABLE reason codes (operator log only; client sees only `SCORE_MATRIX_UNAVAILABLE`)

`INVALID_SCORE_MATRIX` (key present but fails the closed parse or seal), `UNKNOWN_MODEL`, `MISSING_INPUT` (no/invalid `expectedGoals`, dixon-coles without finite rho), `REDERIVE_FAILED` (builder rejected the recorded rho), `MARKETS_MISSING` (stored ForecastMarket rows incomplete), `MISMATCH` (derived vs stored beyond 1e-12 persisted / 1e-9 re-derived).

## Migrations

None. `git diff c6a702c..HEAD -- packages/database/prisma` is empty; `SCORE_CLASS_ORDER`, `FORECAST_CONFIGS`, `FORECAST_CONFIG`, `DIXON_COLES_CONFIG` and `MARKET_SELECTIONS` are unchanged.

## Task Commits

1. `526c1eb` test(14-01): pin createForecast output before score matrix extraction
2. `6184ab4` feat(14-01): extract buildScoreMatrix and persist score-matrix-v1 at issuance
3. `1f58259` feat(14-01): add extended-markets read route tracer
4. `87c8932` feat(14-01): re-derive legacy score matrices fail-closed and pin hashes

Tracer gate: the tracer's `<verify>` (unit set, real-PostgreSQL integration, typecheck) was re-run end-to-end after commit 3 and passed before Task 2 started.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reader fixes pulled forward into the first commit**
- **Found during:** Task 1
- **Issue:** Plan assigns `value.service.ts` and `forecast-comparison.service.ts` to Task 2, but from the moment `publish` writes the key, `parseForecastResponse` (value) and `compareForecastPair` (comparison) would throw `UNKNOWN_FORECAST_RESPONSE_KEY` on new rows, leaving commit 2 broken.
- **Fix:** both readers switched to `splitStoredForecast` in `6184ab4`; their regression coverage lives in integration test 7 (Task 2).
- **Files modified:** apps/api/src/modules/value/value.service.ts, apps/api/src/modules/forecasts/forecast-comparison.service.ts

**2. [Rule 1 - Bug in existing tests] WR-13 orchestrator tests expected the old publish context**
- **Found during:** Task 1 (full unit run)
- **Issue:** four tests in `forecast-model-version.test.ts` asserted `contexts` equal `[{ origin }]`; the context now also carries `scoreMatrix` by design.
- **Fix:** assertions now expect `scoreMatrix: expect.objectContaining({ version: "score-matrix-v1", gridMax: 7 })`.
- **Files modified:** tests/unit/forecast-model-version.test.ts (commit `6184ab4`)

**3. [Rule 3 - Blocking] Integration evidence fixture needed `sourceUpdatedAt: null`**
- The orchestrator's leakage check treats a missing `sourceUpdatedAt` as an unparsable time (`LEAKAGE_DETECTED`); the integration fixture now includes `sourceUpdatedAt: null`, as real sources do.

**Total:** 3 auto-fixed, none changing the plan's contracts.

## Deferred / Out-of-scope Issues

- `pnpm typecheck` fails in `@bet-stats/web` on the generated, corrupted `apps/web/.next/dev/types/routes.d.ts` (syntax errors; `apps/web/next-env.d.ts` was already modified before this plan). Domain, database, api, data-sync, config and football-data typecheck pass. Recorded in `deferred-items.md`.
- `tests/integration/forecast-snapshots.test.ts` requires `DATABASE_URL` (the dev database) and was deliberately not run; it does not touch the new code path.
- `.planning/config.json` shows `use_worktrees: true` modified in the working tree; not part of this plan and left unstaged.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: the single new network surface (the extended-markets route) is covered by T-14-04; T-14-01..T-14-03 mitigations are implemented and tested (tampered seal, 1e-9 re-derivation, DTO shape on all readers).

## Self-Check: PASSED

- Created files exist: score-matrix.ts, asian-handicap.ts, score-matrix.test.ts, asian-handicap.test.ts, score-matrix-persistence.test.ts.
- Commits `526c1eb`, `6184ab4`, `1f58259`, `87c8932` are ancestors of HEAD.
- Verification run: unit project 82 files / 1277 tests pass; integration `score-matrix-persistence` (10), `forecast-api`, `forecast-comparison-api`, `value-api`, `forecast-origin` pass (37 tests); eslint clean for domain, database, api; no leftover Docker containers.
