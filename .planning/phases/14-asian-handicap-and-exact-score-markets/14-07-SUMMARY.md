---
phase: 14-asian-handicap-and-exact-score-markets
plan: 07
subsystem: api
tags: [asian-handicap, exact-score, value-receipt, push-aware-ev, settlement-policy, closing-odds, clv, fail-closed]
requires:
  - phase: 14-asian-handicap-and-exact-score-markets
    provides: "14-01 score matrix persistence and resolveScoreMatrix; 14-03 decideExtendedValue and pageTotalsByPolicy; 14-05 SQL guards, v2 settlement and the shared seed helper; 14-06 registry contract (market, policyVersion, pageTotalsByPolicy)"
provides:
  - "compareValue for ASIAN_HANDICAP:<line> and EXACT_SCORE: push-aware receipt from the verified score matrix, 409 SCORE_MATRIX_UNAVAILABLE with no row on failure"
  - "ValueRepository.findStoredForecast (ISSUED PRODUCTION only)"
  - "evaluation aggregates that never mix flat-one-unit-v1 and v2: cohort filter, market and policyVersion per candidate row, pageTotals (v1 only) and pageTotalsByPolicy"
  - "closing odds CLI, explanation texts and operator doc for five market families"
affects: [14-08 e2e and verification]
tech-stack:
  added: []
  patterns:
    - "fail-closed matrix read before any insert: the internal reason goes to the operator log, the client sees only SCORE_MATRIX_UNAVAILABLE"
    - "policy-labelled rows end to end: the row carries its policy, the legacy total counts one policy, the new total lists each policy separately"
key-files:
  created:
    - tests/integration/extended-markets-api.test.ts
  modified:
    - apps/api/src/modules/value/value.service.ts
    - apps/api/src/modules/evaluation/evaluation.service.ts
    - scripts/closing-odds.mjs
    - docs/closing-odds-operator.md
    - tests/integration/evaluation-api.test.ts
    - tests/integration/no-vig-clv-reader.test.ts
    - tests/integration/closing-odds-api.test.ts
    - tests/integration/model-comparison-api.test.ts
key-decisions:
  - "odds.service.ts needed no change: the domain parser already admits the new markets and the replacement check compares the full market id, so a book of another handicap line cannot replace a book of this line"
  - "cellsHash of a PERSISTED matrix is read with parseScoreMatrixV1 after resolveScoreMatrix has proven the block; a REDERIVED matrix carries cellsHash null"
  - "a repository without findStoredForecast fails closed with SCORE_MATRIX_UNAVAILABLE instead of falling back to a recomputation"
  - "the market filter of the scorecard cohort query (all, ONE_X_TWO, OVER_UNDER_2_5, BTTS) was left as is; extended-market candidates appear under market=all"
requirements-completed: [MKT-03, MKT-04]
status: complete
actuals:
  tokens: 30000
  tasks: 3
  commits: 3
plan_head_before: 4bbb4cab48528a3ea10cd57b4a5556a346818c12
plan_head_after: 9a7aad463129c03fd325e7b1d8a1e6acaab6d81e
duration: n/a
completed: 2026-11-25
---

# Phase 14 Plan 07: API layer for the new markets Summary

**The operator now has a working path book, value receipt, settlement and totals for Asian handicap and exact score: value comparison reads the verified score matrix and refuses with 409 when it cannot, aggregates keep the two money policies apart, and the closing-odds CLI and documentation cover five market families.**

## Accomplishments

- **Value comparison (task 1).** `compareValue` keeps the core path unchanged. For any other registry market it reads `findStoredForecast`, resolves the matrix through `resolveScoreMatrix` and prices the selection with `decideExtendedValue`. The receipt id formula is the old one (forecast, odds snapshot, market, selection), so a repeat returns the same receipt. `modelProbability` is the effective win probability for a handicap and the cell probability for exact score; the receipt carries the `extended` block (`push-aware-ev-v1`, `breakdown`, `evOutcomes`, matrix source and `cellsHash`). The database guard accepted every receipt the service produced.
- **Fail-closed matrix (T-14-20).** Any `UNAVAILABLE` result (tampered seal, legacy markets that do not reproduce, missing reader) throws a `ConflictException` with `SCORE_MATRIX_UNAVAILABLE` before `insertReceipt`; the internal reason (`INVALID_SCORE_MATRIX`, `MISMATCH`, ...) goes only to the operator log. Tests count `ValueReceipt` rows before and after.
- **Aggregation without mixing (task 2, T-14-21).** `loadCohort` filters `valueSettlement` by `policyVersion = flat-one-unit-v1`. Candidate rows carry `market` and `policyVersion` (a value outside the union throws `UNKNOWN_SETTLEMENT_POLICY`). `pageTotals` counts only v1 rows; `pageTotalsByPolicy` comes from the domain `pageTotalsByPolicy` and never sums policies.
- **Closing odds (task 3).** CLI help and the `UNSUPPORTED_MARKET` explanation list five families and the line range; the operator document gained the per-line handicap set and the 17-selection exact-score set with examples. Phase 13 rules (operator only, before kickoff, append-only, CLV evaluation-only) are unchanged and restated.

## Final shape of the registry response

`GET` candidates (`EvaluationService.valueCandidates`) returns `{ items, nextCursor, pageTotals, pageTotalsByPolicy, cohortIdentity }`:

