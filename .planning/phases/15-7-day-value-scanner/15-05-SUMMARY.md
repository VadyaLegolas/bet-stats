---
phase: 15-7-day-value-scanner
plan: 05
subsystem: value-scanner-e2e-and-gate
tags: [scanner, playwright, e2e, accessibility, responsive, release-gate]
requires:
  - phase: 15-7-day-value-scanner
    provides: "seed helpers (15-01), scanner page (15-03), navigation, CSS and guards (15-04)"
provides:
  - "tests/e2e/scanner-stub-api.mjs and playwright.scanner.config.ts: deterministic states of GET /value/scanner"
  - "tests/e2e/value-scanner.spec.ts: 31 browser cases (states, visual matrix, axe, navigation, keyboard, zoom, no ranking, inert text)"
  - "tests/e2e/value-scanner-live.spec.ts: database, API JSON, rendered row and receipt JSON agree on the stored strings"
  - "root script verify:scanner, appended to verify:release"
  - "deferred-items.md of phase 15"
affects: [phase-16]
tech-stack:
  added: []
  patterns:
    - "Server-fetched pages are driven by a local stub API behind an isolated next dev (own port, own dist directory)"
    - "Mid-word label breaks are detected per word with Range client rects, not by element width alone"
    - "Text zoom is checked twice: root font size 200% and every computed font size doubled (scanner sizes are in px)"
key-files:
  created:
    - playwright.scanner.config.ts
    - tests/e2e/scanner-stub-api.mjs
    - tests/e2e/value-scanner.spec.ts
    - tests/e2e/value-scanner-live.spec.ts
    - .planning/phases/15-7-day-value-scanner/deferred-items.md
  modified:
    - .gitignore
    - package.json
    - apps/web/app/globals.css
    - apps/web/app/scanner/scanner-view.tsx
    - apps/web/components/release-navigation.tsx
    - apps/web/eslint.config.mjs
    - tests/unit/scanner-guards.test.ts
    - tests/e2e/release-accessibility.spec.ts
key-decisions:
  - "U-09 applied: the navigation label is «Сканер»; the h1, page title and home card stay «Сканер value»."
  - "U-09 alone left the seven entries wider than 768 px, so nav link side padding is --space-2 between 768 and 1023 px."
  - "The stub spec checks SCANNER_STUB_ORIGIN in beforeEach, not at module load, so a run under another config fails only these cases and does not break collection of other specs."
  - "The 44 px assertion covers row links, disclosure summaries, button links and the empty-state link; the match heading link is recorded as a deferred item."
requirements-completed: [SCAN-01, SCAN-02, SCAN-03]
status: complete
duration: "~50 min"
completed: 2026-11-28
commits: 3
plan_head_before: b8eae11d7b305f7393d475a453779679f5671aed
plan_head_after: f3d2f0f9db68417796c1957f7d3084dec99a2c10
actuals:
  tokens: 14717
  tasks: 3
  commits: 3
---

# Phase 15 Plan 05: Scanner end-to-end evidence and release gate Summary

**Every state of /scanner is now proven in a browser against a stub API, the stored edge and expected-value strings are shown to be identical in PostgreSQL, the API JSON, the rendered row and the receipt JSON, and the browser matrix found and fixed three layout defects. Two phase gate items are not green: one release accessibility case fails on the match page (it reproduces without these changes) and the informational script-transfer bound is exceeded by 380 bytes.**

## What was built

- **Stub and config (Task 1):** `scanner-stub-api.mjs` (127.0.0.1 only, synthetic data) with the planned scenarios plus two edge-descending and edge-ascending variants; `playwright.scanner.config.ts` starts it and an isolated `next dev` on port 3252 with dist directory `.next-scanner`.
- **Browser matrix (Task 1):** 320, 375, 768 and 1440 px in light, dark and forced colors; axe (WCAG 2.2 AA tags) on AVAILABLE, EMPTY with the plaque, UNAVAILABLE and all-stale in both themes at 320 and 1440 px, closed and expanded; navigation at 768, 900 and 1023 px; every EMPTY variant, UNAVAILABLE, invalid shape, truncation, stale block by keyboard, tab order, 200% text zoom, no ranking controls, script-like source label as inert text.
- **Live proof (Task 2):** run-unique insert-only seeding; fresh and stale rows, absent NO_VALUE receipt, equality of database columns, API JSON, row text and receipt JSON; no ranking controls; no axe violation in the light theme.
- **Gate wiring (Task 3):** `verify:scanner` and its place at the end of `verify:release`; `deferred-items.md` with the nine planned entries and the observations of this plan.

## Task commits

1. Task 1: `2e47223` test(15-05): stub-driven scanner e2e matrix with overflow, navigation and target fixes
2. Task 2: `c30ec3a` test(15-05): live scanner proof of stored strings on the real stack
3. Task 3: `f3d2f0f` chore(15-05): wire verify:scanner into the release gate and record deferred items

