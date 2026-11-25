---
phase: 14-asian-handicap-and-exact-score-markets
plan: 05
subsystem: database
tags: [postgres, migration, asian-handicap, exact-score, settlement, flat-one-unit-v2, parity]
requires:
  - phase: 14-asian-handicap-and-exact-score-markets
    provides: "settleExtendedMarket, settleFlatOneUnitV2, decideExtendedValue, score matrix persistence (plans 14-01, 14-03)"
provides:
  - "migration 20261126_phase14_extended_markets: widened guard_value_pair, guard_value_settlement, result CHECK, persist_value_settlement_v2"
  - "settlement pipeline branching the value loop by market family (exhaustive switch)"
  - "tests/helpers/extended-markets-seed.ts shared by plans 14-05 and 14-07"
affects: [14-07 api, 14-06 web]
tech-stack:
  added: []
  patterns:
    - "TS produces the extended result, SQL independently verifies it; exhaustive parity test between the two"
    - "CREATE OR REPLACE of guard functions only; append-only triggers are never recreated"
key-files:
  created:
    - packages/database/prisma/migrations/20261126_phase14_extended_markets/migration.sql
    - tests/helpers/extended-markets-seed.ts
    - tests/integration/extended-markets-guards.test.ts
    - tests/integration/extended-markets-parity.test.ts
    - tests/integration/extended-settlement-pipeline.test.ts
  modified:
    - packages/database/src/evaluation/settlement-pipeline.ts
    - tests/integration/migration-empty.test.ts
key-decisions:
  - "Open Question 3: the full independent SQL verifier was kept (result and return arithmetic), protected by an exhaustive parity test"
  - "v2 money arithmetic uses multiplication only (odds * 0.5 + 0.5); numeric division would round the 21st fractional digit"
  - "A half-win return that would exceed VARCHAR(128) is refused at value-receipt time instead of aborting a later settlement"
  - "Any market that is not EXACT_SCORE or ASIAN_HANDICAP:* falls into the unchanged core branch (needs a ForecastMarket row), so legacy test markets such as MATCH_RESULT stay valid"
requirements-completed: [MKT-03, MKT-04]
status: complete
actuals:
  tokens: 30000
  tasks: 3
  commits: 4
plan_head_before: d174878b395b1e9f537a0b1bd897e2d9bec45fd1
plan_head_after: 770bf71de4cc1ae63b496e141f4a3cd399952e46
duration: n/a
completed: 2026-11-25
---

# Phase 14 Plan 05: SQL guards and settlement pipeline for the extended markets Summary

**One forward migration widens the value-pair guard, the settlement guard and the result CHECK together and adds `persist_value_settlement_v2`; the pipeline settles handicap and exact-score value receipts through `flat-one-unit-v2` in the same pass as the three core markets.**

## Accomplishments

- **Migration `20261126_phase14_extended_markets`** (the only new directory under `prisma/migrations`; `git diff` of all earlier migrations is empty). Only `CREATE OR REPLACE` of functions plus one CHECK swap; `ValueSettlement_guarded_append_only` and `ValueReceipt_validate_pair` are not recreated. New functions: `phase14_numeric`, `phase14_market_line`, `phase14_ah_result`, `phase14_exact_score_result`, `phase14_ah_breakdown`, `phase14_exact_score_probability`, `persist_value_settlement_v2`.
- **`guard_value_pair`**: identity part unchanged; core branch is a logical copy of the guard-path definition; the extended branch recomputes EV, fair odds, edge and probability from the immutable odds snapshot and, for a forecast with a persisted matrix, from the stored cells (handicap breakdown and exact-score cell/OTHER). Legacy forecasts (REDERIVED) are accepted on self-consistency only (range, sum within 1e-9, exact arithmetic). The market id is checked against a whitelist regex before any cast, so `ASIAN_HANDICAP:abc` and `ASIAN_HANDICAP:+1.00` fail with "not a supported extended market".
- **`guard_value_settlement`**: branches on `policyVersion`. v1 keeps the previous logic and only accepts the three core markets; v2 only accepts extended markets, recomputes the result from `ResultVersion` and the return (WIN o, HALF_WIN o*0.5+0.5, PUSH 1, HALF_LOSS 0.5, LOSS 0). The correction-chain check additionally requires the predecessor to be of the same policy.
- **Pipeline** (`settlement-pipeline.ts`): `isScoreMarket` and the ForecastScore loop are untouched. The value loop calls `parseMarketId` (null -> `UNSETTLEABLE_VALUE_MARKET`) and an exhaustive `switch` with a `never` check: core markets take the unchanged v1 path and ids, handicap and exact score call `settleExtendedMarket` and `persist_value_settlement_v2`, ids include `flat-one-unit-v2`, the predecessor lookup filters on the policy.

## Definitions used as the base

