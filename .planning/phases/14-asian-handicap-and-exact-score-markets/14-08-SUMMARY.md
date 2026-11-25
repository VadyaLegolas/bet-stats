---
phase: 14-asian-handicap-and-exact-score-markets
plan: 08
subsystem: methodology-and-e2e
tags: [model-card, methodology, playwright, accessibility, perf-audit, validation]
requires:
  - phase: 14-asian-handicap-and-exact-score-markets
    provides: 14-04 sections and corrected tail wording, 14-06 forms and value breakdown, 14-07 API for the new markets
provides:
  - model-card-v1.4.0 with a card.extendedMarkets block fed by domain constants and a first changeHistory entry
  - "/methodology section #extended-markets between #calibration and #clv, limitation sentence in #limitations"
  - Playwright spec for the extended markets on the real stack (15 scenarios, axe, overflow, forced colors)
  - seed variants (persisted, re-derived, unverifiable, lopsided persisted matrices) as new INSERTs only
  - 14-VALIDATION.md signed off
affects: []

plan_head_before: bf374ac24db6f787a366d77ad34fc78767a6f142
plan_head_after: b33aed47b1976ac76ccca98687dcc49678ed81ff

actuals:
  tokens: 22300
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "model card publishes method and versions taken from domain constants; the re-derivation tolerance is now an exported constant"
    - "E2E states of one match are made of new INSERTs (API issuance plus legacy and lopsided-matrix rows), never UPDATEs"

key-files:
  created:
    - tests/e2e/extended-markets.spec.ts
  modified:
    - packages/domain/src/methodology/model-card.ts
    - packages/domain/src/markets/score-matrix.ts
    - apps/web/app/methodology/page.tsx
    - apps/web/app/globals.css
    - apps/web/components/design-tokens.test.ts
    - tests/unit/model-card.test.ts
    - tests/unit/inner-pages-design-ui.test.tsx
    - tests/e2e/methodology.spec.ts
    - tests/helpers/extended-markets-seed.ts
    - .planning/phases/14-asian-handicap-and-exact-score-markets/14-VALIDATION.md
    - .planning/phases/14-asian-handicap-and-exact-score-markets/deferred-items.md

key-decisions:
  - "The corrected tail wording lives inside the exact-score method item of the card (UI-SPEC methodology item 4), so the page and the card cannot drift; no separate tail field"
  - "The re-derivation tolerance 1e-9 is exported as SCORE_MATRIX_REDERIVED_TOLERANCE and the card reads it, instead of a string literal"
  - "The pre-existing scriptTransferBytes breach is recorded, not fixed (out of scope); nyquist_compliant is true because test coverage is complete, the perf item is flagged separately"

requirements-completed: [MKT-01, MKT-02, MKT-03, MKT-04, MKT-05]

duration: ~3h wall clock (about 1h40 of it waiting for integration, E2E and perf runs)
completed: 2026-11-25
status: complete
---

# Phase 14 Plan 08: Methodology, model card and end-to-end gate Summary

Model card v1.4.0 and the "Азиатский гандикап и точный счёт" methodology section are published with the corrected tail wording and an explicit full-time-score limitation; the browser contract of the new sections is proven on the real stack, which also exposed and fixed a 100 px page overflow at 320 px.

## What was built