## Phase gate results

| Command | Result |
|---------|--------|
| `pnpm test` | passed: unit 1649 passed, 2 skipped (1 file skipped); web 304 passed |
| `pnpm lint` | passed: 7 of 7 tasks, 0 errors, 9 warnings in the web package |
| `pnpm typecheck` | passed: 7 of 7 tasks (no generated-file cleanup needed) |
| `pnpm build` | passed: 7 of 7 tasks, `/scanner` is dynamic |
| `pnpm test:integration:docker` | first run **failed**: 800 passed, 1 failed (`replay-crash-recovery`, «claim barrier timeout») because `workers/data-sync/dist` did not exist in the fresh worktree. After building the worker that file and `scanner-api.test.ts` were rerun on owned containers: 19 passed. The whole suite was not rerun |
| `playwright -c playwright.phase06.config.ts release-accessibility.spec.ts` | **failed**: 18 passed, 2 failed (200% text zoom on `/fixtures/{id}`, 22 px overflow of the chip «Главная линия»); the navigation case passed in both projects |
| `pnpm verify:scanner` | passed: 31 of 31 |
| live spec, `playwright.config.ts`, disposable PostgreSQL | passed: 3 of 3 |
| `node scripts/perf-audit.mjs --record` | ran; **scriptTransferBytes 5 960 540, 380 above the bound 5 960 160**; LCP, TBT, CLS within budget |
| diff constraints | `package.json` changes only `scripts`; no change to `pnpm-lock.yaml` or `packages/database/prisma` since the phase start |
| human check (320 px in both themes against 15-UI-SPEC.md, confirmation of the Amendments) | **not performed**: needs the user |

The live spec used a disposable `postgres:18-alpine` container on a random port, migrated with `prisma migrate deploy` and removed afterwards. The development database was not touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A long unbroken team name stretched the page**
- **Found during:** Task 1 (visual matrix: 401 px excess at 320 px, 346 px at 375 px)
- **Issue:** the implicit grid column of `.scanner-match-head` grew to the min-content width of the word.
- **Fix:** `grid-template-columns: minmax(0, 1fr)` on that block.
- **Files modified:** `apps/web/app/globals.css`
- **Commit:** `2e47223`

**2. [Pre-recorded fallback U-09, then Rule 1] Navigation wrapped at 768 px**
- **Found during:** Task 1 («Операции» on a second row)
- **Fix:** nav label shortened to «Сканер» in `release-navigation.tsx`, `scanner-guards.test.ts` and `release-accessibility.spec.ts`. The row still needed about 752 of 704 px, so a `768px–1023px` rule narrows the link side padding to `--space-2`. This second step is beyond the plan and the UI-SPEC and is open for the owner's decision.
- **Files modified:** `apps/web/components/release-navigation.tsx`, `apps/web/app/globals.css`, the two test files
- **Commit:** `2e47223`

**3. [Rule 1 - Bug] «Открыть матчи» was 20 px high**
- **Found during:** Task 1 (assertion added and seen failing)
- **Fix:** the paragraph uses the existing `.scanner-links` class (44 px target). The UI-SPEC requires 44 px for standalone links.
- **Files modified:** `apps/web/app/scanner/scanner-view.tsx`
- **Commit:** `2e47223`

**4. [Rule 3 - Blocking] ESLint would lint the new dist directory**
- **Fix:** `.next-scanner/**` added to the ignores of `apps/web/eslint.config.mjs` (a file outside the plan list).
- **Commit:** `2e47223`

**5. [Plan ledger] No `gsd-plan-head-before` file:** the base is the known fast-forward target `b8eae11`; `commits: 3` is measured with `git rev-list --count b8eae11..HEAD`. `.planning/WINDOWS.md` was not appended to.

## Deferred Issues

- The release accessibility zoom failure on the match page: the same overflow reproduces with the web sources of `b8eae11` and `41b83d0`; not fixed (outside this phase). It stops `pnpm verify:release` before `verify:scanner` is reached.
- The script-transfer bound: without the two changed client files the audit gives 5 960 465; the scanner domain module is present in the barrel client chunk. See item 4 of `deferred-items.md`.
- Items 1 to 15 of `deferred-items.md`.

## Known Stubs

None. The e2e stub is test infrastructure with synthetic data.

## Threat Flags

None beyond the plan's threat model: T-15-21 (insert-only, run-unique ids, `DATABASE_URL` required), T-15-22 (script-like label asserted inert), T-15-23 (stub bound to 127.0.0.1, synthetic values), T-15-24 (distinct headings, chips and alert asserted); no package installs.

## Self-Check: PASSED

- Files exist: playwright.scanner.config.ts, scanner-stub-api.mjs, value-scanner.spec.ts, value-scanner-live.spec.ts, deferred-items.md.
- Commits `2e47223`, `c30ec3a`, `f3d2f0f` are ancestors of HEAD.
- The self-check covers existence and history only; the failed gate items above remain failed.
