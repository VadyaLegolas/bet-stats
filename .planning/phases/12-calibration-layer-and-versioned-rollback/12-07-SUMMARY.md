---
phase: 12-calibration-layer-and-versioned-rollback
plan: 07
subsystem: web
tags: [calibration, ui, methodology, model-card, e2e, accessibility, responsible-gambling]

requires:
  - phase: 12-calibration-layer-and-versioned-rollback
    provides: "12-05: daily job and seed numbers; 12-06: marketCalibration in forecast responses"
provides:
  - "CalibrationPanel on the match page: raw and calibrated probabilities side by side, version label, method, holdout size, neutral Brier line; exact insufficient-data sentence; coded unavailable texts"
  - "Model card model-card-v1.2.0 with MODEL_CARD.calibration derived from calibration-config-v1; methodology section 'Калибровка вероятностей' (id=calibration)"
  - "Full-loop integration test (job -> API -> rollback) and a release-stack browser journey"
affects: []

actuals:
  tokens: 25700
  tasks: 3
  commits: 3

plan_head_before: 3482811853e4a49f00bd4049e637a68b560224d4
plan_head_after: 5e4eebdf89a6b53e84f7fa920fb5782a7fc75c27

tech-stack:
  added: []
  patterns:
    - "Panel reads only the closed API fields; an absent or malformed block is shown as unavailable, never as calibrated"
    - "Model card block reads CALIBRATION_CONFIG; tests compare to the config and pin the D-07 numbers once"
    - "Release-stack spec seeds only calibrators through the repository (no fixtures, forecasts or results) and leaves no active calibrator"

key-files:
  created:
    - apps/web/app/fixtures/[fixtureId]/calibration-copy.ts
    - apps/web/app/fixtures/[fixtureId]/calibration-panel.tsx
    - tests/unit/calibration-panel-ui.test.tsx
    - tests/integration/calibration-full-loop.test.ts
    - tests/e2e/calibration.spec.ts
  modified:
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - apps/web/app/fixtures/[fixtureId]/page.tsx
    - apps/web/app/methodology/page.tsx
    - packages/domain/src/methodology/model-card.ts
    - tests/unit/model-card.test.ts
    - tests/e2e/methodology.spec.ts

key-decisions:
  - "The panel is a plain component without client directives or hooks; it is rendered by the client workbench inside each market block, after the table of raw probabilities"
  - "The sentence 'Калиброванные вероятности — тоже оценки, а не гарантии.' is the one approved place where the word 'гарант' appears (in a negation); the wording scan removes exactly that sentence before testing for forbidden words"
  - "A CALIBRATED block with missing or length-mismatched numbers is rendered as unavailable ('Калибровка недоступна.')"
  - "The calibrator version number is the market's promotion number, not a global counter: in the release-stack spec the second browser project sees 'Калибровка v2' because the first project's calibrator was promoted and rolled back earlier"

requirements-completed: [CALIB-01, CALIB-03, CALIB-04]

coverage:
  - id: H1
    description: "Panel: CALIBRATED shows 'Калибровка v{n}', method, 'Отложенная выборка: N исходов', raw and calibrated tables and the neutral Brier line; INSUFFICIENT_DATA shows the exact sentence with numbers from the response; UNAVAILABLE explains each reason code; missing marketCalibration is unavailable"
    requirement: CALIB-04
    verification:
      - kind: unit
        ref: "tests/unit/calibration-panel-ui.test.tsx"
        status: pass
      - kind: e2e
        ref: "tests/e2e/calibration.spec.ts"
        status: pass
    human_judgment: false
  - id: H2
    description: "No claims of improvement, superiority or guarantee in any state or reason code; permanent risk disclosure stays; page states value stays on raw probabilities"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/calibration-panel-ui.test.tsx#wording and structure, tests/unit/responsible-copy.test.ts"
        status: pass
      - kind: e2e
        ref: "tests/e2e/calibration.spec.ts (panel text scan, disclosure visible)"
        status: pass
    human_judgment: false
  - id: H3
    description: "Model card v1.2.0, calibration block equal to CALIBRATION_CONFIG, section between evaluation and responsible use, four history entries newest first"
    requirement: CALIB-01
    verification:
      - kind: unit
        ref: "tests/unit/model-card.test.ts"
        status: pass
      - kind: e2e
        ref: "tests/e2e/methodology.spec.ts"
        status: pass
    human_judgment: false
  - id: H4
    description: "Loop on real PostgreSQL: the job promotes, the API serves CALIBRATED v1 on three markets, bad windows 1 and 2 leave it, window 3 rolls it back and the API returns to UNAVAILABLE/NO_PROMOTED_CALIBRATOR; V1 never calibrated; frozen tables unchanged"
    requirement: CALIB-03
    verification:
      - kind: integration
        ref: "tests/integration/calibration-full-loop.test.ts"
        status: pass
    human_judgment: false
  - id: H5
    description: "Browser on the owned release stack: insufficient-data sentence, promotion shows version labels, axe clean and no horizontal scroll at 320 px, link to the methodology section, rollback returns to the insufficient-data sentence; stack left clean"
    requirement: CALIB-04
    verification:
      - kind: e2e
        ref: "tests/e2e/calibration.spec.ts on desktop-chromium and mobile-chromium"
        status: pass
    human_judgment: false

