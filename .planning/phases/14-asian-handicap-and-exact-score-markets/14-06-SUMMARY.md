---
phase: 14-asian-handicap-and-exact-score-markets
plan: 06
subsystem: web-ui
tags: [asian-handicap, exact-score, odds-form, push-aware-ev, scorecard, russian-labels, fail-closed]

requires:
  - phase: 14-asian-handicap-and-exact-score-markets
    provides: "14-03 settlement policies, decideExtendedValue receipt block and PolicyPageTotals; 14-04 enum-labels, extended-markets model and slot normalisation"
provides:
  - "odds entry form for five markets: explicit AH line select (21 lines, no default), 17 labelled exact score fields, per-line drafts, focus on the first invalid field"
  - "comparison of exact snapshots for AH and exact score built from the stored extended view, with a neutral notice and disabled button when the view is not AVAILABLE"
  - "push-aware value outcome: five-outcome breakdown read only from the recorded receipt, always visible push sentence, closed fallback notice"
  - "scorecard candidate registry with market column, policy id under the outcome and totals per settlement policy"
affects: [14-07, 14-08]

plan_head_before: d174878b395b1e9f537a0b1bd897e2d9bec45fd1
plan_head_after: d8a549d3196d81aed35d9ffc1abc1b802afbf786

actuals:
  tokens: 36000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "pure helpers in workbench-format.ts and extended-comparison-model.ts; the eager workbench stays the only stateful module and is never imported by them (T-10-06)"
    - "closed receipt reader (readAhBreakdownReceipt): any deviation returns null, nothing is back-filled or recomputed"
    - "static-markup tests with an explicit initialState seam instead of a DOM library (no new dependencies)"

key-files:
  created:
    - apps/web/app/fixtures/[fixtureId]/extended-comparison-model.ts
    - apps/web/app/fixtures/[fixtureId]/extended-comparison-model.test.ts
    - apps/web/app/fixtures/[fixtureId]/workbench-format.test.ts
    - tests/unit/extended-value-ui.test.tsx
  modified:
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - apps/web/app/fixtures/[fixtureId]/workbench-format.ts
    - apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx
    - apps/web/app/scorecards/scorecard-dashboard.tsx
    - apps/web/app/scorecards/page.tsx
    - apps/web/app/globals.css
    - tests/unit/odds-draft-ui.test.tsx
    - tests/unit/scorecard-ui.test.tsx

key-decisions:
  - "Canonical market id lives in the form as (family, ahLine): ASIAN_HANDICAP without a line has no id, hence no draft, no fields, no snapshots; the id is the single value used for the draft key, parse/serialize, submission body and book filter"
  - "unfilledCount counts selections that carry a field error (empty or invalid) so the exact score status line never reads 0 of 17 on a failed submit"
  - "page totals: no pageTotalsByPolicy or exactly one v1 entry keeps the legacy single line; any other shape prints one line per policy with its id, so a v2-only page is never shown as v1"
  - "value section adds a plain Рынок/выбор line for AH and exact score only, so core-market markup stays byte-identical"

requirements-completed: [MKT-03, MKT-04]

coverage:
  - id: D1
    description: "Five-market select order, AH line select without auto-selection, odds fields hidden until a line is chosen, quarter-line note, 17 labelled exact score fields, missing-line error wiring (alert, aria-describedby, aria-invalid), counter status line"
    requirement: "MKT-03"
    verification:
      - kind: unit
        ref: "tests/unit/odds-draft-ui.test.tsx"
      - kind: unit
        ref: "apps/web/app/fixtures/[fixtureId]/workbench-format.test.ts"
  - id: D2
    description: "Draft keyed by canonical id ASIAN_HANDICAP:<token>, submission body carries the canonical id, incomplete or id-less book rejected"
    requirement: "MKT-03"
    verification:
      - kind: unit
        ref: "tests/unit/odds-draft-ui.test.tsx"
  - id: D3
    description: "AH and exact score comparison rows come from the view without arithmetic; unavailable or unrecognised view gives a notice, no table, disabled button and the visible reason"
    requirement: "MKT-03"
    verification:
      - kind: unit
        ref: "apps/web/app/fixtures/[fixtureId]/extended-comparison-model.test.ts"
      - kind: unit
        ref: "tests/unit/extended-value-ui.test.tsx"
  - id: D4
    description: "Five-outcome breakdown from receipt.extended.evOutcomes in AH_RESULT_ORDER, total = result.expectedValue, signed formatting, push sentence outside details, policy row in the receipt, fallback notice for any malformed receipt"
    requirement: "MKT-03"
    verification:
      - kind: unit
        ref: "tests/unit/extended-value-ui.test.tsx"
      - kind: unit
        ref: "apps/web/app/fixtures/[fixtureId]/workbench-format.test.ts"
  - id: D5
    description: "Registry: market column first, market-aware selection, extended outcome with policy id, one totals line per policy, legacy response unchanged, unknown codes raw"
    requirement: "MKT-04"
    verification:
      - kind: unit
        ref: "tests/unit/scorecard-ui.test.tsx"
  - id: D6
    description: "Click, focus movement, localStorage draft swap and real-browser rendering"
    requirement: "MKT-03"
    verification:
      - kind: manual
        ref: "deferred to plan 14-08 (Playwright), as the plan states"

