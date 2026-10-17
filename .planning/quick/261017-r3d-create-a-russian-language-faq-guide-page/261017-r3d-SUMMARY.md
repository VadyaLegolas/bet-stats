---
phase: quick-261017-r3d
plan: 1
subsystem: web
tags: [faq, onboarding, screenshots, playwright, static-page, russian-ui, nextjs, responsible-gambling, navigation]

# Dependency graph
requires:
  - phase: fast-261017b
    provides: Double-click «Ставки — запуск» launcher (scripts/start-app.bat + app-lifecycle.ps1) that FAQ step 1 documents
  - phase: quick-261017-pyp
    provides: Manual «Загрузить результаты» button and manual-only results publication that FAQ step 6 / FAQ answer 2 describe
  - phase: fast-261017c
    provides: INITIAL-issued-at-14-day-horizon behavior and empty-workbench INITIAL/PRE_MATCH explanation that FAQ step 4 documents
provides:
  - "New route /faq — Russian step-by-step usage guide (8 numbered steps, 5 real screenshots, FAQ question-answer block, links to /fixtures, /scorecards, /methodology, persistent responsible-gambling disclosure before and after the content)"
  - "Reusable scripts/capture-faq-screenshots.mjs — ASCII-console Playwright capture of the 5 guide PNGs from the live stack with IHDR dimension reporting and a hard >=10 KB per-file gate"
  - "5 committed guide screenshots in apps/web/public/images/faq/{home,fixtures,workbench,odds,scorecards}.png"
  - "FAQ reachable from the release navigation (DESTINATIONS) and from the home CONTENTS ledger"
affects: [web, navigation, documentation, screenshots, verification]

# Actuals (#2632) — chars/4 over the realized text diff (git show 6ff6756 text patch = 25,754 chars; binary PNGs excluded from the patch).
actuals:
  tokens: 6438
  tasks: 3
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plain <img> with intrinsic width/height read from the PNG IHDR plus maxWidth/maxHeight CSS (max-width:100%; height:auto) — the codebase precedent (app/internal/reconciliation/page.tsx); no next/image introduced"
    - "Playwright via @playwright/test (the playwright package is not installed): launch -> viewport 1600x1000 -> goto(load) -> waitForTimeout(4000) -> content marker -> remove nextjs-portal dev overlay -> screenshot, all console output ASCII-only"
    - "Screenshot dimensions parsed from PNG IHDR bytes 16/24 so the page can be authored against real pixel sizes (no layout shift)"

key-files:
  created:
    - scripts/capture-faq-screenshots.mjs
    - apps/web/app/faq/page.tsx
    - apps/web/public/images/faq/home.png
    - apps/web/public/images/faq/fixtures.png
    - apps/web/public/images/faq/workbench.png
    - apps/web/public/images/faq/odds.png
    - apps/web/public/images/faq/scorecards.png
  modified:
    - apps/web/components/release-navigation.tsx
    - apps/web/app/page.tsx

key-decisions:
  - "Capture first, author second (plan's ordering rationale): the FAQ page references PNG paths and intrinsic dimensions that already passed the >=10 KB gate, so nothing on the page points at a missing or undersized artifact."
  - "One data-driven Screenshot component (SCREENSHOTS: ShotId -> {src,width,height,alt}) instead of five inline <img> blocks: exactly one <img> element in source, so exactly one scoped eslint-disable with justification, and each image's intrinsic size stays co-located with its alt text."
  - "odds.png captures the tight section (section:has(> h3#odds-heading), 928x558) rather than the whole 3008px workbench column: the first run's wide element screenshot had the sticky header stitched over the 1X2 table, so the script now neutralizes header/nav to position:static before the element shot."
  - "No test for /faq (per plan Task 3, step 2): the two existing web test files are a pure-util test and a route test, there is no component-render/test-library pattern in apps/web, and a zero-logic static server page has no meaningful assertion under either pattern — a brittle HTML-string test would be fabricated coverage, so none was written."

patterns-established:
  - "Repeatable screenshot-capture script pattern for doc pages: reusable node scripts/capture-*.mjs with an env-overridable base URL/fixture id, content-marker waits, ASCII-only logs and a hard file-size exit gate."

requirements-completed: []

# Metrics
duration: "~16m (2026-10-17T19:35Z-19:51Z local +02:00)"
completed: 2026-10-17
status: complete
---

# Phase quick-261017-r3d: Russian FAQ Guide Page with Real Screenshots Summary

