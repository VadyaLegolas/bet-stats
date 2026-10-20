---
phase: 03-forecast-and-manual-value-workbench
plan: 02
subsystem: domain
tags: [typescript, decimal.js, poisson, odds-normalization, value-gates]
requires:
  - phase: 03-forecast-and-manual-value-workbench
    provides: deterministic forecast, odds, and value tracer contracts
provides:
  - Receipt-visible raw marginals, retained/tail mass, normalization policy, and bounded adjustment transforms
  - Versioned confidence weights and minimum-evidence gates
  - Complete-book normalization truth tables, ordered value gates, and non-analyzable local odds drafts
affects: [03-03, 03-04, forecast-persistence, manual-odds-api, workbench-ui]
actuals:
  tokens: 9191
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [receipt-visible transforms, ordered all-of decision gates, strict local draft codec]
key-files:
  created: [packages/domain/src/odds/draft.ts, tests/unit/forecast.test.ts, tests/unit/value.test.ts, tests/unit/odds-draft.test.ts]
  modified: [packages/domain/src/forecast/config.ts, packages/domain/src/forecast/model.ts, packages/domain/src/forecast/confidence.ts, packages/domain/src/odds/normalize.ts, packages/domain/src/value/decision.ts]
key-decisions:
  - "Use forecast-config-v1 minimum samples of goal rates 5, Elo 1, form 3, venue 3, rest 1, and optional H2H 3 as transparent starting policy."
  - "Order value gates as policy, canonical identity, cutoff, data quality, confidence, edge, then expected value."
patterns-established:
  - "Forecast receipts expose raw retained-mass marginals and each bounded weighted adjustment alongside normalized probabilities."
  - "Browser drafts carry only entered strings and an analyzable:false discriminator; only successful immutable submission clears storage."
requirements-completed: [PRED-01, PRED-02, PRED-03, PRED-05, ODDS-01, ODDS-03, VALUE-01, VALUE-02, VALUE-03]
coverage:
  - id: D1
    description: "All supported markets are coherent marginalizations of one retained score matrix with tail and normalization disclosure."
    requirement: PRED-02
    verification:
      - kind: unit
        ref: "tests/unit/forecast.test.ts#forecast mathematical and evidence invariants"
        status: pass
    human_judgment: false
  - id: D2
    description: "Evidence and confidence limits are versioned, receipt-visible, deterministic, and separate from event probability."
    requirement: PRED-05
    verification:
      - kind: unit
        ref: "tests/unit/forecast.test.ts#keeps confidence as a versioned sibling that cannot alter event probability"
        status: pass
    human_judgment: false
  - id: D3
    description: "Complete books normalize exactly while malformed books and partial local drafts cannot produce value output."
    requirement: ODDS-03
    verification:
      - kind: unit
        ref: "tests/unit/odds-draft.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Value decisions use full-precision threshold boundaries and ordered all-of policy and quality gates."
    requirement: VALUE-03
    verification:
      - kind: unit
        ref: "tests/unit/value.test.ts#value decision truth table"
        status: pass
    human_judgment: false
duration: 17min active
completed: 2026-09-06
status: complete
---

# Phase 3 Plan 2: Forecast, Odds, and Value Invariants Summary

**One score matrix now yields receipt-visible raw and normalized markets, while exact decimal books flow through versioned, ordered all-of value gates and safe local drafts.**

## Performance

- **Duration:** 17 min active across a usage-window pause
- **Started:** 2026-09-05T19:07:41Z
- **Completed:** 2026-09-06T01:52:53Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Exposed retained mass, tail mass, raw marginals, normalization policy, adjustment signals/weights/bounds, and exact source fingerprints in deterministic forecast output.
- Added explicit minimum-evidence policy and verified every confidence component remains independent from event probability.
- Covered all three complete odds markets, strict malformed-input rejection, exact decimal threshold boundaries, gate precedence, and non-analyzable browser draft lifecycle.

## Task Commits

Each task followed RED/GREEN TDD commits:

1. **Task 1 RED: Forecast invariant suite** - `114ca6d` (test)
2. **Task 1 GREEN: Forecast and confidence hardening** - `e3b066b` (feat)
3. **Task 2 RED: Odds/value truth tables** - `59e8e94` (test)
4. **Task 2 GREEN: Odds drafts and ordered gates** - `8d7e183` (feat)

## Files Created/Modified

- `packages/domain/src/forecast/config.ts` - Versioned evidence sample defaults.
- `packages/domain/src/forecast/model.ts` - Raw marginals, normalization metadata, adjustment receipts, and evidence limitations.
- `packages/domain/src/forecast/confidence.ts` - Exported immutable confidence policy.
- `packages/domain/src/odds/normalize.ts` - Explicit multiplicative normalization version.
- `packages/domain/src/odds/draft.ts` - Strict local-only partial draft serialization and successful-submission cleanup.
- `packages/domain/src/value/decision.ts` - Versioned thresholds and ordered policy/canonical/cutoff/quality/confidence/value gates.
- `tests/unit/forecast.test.ts` - Property-style mathematical, source, evidence, and confidence invariants.
- `tests/unit/value.test.ts` - Exact boundary and gate-precedence truth tables.
- `tests/unit/odds-draft.test.ts` - All market books, malformed inputs, and draft lifecycle coverage.

## Decisions Made

- Used the research-recommended confidence weights and value thresholds unchanged, while making minimum evidence samples explicit and configurable under `forecast-config-v1`.
- Treated configuration, canonical identity, and cutoff failures as distinct gates ahead of generic data quality so receipts explain the earliest failed trust boundary.
- Kept partial drafts structurally incompatible with submitted odds books and excluded all analysis identifiers, normalized values, and results.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Vitest required permission to spawn its Vite build helper in the managed sandbox; approved execution produced the required RED and GREEN evidence.
- The runtime is Node 25.2.1 while the repository declares Node 24 LTS. This emitted an engine warning only; tests and typecheck passed.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/unit --project unit` — 12 files, 121 tests passed.
- `corepack pnpm --filter @bet-stats/domain typecheck` — passed.

## Next Phase Readiness

- Immutable persistence and API plans can store complete normalization, confidence, source, threshold, and ordered gate receipts without reconstructing calculation state.
- No blocking issues remain for dependent Phase 3 plans.

## Self-Check: PASSED

- All nine created or modified implementation/test files exist.
- Commits `114ca6d`, `e3b066b`, `59e8e94`, and `8d7e183` exist in repository history.

---
*Phase: 03-forecast-and-manual-value-workbench*
*Completed: 2026-09-06*
