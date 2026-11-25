---
phase: 15-7-day-value-scanner
plan: 03
subsystem: value-scanner-ui
tags: [scanner, nextjs, server-components, russian-copy, fail-closed]
requires:
  - phase: 15-7-day-value-scanner
    provides: "GET /value/scanner contract (plan 15-01), ScannerItem and ScannerResponse types"
provides:
  - "formatKickoffWarsaw, formatCapturedWarsaw, formatAge pure helpers"
  - "scanner-labels.ts: all Russian scanner copy, SCANNER_HOME_CONTENT, SCANNER_METHODOLOGY_LIMITATION"
  - "parseScannerResponse: fail-closed parser locked to the real loadScanner output"
  - "readScanner: server fetch, null on any failure"
  - "ScannerView, ScannerAvailable, ScannerRow: AVAILABLE, EMPTY, POLICY-UNMET plaque, UNAVAILABLE"
  - "/scanner page: force-dynamic server page with metadata title"
affects: [15-04, 15-05, phase-16]
tech-stack:
  added: []
  patterns:
    - "Stored value strings are the only child of their dd and are never converted or formatted"
    - "Response schema typed as Record over the contract keys, so a new API field breaks the build until the parser lists it"
    - "Freshness demotion by stable filter and placement only; no sorting call in the row or view modules"
key-files:
  created:
    - apps/web/app/scanner/scanner-labels.ts
    - apps/web/app/scanner/scanner-types.ts
    - apps/web/app/scanner/scanner-data.ts
    - apps/web/app/scanner/scanner-rows.tsx
    - apps/web/app/scanner/scanner-view.tsx
    - tests/unit/scanner-ui.test.tsx
  modified:
    - apps/web/components/time-format.ts
    - apps/web/components/time-format.test.ts
    - apps/web/app/scanner/page.tsx
key-decisions:
  - "Truncation copy uses the amended wording of plan 15-02 with shown, total and limit from the payload."
  - "Fact sub-lines (unit, source, capture time) are a second dd.scanner-sub with inner span.market-sub, so every stored value stays the only child of its dd and the dl stays valid HTML."
  - "Chip row uses an inline flex style: the UI-SPEC CSS table has no class for it."
  - "Link hrefs encode fixtureId and receiptId with encodeURIComponent (identical output for ordinary ids)."
patterns-established:
  - "Scanner EMPTY count tile: dt «Проверено квитанций в окне», dd the number (not a single string with a colon)."
requirements-completed: [SCAN-01, SCAN-02, SCAN-03]
status: complete
duration: ~35 min
completed: 2026-11-25
commits: 3
plan_head_before: 7caeb33b3cd9d4e49dbf852966a46f24757463dc
plan_head_after: 1be6a27d40eebda005b881a87232300e84728abd
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
---

# Phase 15 Plan 03: Scanner page UI Summary

**The /scanner page now renders the real candidate list as a server component: verbatim stored strings, honest freshness demotion by placement and label, a stale block, and distinct EMPTY, policy-plaque and UNAVAILABLE states, all behind a fail-closed parser and with no client JavaScript.**

## What was built

- **Time helpers** (`time-format.ts`): `formatKickoffWarsaw` («сб, 28 ноября, 18:00», parts joined by hand to drop the word «в»), `formatCapturedWarsaw` («25.11.2026, 14:05»), `formatAge` (boundaries at 60 s, 3600 s, 172800 s). Explicit zone, fall back to the raw input, never throw. `formatInstant` is unchanged.
- **Copy** (`scanner-labels.ts`): every UI-SPEC string, freshness and outcome labels, interpolated how-to-read bullets (hours and version from the payload), amended truncation text, `SCANNER_HOME_CONTENT`, `SCANNER_METHODOLOGY_LIMITATION`.
- **Parser** (`scanner-types.ts`): exact top-level and item keys, strict types, state consistent with the item list; schema maps are `Record` over the domain keys.
- **Data entry** (`scanner-data.ts`): `readScanner(fetchImpl = fetch)` with no-store, `redirect: "manual"`, 10 s timeout, eligibility headers read at call time; null for throw, timeout, non-2xx (308 included), invalid JSON and unrecognised shape.
- **Rows and list** (`scanner-rows.tsx`): `ol.scanner-groups` of `li.panel.scanner-match`, consecutive-fixture grouping in API order, `li.scanner-row#receipt-{id}`, chips, facts, details, links; stale rows only in `details.scanner-stale` (open only when the main list is empty), all-stale line, truncation notice.
- **View and page** (`scanner-view.tsx`, `page.tsx`): header with exact top line, `RiskDisclosure` in every state, ordering notice and how-to-read for data states, EMPTY with count tiles and optional policy plaque, UNAVAILABLE with `role="alert"` and plain refresh link. `page.tsx` exports only `default`, `dynamic = "force-dynamic"` and `metadata`.

