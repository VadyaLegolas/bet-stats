# Quick Task 261017-utn: Quick forecast probabilities in fixtures analysis list — SUMMARY

## What changed

**API (additive, list path only):** `GET /fixtures` items now carry a new `forecast` field with the latest ISSUED 1X2 probabilities per fixture.

- `apps/api/src/modules/fixtures/fixtures.service.ts` — new exported types `AttachedForecast` (`kind`, `cutoff` ISO, `probabilities: { home, draw, away }`) and `FixtureListProjection = FixtureProjection & { forecast: AttachedForecast | null }`; new exported pure `summarizeLatestForecasts()` (order-dependent, first-accepted-row-wins, per-row all-or-nothing validation with documented malformed-newest fall-through, `ONE_X_TWO` matched by `selection` position-independently); `list()` runs a second `forecastSnapshot.findMany` (ISSUED, newest-first orderBy identical to `forecast-repository.ts` `listIssued`) inside try/catch — on ANY error the result is `[]` so the endpoint degrades to all-fallback cards and never 500s. Deterministic demo path does no query and gets `forecast: null` automatically.
- `apps/api/src/modules/fixtures/fixtures.controller.ts` — `list()` Promise return type widened to `FixtureListProjection[]`. `detail()` (`GET /fixtures/:fixtureId`) byte-identical, untouched.

**Web (display-only, existing server component):** each fixture card on `/fixtures` shows «Прогноз: П1 52% · Х 26% · П2 22%» or «Прогноз пока не выпущен».

- `apps/web/app/fixtures/page.tsx` — `Fixture` type gains optional tolerant `forecast`; new exported pure `forecastPercentages()` (tolerance window [0.9, 1.1] with proportional normalization, largest-remainder rounding with deterministic home→draw→away tie-break, integers always sum to exactly 100, anything out-of-contract → `null`); new exported presentational `FixtureForecastLine` rendered between `fixture-header` and `fixture-badges`. Raw enum codes never reach the markup.
- `apps/web/app/globals.css` — new `.fixture-forecast` / `.fixture-forecast--pending` rules next to `.fixture-badges`.
- `tests/unit/fixtures-list-forecast.test.ts` (new, 10 tests) and `tests/unit/fixtures-forecast-ui.test.tsx` (new, 11 tests) cover everything in the plan: newest-wins, malformed fall-through, invalid rows skipped, position independence, ISO cutoffs, rounding/tie-break/tolerance/nulls, exact Russian markup, pending fallback classes, and no-raw-codes leak.

## Gates

| Gate | Before | After |
| --- | --- | --- |
| `pnpm test` unit project | 314 tests / 36 files | 335 tests / 38 files (+21, +2 files, zero regressions) |
| `pnpm --filter @bet-stats/web test` | 13 tests / 2 files | 13 tests / 2 files (unchanged) |
| `pnpm --filter @bet-stats/web typecheck` | clean | clean |
| `pnpm --filter @bet-stats/api typecheck` | clean | clean |
| Guard tests (`provider-state-ui`, `responsible-copy`, `phase-01-security` integration, `provider-state-api` integration) | green | green without edits |

Commit: `b520fc8` — exactly the six planned files, no deletions; `.planning/`, `.env*`, sentinel files not staged.

## Deviations from Plan

**1. [Rule 1 - Bug] Plan's expected value for the within-tolerance case was arithmetically wrong**
- **Found during:** Task 2 (UI test authoring)
- **Issue:** The plan specifies `{0.52, 0.26, 0.23}` (sum 1.01) → `{52, 26, 22}`. The plan's own locked algorithm (normalize `p = value / sum`, floor, largest-remainder) gives `0.52/1.01×100 = 51.49 → 51`, `25.74 → 26`, `22.77 → 23`, shortfall 2 → `{51, 26, 23}`. The stated `{52, 26, 22}` matches no described method (it would require NOT normalizing, plus a subtraction pass the plan never defines, which would break the sum-to-100 invariant).
- **Fix:** Implemented the locked algorithm; the test asserts the mathematically correct `{51, 26, 23}` (verified to sum to exactly 100). Every other plan-specified expectation (`{52,26,22}`, `{33,33,34}`, `{50,30,20}`, `{34,33,33}`, all nulls) matches the implementation exactly.
- **Files:** `apps/web/app/fixtures/page.tsx`, `tests/unit/fixtures-forecast-ui.test.tsx`
- **Commit:** b520fc8

**2. [Rule 3 - Mechanical] `exactOptionalPropertyTypes` forced `| undefined` on the component prop**
- The plan's `FixtureForecastLine({ forecast }: { forecast?: {...} | null })` cannot accept `fixture.forecast` (typed `{...} | null | undefined`) under the web app's `exactOptionalPropertyTypes: true`. Added `| undefined` to the prop union — the plan's tolerant-stale-API intent is preserved and the call site stays exactly `<FixtureForecastLine forecast={fixture.forecast} />`.
- **Commit:** b520fc8

**3. [Rule 3 - Mechanical] `noUncheckedIndexedAccess` guard in the largest-remainder loop**
- `result[ranked[index].key] += 1` failed typecheck (`ranked[index]` possibly undefined); the loop now binds `const item = ranked[index]` with an `if (item)` guard. Behavior identical.
- **Commit:** b520fc8

## Live-data observations

None yet — the detached servers (:3000/:3001) run compiled dist and were not restarted or rebuilt per the hard constraint. In deterministic demo mode (no `DATABASE_URL`) the card will honestly show «Прогноз пока не выпущен» (`forecast: null`). Live verification of the populated `forecast` field after the orchestrator rebuilds is the orchestrator's job.

## Known Stubs

None — no stub patterns, TODOs, or placeholder values introduced.
