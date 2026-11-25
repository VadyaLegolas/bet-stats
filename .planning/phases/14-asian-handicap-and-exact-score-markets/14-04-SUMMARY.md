---
phase: 14-asian-handicap-and-exact-score-markets
plan: 04
subsystem: web-ui
tags: [asian-handicap, exact-score, match-page, russian-labels, css-tokens, fail-closed, server-side-fetch]

requires:
  - phase: 14-asian-handicap-and-exact-score-markets
    provides: 14-02 ExtendedMarketsView DTO, parseExtendedMarketsView, market registry, buildAhView / exactScoreView
provides:
  - typed Russian dictionaries and market-aware label functions (family, AH results, unavailable reasons, matrix sources, selectionLabelFor, formatAhLine, oddsMarketLabel(string))
  - additive .market-* CSS block on existing tokens plus forced-colors rules
  - pure view model (window of 5 around the main line, row models for both sides, structural zeros, exact score grid, closed slot classification)
  - ResponsiveEvidence rowCurrent prop (markup unchanged without it) and the extendedMarkets methodology warning
  - server-side loader and client island rendering the "Азиатский гандикап" (#asian-handicap) and "Точный счёт" (#exact-score) sections on the match page
affects: [14-05, 14-06, 14-07, 14-08]

plan_head_before: ad0ba61b4f9693f0be037a8879d30a7e70f134e1
plan_head_after: 3fe96361e93da0e6240bbe97b2bc4c87a6e444bf

actuals:
  tokens: 38000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "pure model + thin client island: the UI formats, orders and labels DTO values and performs no probability arithmetic"
    - "closed slot classification in one function (normaliseExtendedMarkets) used by both the server loader and the island, so a malformed view is never drawn as AVAILABLE"
    - "static-markup tests with explicit initialSide / initialExpanded props instead of Testing Library (not in the repo, no new dependencies)"

key-files:
  created:
    - apps/web/app/fixtures/[fixtureId]/extended-markets-model.ts
    - apps/web/app/fixtures/[fixtureId]/extended-markets-model.test.ts
    - apps/web/app/fixtures/[fixtureId]/extended-markets-sections.tsx
    - apps/web/app/fixtures/[fixtureId]/extended-markets-loader.ts
    - tests/unit/extended-markets-ui.test.tsx
    - tests/unit/responsive-evidence-current.test.tsx
  modified:
    - apps/web/components/enum-labels.ts
    - apps/web/components/enum-labels.test.ts
    - apps/web/components/responsive-evidence.tsx
    - apps/web/components/contextual-methodology-warning.tsx
    - apps/web/components/design-tokens.test.ts
    - apps/web/app/globals.css
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - apps/web/app/fixtures/[fixtureId]/page.tsx
    - apps/web/vitest.config.ts
    - tests/unit/responsible-copy.test.ts
    - .planning/phases/14-asian-handicap-and-exact-score-markets/14-UI-SPEC.md

key-decisions:
  - "Sections are rendered by ForecastWorkbench between the 'Замороженный прогноз' panel and .workbench-duo (no next/dynamic); the workbench receives an optional extendedMarkets map keyed by forecast id, and a missing key for the selected snapshot renders the read-failure alert"
  - "Side and expander state live in ExtendedMarketsSections itself with no forecast.id key, so they survive a snapshot switch within the session"
  - "normaliseExtendedMarkets lives in the model (not the loader) so the island can re-classify its prop: defence in depth for T-14-12"
  - "Exact-score cell model keeps the visible prefix 'коэф. ' separate from the number, so the prefix can be aria-hidden while the sr-only 'Справедливый коэффициент:' carries the meaning"

requirements-completed: [MKT-01, MKT-02, MKT-05]

coverage:
  - id: D1
    description: "Typed Russian dictionaries over the domain unions; 21 AH line labels and 17 exact-score labels pinned; no label equals its raw code"
    requirement: "MKT-01"
    verification:
      - kind: unit
        ref: "apps/web/components/enum-labels.test.ts"
  - id: D2
    description: ".market-* CSS block has no hex, no new custom property, no animation; accent-soft contrast pairs pass in both themes"
    requirement: "MKT-01"
    verification:
      - kind: unit
        ref: "apps/web/components/design-tokens.test.ts"
  - id: D3
    description: "Window of exactly 5 rows around the main line (shifts at both edges), 21 when expanded, away view ordered by the away line, structural zeros as a dash with sr-only text"
    requirement: "MKT-01"
    verification:
      - kind: unit
        ref: "apps/web/app/fixtures/[fixtureId]/extended-markets-model.test.ts"
  - id: D4
    description: "ResponsiveEvidence without rowCurrent renders byte-identical markup (inline snapshot taken on HEAD before the edit); with rowCurrent marks the row and card and opens the card details"
    requirement: "MKT-01"
    verification:
      - kind: unit
        ref: "tests/unit/responsive-evidence-current.test.tsx"
  - id: D5
    description: "AVAILABLE layout: 5 / 21 AH rows, one aria-current row with the chip text, toolbar ARIA, 16 cells plus OTHER, corrected tail wording, Хвост повышен chip"
    requirement: "MKT-02"
    verification:
      - kind: unit
        ref: "tests/unit/extended-markets-ui.test.tsx"
  - id: D6
    description: "Legacy snapshot: both headings stay, D-19 sentence in each section, role=status, no table and no retry; unknown reason / malformed view fail closed to the generic notice; READ_FAILED is role=alert"
    requirement: "MKT-05"
    verification:
      - kind: unit
        ref: "tests/unit/extended-markets-ui.test.tsx"
  - id: D7
    description: "Interaction (click, focus, aria-expanded toggling), overflow at 320/768/1440 and 200 percent, dark theme, forced-colors, axe"
    requirement: "MKT-01"
    verification:
      - kind: manual
        ref: "deferred to plan 14-08 (Playwright and visual snapshots, as the plan states)"

duration: ~75min
completed: 2026-11-25
status: complete
---

# Phase 14 Plan 04: Extended-markets sections on the match page Summary

Match page now shows "Азиатский гандикап" (21 lines, side toggle, main line, 5-row window with a 21-row expander) and "Точный счёт" (4x4 grid plus "Любой другой счёт"), fed by a server-side loader with closed classification and an honest neutral notice for legacy snapshots.

## What was built

**Task 1 (a7eec78)** Russian dictionaries and CSS.
- `enum-labels.ts`: `MARKET_FAMILY_LABELS`, `AH_RESULT_LABELS`, `AH_RESULT_ORDER`, `EXTENDED_MARKETS_UNAVAILABLE_LABELS` (+ generic fallback and `extendedUnavailableLabel`), `FAIR_ODDS_UNAVAILABLE_LABELS`, `SCORE_MATRIX_SOURCE_LABELS`, `selectionLabelFor`, `formatAhLine`, and `oddsMarketLabel(market: string)`; `FINANCIAL_OUTCOME_LABELS` and the value-reason dictionary gained the new codes. All new `Record`s are typed over domain unions.
- `globals.css`: appended `.market-*` block plus `.evidence-card[data-current="true"]`, two forced-colors rules; no hex, no new custom property, no animation.
- `design-tokens.test.ts`: text, text-secondary and muted on `--color-accent-soft` in both themes, and a guard test for the block.
- `responsible-copy.test.ts`: scanning extended from `.tsx` to non-test `.ts` modules (covers `enum-labels.ts` and `extended-markets-model.ts`).

**Task 2 (4bf7c87)** Model and `ResponsiveEvidence.rowCurrent`.
- `extended-markets-model.ts`: `ahWindow`, `ahRowModel`, `ahSummaryModel`, `exactGridModel`, `isStructuralZero`, caption helpers and `tailLine`. No probability arithmetic (a source-level test forbids reduce, Math.abs/min/max and arithmetic on probability).
- `ResponsiveEvidence` gets optional `rowCurrent`; the inline snapshot was taken on HEAD before the edit.
- `extendedMarkets` key added to `METHODOLOGY_WARNINGS`.

**Task 3 (3fe9636)** Sections, loader and placement.
- `extended-markets-loader.ts`: `loadExtendedMarkets` calls `GET /fixtures/{id}/forecasts/{forecastId}/extended-markets` for every listed snapshot in parallel with the same eligibility headers and `cache: "no-store"`; network or non-2xx gives `READ_FAILED`, a body that fails `parseExtendedMarketsView` (or is not JSON) gives `{ UNAVAILABLE, UNRECOGNISED }`.
- `extended-markets-sections.tsx`: client island with side toggle and expander; UNAVAILABLE and READ_FAILED notices.
- `page.tsx` loads the slots after `loadForecasts`; `ForecastWorkbench` renders `ExtendedMarketsSections` for the selected `forecast.id`.

## Where it sits in the workbench

Inside `ForecastWorkbench`, directly after the `section#forecast-heading` ("Замороженный прогноз") panel and before `div.workbench-duo`, as two sibling `panel workbench-card` sections (`#asian-handicap`, then `#exact-score`). Eager, not `next/dynamic`. `RiskDisclosure` and the workbench header disclaimer are untouched.

## No new tokens

Confirmed: the `.market-*` block declares no custom properties and contains no hex or animation (enforced by `design-tokens.test.ts`). It adds two small rules beyond the UI-SPEC table, also on existing tokens only: `.market-head > h3` (keeps the 24px heading size that `.workbench-card > h3` gives to direct children), `.market-side` (flex gap for the two toggle buttons).

## Tail wording for user confirmation (verbatim)

> Хвост матрицы вне 0–7 голов: {percent} — уже учтён нормировкой на сохранённую массу и распределён по всем счетам.

This replaces the approved UI-SPEC text "... — входит в строку «Любой другой счёт»." (Pitfall 9: with retained-mass-v1 the grid is divided by the retained mass, so the tail is spread over all cells and OTHER = 1 − sum of 16 explicit cells holds renormalised 4+ goal cells, not the raw tail). The methodology paragraph in UI-SPEC changed analogously; plan 14-08 must apply the same wording to the live methodology page and model card.

## 14-UI-SPEC.md edits (exact lines)

| Line | Change | Why |
|------|--------|-----|
| 169 | Exact score anatomy item 4 (tail line): "входит в строку «Любой другой счёт»" replaced by "уже учтён нормировкой на сохранённую массу и распределён по всем счетам" | Pitfall 9, tail is not part of OTHER as a separate mass |
| 345 | Methodology item 4: "строка «Любой другой счёт», в которую входит всё остальное, включая хвост матрицы за пределами сетки" replaced by "строка «Любой другой счёт» — все счета, не вошедшие в 16 явных, в том числе с четырьмя и более голами; хвост матрицы за пределами сетки 0–7 уже учтён нормировкой на сохранённую массу" | same |
| 448-460 | New section "Revision 2026-11-25 (planner)" appended at the end, marked "ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ ПОЛЬЗОВАТЕЛЯ" and listing both edits | approved user-visible text was changed, so the change must be flagged |

No other lines of the UI-SPEC were touched. Note: the UI-SPEC "Testable Acceptance Contract" line 385 still says only "elevated tail renders the «Хвост повышен» chip"; it needs no change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Domain not resolvable at runtime in the web test project**
- **Found during:** Task 1
- **Issue:** `@bet-stats/domain` exports `./dist/index.js`, which exists only after a build, and `apps/web/vitest.config.ts` had no alias, so the new web tests (which need `parseMarketId`, `buildExtendedMarketsView`) could not import it.
- **Fix:** added a `resolve.alias` to the domain sources in `apps/web/vitest.config.ts` (the root project already aliases it the same way).
- **Files modified:** apps/web/vitest.config.ts
- **Commit:** a7eec78

**2. [Rule 2 - Missing critical functionality] ResponsiveEvidence rendered an empty paragraph for rows without a warning**
- **Found during:** Task 3
- **Issue:** the `warning` slot always rendered `<p>`, so AH rows without a quarter-line note (most rows) produced empty paragraphs in the mobile cards.
- **Fix:** `<p>` is skipped when `warning` returns `null`, `undefined` or `false`. Existing callers return strings, so their markup is unchanged (the pinned snapshot still passes).
- **Files modified:** apps/web/components/responsive-evidence.tsx
- **Commit:** 3fe9636

**3. [Rule 2 - Defence in depth] Island re-classifies its prop**
- `normaliseExtendedMarkets` (closed parse) runs in the loader and again in the island, so a slot that did not come through the loader (tests, future callers) can never draw the AVAILABLE layout from a malformed value (T-14-12).

### Interpretation notes (not deviations)

- The plan's `ExtendedMarketsSlot` type is defined in `extended-markets-model.ts` and re-exported from `extended-markets-loader.ts`, to keep the loader a thin module and avoid a type cycle.
- The unit test for the island uses `renderToStaticMarkup` with explicit `initialSide` and `initialExpanded`, as the plan assumed (no Testing Library or jsdom). Clicks, focus movement and `aria-expanded` toggling are not exercised until Playwright in plan 14-08.
- `ForecastWorkbench`'s `extendedMarkets` prop is optional: existing callers and tests that do not pass it render no sections; when the map is passed but lacks the selected snapshot, a `READ_FAILED` alert is shown.
- The "Обновить страницу" link carries `href="/fixtures/{id}"` for no-JS and reloads the current URL on click (keeps `returnTo`).

## Known Stubs

None. Every rendered value comes from the DTO; no hardcoded empty values reach the UI.

## Threat Flags

None beyond the plan's threat model. The loader adds a server-to-API GET to an endpoint introduced in 14-01; it reuses the existing eligibility headers and `cache: "no-store"`.

## Verification run

- `pnpm --filter @bet-stats/web test`: 12 files, 251 tests passed
- `pnpm exec vitest run --project unit` for extended-markets-ui, responsive-evidence-current, responsible-copy, workbench-design-ui, fixtures-forecast-ui, scorecard-ui, forecast-comparison-ui, odds-draft-ui: 8 files, 114 tests passed
- `pnpm typecheck` passed (web typecheck ran fresh; sibling packages replayed from the shared turbo cache)
- `pnpm --filter @bet-stats/web lint`: 0 errors (9 pre-existing warnings in unrelated files)
- `turbo run build --filter=@bet-stats/web`: Next production build succeeded

Not run here (plan 14-08): Playwright interaction, axe, visual snapshots at 320/768/1440 px and 200 percent, dark theme, forced-colors, perf harness.

## Self-Check: PASSED

- Created files exist: extended-markets-model.ts, extended-markets-model.test.ts, extended-markets-sections.tsx, extended-markets-loader.ts, extended-markets-ui.test.tsx, responsive-evidence-current.test.tsx
- Commits a7eec78, 4bf7c87, 3fe9636 are ancestors of HEAD (3 commits since ad0ba61)