**`/faq` now explains the whole product in Russian — launch, sections, fixtures sync, forecast snapshots, manual odds entry, scorecards, evidence and provider quotas — illustrated with five real screenshots of the live stack captured by a reusable script, linked from the nav and the home ledger, in one atomic commit `6ff6756`**

## Performance

- **Started:** 2026-10-17T19:35Z (+02:00)
- **Completed:** 2026-10-17T19:51Z (+02:00)
- **Tasks:** 3
- **Files changed:** 9 committed (+363 text lines / 363 insertions, 0 deletions, 5 binary PNGs), plus untracked `.planning/**` never staged

## Accomplishments

- **Task 1 (capture):** created `scripts/capture-faq-screenshots.mjs` (ESM, `node scripts/capture-faq-screenshots.mjs` from repo root) using `import { chromium } from "@playwright/test"` with the orchestrator's proven recipe per shot (`launch()` -> `newPage({viewport:{width:1600,height:1000}})` -> `goto(url,{waitUntil:"load",timeout:60000})` -> `waitForTimeout(4000)` -> content marker -> `page.evaluate(() => document.querySelector("nextjs-portal")?.remove())` -> `screenshot`). Console output is strictly ASCII (paths, byte sizes, `WxH`); PNG dimensions are parsed from IHDR bytes 16/20 for Task 2; the script exits non-zero if any of the 5 PNGs is missing or < 10 KB. Shots: `home.png` = `/`, `fixtures.png` = `/fixtures`, `workbench.png` = `/fixtures/e1ef6104-9515-41bb-9bbc-8412a8c4fb24` (`fullPage: true`), `odds.png` = the odds form section of the same fixture, `scorecards.png` = `/scorecards`. Ran three times (first pass produced a wide odds shot whose stitched sticky header overlapped the 1X2 table, so the selector was tightened to `section:has(> h3#odds-heading)` and `header, nav` forced to `position:static` before the element shot; final run = the committed bytes). `fixtures.png` and `workbench.png` visually spot-checked by reading the PNGs: date/league filters, «Обновить матчи», «Загрузить результаты», the 38/100 quota badge, INITIAL + PRE_MATCH snapshots and the probability tables are all visible and there is no dev overlay.
- **Task 2 (page + navigation):** new `apps/web/app/faq/page.tsx` (server component, all UI text Russian): H1 «FAQ: как пользоваться сайтом», intro, `<RiskDisclosure />` (persistent money-loss warning) immediately after the intro and again at the end, then an ordered list of 8 steps — (1) «Ставки — запуск» + `localhost:3000`, (2) home sections `home.png`, (3) fixtures filters/sync buttons/quota badge and why updates are manual `fixtures.png`, (4) INITIAL at the 14-day horizon / PRE_MATCH at kickoff-6h / immutable snapshots / how to read the probability and fair-odds columns `workbench.png`, (5) manual decimal odds book, EV/edge comparison and the value rule (positive EV **and** transparent probabilities; an estimate, not a profit promise) `odds.png`, (6) scorecards reliability/calibration and why «Загрузить результаты» must be pressed after each round `scorecards.png`, (7) evidence — why a snapshot is checkable, with links to `/methodology`, `/scorecards`, `/fixtures#match-analysis` (no screenshot, per plan), (8) provider quotas and free-tier limits (Europa League restricted). Then a «Частые вопросы» `<dl>` with the five required answers (no forecast yet / no results / Europa League / why manual / are there guarantees — **no**), and the `/fixtures` `/scorecards` `/methodology` link row. Images use the codebase's plain `<img>` precedent with intrinsic `width`/`height` from the capture run plus `max-width:100%; height:auto`, Russian alt text, and one scoped `eslint-disable-next-line @next/next/no-img-element` with justification (no `next/image`). `release-navigation.tsx` gained `{ label: "FAQ", href: "/faq", current: p => p.startsWith("/faq") }`; `app/page.tsx` CONTENTS gained the planned FAQ entry. Verified live: `curl http://127.0.0.1:3000/faq` -> 200 with «FAQ: как пользоваться сайтом», exactly 5 `<img>` tags and all five PNG names; `/fixtures` HTML contains `href="/faq"`; `/` CONTENTS contains `href="/faq"`; `GET /images/faq/home.png` -> 200, 100,789 bytes.
- **Task 3 (gates + commit):** all four gates run and green (numbers below), then exactly one atomic commit staging only the 9 planned paths; `.gsd/dispatch-isolation-sentinel.json` and `.planning/**` never staged; zero tracked-file deletions.

