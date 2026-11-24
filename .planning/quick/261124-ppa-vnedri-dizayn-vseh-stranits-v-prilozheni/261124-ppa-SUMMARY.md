---
quick_id: 261124-ppa
phase: quick-261124-ppa
plan: 261124-ppa
subsystem: web-ui
tags: [design, css, tokens, markup-only, fixtures-detail, scorecards, methodology, faq]
requires: [261124-n50, 261124-o3r, 261124-oy4]
provides:
  - "BackLink and MatchHero components for the fixture detail page"
  - "Workbench two-card layout, facts tiles and bordered EV rows"
  - "Scorecards KPI tiles, methodology card grid with band, FAQ step cards and ruled Q&A"
  - "One chevron disclosure style, muted-head tables, header/footer/list polish"
affects: [apps/web]
key-files:
  created:
    - "apps/web/app/fixtures/[fixtureId]/match-hero.tsx"
    - tests/unit/match-hero-ui.test.tsx
    - tests/unit/workbench-design-ui.test.tsx
    - tests/unit/inner-pages-design-ui.test.tsx
  modified:
    - "apps/web/app/fixtures/[fixtureId]/page.tsx"
    - "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"
    - "apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx"
    - apps/web/app/scorecards/scorecard-dashboard.tsx
    - apps/web/app/methodology/page.tsx
    - apps/web/app/faq/page.tsx
    - apps/web/app/globals.css
decisions:
  - "PD-01..PD-07 from the plan were followed as written (no 1X2 hero bar, no chips, FAQ keeps list/dl, no demo data)"
  - "Stylesheet contract tests look up every rule of a selector (a class can have several rules) rather than the first match"
metrics:
  duration: "about 40 minutes"
  completed: 2026-11-24
status: complete
commits: 3
plan_head_before: 099e6c6e39ae672595fd55af6226c554160954ee
plan_head_after: 5f49f390d5ce3636ce5070c18073ce8e5f23004c
actuals:
  tokens: 17600
  tasks: 3
  commits: 3
---

# Phase quick-261124-ppa Plan 261124-ppa: Port the all-pages design canvas layouts Summary

Fixture detail hero card with facts tiles, side-by-side odds/comparison cards with bordered EV rows, scorecard KPI tiles, methodology card grid with responsible-use band, FAQ step cards and one chevron disclosure, all with design-token colours only and real data and copy.

## Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 (tracer) | 945d265 | BackLink + MatchHero, full-width page column, h1/h2 scale, hero/facts-grid rules, match-hero test |
| 2 | 9bceb8d | Workbench `workbench-duo` two cards, `field` wrappers, facts-grid forecast, `ev-rows` + `value-chip`, chevron summary, table polish, workbench test |
| 3 | 5f49f39 | KPI tiles, methodology grid/band/facts, FAQ step cards and `faq-list`, panel/well/header/footer/list polish, inner-pages test |

## What changed

- Detail page: back link (chevron, 44px) and one hero card (24px radius, card shadow) with h1 where "против" is muted and the five real dt/dd pairs as tiles; competition and status each appear once; no chip, no 1X2 bar, no invented text.
- Workbench: odds-entry and exact-snapshot comparison sit side by side (`repeat(auto-fit, minmax(min(100%, 26rem), 1fr))`, one column at 360px); frozen forecast as a facts grid; verdict card with four bordered rows; the expected-value cell is the accent chip only for `VALUE_CANDIDATE`, otherwise an outlined neutral chip. Ids, label pairings, roles, headings, button names and the h3/`code` sibling contract are unchanged.
- Scorecards: muted deck, two KPI tiles whose text still reads exactly "Оценка Брайера: 0.4400" / "Логарифмическая потеря: 0.6700" (hidden colon in `sr-only`), receipts card, 44px pagination links.
- Methodology: full width, metadata as facts grid, seven section cards in `card-grid--lg`, responsible-use accent-soft band, history unchanged.
- FAQ: numbered step cards (CSS counter, `role="list"`), ruled Q&A rows; no details element added.
- Global: one chevron summary treatment (arrow glyph removed), muted-head tables with 14px rows, no first-child panel gap, limits card 14px, theme toggle 16px, 18+ badge 38px/12px, fixtures date headings accent-text 24px, filter card radius, filter chips 44px, forced-colors borders for the new surfaces.

## Verification

| Check | Result |
| ----- | ------ |
| Task unit files (match-hero, workbench-design, inner-pages-design, scorecard-ui, forecast-comparison-ui, odds-draft-ui, calibration-panel-ui, fixtures-row-ui, home-page-ui, responsible-copy) | PASS (81 tests in the Task 3 batch, 114 in the Task 2 batch) |
| Whole unit project `pnpm exec vitest run --project unit` | PASS: 76 files / 1075 tests (baseline 72 / 1018 plus the three new files) |
| `tests/integration/phase-01-security.test.ts` | PASS (5 tests) |
| `pnpm --filter @bet-stats/web test` | PASS: 11 files / 209 tests (includes design-tokens) |
| `pnpm --filter @bet-stats/web typecheck` | PASS |
| `pnpm --filter @bet-stats/web lint` | PASS: 0 errors, 9 warnings (pre-existing, none new) |
| `NEXT_DIST_DIR=.next-gate pnpm --filter @bet-stats/web build` | PASS; `apps/web/next-env.d.ts` reverted with `git checkout` (clean) |
| Gate greps | `max-width: 960px` = 0, `min-height: 40px` = 0, `summary::before` outside comments = 0; `match-hero`, `workbench-duo`, `kpi-`, `faq-list`, `panel--band` all present |
| Scope | `git diff --stat` for `apps/web/app/fixtures/page.tsx`, `apps/web/app/page.tsx`, `apps/web/next-env.d.ts` is empty |
| Playwright (forecast-workbench, evidence-scorecard, methodology, release-accessibility, fixture-discovery) | **NOT RUN.** Port 3000 is already held by a foreign process (a running web dev server, PID 6068); `playwright.config.ts` uses `reuseExistingServer: false`, so it would abort. The process was not stopped. The 360px no-overflow, real-DOM sibling/heading contracts and forced-colors behaviour are therefore not checked end to end; only the unit-level markup and stylesheet contracts back them. |
| Human visual pass (1440 / 768 / 390px, light and dark) | Not performed (recommended in the plan) |

Existing tests edited: none. The three new test files were the only test changes.

## Deviations from Plan

None - plan executed as written. Notes (not deviations):

- Methodology: the seven wrapped sections were re-indented by two spaces inside the new grid div (formatting only).
- During the RED/GREEN cycle two test-authoring slips were fixed inside the new test files themselves (regex escapes and a first-match CSS lookup that picked an earlier `.quota-counter` rule); no assertion was weakened.

## Known Stubs

None. No placeholder, hardcoded-empty or demo data was added; canvas demo data was not copied.

## Threat Flags

None. No new endpoints, auth paths or schema; names still render as React text children (escaping asserted by the hero test), hrefs still come from the unchanged `evidenceHref` / `safeReturn`, and the positive chip is emitted only for `VALUE_CANDIDATE`.

## Self-Check: PASSED

- Files present: match-hero.tsx, match-hero-ui.test.tsx, workbench-design-ui.test.tsx, inner-pages-design-ui.test.tsx.
- Commits 945d265, 9bceb8d, 5f49f39 are on main (`git rev-list --count 099e6c6..HEAD` = 3).
