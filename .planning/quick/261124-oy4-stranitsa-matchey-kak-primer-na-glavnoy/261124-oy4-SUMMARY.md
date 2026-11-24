---
phase: quick-261124-oy4
plan: 261124-oy4
subsystem: web
tags: [ui, fixtures, css, design]
requires: []
provides:
  - Shared ProbBar and PROB_OUTCOME_LABELS (apps/web/components/prob-bar.tsx)
  - FixtureRow sample-style row on /fixtures
affects: [apps/web/app/fixtures/page.tsx, apps/web/app/page.tsx, apps/web/app/globals.css]
tech-stack:
  added: []
  patterns: [shared selectors between .sample-row and .fixture-row, token-only colours]
key-files:
  created:
    - apps/web/components/prob-bar.tsx
    - tests/unit/fixtures-row-ui.test.tsx
  modified:
    - apps/web/app/page.tsx
    - apps/web/app/fixtures/page.tsx
    - apps/web/app/globals.css
    - tests/unit/fixtures-forecast-ui.test.tsx
decisions:
  - "No value pill on /fixtures: the API has no per-fixture value flag"
  - "Sample list rules are shared by extending selectors, not copied, so homepage styles are untouched"
metrics:
  tasks: 2
  files: 6
status: complete
requirements: [UX-01]
actuals:
  tasks: 2
  commits: 2
plan_head_before: 884a012f3dd21878708065e1b052b412d7833ee7
plan_head_after: 26cf0adf8a52b6be1fa11aad1c76903c396cc597
---

# Phase quick-261124-oy4 Plan 261124-oy4: Fixtures list as the homepage sample Summary

The real /fixtures list now renders each fixture as a row of the homepage sample list: competition and kickoff time on the left, the title link, a small 1X2 bar with three percentages, and status / LIVE badge / compact chips on the right, inside the existing date groups.

## Tasks

| Task | Commit | Result |
| ---- | ------ | ------ |
| 1. Shared ProbBar and FixtureRow markup (tests first) | 3cd1889 | ProbBar moved to a shared component; exported FixtureRow; FixtureForecastLine reshaped into bar + numbers; pending text kept |
| 2. Sample-row styling | 26cf0ad | Sample rules shared via extended selectors; fixture-specific column, 44px link, side and status rules; 640px wrap block; legacy card rules removed; forced-colors list updated; stylesheet contract tests |

## Edited existing test assertion

In `tests/unit/fixtures-forecast-ui.test.tsx` only one assertion was changed: the test **"renders the exact Russian percentage line for a valid forecast"** (it asserted the old text line `Прогноз: П1 52% · Х 26% · П2 22%`; it now asserts the new probability block markup with the sr-only prefix, bar widths 52/26/22 and the labelled numbers). All other tests in that file are untouched.

## Verification

- Unit: fixtures-row-ui, fixtures-forecast-ui, home-page-ui, provider-state-ui, responsible-copy: 46 passed.
- Integration source scan `phase-01-security.test.ts`: 5 passed.
- `pnpm --filter @bet-stats/web test`: 209 passed; typecheck clean; lint 0 errors (9 pre-existing warnings, none from this change).
- Production build `NEXT_DIST_DIR=.next-gate pnpm --filter @bet-stats/web build`: succeeded; `apps/web/next-env.d.ts` reverted and not committed.
- Homepage byte-identity: the full `renderToStaticMarkup(HomePage)` output was dumped before and after the refactor and compared with `cmp`: identical (temporary dump test was deleted, not committed). A homepage characterization test is also committed.
- Playwright `tests/e2e/fixture-discovery.spec.ts`: **NOT RUN.** The config boots its own API on port 3001 with `reuseExistingServer: false`, and port 3001 was already occupied by another process, so Playwright aborted. I did not stop that process. The 360px / 1280px no-overflow, forced-colors and single-chip e2e contracts therefore remain unverified against the new CSS (covered only by unit-level CSS contract tests and the min-width / wrap rules).

## Deviations from Plan

None in behavior. Minor note: the chip-uniqueness unit test counts visible text only (tags stripped), because the compact chips also repeat their labels in `aria-label` attributes by design.

## Known Stubs

None. No value pill or invented value data is rendered on /fixtures.

## Self-Check: PASSED

Files prob-bar.tsx, fixtures-row-ui.test.tsx exist; commits 3cd1889 and 26cf0ad are in HEAD history.