## Gate Results (all run before the commit)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Capture | `node scripts/capture-faq-screenshots.mjs` | **exit 0** — 5/5 PNGs present and >= 10 KB: `home.png` 100,789 B 1600x1000, `fixtures.png` 112,345 B 1600x1000, `workbench.png` 348,367 B 1600x4123, `odds.png` 29,935 B 928x558, `scorecards.png` 84,830 B 1600x1000 (odds form outcome: **filled**) |
| Tests | `pnpm test` (root) | **exit 0** — unit project **298/298 across 35 files**, web project **13/13 across 2 files** |
| Typecheck | `pnpm --filter @bet-stats/web typecheck` | **exit 0** (re-run after the final capture, still 0) |
| Build | `pnpm --filter @bet-stats/web build` | **exit 0** — Next.js 16.3.3 Turbopack, compiled in 6.4s, 15/15 static pages, `/faq` listed as `○ (Static) prerendered as static content` |

## Capture Details

- **Fixture used:** the fixed target `/fixtures/e1ef6104-9515-41bb-9bbc-8412a8c4fb24` (Bologna FC 1909 vs FC Internazionale Milano) resolved 200 with both INITIAL (rev 1, 2026-10-16T16:00:16.447Z) and PRE_MATCH (rev 1, 2026-10-17T10:00:00.000Z) snapshots — **no substitution was needed**.
- **Odds fill outcome:** **filled, never submitted** — `#source-label` = «Букмекер (пример)», `#odds-HOME` = 2.10, `#odds-DRAW` = 3.40, `#odds-AWAY` = 3.20 on the default 1X2 market, then the section screenshot; the save button «Сохранить полную неизменяемую книгу коэффициентов» was never clicked, so **no odds observation was created** (verified: the script contains no click/press call at all).
- **Dev overlay:** `nextjs-portal` removed before every screenshot; every committed PNG is overlay-free (visually confirmed on `fixtures.png`, `workbench.png`, `odds.png`).
- **Stack:** untouched — no start/restart/stop; only `GET` requests and browser navigation against the running `127.0.0.1:3000`.

## Task Commits

Single atomic commit (per plan):

1. **Task 1: Capture script + 5 PNGs** — `6ff6756`
2. **Task 2: FAQ page + nav/home entries** — `6ff6756`
3. **Task 3: Gates + one atomic commit** — `6ff6756`

**Commit:** `6ff6756` `feat(web): add Russian FAQ guide page with captured site screenshots` — exactly 9 files: `scripts/capture-faq-screenshots.mjs` (new, +120), `apps/web/app/faq/page.tsx` (new, +241), `apps/web/app/page.tsx` (+1), `apps/web/components/release-navigation.tsx` (+1), 5 new PNGs (binary); zero tracked-file deletions (`git diff --diff-filter=D HEAD~1 HEAD` empty).

## Files Created/Modified

- `scripts/capture-faq-screenshots.mjs` - New reusable ESM capture script (base URL and fixture id overridable via `FAQ_CAPTURE_BASE` / `FAQ_CAPTURE_FIXTURE`), content-marker waits with ASCII-only fallback logging, dev-overlay removal, IHDR dimension reporting, 10 KB exit gate.
- `apps/web/app/faq/page.tsx` - New server component; panel/figure styles reuse the methodology page's `var(--color-*)` inline-style idiom; `<RiskDisclosure />` from `components/risk-disclosure.tsx`.
- `apps/web/components/release-navigation.tsx` - FAQ destination appended to `DESTINATIONS` in the exact existing `{label, href, current}` shape.
- `apps/web/app/page.tsx` - FAQ row appended to `CONTENTS` in the exact `{label, href, detail}` shape.
- `apps/web/public/images/faq/{home,fixtures,workbench,odds,scorecards}.png` - The five captured screenshots (first public/ directory in the app).

## Decisions Made

