---
phase: 05-provider-aware-coverage-and-enrichment
plan: 05
subsystem: fixture-provider-state
tags: [nestjs, nextjs, degradation, accessibility, immutable-receipts]
requires:
  - phase: 05-03
    provides: durable closed provider route outcomes and attempts
provides:
  - Safe provider-state DTO on fixture collection and detail
  - Accessible primary/fallback/pending/unavailable/limited/unsupported/stale/budget/circuit notices
  - Exact no-fallback and persistent-filter recovery copy
affects: [fixtures-api, fixtures-web]
actuals: {tokens: 7535, tasks: 2, commits: 4}
tech-stack:
  added: []
  patterns: [closed safe projection, canonical fixture plus orthogonal degradation state, progressive sanitized receipt]
key-files:
  created: [apps/web/components/provider-state-notice.tsx, tests/integration/provider-state-api.test.ts, tests/unit/provider-state-ui.test.tsx, tests/e2e/provider-degradation.spec.ts]
  modified: [apps/api/src/modules/fixtures/fixtures.service.ts, apps/web/app/fixtures/page.tsx, apps/web/app/fixtures/[fixtureId]/page.tsx]
key-decisions:
  - "Phase 05: Provider degradation is an orthogonal safe DTO and never replaces or duplicates canonical fixture identity."
  - "Phase 05: Only receipt ID, policy version, outcome and trigger cross the fixture API boundary."
requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04]
coverage:
  - id: D1
    description: Fallback and sole-source failure project safe provider/reason/time/receipt fields without raw payloads.
    requirement: PROV-02
    verification: [{kind: integration, ref: tests/integration/provider-state-api.test.ts, status: pass}]
    human_judgment: false
  - id: D2
    description: All provider states, exact copy, filters and responsive accessibility remain visible.
    requirement: PROV-04
    verification: [{kind: unit, ref: tests/unit/provider-state-ui.test.tsx, status: pass}, {kind: e2e, ref: tests/e2e/provider-degradation.spec.ts, status: pass}]
    human_judgment: false
duration: 16min
completed: 2026-09-13
status: complete
---

# Phase 05 Plan 05: Honest Provider Degradation Summary

**Canonical fixtures now stay visible while a closed, sanitized provider-state projection explains primary, fallback and every degradation outcome with safe reason, time and receipt metadata.**

## Accomplishments

- Derived provider states server-side from immutable route receipts and attempts.
- Exposed only provider, safe reason, capture/last-valid times and four allowlisted receipt fields.
- Rendered exact fallback and API-Football sole-source no-fallback copy without zero substitution.
- Completed the nine-state notice matrix across collection/detail while retaining usable filters on errors.
- Added keyboard-size, narrow viewport, long-text, forced-colors and reduced-motion acceptance backstops.

## Task Commits

1. **Task 1 RED:** `e456b3c`
2. **Task 1 GREEN:** `d032402`
3. **Task 2 RED:** `e25d0be`
4. **Task 2 GREEN:** `f5d089b`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed a corrupt generated Next dev type cache before verification**
- A prior Playwright server interruption left `apps/web/.next/dev/types/routes.d.ts` syntactically incomplete.
- Removed only generated `.next` output and restored generated `next-env.d.ts`; no source or user files were discarded.

## Threat Mitigations

- Raw exceptions, payloads, headers and capability/budget internals are excluded by the closed DTO.
- Provider labels derive from the server route receipt, never client query text.
- Retry remains an explicit 48px user action and preserves the same filters.

## Self-Check: PASSED

- All seven planned artifacts exist.
- Commits `e456b3c`, `d032402`, `e25d0be`, and `f5d089b` exist.
- API integration passed 2/2, component tests 2/2, Chromium 2/2, and API/web typechecks passed.

---
*Phase: 05-provider-aware-coverage-and-enrichment*
*Completed: 2026-09-13*