Current definitions were read with `pg_get_functiondef` on a database migrated by `prisma migrate deploy` (34 prior migrations): `guard_value_pair` equals `20260908_phase03_value_receipt_guard_path`, `guard_value_settlement` and `persist_value_settlement` equal `20260908_phase04_value_settlements`; no later migration redefines them (grep confirmed).

## Parity result

- Handicap: `phase14_ah_result` versus `settleAsianHandicap` over 21 lines x 2 sides x 0..10 x 0..10 = 5082 combinations in one query: 0 mismatches, all five results occur.
- `phase14_market_line` accepts exactly the 21 tokens; `+1.00`, `0.0`, `-0`, `1e0`, `abc`, empty tail and others return NULL, like the TS whitelist.
- Exact score: 17 selections x 0..8 x 0..8 = 1377 combinations: 0 mismatches.
- Arithmetic: `persist_value_settlement_v2` versus `settleFlatOneUnitV2` for every result (WIN, HALF_WIN, PUSH, HALF_LOSS, LOSS) at ordinary odds, odds with 20 fractional digits and odds with 107 integer digits: stored strings are identical.

## Verification (disposable postgres:18-alpine containers only)

- `extended-markets-guards` 16 passed, `extended-markets-parity` 8 passed, `extended-settlement-pipeline` 5 passed, `migration-empty` (all 35 migrations on an empty database) green.
- Regression: `settlement-pipeline`, `settlement-chain-upgrade`, `settlement-multi-forecast` (28 tests with the new test), `value-receipt`, `value-settlement`, and `closing-odds-repository`, `clv-ranking-invariance`, `no-vig-clv-reader`, `mutation-rejection`, `phase-03/04-security`, `value-api`, `evaluation-api`, `forecast-calibration-api` (75 tests): all green. Tests that need `DATABASE_URL` ran against a disposable container.
- `pnpm typecheck`: 7 of 7 successful.
- No command touched the development container.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] Overlong half-win return.** `odds * 0.5 + 0.5` of the largest canonical odds (107 integer + 20 fractional digits) is 129 characters and does not fit `VARCHAR(128)`; the failure would have rolled back the whole Serializable settlement of a fixture, the exact failure mode of Pitfall 1. The extended branch of `guard_value_pair` now refuses such a receipt up front ("decimal odds are too precise for flat-one-unit-v2 settlement"), covered by a test. Commit 9fa90b1. The plan's "pathological" arithmetic cases are therefore tested as two separate odds (20 fractional digits; 107 integer digits).

**2. [Interpretation] Unsupported-market message.** The plan says any market outside both branches raises "unsupported market". Existing tests (`value-receipt.test.ts`) use the market `MATCH_RESULT` on the unchanged core branch, so only ids starting with `ASIAN_HANDICAP:` that fail the whitelist, and nothing else, raise the new message; every other non-extended market keeps the previous core-branch behaviour (requires a ForecastMarket row).

**3. [Interpretation] Test 5 of task 3.** A value receipt on a market without a settlement rule cannot be stored with the guards active (and a ForecastMarket row of such a market would stop at `INVALID_SCORE_MARKET` first), so the test disables `ValueReceipt_validate_pair` on the disposable database for one insert and re-enables it.

**4. Tolerance.** EV and fair odds of the extended branch use `1e-12 * max(1, |expected|)` instead of an absolute 1e-12, because fair odds of tiny exact-score probabilities and EV of very large odds exceed the absolute bound through rounding of the 40-digit TS value alone. The probability, edge and breakdown checks stay absolute.

## Notes for the operator and the next plans

- **Operator action at rollout:** run `prisma migrate deploy` against the development database. This agent did not apply it anywhere except disposable containers.
- The views `current_value_settlements` and `current_value_settlement_aggregate` still sum across policies (noted in the migration header; the application does not read them, aggregation by policy is plan 14-07).
- `tests/helpers/extended-markets-seed.ts` exports `seedExtendedMarketsFixture` (option `settlementReceipt: false` leaves the settlement to the pipeline), `seedOddsBook`, `buildExtendedValueReceipt`, `buildCoreValueReceipt`, `insertValueReceipt`, `exactScoreSelections` for plan 14-07.
- Observation A7 from 14-03 still holds: the value policy requires `forecast-config-v1`; for forecasts of other config versions a receipt is `INSUFFICIENT_EVIDENCE`. The guard does not check the outcome field.

## Known Stubs

None.

## Threat Flags

None. New surface is limited to the mitigated T-14-13..T-14-16: whitelist before cast, independent recomputation in the guards, parity test, triggers untouched.

## Self-Check: PASSED

- migration.sql, extended-markets-seed.ts, the three new test files: FOUND
- commits 04b3073, 9fa90b1, 3df3017, 770bf71: FOUND