- Screenshot-first ordering (plan's rationale) held: the page was written against already-validated artifacts with real intrinsic pixel sizes, so no `width`/`height` value on the page is a guess.
- Guide text states only verifiable behavior (manual sync buttons, snapshot timing, immutable revisions, free-tier UEL restriction) and never promises accuracy or profit; the responsible-gambling disclosure renders top and bottom, and the FAQ «Есть ли гарантии?» answer is an explicit «Нет».
- Quota numbers and cohort Brier values are deliberately NOT hardcoded in the prose (the badge and the cohort change at runtime); the text describes what they mean instead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] First `odds.png` had the sticky header stitched over the 1X2 table**
- **Found during:** Task 1 (visual spot-check of the first capture run)
- **Issue:** The element screenshot captured the whole 3008px-tall outer section (the `section` locator matched ancestor sections, and Playwright's stitched element shot placed the sticky header/quota badge mid-image, covering the «Ничья»/«Гости» rows).
- **Fix:** Selector tightened to `section:has(> h3#odds-heading)` (the actual form section) and `header, nav { position: static !important; }` injected before the element shot; re-ran the script -> clean 928x558 form shot with all three filled inputs and the save button visible.
- **Files modified:** scripts/capture-faq-screenshots.mjs
- **Verification:** re-run exit 0, PNG read back and inspected.

**2. [Rule 3 - Blocking] `pnpm build` rewrote `apps/web/next-env.d.ts` (dev -> prod type paths), dirtying an unrelated tracked file**
- **Found during:** Task 3 (post-build `git status`)
- **Issue:** The required build gate regenerates `next-env.d.ts` to `./.next/types/...` while the committed (dev-server) form points at `./.next/dev/types/...`; leaving it would have put a 10th, unplanned file in the tree.
- **Fix:** Targeted `git checkout -- apps/web/next-env.d.ts` after the final build (both `apps/web/.next/dev/types/routes.d.ts` and `.next/types/routes.d.ts` exist, so the restored file resolves), then re-ran the typecheck gate -> exit 0. Only the 9 planned paths were staged.
- **Files modified:** apps/web/next-env.d.ts (restored to HEAD, not committed)
- **Verification:** `git status --porcelain` shows only the sentinel, the 9 committed paths and untracked `.planning/`.

---

**Total deviations:** 2 (1 screenshot-quality fix inside the planned script, 1 build side-effect cleanup; zero production-behavior deviation)
**Impact on plan:** all three tasks delivered exactly the planned files; gates green; one atomic commit.

## Issues Encountered

- **PowerShell `$HOME` collision:** a verification snippet used `$home` as a variable name (read-only automatic variable) and errored; re-ran with `$homeHtml`. No repo impact.
- **Node engine warning** (`wanted >=24 <25, current v25.2.1`) on every pnpm invocation — pre-existing, repository-wide, non-blocking, out of scope.
- **`next build` runs against a live `next dev`** (mandated gate): verified afterwards that `/faq` and `/fixtures` still return 200 on `127.0.0.1:3000` and that the PNG route serves 200 — the stack was never restarted.

## Known Stubs

None — no hardcoded empty values, placeholder copy, `TODO`/`FIXME` markers, or components with unwired data. The five screenshots are real captures of the running stack (not mock images).

## Threat Flags

None — no new network endpoints, auth paths, file-access patterns or schema changes: `/faq` is a static server-rendered page that reads only bundled `public/images/faq/*.png`, and the capture script only issues `GET` navigations (its odds interaction is fill-only, never submitted).

## User Setup Required

None — the FAQ is live at `http://127.0.0.1:3000/faq` on the already-running stack.

## Next Phase Readiness

- FAQ copy will drift if snapshot timing, sync buttons or quota semantics change — the page's prose is the single place to update (`apps/web/app/faq/page.tsx`); re-capture screenshots with `node scripts/capture-faq-screenshots.mjs` whenever the UI changes materially.
- Untouched and unstaged: `.gsd/dispatch-isolation-sentinel.json`, `.planning/**` (including this SUMMARY), ROADMAP.md, `apps/web/next-env.d.ts` (restored to HEAD).

---
*Phase: quick-261017-r3d*
*Completed: 2026-10-17*

## Self-Check: PASSED

- Commit `6ff6756` found in `git log`; `git show --stat HEAD` lists exactly the 9 planned files, `git diff --diff-filter=D HEAD~1 HEAD` empty (no deletions); `.gsd/**` and `.planning/**` absent from the commit.
- All created files exist on disk: `scripts/capture-faq-screenshots.mjs`, `apps/web/app/faq/page.tsx`, and the five `apps/web/public/images/faq/*.png` (byte sizes re-read from the commit stat: 100,789 / 112,345 / 348,367 / 29,935 / 84,830 — all >= 10 KB).
- Gates re-verified this session: capture exit 0, `pnpm test` 298/298 + 13/13 exit 0, web typecheck exit 0, web build exit 0 with `/faq` prerendered.
- Frontmatter carries `status: complete`.