duration: ~100min
completed: 2026-11-24
status: complete
---

# Phase 12 Plan 07: Calibration panel, methodology and end-to-end proof Summary

**The match page now shows raw and calibrated probabilities side by side with a version label, the method and the holdout size, or the exact sentence "Недостаточно данных для калибровки: нужно не меньше N исходов, сейчас M"; the methodology gains a calibration section built from `calibration-config-v1` (model card v1.2.0); the whole loop job -> API -> rollback is proven on real PostgreSQL and in a browser on the owned release stack.**

## Performance

- **Duration:** about 100 min
- **Tasks:** 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Commits (measured, `git rev-list --count 3482811..HEAD` before the docs commits):** 3 (6c7b63a, baccee5, 5e4eebd)
- **`git rev-parse HEAD` before the first edit:** `3482811853e4a49f00bd4049e637a68b560224d4`
- No dependency, lockfile or migration changes. `apps/web/app/internal-api/fixtures`, `packages/domain/src/forecast` and `tests/e2e/live-release-stack.ts`, `live-provider-stack.ts`, `playwright.phase06.config.ts` untouched (`git diff --quiet 3c5f75e..HEAD` exit 0).

## Red evidence

- **Task 1:** `pnpm vitest run --project unit tests/unit/calibration-panel-ui.test.tsx` before the implementation -> `Error: Cannot find module '../../apps/web/app/fixtures/[fixtureId]/calibration-panel.js'`, `Tests no tests`. Green afterwards: 40 tests.
- **Task 2:** `pnpm vitest run --project unit tests/unit/model-card.test.ts` against the unchanged `model-card.ts` -> 7 failed of 14 (version, section list, history, and the five tests of the new calibration block); after the implementation two of the five failed once on wording (a capital letter in a sentence) and were fixed in the card text, not in the tests.
- **Task 3:** the first browser run failed before any test: `SyntaxError: The requested module '@bet-stats/domain' does not provide an export named 'calibratorContentId'`. Cause: Playwright and the owned stack resolve workspace packages through `dist/` (`exports.default = ./dist/index.js`), and `packages/domain/dist` and `packages/database/dist` were stale (gitignored build output). Fix: `pnpm --filter @bet-stats/domain build` and `pnpm --filter @bet-stats/database build` (no tracked file changes). The second run passed everything except the mobile project of the new spec (`Калибровка v2` instead of `v1`, see key decisions); the spec was corrected to read each market's promotion number from the repository and to require `1` only in the first (desktop) project.

## Verbatim Russian texts

Panel (`calibration-copy.ts`):

