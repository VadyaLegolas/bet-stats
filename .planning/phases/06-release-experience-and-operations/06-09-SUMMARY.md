---
phase: 06-release-experience-and-operations
plan: 09
subsystem: release-verification
tags: [release-gate, playwright, accessibility, degradation, docker, postgresql, redis, bullmq]
requires:
  - phase: 06-release-experience-and-operations
    provides: release UX, methodology, operations, recovery, and privacy boundaries from plans 06-01 through 06-08
provides:
  - One fail-fast Node 24 release command covering static, unit, integration, build, and production-boundary browser gates
  - Real-service D-16 degradation matrix with durable invariant and secret-canary assertions
  - Desktop and mobile Chromium parity for release journeys, accessibility, operations, and privacy
affects: [release-process, milestone-verification, continuous-integration]
tech-stack:
  added: []
  patterns: [parent-owned integration dependencies, supervised child lifecycle, exact BullMQ job ownership, project-scoped browser fixtures]
key-files:
  created:
    - tests/e2e/release-degradation.spec.ts
    - scripts/verify-release-integration.mjs
    - tests/unit/release-db-lifecycle.test.ts
  modified:
    - package.json
    - playwright.phase06.config.ts
    - tests/e2e/live-release-stack.ts
    - tests/e2e/release-accessibility.spec.ts
    - tests/e2e/release-journey.spec.ts
key-decisions:
  - "The supported automated browser scope is desktop and mobile Chromium; broader browser support must add an explicit release project."
  - "The integration release gate owns PostgreSQL and Redis in one parent process and propagates child failures through awaited supervision with bounded redacted diagnostics."
  - "Stateful release tests remove only their exact BullMQ jobs and use project-scoped durable identities rather than queue-wide cleanup or shared mutable subjects."
actuals:
  tokens: 15989
  tasks: 3
  commits: 4
duration: 2 days elapsed across resumed execution and debug verification
completed: 2026-09-24
status: complete
---

# Phase 06 Plan 09: Production Release Boundary Summary

**A single fail-fast release command now proves the D-15 journey and full D-16 degradation matrix across real PostgreSQL 18, Redis 8, BullMQ, Nest, built Next.js, and desktop/mobile Chromium without interception.**

## Performance

- **Duration:** 2 days elapsed across resumed execution and debug verification
- **Tasks:** 3
- **Files changed:** 19
- **Runtime:** Node 24.14.0, pnpm 10.34.5, Docker 29.7.2

## Accomplishments

- Added seven production-boundary degradation scenarios covering quota denial, open circuit, sole-source unavailability, quarantine, stale/limited evidence, dead letters, and safe replay while preserving durable invariants.
- Proved desktop/mobile parity across the release journey, accessibility behaviors, methodology, operator recovery, and fail-closed privacy surfaces.
- Published `pnpm verify:release` as the mandatory prerequisite, schema, typecheck, unit, integration, build, and Phase 06 browser boundary.
- Stabilized release dependency ownership so PostgreSQL, Redis, API, web, workers, and exact BullMQ jobs cannot leak state or hide a post-readiness child failure.

## Verification Evidence

| Gate | Result |
|---|---|
| Typecheck | PASS — 7/7 workspaces |
| Unit tests | PASS — 236/236 |
| Integration tests | PASS — 451/451 |
| Production builds | PASS — 7/7 workspaces |
| Phase 06 Playwright | PASS — 54/54 across desktop and mobile Chromium |
| Full `pnpm verify:release` | PASS — exit 0 under the required Node 24 and Docker environment |

The complete gate was not repeated during summary finalization. Commit `43ee98d` archives the resolved debug session with the full command, runtime versions, clean preflight, and exact passing totals.

## Task Commits

1. **Task 1 RED: define the release degradation matrix** — `33df9b4`
2. **Task 1 GREEN: enforce the real degradation release matrix** — `c1f72e7`
3. **Task 2: verify desktop and mobile release parity** — `ba55451`
4. **Task 3: stabilize and pass the complete release boundary** — `8920720`

Supporting debug evidence was archived separately in `43ee98d`.

## Decisions Made

- Declared desktop and mobile Chromium as the exact automated support matrix instead of implying untested cross-browser support.
- Kept integration infrastructure under one parent owner and made unexpected child exits reject the awaited test owner after sibling termination.
- Scoped durable test identities by Playwright project and cleaned only test-owned queue jobs, preserving evidence instead of masking pollution with global resets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stabilized parent-owned release dependency lifecycle**
- **Found during:** Task 3 full release verification
- **Issue:** Integration children could outlive or lose their PostgreSQL/Redis owner, and a post-readiness API exit could hang without preserving its diagnostic.
- **Fix:** Added a parent-owned integration runner, awaited child supervision, bounded redacted output retention, and lifecycle regression tests.
- **Files modified:** `package.json`, `scripts/verify-release-integration.mjs`, `tests/e2e/live-provider-stack.ts`, `tests/unit/release-db-lifecycle.test.ts`
- **Commit:** `8920720`

**2. [Rule 1 - Bug] Removed cross-suite and cross-project durable identity collisions**
- **Found during:** Task 3 integration and browser gates
- **Issue:** Reused replay identities, privacy subjects, and hard-coded global counts allowed earlier suites/projects to contaminate later assertions.
- **Fix:** Introduced exact owned-job cleanup, unique fixture identities, project-scoped privacy subjects, and state-tolerant semantic assertions.
- **Files modified:** integration replay/value/provider-policy tests, `tests/e2e/privacy-retention.spec.ts`, `tests/e2e/operator-overview.spec.ts`
- **Commit:** `8920720`

**3. [Rule 3 - Blocking] Aligned historical security assertions with the approved Phase 05 provider surface**
- **Found during:** Task 3 integration gate
- **Issue:** Older tests still prohibited the API-Football integration that Phase 05 intentionally introduced.
- **Fix:** Narrowed the assertions to the current security boundary while retaining credential and network-isolation checks.
- **Files modified:** `tests/integration/phase-01-security.test.ts`, `tests/integration/phase-03-security.test.ts`
- **Commit:** `8920720`

## Known Stubs

None.

## Threat Flags

No unplanned trust boundary was introduced. Exact provider-call assertions, canary scans, bounded redacted diagnostics, and durable invariant checks implement T-06-20 through T-06-22.

## Self-Check: PASSED

- All planned release matrix, journey, accessibility, configuration, and lifecycle artifacts exist.
- Commits `33df9b4`, `c1f72e7`, `ba55451`, `8920720`, and evidence commit `43ee98d` exist in git history.
- The archived debug evidence records a clean full `pnpm verify:release` exit 0 with every mandatory gate passing.
- No unrelated working-tree files were staged or modified during plan finalization.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-24*