## Task commits

1. Task 1: `a6e1191` feat(15-03): Warsaw time helpers, scanner copy and fail-closed response parser
2. Task 2: `dec0920` feat(15-03): match groups, candidate rows, stale block and AVAILABLE section
3. Task 3: `1be6a27` feat(15-03): scanner server data entry, page shell, EMPTY, policy plaque and UNAVAILABLE states

## Verification

Ran and passed:

- `pnpm --filter @bet-stats/web exec vitest run -c vitest.config.ts components/time-format.test.ts` (26 passed)
- `pnpm exec vitest run --project unit tests/unit/scanner-ui.test.tsx` (56 passed)
- `pnpm exec vitest run --project unit tests/unit/clv-evaluation-only.test.ts tests/unit/responsible-copy.test.ts tests/unit/home-page-ui.test.tsx` (32 passed)
- `pnpm --filter @bet-stats/web lint`: exit 0 (9 pre-existing warnings, none in scanner files or time-format)
- `tsc --noEmit` in `apps/web`: clean
- Self-check regex for the UI-SPEC prohibited Russian stems over `apps/web/app/scanner`: only the approved top line («прибыли»)

Not run (out of scope for this plan or not available):

- `next build` and a live browser check of the page (no running API or database was used; the dev stack on ports 3000/3001 was not touched).
- The Russian prohibited-vocabulary suite and the `.scanner-*` CSS block: owned by plans 15-02 and 15-04. No CSS was added here.
- Playwright and axe backstops: plan 15-05.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESLint `@next/next/no-html-link-for-pages` on the «Открыть матчи» anchor**
- **Found during:** Task 3 lint run
- **Issue:** the plan requires a plain anchor to `/fixtures` (no `next/link`) and `pnpm --filter @bet-stats/web lint` exit 0; the rule flags the literal `/fixtures` href.
- **Fix:** kept the plain anchor and added a single-line `eslint-disable-next-line` for that rule with a comment stating the contract. `/fixtures/{id}` hrefs are template strings and are not flagged.
- **Files modified:** `apps/web/app/scanner/scanner-view.tsx`
- **Commit:** `1be6a27`

**2. [Plan ledger] No `gsd-plan-head-before` ledger file**
- The shared git-dir path is outside the worktree for the file tools, so the base was recorded from the known fast-forward target `7caeb33`. `commits: 3` is measured with `git rev-list --count 7caeb33..HEAD` at the time of writing.

### Notes for Plans 15-04 and 15-05 (not deviations)

- Markup contract the CSS must style: each fact group is `div > dt + dd (+ dd.scanner-sub > span.market-sub)`. The `dd.scanner-sub` wrapper keeps stored values alone in their `dd`; the inner span carries the 14px muted style.
- The chip row inside `.scanner-pick` is an unclassed `div` with an inline flex style.
- The EMPTY count tile is `dt` «Проверено квитанций в окне» plus `dd` N, so page text reads «Проверено квитанций в окне0» without styling; an e2e assertion should match the label and the number separately.
- `scanner-rows.tsx` imports `enum-labels.ts` (which imports the domain barrel at runtime) as the plan's key link requires; scanner files themselves only use `import type` from the barrel, which a test asserts.

## Known Stubs

None. `page.tsx` is no longer a tracer.

## Threat Flags

None beyond the plan's threat model. T-15-11 (escaped text, markup test), T-15-12 (`rel="noopener noreferrer"` on the target-blank link, asserted), T-15-13 (fail-closed parser, malformed-input tests), T-15-14 (fixed copy, no body logging), T-15-15 (force-dynamic plus no-store, static and stub-fetch tests), T-15-16 (no formatting of stored strings, held-out string tests) are mitigated.

## Assumption carried forward

A hash link into the closed stale `details` may not expand it in every browser; every row carries `id="receipt-{receiptId}"` and Phase 16 decides whether a server-side open rule is needed (UI-SPEC unresolved item).

## Self-Check: PASSED

- Files exist: scanner-labels.ts, scanner-types.ts, scanner-data.ts, scanner-rows.tsx, scanner-view.tsx, page.tsx, scanner-ui.test.tsx, time-format.ts and its test.
- Commits `a6e1191`, `dec0920`, `1be6a27` are ancestors of HEAD.
