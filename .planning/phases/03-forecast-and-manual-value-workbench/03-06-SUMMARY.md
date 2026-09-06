---
phase: 03-forecast-and-manual-value-workbench
plan: 06
subsystem: ui
tags: [nextjs, react, accessible-forms, manual-odds, immutable-receipts, playwright]
requires:
  - phase: 03-forecast-and-manual-value-workbench
    provides: protected forecast, manual-odds, and exact-pair value APIs
provides:
  - Private no-store same-origin proxies with strict request and response-header allowlists
  - Accessible frozen-forecast and complete-book manual odds workbench
  - Canonical on-screen, clipboard, and download receipt presentation
affects: [03-07, 04-evaluation, forecast-ui, value-workbench]
actuals:
  tokens: 11480
  tasks: 3
  commits: 7
tech-stack:
  added: []
  patterns: [server-only eligibility forwarding, explicit immutable snapshot selectors, versioned browser-local drafts, API-owned receipt rendering]
key-files:
  created: [apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx, apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/route.ts, apps/web/app/internal-api/fixtures/[fixtureId]/odds/route.ts, apps/web/app/internal-api/fixtures/[fixtureId]/value/route.ts, apps/web/app/internal-api/value/[receiptId]/route.ts, tests/e2e/forecast-workbench.spec.ts]
  modified: [apps/web/app/fixtures/[fixtureId]/page.tsx, packages/domain/src/index.ts, tests/unit/responsible-copy.test.ts, vitest.config.ts]
key-decisions:
  - "Forward eligibility facts from server-only environment configuration while exposing only allowlisted content and download headers to the browser."
  - "Keep incomplete odds books in a versioned fixture-and-market local draft and enable comparison only after an immutable snapshot response."
patterns-established:
  - "Protected web proxies preserve upstream status/body while pinning private no-store and rebuilding a minimal response-header set."
  - "The workbench treats server forecast, odds, and value payloads as authoritative and performs display rounding only."
requirements-completed: [PRED-01, PRED-02, PRED-03, PRED-05, PRED-06, ODDS-01, ODDS-02, ODDS-03, VALUE-01, VALUE-02, VALUE-03, VALUE-04]
coverage:
  - id: D1
    description: "Protected proxy routes strictly forward forecast, odds, value, and receipt traffic without credential leakage or shared caching."
    requirement: PRED-05
    verification:
      - kind: unit
        ref: "tests/unit/internal-api-route.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The workbench preserves explicit snapshot choices, validates complete odds books, and safely restores local partial drafts."
    requirement: ODDS-02
    verification:
      - kind: unit
        ref: "tests/unit/odds-draft-ui.test.tsx"
        status: pass
      - kind: e2e
        ref: "tests/e2e/forecast-workbench.spec.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Three-state results and exact immutable receipts remain accessible and free of prescriptive wagering language."
    requirement: VALUE-04
    verification:
      - kind: unit
        ref: "tests/unit/responsible-copy.test.ts"
        status: pass
    human_judgment: false
duration: 25min
completed: 2026-09-06
status: complete
---

# Phase 3 Plan 6: Forecast and Manual Value Workbench Summary

**A no-store Next.js workbench now pairs explicit immutable forecast and manual-odds snapshots, explains three-state value outcomes, and exposes the exact server receipt without wagering cues.**

## Performance

- **Duration:** 25 min active execution
- **Started:** 2026-09-06T03:06:47Z
- **Completed:** 2026-09-06T07:28:14Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added narrow same-origin route handlers that allowlist methods, query/body fields, content types, and fixed receipt filenames while retaining server-only eligibility facts.
- Built responsive, keyboard-accessible forecast, confidence, evidence, odds-entry, snapshot-selection, comparison, and three-state outcome surfaces.
- Reused the versioned draft codec for local incomplete books and the exact API response for readable, copied, and downloaded receipts.

## Task Commits

