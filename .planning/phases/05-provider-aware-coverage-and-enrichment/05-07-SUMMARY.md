---
phase: 05-provider-aware-coverage-and-enrichment
plan: 07
subsystem: web
tags: [react, accessibility, immutable-comparison, playwright, url-state]
requires:
  - phase: 05-06
    provides: server-authoritative exact forecast comparison DTO and availability reasons
provides:
  - URL-stable left/right immutable snapshot selectors with explicit swap
  - Change-first semantic delta and exact receipt presentation
  - Documented zero/one snapshot, absent-lineup and risk states
affects: [forecast-workbench, acceptance-tests]
actuals: {tokens: 6221, tasks: 2, commits: 4}
tech-stack:
  added: []
  patterns: [initialize URL pair once, server-authoritative deltas, focus after explicit compare, progressive receipt disclosure]
key-files:
  created: [tests/unit/forecast-comparison-ui.test.tsx, tests/e2e/forecast-comparison.spec.ts, apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/compare/route.ts]
  modified: [apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx, playwright.config.ts]
key-decisions:
  - "Phase 05: Discovery initializes a comparison pair only when URL IDs are absent; refresh never substitutes either selected immutable ID."
  - "Phase 05: The web renders semantic deltas only from the server comparison DTO and verifies echoed left/right IDs before display."
requirements-completed: [PROV-06]
coverage:
  - id: D1
    description: Exact URL pair selection and keyboard swap remain stable.
    requirement: PROV-06
    verification: [{kind: unit, ref: tests/unit/forecast-comparison-ui.test.tsx, status: pass}, {kind: e2e, ref: tests/e2e/forecast-comparison.spec.ts, status: pass}]
    human_judgment: false
  - id: D2
    description: Semantic directions, signed deltas, receipt IDs, absent-kind copy and risk disclosure are present.
    requirement: PROV-06
    verification: [{kind: unit, ref: tests/unit/forecast-comparison-ui.test.tsx, status: pass}]
    human_judgment: false
duration: 18min
completed: 2026-09-13
status: complete
---

# Phase 05 Plan 07: Accessible Forecast Revision Comparison Summary

**Exact immutable forecast pairs now survive refresh in URL state and render server-authoritative, change-first semantic deltas with accessible receipts and honest absence copy.**

## Accomplishments

- Added controlled left/right selectors, one-time pair initialization, explicit keyboard swap and URL persistence.
- Added a private no-store internal proxy and rejected responses that do not echo the selected exact pair.
- Focused the result only after explicit comparison, while errors retain both selected IDs.
- Rendered written increased/decreased/unchanged directions, signed values, scoped tables, timestamps and progressive exact receipt IDs.
- Covered one-snapshot/absent-lineup states, persistent responsible-gambling disclosure, 320px, forced-colors, reduced-motion and overflow.

## Task Commits

1. **Task 1 RED:** `e0a7055`
2. **Task 1 GREEN:** `84580ed`
3. **Task 2 RED:** `77fa493`
4. **Task 2 GREEN:** `f5ad800`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added the internal comparison proxy**
- Required so the client does not bypass eligibility headers or expose API topology.
- File: `apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/compare/route.ts`
- Commit: `84580ed`

**2. [Rule 3 - Blocking] Built database and football-data before the E2E API server**
- The prior Playwright command started API against a stale database dist export.
- File: `playwright.config.ts`
- Commit: `84580ed`

## Threat Mitigations

- URL text never supplies provider/status labels; response IDs must match the selected pair.
- Only the allowlisted comparison DTO is rendered as inert React text.
- Client-side probability delta computation was not introduced.

## Self-Check: PASSED

- All planned artifacts and the required internal proxy exist.
- Commits `e0a7055`, `84580ed`, `77fa493`, and `f5ad800` exist.
- Unit tests passed 6/6, Chromium passed 2/2, and web typecheck passed under Node 24.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-13*