- CALIBRATED: `Калибровка v{calibratorVersion}`; `Метод: Platt` or `Метод: изотоническая регрессия`; `Отложенная выборка: {sampleSize} исходов`; table columns `Выбор`, `Сырая вероятность`, `Калиброванная вероятность`; `Brier на отложенной выборке: сырые {x}, калиброванные {y}` (three decimals); `Калиброванные вероятности — тоже оценки, а не гарантии.`; `Расчёт value по-прежнему использует сырые вероятности.`; link `Как устроена калибровка` -> `/methodology#calibration`
- INSUFFICIENT_DATA: `Недостаточно данных для калибровки: нужно не меньше {requiredSample} исходов, сейчас {sampleSize}`, then `Показаны только сырые вероятности.`, the value note and the link
- UNAVAILABLE by code: `KIND_NOT_COVERED` -> `Калибровка не применяется к первичному прогнозу.`; `NO_PROMOTED_CALIBRATOR` -> `Калибратор для этой версии модели ещё не утверждён.`; `CALIBRATOR_MODEL_MISMATCH`, `CALIBRATOR_MARKET_MISMATCH`, `CALIBRATOR_INVALID` -> `Калибратор не соответствует версии модели этого прогноза.`; `CALIBRATION_READ_FAILED` -> `Калибровка временно недоступна.`; unknown or absent code, absent `marketCalibration`, malformed CALIBRATED block -> `Калибровка недоступна.`; each followed by `Показаны только сырые вероятности.`
- Heading `Калибровка` (h5) in every non-calibrated state; `Калибровка v{n}` (h5) when calibrated; region label of the table `{рынок} — сырые и калиброванные вероятности`; evidence projection id `calibration-{market}`.

## Methodology sections (final list, `main h2`)

Входы, Поправка на низкие счета, Что исключается, Уверенность, Ограничения, Оценка, **Калибровка вероятностей** (`#calibration`, technical details `#calibration-technical`: config version and hash, markets, fit and served kinds, minimum samples 300 / 1500 / 60, holdout fraction, materiality 0.002, rollback 3 in a row each of at least 30 outcomes, clip epsilon, cadence), Ответственное использование, История изменений (four entries: v1.2.0, v1.1.0, v1.0.0, v0.9.0). `MODEL_CARD.version = model-card-v1.2.0`, effective `2026-11-24`.

### Limitations published in the section (two added at the request of the checker/reports)

1. **Fit kinds versus served kinds.** Per the code, the calibrator is fitted on `PRE_MATCH` snapshots only (`CALIBRATION_CONFIG.fit.kinds = ["PRE_MATCH"]`), and the same calibrator is shown for `PRE_MATCH` and `LINEUP_CONFIRMED` forecasts (`servedKinds`). The card says: the calibrator is fitted on pre-match snapshots and also shown for forecasts by confirmed lineup; the transfer to such forecasts is not separately verified and the shares of forecast kinds in the training sample and in the display may differ. (The request wording "the fit may train mostly on LINEUP_CONFIRMED forecasts while serving PRE_MATCH" does not match the implemented direction; the published limitation states what the code does, and the mismatch of kinds between fit and display is the open caveat in either direction.)
2. **Read-time state with today's asOf.** The calibrated state and the census are computed at read time at the request moment: an old forecast is shown with today's calibrator and today's number of eligible outcomes, not with the state at issuance.

Other limitations: below 300 outcomes per market no calibrator exists; calibration does not promise closer-to-reality probabilities and may be worse than raw on new data (hence the rollback); the first (INITIAL) forecast is not covered; the calibration is not multiclass (1X2 is one-vs-rest with renormalisation).

## Verification run

- Unit: `tests/unit/calibration-panel-ui.test.tsx tests/unit/model-card.test.ts tests/unit/responsible-copy.test.ts tests/unit/fixtures-forecast-ui.test.tsx tests/unit/forecast-comparison-ui.test.tsx` -> 5 files, 91 tests passed.
- Integration: `calibration-full-loop.test.ts` three consecutive runs: 4/4 each; `forecast-calibration-api.test.ts` 12/12.
- Browser, only `playwright.phase06.config.ts` on the owned stack (ports 3240 and 3241), four files unfiltered: `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/calibration.spec.ts tests/e2e/methodology.spec.ts tests/e2e/release-accessibility.spec.ts tests/e2e/release-journey.spec.ts` -> **28 passed, 0 failed: 14 on `desktop-chromium` and 14 on `mobile-chromium`** (1.6 min). The first of two runs had 27 passed and 1 failed (mobile calibration spec, version number; fixed in the spec).
- `pnpm typecheck` 7 successful; `pnpm --filter @bet-stats/web lint` 0 errors (9 pre-existing warnings, none from the new files); root `tsc -p tsconfig.json --noEmit` reports nothing under `calibration`, `methodology` or `model-card`.
- `grep -c "model-card-v1.2.0"` in the card = 2; `id="calibration"` in the methodology page = 1; `CalibrationPanel` in the workbench = 2; `Недостаточно данных для калибровки` in `calibration-copy.ts` = 1 and in `calibration.spec.ts` the sentence is asserted through its regular expression.
- `docker ps -a` after the runs shows only the two pre-existing development containers: the stack's PostgreSQL and Redis (owned by `playwright.phase06.config.ts`) and the integration containers were removed. The development database, ports 3000 and 3001 and `.env*` were not touched; `playwright.config.ts` specs were not run.

