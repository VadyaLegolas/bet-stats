---
phase: 06-release-experience-and-operations
plan: 03
subsystem: ui
tags: [nextjs, react, methodology, model-card, accessibility, playwright]
requires:
  - phase: 06-02
    provides: responsive analytical surfaces and persistent responsible-use disclosure
provides:
  - versioned two-layer methodology and model card bound to executable policy identities
  - stable technical deep links and newest-first material change history
  - contextual forecast, value, and scorecard limitation warnings without activity parameters
affects: [release-ux, verification, responsible-gambling, scorecards]
actuals:
  tokens: 13911
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [source-controlled model card, stable fragment-only methodology links, contextual decision warnings]
key-files:
  created:
    - packages/domain/src/methodology/model-card.ts
    - apps/web/app/methodology/page.tsx
    - apps/web/components/contextual-methodology-warning.tsx
    - tests/e2e/methodology.spec.ts
  modified:
    - packages/domain/src/index.ts
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - apps/web/app/scorecards/scorecard-dashboard.tsx
key-decisions:
  - "Bind public methodology metadata and technical claims directly to exported forecast, value, settlement, scoring, reliability, cohort, financial, CLV, and backtest constants."
  - "Use one closed contextual-warning component with fragment-only methodology links so analytical activity never enters disclosure URLs."
patterns-established:
  - "Model-card source: publish plain language and exact technical identities from one frozen domain contract."
  - "Decision-point warning: reviewed context-specific copy plus a stable /methodology#limitations link."
requirements-completed: [UX-02]
coverage:
  - id: D1
    description: "A versioned accessible model card presents the fixed plain-language hierarchy, executable policy identities, formulas, thresholds, receipts and newest-first changelog."
    requirement: UX-02
    verification:
      - kind: automated_ui
        ref: "tests/e2e/methodology.spec.ts#versioned model card presents plain-language and exact technical evidence"
        status: pass
    human_judgment: false
  - id: D2
    description: "Forecast, value and scorecard decisions repeat reviewed limitations through clean stable methodology links while persistent responsible-use copy remains present."
    requirement: UX-02
    verification:
      - kind: automated_ui
        ref: "tests/e2e/methodology.spec.ts#contextual warnings repeat exact limitations with clean stable links"
        status: pass
    human_judgment: false
duration: 4h 54m
completed: 2026-09-20
status: complete
---

# Phase 06 Plan 03: Versioned Methodology and Contextual Warnings Summary

**Frozen executable-policy model card with progressive technical disclosure and fragment-only contextual warnings across every analytical decision surface**

## Performance

- **Duration:** 4h 54m
- **Started:** 2026-09-20T10:42:02Z
- **Completed:** 2026-09-20T15:36:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Published `How forecasts work` with the required fixed section order, visible version/effective date/current config, exact formulas and thresholds, policy hashes, receipt destinations, complete limitations, and newest-first material history.
- Bound public technical claims to existing exported domain constants rather than duplicating or fabricating policy identities.
- Added exact contextual warnings beside forecast, value, and scorecard conclusions with stable fragment-only links and retained the persistent global responsible-use disclosure.
- Proved UX-02 with two production-boundary Playwright scenarios, axe analysis, all 232 unit tests, domain/web typechecks, and a production Next build.

## Task Commits

1. **Task 1 RED: model-card acceptance contract** - `5658938` (test)
2. **Task 1 GREEN: versioned methodology/model card** - `ad14643` (feat)
3. **Task 2 GREEN: contextual decision warnings** - `23b0bf1` (feat)
4. **Rule 1: policy-neutral public methodology copy** - `ab5530b` (fix)

## Files Created/Modified

- `packages/domain/src/methodology/model-card.ts` - Frozen model-card metadata, formulas, thresholds, executable policy identities, and change history.
- `packages/domain/src/index.ts` - Exposes the model-card contract to application consumers.
- `apps/web/app/methodology/page.tsx` - Accessible SSR methodology hierarchy with native technical disclosures and stable fragments.
- `apps/web/components/contextual-methodology-warning.tsx` - Closed forecast/value/scorecard warning vocabulary and clean methodology link.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` - Forecast and value decision-point limitations.
- `apps/web/app/scorecards/scorecard-dashboard.tsx` - Historical-evaluation limitation and stable formula-receipt destination.
- `tests/e2e/methodology.spec.ts` - Model-card, accessibility, executable-identity, warning-copy, and URL privacy acceptance coverage.

## Decisions Made

- Public methodology imports existing executable constants so version, thresholds and hashes cannot silently drift from production behavior.
- Contextual links always target `/methodology#limitations`; fixture IDs, selected snapshots, odds, cohort filters, subjects and correlations are never forwarded.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kept methodology copy inside the repository responsible-copy policy**
- **Found during:** Overall verification
- **Issue:** Neutral limitation sentences containing prohibited certainty and automatic-wager phrases triggered the public-copy safety gate.
- **Fix:** Rephrased the same restrictions as neutral product boundaries without weakening the complete limitation policy.
- **Files modified:** `apps/web/app/methodology/page.tsx`
- **Verification:** Full unit project passed 24 files / 232 tests.
- **Committed in:** `ab5530b`

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** The fix preserved all D-05 through D-08 disclosures and aligned public copy with an existing release safety policy; no scope expansion.

## Issues Encountered

- The Windows sandbox denied Vite/Next child-process creation with `spawn EPERM`; the same checks passed through the approved host execution channel.
- Shared `.next` and release-stack ports were serialized with Plan 06-05. One final attempt observed its transient replay-page type errors; after 06-05 completed typecheck, the unchanged 06-03 full production-boundary suite passed.

## Known Stubs

None.

## Threat Flags

None. The plan added no endpoint, authentication path, schema boundary, or file-access surface. Contextual URLs are fixed fragment-only links and contain no user activity state.

## Verification

- `node node_modules/@playwright/test/cli.js test -c playwright.phase06.config.ts tests/e2e/methodology.spec.ts` — 2 passed through real PostgreSQL, Redis, Nest and built Next boundaries.
- `node node_modules/vitest/vitest.mjs run --project unit` — 24 files, 232 tests passed.
- `node node_modules/typescript/bin/tsc -p packages/domain/tsconfig.json --noEmit` — passed.
- `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` — passed; production Next build also passed inside the Playwright setup.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UX-02 is covered by deterministic automated UI evidence and executable-identity checks.
- Release verification can deep-link to the stable methodology limitation and receipt sections.

## Self-Check: PASSED

- All seven declared implementation/test files exist.
- Commits `5658938`, `ad14643`, `23b0bf1`, and `ab5530b` exist in git history.
- No skipped tests, unrun verification, goal-blocking stubs, or activity-bearing methodology URLs remain.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-20*
