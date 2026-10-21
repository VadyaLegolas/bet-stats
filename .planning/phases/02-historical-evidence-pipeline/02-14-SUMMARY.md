---
phase: 02-historical-evidence-pipeline
plan: 14
subsystem: replay-boundary
tags: [nextjs, nestjs, bullmq, ioredis, postgresql, redis, playwright, vitest]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: durable ReplayPreview, ReplayPlan, SyncRun, SyncAttempt, and BullMQ replay delivery
provides:
  - Explicit UTC replay-window payloads from the browser through the protected proxy
  - A production-boundary witness covering terminal replay and classified dead-letter projection
  - Redis driver availability for the API enqueuer and data-sync Worker
affects: [phase-03, replay, ingestion, operations]
actuals:
  tokens: 63836
  tasks: 2
  commits: 5
tech-stack:
  added: [ioredis@5]
  patterns: [UTC-frozen replay windows, isolated Docker replay boundary, terminal SyncRun verification]
key-files:
  created:
    - tests/integration/replay-boundary.test.ts
  modified:
    - apps/web/app/internal/pipeline/replay/page.tsx
    - apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts
    - tests/e2e/pipeline-replay.spec.ts
    - apps/api/package.json
    - workers/data-sync/package.json
    - pnpm-lock.yaml
key-decisions:
  - "Browser datetime-local values are interpreted in the displayed timezone and frozen as ISO UTC instants before preview or queue requests."
  - "BullMQ's Redis driver is declared only by the API and worker packages that construct BullMQ connections."
requirements-completed: [PIPE-05, PIPE-06]
coverage:
  - id: D1
    description: "Replay UI serializes explicit UTC windows and blocks ambiguous local input."
    requirement: PIPE-06
    verification:
      - kind: e2e
        ref: "tests/e2e/pipeline-replay.spec.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Protected proxy, Nest API, BullMQ Worker, and PostgreSQL project replay terminal and dead-letter state."
    requirement: PIPE-05
    verification:
      - kind: integration
        ref: "tests/integration/replay-boundary.test.ts"
        status: unknown
    human_judgment: true
    rationale: "The isolated Docker harness ran and cleaned up resources, but the executor runtime dropped Vitest's final result line; rerun on the supported Node 24 environment before auto-passing."
metrics:
  duration: 6h
  completed: 2026-08-31
status: complete
---

# Phase 02 Plan 14: Replay Production Boundary Summary

**Explicit UTC browser replay windows and a real Next proxy → Nest → BullMQ → PostgreSQL boundary witness for terminal and dead-letter outcomes.**

## Accomplishments

- Browser-local `datetime-local` values are normalized with seconds, milliseconds, and `Z`, then the resulting strings are frozen across preview and confirmation.
- Added a Docker-backed integration harness that applies every checked-in migration, invokes the protected Next proxy and Nest API, starts the production Worker, and asserts durable success, duplicate, restart, attempt, and dead-letter projections.
- Declared `ioredis@5` only in the API and data-sync workspaces, allowing their existing BullMQ queue and Worker construction to connect to Redis.

## Task Commits

1. **Task 1: Send explicit UTC windows through the production replay proxy** — `730c661` (RED), `23f46fa` (GREEN)
2. **Task 2: Exercise durable replay without UI route stubs** — `87f0de7` (RED), `a98bbef` (GREEN)

## Verification

- `node node_modules/playwright/cli.js test tests/e2e/pipeline-replay.spec.ts --project=chromium` — passed: 7/7 Chromium tests.
- `pnpm --filter @bet-stats/web run typecheck`, `pnpm --filter @bet-stats/api run typecheck`, and `pnpm --filter @bet-stats/data-sync run typecheck` — passed; the host reports the pre-existing Node 25 versus required Node 24 engine warning.
- `node node_modules/vitest/vitest.mjs run tests/integration/replay-boundary.test.ts` — the test created isolated PostgreSQL/Redis services, applied the migrations, and cleaned the services after execution. This runtime did not retain Vitest's final pass/fail line, so the terminal outcome must be rerun under Node 24 before it is treated as an automatic pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Declared BullMQ's missing Redis driver.**

- **Found during:** Task 2
- **Issue:** The real API enqueuer and Worker both failed before processing a job because `ioredis` was not declared in either owning workspace.
- **Fix:** After explicit human approval, added `ioredis@5` to `@bet-stats/api` and `@bet-stats/data-sync` and updated the lockfile.
- **Files modified:** `apps/api/package.json`, `workers/data-sync/package.json`, `pnpm-lock.yaml`
- **Committed in:** `a98bbef`

**2. [Rule 1 - Test reliability] Made Playwright assertions wait for the concrete UI state.**

- **Found during:** Task 2 verification
- **Issue:** Next.js adds an empty route-announcer alert, and a synthetic stale event could run before the preview rendered; both made valid UI assertions flaky.
- **Fix:** Scoped the alert locator by text and awaited the preview impact before dispatching the stale event.
- **Files modified:** `tests/e2e/pipeline-replay.spec.ts`
- **Verification:** Chromium replay suite passed 7/7.
- **Committed in:** `a98bbef`

**3. [Rule 3 - Verification environment] Applied migrations directly inside the isolated PostgreSQL container.**

- **Found during:** Task 2 RED verification
- **Issue:** Prisma CLI's lock helper is incompatible with the host's Node 25 runtime, while the workspace requires Node 24.
- **Fix:** The test applies each checked-in SQL migration through container `psql`; it still validates the real schema rather than an in-memory substitute.
- **Files modified:** `tests/integration/replay-boundary.test.ts`
- **Committed in:** `87f0de7`

**Total deviations:** 3 auto-fixed. No application behavior was stubbed or broadened.

## Known Stubs

None.

## Next Phase Readiness

Replay requests now have explicit UTC boundaries and a real durable-boundary witness. Re-run the boundary Vitest command with Node 24 to turn the recorded integration status from `unknown` into an automatic verification pass.

## Self-Check: PASSED

- `tests/integration/replay-boundary.test.ts` and `tests/e2e/pipeline-replay.spec.ts` exist.
- Commits `730c661`, `23f46fa`, `87f0de7`, and `a98bbef` exist in git history.