1. **Task 1 RED: Protected proxy contract** - `2ee27db` (test)
2. **Task 1 GREEN: Safe forecast/odds/value proxies** - `1b0aec8` (feat)
3. **Task 2 RED: Odds workbench behavior** - `bf850f2` (test)
4. **Task 2 GREEN: Three-state manual value workbench** - `7d22722` (feat)
5. **Task 3 RED: Receipt and responsible-copy gate** - `7fe1d0a` (test)
6. **Task 3 GREEN: Exact receipt presentation** - `3527e6f` (feat)
7. **Browser gate: Responsive insufficient-evidence path** - `aa8faaf` (test)

## Files Created/Modified

- `apps/web/app/internal-api/fixtures/[fixtureId]/*` and `apps/web/app/internal-api/value/[receiptId]/route.ts` - strict protected-resource proxies.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` - focused client interaction for drafts, immutable submissions, exact comparisons, and receipts.
- `apps/web/app/fixtures/[fixtureId]/page.tsx` - no-store fixture and forecast integration with safe return navigation and persistent disclosure.
- `tests/unit/internal-api-route.test.ts` - forwarding, transparency, cache, credential, and download-header coverage.
- `tests/unit/odds-draft-ui.test.tsx` - complete-book, draft-key, payload, and stable-selection behavior.
- `tests/unit/responsible-copy.test.ts` - receipt-source and expanded prohibited-language scans.
- `tests/e2e/forecast-workbench.spec.ts` - browser fallback, disclosure, and responsive reflow coverage.

## Decisions Made

- Eligibility facts are read from server-only environment variables and rebuilt as upstream headers; incoming browser headers are never trusted or echoed.
- Explicit selected IDs remain stable as arrays grow, and incomplete draft state never creates or selects an odds snapshot.
- Receipt JSON is serialized once from the API result for display and clipboard use; download delegates to the API-backed safe route.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Enabled TSX unit discovery**
- **Found during:** Task 2 RED
- **Issue:** The prescribed `.test.tsx` file was excluded by the unit-project include pattern.
- **Fix:** Extended the existing Vitest unit include to `tests/unit/**/*.test.{ts,tsx}`.
- **Files modified:** `vitest.config.ts`
- **Verification:** The TSX suite ran and passed all four tests.
- **Committed in:** `bf850f2`

**2. [Rule 3 - Blocking] Exposed the existing browser draft codec**
- **Found during:** Task 2 GREEN
- **Issue:** The workbench could not consume the already-implemented draft codec through the domain package barrel.
- **Fix:** Exported `odds/draft` from `@bet-stats/domain`.
- **Files modified:** `packages/domain/src/index.ts`
- **Verification:** Domain and web typechecks plus draft UI tests passed.
- **Committed in:** `7d22722`

---

**Total deviations:** 2 auto-fixed (2 blocking issues)
**Impact on plan:** Both changes connected existing test and domain infrastructure without adding product scope or dependencies.

## Issues Encountered

- Playwright required the existing disposable Phase 3 PostgreSQL URL because the current API constructs Prisma-backed services at startup.
- The retained `p3-fixture` forecast receipt uses a legacy shape rejected by the strict current parser; this pre-existing test-data issue is recorded in `deferred-items.md`, and browser coverage uses the valid forecast-free odds fixture.
- The local runtime is Node 25.2.1 while the repository declares Node 24 LTS; this emitted engine warnings only.

## Known Stubs

None.

## Threat Flags

None. Credential forwarding, user-controlled request fields, snapshot spoofing, client-side calculation, and receipt download boundaries are covered by the plan threat register.

## User Setup Required

None - no external service configuration required.

## Verification

- Unit suites: 3 files, 18 tests passed.
- Web and domain TypeScript typechecks passed.
- Playwright workbench gate: 2 Chromium tests passed against the disposable Phase 3 database.
- Stub/copy scan found no TODO, FIXME, placeholder, or coming-soon markers in changed surfaces.

## Next Phase Readiness

- Phase 03-07 can run cross-surface verification against explicit snapshot and receipt identities.
- Regenerate legacy retained forecast test rows before relying on them for issued-forecast browser fixtures.

## Self-Check: PASSED

- All twelve implementation/test files exist.
- Commits `2ee27db`, `1b0aec8`, `bf850f2`, `7d22722`, `7fe1d0a`, `3527e6f`, and `aa8faaf` exist in repository history.

---
*Phase: 03-forecast-and-manual-value-workbench*
*Completed: 2026-09-06*
