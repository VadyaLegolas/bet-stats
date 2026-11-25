---
phase: 15-7-day-value-scanner
plan: 04
subsystem: value-scanner-wiring-and-guards
tags: [scanner, navigation, css, responsible-gambling, static-guards]
requires:
  - phase: 15-7-day-value-scanner
    provides: "scanner page, scanner-labels.ts constants (plan 15-03)"
provides:
  - "Navigation entry «Сканер value» (/scanner) between «Анализ» and «Результаты»"
  - "Home card from SCANNER_HOME_CONTENT (six cards) and methodology limitation sentence"
  - ".scanner-* token-only CSS block at the end of globals.css plus a forced-colors rule"
  - "PROHIBITED_RU / scanRu Russian vocabulary suite on the scanner surface"
  - "tests/unit/scanner-guards.test.ts: ten static guard groups"
affects: [15-05, phase-16]
tech-stack:
  added: []
  patterns:
    - "CSS block contract tests slice the stylesheet from the first block selector to the end of the file"
    - "Static guards strip comments with a boundary-aware line-comment rule so URLs survive"
key-files:
  created:
    - tests/unit/scanner-guards.test.ts
  modified:
    - apps/web/components/release-navigation.tsx
    - apps/web/app/page.tsx
    - apps/web/app/methodology/page.tsx
    - apps/web/app/globals.css
    - apps/web/components/design-tokens.test.ts
    - tests/unit/home-page-ui.test.tsx
    - tests/unit/responsible-copy.test.ts
    - tests/e2e/release-accessibility.spec.ts
key-decisions:
  - "Guard 5 allows exactly one argument-free sort, inside outcomeTileOrder, because the existing scanner-ui test pins alphabetical order of unknown outcome codes; every other scanner web file and the rest of scanner-labels.ts stay sort-free."
  - "The e2e navigation step opens the menu unconditionally after setViewportSize(390), because the menu is collapsed at that width in every project."
patterns-established:
  - "scanner-guards ORDER BY check walks to the closing parenthesis at depth zero, so window functions are inspected whole."
requirements-completed: [SCAN-01, SCAN-03]
status: complete
duration: ~40 min
completed: 2026-11-26
commits: 3
plan_head_before: fae89d028486b3b48e27c05e96837ee0a742c027
plan_head_after: 3074ba0f1f34f15685cfd9d1bf344da01774a54d
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
---

# Phase 15 Plan 04: Scanner wiring, CSS and guards Summary

**The scanner is reachable from navigation, home and methodology, styled by a token-only `.scanner-*` block, and protected by a Russian prohibited-vocabulary suite and ten static guards against client JS, reformatting, sorting and N+1.**

## What was built

- **Wiring (Task 1):** one DESTINATIONS entry (`/scanner`, current on `startsWith("/scanner")`, no scanner import in the client file); `SCANNER_HOME_CONTENT` in CONTENTS after «Анализ» (six home cards); `SCANNER_METHODOLOGY_LIMITATION` as a paragraph in `#limitations` after the first paragraph. Home test asserts link, label, detail sentence, order and six cards. The release e2e list gains «Сканер value» and a step that opens `/scanner` and checks `aria-current="page"`.
- **CSS (Task 2):** block starts at `.scanner-groups`, written as plain selectors on existing tokens: no hex, no custom property, no transition or animation, font sizes only 14/16/20 px. dt `overflow-wrap: normal`, dd `anywhere`, links and stale summary 44 px, 768 px grid `minmax(11rem, 14rem) minmax(0, 1fr)` with note, detail and links spanning both columns, forced-colors CanvasText borders. A new `design tokens: scanner block` describe (8 tests) pins this; the Phase 14 market block tests stay green.
- **Vocabulary and guards (Task 3):** `PROHIBITED_RU` (ranking, certainty, urgency, advice, profit) with `(?<![\p{L}])` and flags `iu`; six negative fixtures flagged under the right category, six positive fixtures clean (including «улучшение»), both approved sentences allowed, and a scan of `apps/web/app/scanner` plus `release-navigation.tsx` finds nothing. `scanner-guards.test.ts` holds guard groups 1 to 10 plus a coverage check; messages name file and rule.

## Task commits

1. Task 1: `2e4b614` feat(15-04): scanner navigation entry, home card and methodology sentence
2. Task 2: `f02626a` feat(15-04): token-only scanner CSS block with design-token contract tests
3. Task 3: `3074ba0` test(15-04): Russian prohibited-vocabulary suite and static scanner guards

## Verification

Ran and passed:

- `pnpm exec vitest run --project unit tests/unit/home-page-ui.test.tsx tests/unit/inner-pages-design-ui.test.tsx tests/unit/responsible-copy.test.ts tests/unit/scanner-guards.test.ts tests/unit/clv-evaluation-only.test.ts tests/unit/scanner-ui.test.tsx` (133 passed)
- `pnpm --filter @bet-stats/web exec vitest run -c vitest.config.ts components/design-tokens.test.ts` (105 passed)
- `pnpm exec vitest run --project unit` full unit project (1649 passed, 2 skipped, 1 file skipped as before)
- `pnpm --filter @bet-stats/web lint` exit 0 (9 pre-existing warnings, none in changed files); `tsc --noEmit` in `apps/web` clean

Not run:

- `tests/e2e/release-accessibility.spec.ts` (Playwright, release gate; owned by plan 15-05) and the 768 to 1023 px navigation fit check (U-09 fallback: shorten the nav label to «Сканер» and update the e2e list only if that check fails).
- `next build`, live browser rendering of the new CSS, visual and axe matrix (plan 15-05).
- Integration tests (no Docker or database used).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan guard] Guard 5 would have failed on an existing, tested sort**
- **Found during:** Task 3
- **Issue:** `scanner-labels.ts` `outcomeTileOrder` sorts unknown outcome codes alphabetically for the EMPTY count tiles, and `scanner-ui.test.tsx` pins that order. The plan's blanket `.sort` ban over scanner web files failed on it. Removing the sort broke the 15-03 test.
- **Fix:** kept the 15-03 behaviour. Guard 5 now allows exactly one argument-free `.sort()` and only inside `outcomeTileOrder` (it asserts that count); the function body is removed from the text before the ban, so any other sort in scanner-labels.ts or any other scanner file still fails. The sorted values are short outcome codes, never rows, edge, EV or probability.
- **Files modified:** `tests/unit/scanner-guards.test.ts`
- **Commit:** `3074ba0`

**2. [Plan ledger] `gsd-plan-head-before` file not created**
- The base is the known fast-forward target `fae89d0`; `commits: 3` was measured with `git rev-list --count fae89d0..HEAD`.

### Notes

- The home test checks the six-card count inside the contents section only (the principles section also uses `home-card`).
- `pnpm install --frozen-lockfile` was run in the worktree (no lockfile change).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-15-17 (Russian vocabulary suite plus kept English scan), T-15-18 (client-import and barrel guards), T-15-19 (sort and ORDER BY guards), T-15-20 (no proxy route guard) are mitigated; no packages were installed.

## Self-Check: PASSED

- Files exist: scanner-guards.test.ts, globals.css scanner block, updated navigation, page, methodology and tests.
- Commits `2e4b614`, `f02626a`, `3074ba0` are ancestors of HEAD.