**Task 1 (5c08e56)** model card and methodology.
- `model-card.ts`: `version` is `model-card-v1.4.0`, `effectiveDate` is 2026-11-25 (UTC execution date) and equals the first `changeHistory` entry; `extended-markets` sits between `calibration` and `clv` in `MODEL_CARD_SECTION_IDS`; new `extendedMarkets` block (`versions` from the domain constants, `derivation`, `method`, `formulas`, `legacyTolerance`, six `limitations`); `policies.financialV2`. Older history entries are untouched.
- Limitations: the five UI-SPEC items plus the stored-final-score item (extra time and penalty shoot-out can make the result differ from a bookmaker's rules).
- `page.tsx`: `<section id="extended-markets">` between `#calibration` and `#clv` with `TechnicalDetails id="extended-markets-technical"`; `#limitations` links to it with the approved sentence. Lead, `RiskDisclosure` and `#responsible-use` unchanged.
- Tail wording: the exact-score item says "хвост матрицы за пределами сетки 0–7 уже учтён нормировкой на сохранённую массу" and a test forbids "входит в строку" next to the tail. This is the corrected text 14-04 flagged for user confirmation; it is still awaiting that confirmation.
- Tests: `model-card.test.ts` (version, dates, six versions in the first entry, constants-driven block, formulas, six limitations, tail wording), `inner-pages-design-ui.test.tsx` (nine-section grid, order, section content, limitations link, lead and disclosure intact), `methodology.spec.ts` (anchor order, six history entries, new content).

**Task 2 (16511e6)** end-to-end spec, seed, and a CSS fix.
- `extended-markets.spec.ts`, 15 scenarios, real PostgreSQL, Nest and Next, no interception: five rows and one main line (`aria-current`, chip text and rail, not colour alone); side toggle keeps the main row and shows "(Хозяева …)"; expander (`aria-expanded`, focus kept, polite status "Показаны все 21 линия", 21 rows); 16 cells plus "Любой другой счёт", "Без калибровки" chip, persistent disclosure; re-derived snapshot; unverifiable snapshot (both sections neutral `role=status`, no table, compare disabled with the visible reason for both markets); AH form (no default line, inputs hidden, "Выберите линию гандикапа.", focus, signed labels); exact-score form (17 labelled fields, focus on the first invalid one, "Не заполнено полей: 17 из 17", then 16); full AH book saved and compared by keyboard, five-outcome breakdown and push sentence; keyboard walk through toggle, expander, line select, 17 fields and the disabled compare state; axe (serious and critical only) for available, expanded and unavailable pages in light and dark; overflow at 320, 768 and 1440 px; 200 percent text zoom; forced colors with reduced motion; main line at -2.5 and +2.5; zero-probability exact-score cell; long source label.
- Seed (`extended-markets-seed.ts`): `seedLegacyForecastVariants` (INITIAL revision 1 re-derivable, revision 2 with a distorted home rate so it fails closed) and `seedCustomMatrixForecast` (revisions 3 and 4 with persisted lopsided matrices, one with a zero 0:3 cell). All are INSERTs; the spec first proves through the API that the four snapshots really are AVAILABLE/PERSISTED, AVAILABLE/REDERIVED, UNAVAILABLE and AVAILABLE/PERSISTED.

**Task 3 (b33aed4)** gate and sign-off, see "Checks" below. `14-VALIDATION.md` now has `nyquist_compliant: true`, `wave_0_complete: true`, a filled verification map and sign-offs.

## Where the E2E ran

Locally on Windows with Node 24.22, a disposable Docker PostgreSQL 18 (`bs14-08-e2e-pg`, port 55438, removed afterwards) and `DATABASE_URL` pointing at it; `playwright.config.ts` started the API (3001) and Next (3000) itself. Chromium was already installed. The development database was never touched.

## Human-check backstops (UI-SPEC "UI Considerations")

Run as automated checks on computed styles, not as a visual review by eye (no live look at the screen was possible):

| Backstop | Result |
|----------|--------|
| overflow at 320, 768, 1440 px and 200 percent | pass after the fix below: no page-level sideways scroll; exact-score region is a labelled `role=region` with `overflow-x` auto, scrolls inside itself at 320 (`scrollWidth` > `clientWidth`); row header is `position: sticky`; at 768 and 1440 the AH region is the scroller, at 320 the AH rows are cards |
| theme / a11y | pass: axe no serious or critical violations in light and dark (available, expanded, unavailable); forced colors keep the 4 px rail and the chip border; reduced motion adds nothing |
| long text | pass: a 150-character source label in the odds select leaves the 360 px page without sideways scroll; line labels are short by construction |
| main line at the edges | pass: -2.5 and +2.5 on lopsided persisted matrices, still five rows, one main row, 21 rows expanded |
| zero-probability exact-score cell | pass: "Недоступно" plus "вероятность счёта равна нулю" and "0.0%" |

## Checks

Ran and passed:
- `pnpm test`: unit 89 files passed, 1 skipped (1531 passed, 2 skipped); web 14 files, 271 tests.
- `pnpm typecheck`, `pnpm lint` (0 errors, 9 pre-existing warnings), `pnpm build`.
- `pnpm test:integration` (whole suite, 85 files): 75 files passed on a bare run. All phase 14 files (`extended-markets-guards`, `-parity`, `-api`, `extended-settlement-pipeline`, `score-matrix-persistence`, `evaluation-api`, `closing-odds-api`, `no-vig-clv-reader`, `value-api`, `manual-odds-api`, `forecast-api`, `forecast-comparison-api`, `migration-empty`, `settlement-pipeline`) are among them. The ten files that failed on the bare run failed for environment reasons: eight need `DATABASE_URL`, `replay-boundary` needs `OPERATOR_PROXY_SIGNING_SECRET`, `calibration-full-loop` has one test that takes 5.1 to 6.1 s against a 5 s timeout. Re-run through the owned dependencies of `scripts/verify-release-integration.mjs` (own PostgreSQL and Redis): 9 of 10 passed; `calibration-full-loop` passes (4 of 4) with `--testTimeout=60000`.
- `extended-markets.spec.ts`: 15 of 15 passed, none skipped (`playwright.config.ts`).
- `methodology.spec.ts`: 2 of 2 passed under `playwright.phase06.config.ts --project=desktop-chromium`.
- Perf audit with the receipt in the session scratch directory (not in `scripts/perf/perf-receipts`; `git diff` over `scripts/perf` is empty), harness preflight passed. The extended sections are imported eagerly, not through `next/dynamic`.

Did not pass or not run:
- `scriptTransferBytes` is 5 960 160 against the 5 500 000 budget. It was already over before phase 14: the same audit on the last phase 13 commit (a throwaway detached worktree, removed) gives 5 921 263, so phase 14 adds 38 897 bytes (+0.66 percent). LCP median 16.2 s (budget 26.5 s), TBT 734 ms (950 ms) and CLS median 0 with one run at 0.057 (0.09) are within budget. Recorded in `deferred-items.md`; not fixed (pre-existing, out of scope).
- `tests/e2e/methodology.spec.ts` under `playwright.config.ts` (the command in the plan): the first test passes, the second ("contextual warnings ...") needs the phase 06 stack fixture and cannot pass there. Not a regression.
- The mobile-chromium project of `playwright.phase06.config.ts` was not run.
- No visual check by eye; no CI run (`playwright.ci.config.ts` was not needed because the live stack started locally).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The exact-score grid widened the page by 100 px at 320 px**
- **Found during:** Task 2 (overflow backstop).
- **Issue:** `.sr-only` spans in the grid cells are `position: absolute`; with no positioned ancestor the scroll region does not clip them, so cells at the right edge of the 492 px table pushed `scrollWidth` of the page to 420 (143 px at 200 percent zoom, 60 px with a long label at 360). Hiding the exact-score block restored 320.
- **Fix:** `.market-table td { position: relative; }` in the existing `.market-*` block (no new token), plus a guard in `design-tokens.test.ts`.
- **Files modified:** apps/web/app/globals.css, apps/web/components/design-tokens.test.ts
- **Commit:** 16511e6

**2. [Rule 3 - Blocking] The tolerance was not reachable from the model card**
- **Issue:** `REDERIVED_TOLERANCE` was a private constant, but the card must read it instead of repeating "1e-9".
- **Fix:** exported it as `SCORE_MATRIX_REDERIVED_TOLERANCE` (value unchanged). The file was not in the plan's list.
- **Files modified:** packages/domain/src/markets/score-matrix.ts
- **Commit:** 5c08e56

**3. [Rule 2 - Missing critical coverage] Edge-case seeds beyond the plan's three variants**
- The plan lists three forecast variants; the UI-SPEC backstops (main line at -2.5 and +2.5, zero-probability cell) need persisted lopsided matrices, so `seedCustomMatrixForecast` was added (new INSERTs only).

### Interpretation notes

- The plan's step 3 lists `pnpm test:integration` as a single gate; because some files need owned dependencies, the gate that matches the repository's own `test:integration:docker` was used for those ten files.
- `model-card.ts` carries the tail wording inside the exact-score method item, so the "tail" paragraph the plan describes is that item rather than a separate paragraph.

## Follow-ups

- **regularTime (Open Question 2):** results come from `score.fullTime`; for knockout matches the stored score can include extra time and penalties, so settlement can differ from a bookmaker's rules. Only documented (methodology page and model card); storing a regular-time score on `ResultVersion` is a separate task.
- **Perf budget decision** for `scriptTransferBytes` (see above); the whole `@bet-stats/domain` barrel ships in the largest client chunk (about 518 KB).
- **User confirmation** of the corrected tail wording is still pending (two places now: the exact-score line and the model-card method item).

## Known Stubs

None. Every rendered value on the methodology page comes from `MODEL_CARD`; the spec seeds real snapshots.

## Threat Flags

None. No new endpoints, auth paths or schema changes; the spec and seeds only INSERT test rows into a disposable database.

## Self-Check: PASSED

- Created files exist: `tests/e2e/extended-markets.spec.ts`, `14-08-SUMMARY.md`.
- Commits 5c08e56, 16511e6 and b33aed4 are ancestors of HEAD (3 commits since bf374ac).
- `git diff` over `scripts/perf` is empty; no containers of this plan remain (`bs14-08-e2e-pg` removed); the detached baseline worktree was pruned.
