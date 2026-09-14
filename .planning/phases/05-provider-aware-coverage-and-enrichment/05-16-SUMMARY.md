---
phase: 05-provider-aware-coverage-and-enrichment
plan: 16
subsystem: provider-live-acceptance
status: complete
tags: [playwright, postgresql, redis, bullmq, nestjs, nextjs]
requires: [05-15]
provides:
  - Owned migrated live-stack acceptance harness
  - Browser evidence for fallback, no-fallback, lineup enrichment and exact forecast pairs
affects: [phase-05-verification]
tech-stack:
  added: []
  patterns: [unique owned Docker resources, production-boundary browser acceptance, exact PID and container cleanup]
key-files:
  created: []
  modified:
    - tests/e2e/live-provider-stack.ts
    - tests/integration/live-provider-harness-smoke.test.ts
    - tests/e2e/provider-degradation.spec.ts
    - tests/e2e/forecast-comparison.spec.ts
    - playwright.phase05.config.ts
    - apps/api/src/modules/forecasts/forecast-comparison.service.ts
    - apps/web/app/layout.tsx
key-decisions:
  - Browser acceptance uses only the real Next-to-Nest-to-PostgreSQL path and never intercepts requests or substitutes page content.
  - Exact comparison validates persisted forecast state before removing the repository-only state field from the strict domain DTO.
metrics:
  duration: 23m
  completed: 2026-09-14
actuals:
  tokens: 8007
  tasks: 2
  commits: 2
---

# Phase 5 Plan 16: Live Provider Acceptance Summary

Owned PostgreSQL, Redis, worker, Nest and Next processes now prove provider degradation and immutable forecast comparison through real production boundaries.

## Accomplishments

- Migrated and seeded unique PostgreSQL/Redis resources with deterministic canonical leagues, provider refs, route attempts, source observations, official lineup provenance and immutable forecast receipts.
- Verified fallback receipts, sole-source no-fallback reason and last-valid timestamp in the rendered fixture UI.
- Verified an official lineup snapshot and an exact left/right forecast pair that survives reload, a newer revision and explicit keyboard Swap.
- Kept cleanup scoped to recorded child PIDs and exact owned Docker resource names; no owned containers remained after verification.

## Verification

- `vitest run tests/integration/live-provider-harness-smoke.test.ts --project integration`: 3/3 passed.
- `playwright test tests/e2e/provider-degradation.spec.ts tests/e2e/forecast-comparison.spec.ts --config=playwright.phase05.config.ts --project=chromium`: 5/5 passed.
- `vitest run tests/integration/forecast-comparison-api.test.ts --project integration`: 8/8 passed.
- `pnpm typecheck`: 7/7 workspace packages passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed repository-only state before strict forecast comparison**
- **Found during:** Task 2 live comparison
- **Issue:** The production comparison repository appended `state` to an exact `ForecastResponseDto`, causing `UNKNOWN_FORECAST_RESPONSE_KEY`.
- **Fix:** Validate the stored state and strip it before invoking the strict domain comparison.
- **Files modified:** `apps/api/src/modules/forecasts/forecast-comparison.service.ts`
- **Commit:** `635b970`

**2. [Rule 1 - Bug] Prevented narrow viewport overflow**
- **Found during:** Task 2 forced-colors 320px acceptance
- **Issue:** Root padded containers and intrinsic fieldset/select sizing exceeded the viewport.
- **Fix:** Applied border-box sizing to root containers and bounded form controls.
- **Files modified:** `apps/web/app/layout.tsx`
- **Commit:** `635b970`

## Known Stubs

None.

## Self-Check: PASSED

- Required harness, specs and config exist.
- Commits `b55d4b9` and `635b970` exist.
- All mandatory automated gates passed and exact owned resources were cleaned up.