## Deviations from Plan

### Auto-fixed Issues

None in product code.

### Plan variations

**1. [Environment] Rebuild of `dist/` for the browser stack**
- `packages/domain/dist` and `packages/database/dist` (gitignored) were stale and lacked the calibration exports; `pnpm --filter @bet-stats/domain build` and `pnpm --filter @bet-stats/database build` were run once. Any fresh checkout that runs the phase06 browser suite needs the same build (or a full `pnpm build`) first.

**2. [Test wording]** The forbidden-word scan removes the approved sentence `Калиброванные вероятности — тоже оценки, а не гарантии.` before checking for `гарант`, because the plan requires that exact sentence and the scan also lists `гарант`.

**3. [Spec]** The e2e promotion number is read from the repository per market: `v1` is asserted only in the first browser project; in the second project it is `v2` by design (promotion number of the market).

**4. [Scope]** The release stack V1 identity is read from the stack database (latest issued forecast of the comparison fixture). The panel for the page's default forecast (the newest, a confirmed-lineup one) is the one asserted; `LIVE_FIXTURES.comparison` is not imported, the fixture id is a local constant `CALIBRATION_FIXTURE` as requested.

**5. [Files]** `tests/unit/model-card.test.ts` and `tests/e2e/methodology.spec.ts` assertions were updated (version, sections, history of four), existing checks were kept.

**Total deviations:** 0 auto-fixes, 5 plan variations. **Impact:** none on scope.

## Authentication Gates

None.

## Issues Encountered

- Shell quoting of long Node one-liners failed several times (backticks and quotes); patches were applied with script files written by the Write tool. No partial edit reached a commit.
- The Playwright suite takes about three minutes including the web build of the owned stack.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-12-26 (copy module, wording scan over all states and codes, `responsible-copy.test.ts`), T-12-27 (absent or malformed block = unavailable), T-12-28 (only closed fields; no calibrator ids in the markup), T-12-29 (no `dangerouslySetInnerHTML`; an unknown reason code with markup is rendered as escaped text), T-12-30 (risk disclosure asserted in the CALIBRATED state), T-12-31 (reuse of `ResponsiveEvidence`, axe and the 320 px check in the browser), T-12-SC (no dependencies).

## Not verified / limits

- Real data: all numbers shown in the panel come from synthetic calibrators; real forecasts are expected to remain in the insufficient-data state for a long time.
- The panel's visual layout was checked by DOM assertions, axe and the 320 px scroll width, not by screenshot review or on a real mobile device; browsers other than Chromium (desktop and Pixel 5 emulation) were not run.
- The browser journey seeds the calibrators through the repository, not through the daily job; the job-to-API path is proven separately on real PostgreSQL without a browser.
- Dev stack on ports 3000/3001 was deliberately not exercised; the new `marketCalibration` response is therefore unproven against a live developer database.
- The two limitations above (kind mismatch between fit and display; read-time asOf) are published, not mitigated in code.
- `pnpm test` / `pnpm test:integration` for the whole repository were not run for this plan; only the calibration files and the listed neighbours.

## Next Phase Readiness

Plan 12-07 is the last plan of phase 12. All seven plans have summaries; the phase is not marked complete here: verification of the phase goal is the next step for the orchestrator.

## Self-Check: PASSED

- Files: `calibration-copy.ts`, `calibration-panel.tsx`, `calibration-panel-ui.test.tsx`, `calibration-full-loop.test.ts`, `calibration.spec.ts` exist; `model-card.ts`, `methodology/page.tsx`, `forecast-workbench.tsx`, `page.tsx` modified.
- Commits: 6c7b63a, baccee5 and 5e4eebd are ancestors of HEAD.
