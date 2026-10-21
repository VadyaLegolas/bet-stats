---
phase: 01-trustworthy-fixture-discovery
plan: 04
subsystem: vertical-tracer
tags: [nextjs, nestjs, playwright, health, fixtures]
requires:
  - phase: 01-03
    provides: Validated config, worker scaffold, and deterministic test harnesses
provides:
  - Browser-to-Next-to-Nest normalized Premier League fixture tracer
  - Dependency-specific redacted API and worker readiness
affects: [fixture-discovery, provider-ingestion, health, production-build]
actuals:
  tokens: 2400
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns: [vertical-tracer, deterministic-nonproduction-adapter, redacted-health-projection]
key-files:
  created: [apps/api/src/app.module.ts, apps/api/src/modules/fixtures/fixtures.controller.ts, apps/api/src/modules/fixtures/fixtures.service.ts, apps/api/src/modules/health/health.controller.ts, apps/web/app/fixtures/page.tsx, tests/helpers/time.ts, tests/e2e/walking-skeleton.spec.ts, tests/integration/health.test.ts]
  modified: [apps/api/src/main.ts, workers/data-sync/src/main.ts, playwright.config.ts, vitest.config.ts]
key-decisions:
  - "Use the real GET /fixtures controller/service boundary with a deterministic adapter only outside production."
  - "Expose process-local liveness separately from dependency-specific readiness without diagnostic payloads."
patterns-established:
  - "Tracer tests freeze both instant and IANA timezone before asserting browser projections."
  - "Workspace runtime dependencies build before Playwright starts consuming processes."
requirements-completed: [FOUND-01, FOUND-02, FOUND-03, DATA-01]
coverage:
  - id: D1
    description: "A browser renders one normalized Premier League fixture through Next.js and NestJS using the production route shape."
    requirement: DATA-01
    verification:
      - kind: e2e
        ref: "tests/e2e/walking-skeleton.spec.ts#renders one normalized Premier League fixture through the production path"
        status: pass
    human_judgment: false
  - id: D2
    description: "API and worker readiness distinguishes PostgreSQL and Redis without exposing diagnostics or secrets."
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/integration/health.test.ts#distinguishes PostgreSQL and Redis failure without leaking diagnostics"
        status: pass
    human_judgment: false
  - id: D3
    description: "API and web production builds compile independently."
    requirement: FOUND-01
    verification:
      - kind: other
        ref: "pnpm --filter @bet-stats/api build && pnpm --filter @bet-stats/web build"
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 04: Fixture Tracer and Readiness Summary

**Production-shaped browser-to-API Premier League fixture tracer with fixed-time E2E proof and redacted dependency readiness**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-28T03:52:00Z
- **Completed:** 2026-08-28T04:00:00Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Proved the browser → Next.js server component → NestJS controller/service fixture path with a deterministic non-production adapter.
- Added fixed-clock and explicit Europe/Warsaw timezone coverage while preserving a neutral read-only UI.
- Added process-local liveness plus redacted PostgreSQL/Redis readiness for API and worker lifecycle state.

## Task Commits

1. **RED: Define tracer and readiness contracts** — `d2c1c64` (test)
2. **GREEN: Deliver tracer and readiness slice** — `597c6cc` (feat)

## Files Created/Modified

- `apps/api/src/modules/fixtures/` — normalized fixture service and GET controller.
- `apps/api/src/modules/health/health.controller.ts` — safe liveness/readiness projections.
- `apps/web/app/fixtures/page.tsx` — server-rendered neutral fixture list.
- `tests/e2e/walking-skeleton.spec.ts` — full browser tracer.
- `tests/integration/health.test.ts` — health redaction witness.

## Decisions Made

- Kept the deterministic fixture behind validated non-production configuration rather than adding a separate test-only HTTP route.
- Used source aliases only within Vitest; production processes retain compiled `dist` package exports.

## Deviations from Plan

- API and web package/build configuration files were updated to link and build the shared config dependency deterministically.
- Fixture and health controllers were committed together because AppModule links both and splitting would create a noncompiling intermediate commit.

## Issues Encountered

- Vitest inline projects do not inherit root aliases; the integration project now declares its alias explicitly.
- Combined shell commands can mask earlier native-command failures in PowerShell; final verification used explicit fail-fast exit checks.

## User Setup Required

None beyond the existing Node 24 LTS requirement.

## Next Phase Readiness

The first vertical slice is green and ready for canonical persistence/reconciliation in Plans 01-05 and 01-08.

## Self-Check: PASSED

- Integration health test: 1/1 passed.
- Walking-skeleton browser test: 1/1 passed.
- API/worker typechecks passed.
- API and Next.js production builds passed.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