duration: ~70min
completed: 2026-11-25
status: complete
---

# Phase 14 Plan 06: Forms and results for the new markets Summary

The manual odds form now takes full Asian handicap and exact score books, the comparison and value outcome show push-aware results from the recorded receipt, and the scorecard registry separates settlement policies v1 and v2.

## Final form structure

`Рынок` select (1X2, Тотал 2.5, Обе забьют, Азиатский гандикап, Точный счёт). For the handicap a second field `Линия гандикапа (с позиции хозяев)` (`#ah-line`, placeholder `Выберите линию`, 21 options, main line of the selected forecast suffixed) follows directly; until a line is chosen the panel shows the note strip instead of odds fields. Then the draft-restored notice, the source label, and the fields: two for a handicap line (plus the quarter-line split note), or a `fieldset.market-score-fields-set` with 17 inputs in registry order for exact score (source stays above). A failed submit sets the status line (with `Не заполнено полей: n из 17` for exact score) and moves focus to the line select, the source field or the first invalid odds field.

`ForecastWorkbench` gained an optional `initialState` prop (family, line, fields, errors, message, snapshots, selected book, forecast id) used by static-markup tests; production callers do not pass it.

## Registry contract (consumed from plan 14-07)

`CandidateRow` gets optional `market` (canonical id string) and `policyVersion` (`flat-one-unit-v1` | `flat-one-unit-v2`); `CandidatePage` gets optional `pageTotalsByPolicy: readonly PolicyPageTotals[]` and `pageTotals` becomes optional (legacy, v1 rows only). `pageTotalsLines` is exported for tests. A response without these fields renders the previous layout with `—` in the market column.

## New tests

- `apps/web/app/fixtures/[fixtureId]/workbench-format.test.ts` (labels, line options, quarter note, form helpers, signed formatting, receipt reader)
- `apps/web/app/fixtures/[fixtureId]/extended-comparison-model.test.ts` (comparison rows, copy, no-arithmetic source guard)
- `tests/unit/extended-value-ui.test.tsx` (comparison states, five-outcome table, fallback, exact score layout, raw-code and wording scan)
- additions to `tests/unit/odds-draft-ui.test.tsx` (form) and `tests/unit/scorecard-ui.test.tsx` (registry)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `.market-score-fields-set` had no CSS rule**
- **Found during:** Task 1
- **Issue:** the UI-SPEC class on the fieldset was not defined, so the browser default border and padding would frame the grid.
- **Fix:** one rule on existing tokens-free properties (`border: 0; margin: 0; padding: 0; min-width: 0`) after `.market-score-fields` in `apps/web/app/globals.css`.
- **Commit:** a7dc829

**2. [Rule 3 - Blocking] React Compiler lint error on a type guard inside `useMemo`**
- **Found during:** Task 1 lint run
- **Fix:** the `isCoreMarket(marketId)` narrowing is computed once outside the memo (`coreMarket`).
- **Commit:** a7dc829

### Interpretation notes

- `unfilledCount(selections, errors)` and `firstInvalidField(selections, errors)` take the validation errors (not a validator callback); the plan left the signature open.
- The plan's `ahComparisonRows(view, lineToken, oddsSnapshot)` and `exactScoreComparisonRows` take structural parameters, so tests need no workbench import.
- The status line for a missing handicap line is a separate constant (`AH_LINE_REQUIRED_STATUS`), so `incompleteBookMessage` only adds the counter for exact score.
- The refund column in the AH comparison shows the plain percent from the view (also `0.0%` on lines where a refund cannot occur); the structural-dash rule stays in the 14-04 table.
- Interaction (clicks, focus move, draft swap in localStorage) is not exercised by static markup and is deferred to Playwright in plan 14-08.

## Known Stubs

None. Every rendered value comes from the view, the odds snapshot or the recorded receipt.

## Threat Flags

None beyond the plan's threat model. No new endpoint or storage key shape other than the existing draft key carrying the canonical market id.

## Verification run

- `pnpm --filter @bet-stats/web test`: 14 files, 270 tests passed
- `pnpm exec vitest run --project unit` (whole unit project): 89 files passed, 1 skipped; 1525 tests passed, 2 skipped
- `pnpm typecheck`: 7 of 7 tasks successful
- `pnpm --filter @bet-stats/web lint`: 0 errors (9 pre-existing warnings; the one new error found on the way was fixed)

## Self-Check: PASSED

- Created files exist: extended-comparison-model.ts, extended-comparison-model.test.ts, workbench-format.test.ts, extended-value-ui.test.tsx
- Commits a7dc829, 6267e6e, d8a549d are ancestors of HEAD (3 commits since d174878)
