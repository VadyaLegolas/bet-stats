---
phase: 06-release-experience-and-operations
plan: 02
subsystem: ui
tags: [nextjs, react, accessibility, responsive-design, playwright]
requires:
  - phase: 06-01
    provides: release data surfaces and stable forecast/scorecard contracts
provides:
  - accessible release navigation with desktop and mobile interaction contracts
  - one typed evidence projection for desktop tables and mobile conclusion-first cards
  - local loading, limited, stale, unavailable, and retrying states that retain valid content
affects: [release-ux, operations, uat, accessibility]
actuals:
  tokens: 14700
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [typed responsive projections, local data-state boundaries, focus-restoring retry]
key-files:
  created:
    - apps/web/app/globals.css
    - apps/web/components/release-navigation.tsx
    - apps/web/components/responsive-evidence.tsx
    - apps/web/components/local-data-block.tsx
    - tests/e2e/release-accessibility.spec.ts
  modified:
    - apps/web/app/layout.tsx
    - apps/web/app/scorecards/scorecard-dashboard.tsx
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
key-decisions:
  - "Render desktop tables and mobile conclusion-first cards from one typed evidence projection so semantics cannot drift by breakpoint."
  - "Keep retry state local to forecast availability, retain the last valid content, and restore focus to the retry control after a failed retry."
patterns-established:
  - "Responsive evidence: transform data once, then render breakpoint-specific semantic views."
  - "Local failure boundaries: warnings and retry state do not erase valid sibling or historical content."
requirements-completed: [UX-01]
coverage:
  - id: D1
    description: "Keyboard-accessible fixed release navigation reflows without horizontal overflow at 320px."
    requirement: UX-01
    verification:
      - kind: automated_ui
        ref: "tests/e2e/release-accessibility.spec.ts#release shell navigation and narrow reflow"
        status: pass
    human_judgment: false
  - id: D2
    description: "Dense forecast and scorecard evidence becomes readable mobile cards while preserving semantic desktop tables and exact missing-data language."
    requirement: UX-01
    verification:
      - kind: automated_ui
        ref: "tests/e2e/release-accessibility.spec.ts#responsive evidence transformations"
        status: pass
    human_judgment: false
  - id: D3
    description: "Local data failures retain valid content and expose an accessible retry flow with deterministic focus restoration."
    requirement: UX-01
    verification:
      - kind: automated_ui
        ref: "tests/e2e/release-accessibility.spec.ts#local retry retains content and restores focus"
        status: pass
    human_judgment: false
duration: 5h 6m
completed: 2026-09-20
status: complete
---

# Phase 06 Plan 02: Responsive Release Experience Summary

**Accessible release navigation, responsive evidence projections, and focus-safe local retry states across the forecast and scorecard surfaces**

## Performance

- **Duration:** 5h 6m
- **Started:** 2026-09-20T05:27:05Z
- **Completed:** 2026-09-20T10:32:48Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added skip-link and keyboard-safe desktop/mobile release navigation with narrow reflow, reduced-motion, and forced-colors support.
- Converted dense evidence into a shared typed projection rendered as semantic desktop tables and conclusion-first mobile cards.
- Added local loading, limited, stale, unavailable, and retrying boundaries that preserve exact timestamps and last valid content.
- Proved the release surface with seven Playwright scenarios, direct TypeScript checking, and a production Next.js build.

## Task Commits

1. **Task 1: Ship responsive release navigation** - `469c038` (feat)
2. **Task 2: Transform responsive evidence** - `e97ab65` (feat)
3. **Task 3: Preserve focus through local retry** - `1cf4a96` (fix)

## Files Created/Modified

- `apps/web/app/layout.tsx` - Installs the global release shell and skip target.
- `apps/web/app/globals.css` - Defines tokens, reflow behavior, focus treatment, and accessibility media queries.
- `apps/web/components/release-navigation.tsx` - Implements desktop and disclosure-based mobile navigation.
- `apps/web/components/responsive-evidence.tsx` - Projects one typed evidence model into table and card renderers.
- `apps/web/components/local-data-block.tsx` - Encapsulates local data states, retained content, retry status, and focus restoration.
- `apps/web/app/scorecards/scorecard-dashboard.tsx` - Applies responsive evidence and complete empty-bucket alternatives.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` - Applies responsive projections and a scoped availability retry boundary.
- `tests/e2e/release-accessibility.spec.ts` - Covers navigation, reflow, evidence transformations, local failure states, and retry focus.

## Decisions Made

- Desktop and mobile presentations consume one typed projection to prevent semantic or missing-data drift across breakpoints.
- A failed local retry preserves forecast identity and previously valid content; it does not reset the whole workbench.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Retained reliability context in limited/unavailable states**
- **Found during:** Task 2 (responsive evidence)
- **Issue:** Replacing the complete evidence projection with a warning would hide the required empty-bucket explanation.
- **Fix:** Added retained-content behavior so the local warning and the complete data alternative remain visible together.
- **Files modified:** `apps/web/components/local-data-block.tsx`, `apps/web/app/scorecards/scorecard-dashboard.tsx`
- **Verification:** Responsive evidence Playwright scenarios pass.
- **Committed in:** `e97ab65`

**2. [Rule 1 - Bug] Restored focus after an unsuccessful local retry**
- **Found during:** Task 3 (local data failure flow)
- **Issue:** The status announcement updated, but focus was not deterministically returned to the retry control.
- **Fix:** Added an explicit retry-button reference and restored focus after the async attempt settles.
- **Files modified:** `apps/web/components/local-data-block.tsx`, `tests/e2e/release-accessibility.spec.ts`
- **Verification:** Offline browser retry scenario passes and asserts the focused control.
- **Committed in:** `1cf4a96`

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both fixes were required for the planned accessibility and evidence-retention contract; no scope expansion.

## Issues Encountered

- Windows shell quoting made the plan's pnpm regex form unreliable, so the same checked-in Playwright configuration and spec were executed directly through the Playwright CLI. The full suite passed 7/7.
- The sandbox blocked a Next.js child process with `spawn EPERM`; the identical build completed successfully with approved process permissions.

## Known Stubs

None. “Not available” is intentional evidence vocabulary for missing values and does not stand in for an unwired data source.

## Threat Flags

None. This plan added no endpoint, authentication path, file-access boundary, or schema change.

## Verification

- `node node_modules/@playwright/test/cli.js test -c playwright.phase06.config.ts tests/e2e/release-accessibility.spec.ts` — 7 passed.
- `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` — passed.
- `pnpm --filter @bet-stats/web build` — passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UX-01 is covered by deterministic browser checks and the production web build.
- The release surfaces are ready for phase verification and the remaining operations-plan checks.

## Self-Check: PASSED

- All eight declared implementation/test files exist.
- Task commits `469c038`, `e97ab65`, and `1cf4a96` exist in git history.
- No skipped tests, unrun verification, or goal-blocking stubs remain.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-20*