- `items[]`: previous fields plus `market` (canonical id) and `policyVersion` (`flat-one-unit-v1` | `flat-one-unit-v2`); `outcome` passes the stored result through (`WIN`, `HALF_WIN`, `PUSH`, `HALF_LOSS`, `LOSS`); `stakeUnits` and `profitUnits` are the stored strings.
- `pageTotals`: `{ count, stakeUnits, profitUnits }` for the v1 rows of the page only (legacy, kept for existing consumers).
- `pageTotalsByPolicy`: `[{ policyVersion, count, stakeUnits, profitUnits }]`, v1 first, v2 second, one entry per policy present, empty for an empty page, never a combined entry. Verified: page with 2 v1 rows (stake 2, profit 0.4) and 3 v2 rows (stake 3, profit -0.4) gives `pageTotals {2, "2", "0.4"}` and two separate entries.

## Observation A7 (test result, needs a user decision, not changed here)

Pinned by `extended-markets-api.test.ts` test 5 on real PostgreSQL:

- a forecast of `poisson-ensemble-v1` (`forecast-config-v1`, confidence 0.65 or above) can reach `VALUE_CANDIDATE` on exact score (top cell priced 100, rest 30: reasons empty, EV above 0.05);
- a forecast of `dixon-coles-ensemble-v1` (`forecast-config-v2`) with the same book is `INSUFFICIENT_EVIDENCE` with reason `POLICY_CONFIG_MISMATCH`.

The extended markets inherit the `POLICY` gate of the value policy (requires `forecast-config-v1`), so default dixon-coles forecasts never produce a value candidate on any market, old or new. Changing the value policy is outside this phase and needs a separate decision.

## Updated pinned texts (Pitfall 13)

`scripts/closing-odds.mjs`:
- usage line `--market`: `ONE_X_TWO | OVER_UNDER_2_5 | BTTS | EXACT_SCORE | ASIAN_HANDICAP:<линия>`;
- a new block "Примеры для новых рынков" with `--market ASIAN_HANDICAP:-0.75 --odds HOME=1.90,AWAY=1.95`, `--market EXACT_SCORE --odds 0-0=9.5,0-1=12,...,3-3=80,OTHER=30` and the sentence that a handicap set is written separately per line;
- `CLOSING_ODDS_REJECTION_COPY.UNSUPPORTED_MARKET`: "рынок не поддерживается (допустимы ONE_X_TWO, OVER_UNDER_2_5, BTTS, EXACT_SCORE и ASIAN_HANDICAP:<линия> с линией от -2.5 до +2.5 шагом 0.25)".

No test previously pinned these strings verbatim; the new test `pins the help text and the UNSUPPORTED_MARKET explanation to the five market families` now does, and also pins two unchanged texts of other codes. All other texts are byte-identical.

## Deviations from Plan

**1. [Rule 3 - Blocking] Mock repositories of existing tests.** `ValueCandidateRow` and the repository return shape gained required fields, so the mocks in `evaluation-api.test.ts` and `model-comparison-api.test.ts` got `market`, `policyVersion` and `pageTotalsByPolicy: []`. Existing expectations are unchanged.

**2. [Interpretation] HTTP and repository levels.** Plan task 1 asks for HTTP and repository coverage. The value and odds modules are started with `NestFactory` on real PostgreSQL (real eligibility guard headers); the 409 and "no reader" cases patch the repository of the running `ValueService` or call `compareValue` directly, the same technique as `score-matrix-persistence.test.ts`.

**3. [Interpretation] Helper for the CLV tests.** For the handicap and exact-score CLV cases `seedExtendedMarketsFixture` plus `seedOddsBook` of plan 14-05 were used with `insertClosingBook`; no new helper was written. The new CLV describe starts its own disposable container.

Otherwise the plan was executed as written; `odds.service.ts`, `evaluation` market whitelist and web code needed no change.

## Verification

- `extended-markets-api` 6 tests, `evaluation-api` 10, `no-vig-clv-reader` 13, `closing-odds-api` plus `closing-odds-repository` 65, `clv-ranking-invariance`, `phase-04-security`, `model-comparison-api`, `value-api`, `manual-odds-api`, `score-matrix-persistence`, `forecast-api`: all green (116 tests in the final combined run of 8 files).
- `pnpm exec vitest run --project unit`: 89 files passed, 1 skipped; 1525 tests passed, 2 skipped (includes `clv-evaluation-only`).
- `pnpm typecheck`: 7 of 7 tasks successful. `pnpm lint`: 0 errors (9 pre-existing warnings in the web package).
- Only disposable `postgres:18-alpine` containers named per test and process were used; all were removed. The development containers were not touched; no migration was applied to the development database.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. Mitigations in place: T-14-20 (fail-closed 409 with no write, row-count tests), T-14-21 (policy filter, v1-only legacy total, per-policy list, tests on mixed data), T-14-22 (domain validation of closing sets, unchanged triggers, CLI/route tests with unknown line and incomplete set), T-14-23 (CLI parses syntax only), T-14-SC (no new dependencies).

## Self-Check: PASSED

- apps/api/src/modules/value/value.service.ts, apps/api/src/modules/evaluation/evaluation.service.ts, scripts/closing-odds.mjs, docs/closing-odds-operator.md, tests/integration/extended-markets-api.test.ts: FOUND
- commits 1bb32eb, 5694ceb, 9a7aad4: ancestors of HEAD (3 commits since 4bbb4ca)
