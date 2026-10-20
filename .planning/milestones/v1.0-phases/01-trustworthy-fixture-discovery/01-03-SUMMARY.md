---
phase: 01-trustworthy-fixture-discovery
plan: 03
subsystem: config-testing
tags: [zod, vitest, playwright, worker, redaction]
requires:
  - phase: 01-02
    provides: Compile-safe web, API, and provider processes
provides:
  - Fail-closed redacted server configuration contract
  - Compile-safe data-sync worker lifecycle shell
  - Deterministic Vitest and Playwright multi-server harnesses
affects: [fixture-tracer, all-server-processes, unit-tests, e2e-tests]
actuals:
  tokens: 2600
  tasks: 2
  commits: 4
tech-stack:
  added: [zod-4.4.3, vitest-4.1.11, playwright-1.62.1, chromium]
  patterns: [red-green-tdd, centralized-redaction, readiness-driven-e2e]
key-files:
  created: [packages/config/package.json, packages/config/tsconfig.json, packages/config/src/index.ts, packages/config/src/index.test.ts, workers/data-sync/package.json, workers/data-sync/tsconfig.json, workers/data-sync/src/main.ts, vitest.config.ts, playwright.config.ts, tests/e2e/public-shell.spec.ts]
  modified: [package.json, apps/api/package.json, apps/web/package.json, pnpm-lock.yaml]
key-decisions:
  - "Production rejects every non-live provider mode and reports only field names/reasons, never supplied values."
  - "Playwright uses TCP readiness for the controller-free API scaffold and HTTP readiness for Next.js."
patterns-established:
  - "Configuration behavior is introduced through an observed RED test before implementation."
  - "Browser orchestration owns process startup and waits on readiness rather than sleeps."
requirements-completed: [FOUND-01, FOUND-02, FOUND-03]
coverage:
  - id: D1
    description: "Production configuration fails closed, redacts secrets, and rejects deterministic adapters."
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "packages/config/src/index.test.ts#server configuration"
        status: pass
    human_judgment: false
  - id: D2
    description: "Worker and config packages compile with independent PostgreSQL and Redis readiness state."
    requirement: FOUND-02
    verification:
      - kind: other
        ref: "pnpm --filter @bet-stats/config typecheck && pnpm --filter @bet-stats/data-sync typecheck"
        status: pass
    human_judgment: false
  - id: D3
    description: "Vitest and Playwright load deterministic root harnesses and a real browser smoke test passes."
    requirement: FOUND-01
    verification:
      - kind: e2e
        ref: "tests/e2e/public-shell.spec.ts#renders the neutral public shell and persistent disclosure"
        status: pass
      - kind: unit
        ref: "pnpm exec vitest run packages/config/src/index.test.ts"
        status: pass
    human_judgment: false
duration: 10min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 03: Safe Configuration and Test Harness Summary

**Zod-backed fail-closed configuration with redaction tests, worker readiness state, and readiness-driven Vitest/Playwright harnesses**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-28T03:22:00Z
- **Completed:** 2026-08-28T03:32:00Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments

- Proved configuration behavior with a RED→GREEN cycle covering production failure, secret redaction, adapter denial, and dependency readiness.
- Added a safe data-sync worker entrypoint that never logs parsed secrets.
- Added deterministic root unit/browser harnesses and passed a real Chromium smoke test against Playwright-owned API/web processes.

## Task Commits

1. **Task 1 RED: Define fail-closed configuration contract** — `f897251` (test)
2. **Task 1 GREEN: Implement safe worker configuration** — `d7b31cc` (feat)
3. **Task 2: Establish deterministic test harnesses** — `c02c4c7` (test)
4. **Generated framework metadata** — `ea5e322` (chore)

## Files Created/Modified

- `packages/config/` — validated server config, centralized redaction, readiness projection, and tests.
- `workers/data-sync/` — strict worker package and safe entrypoint.
- `vitest.config.ts` — deterministic unit project configuration.
- `playwright.config.ts` — sequential multi-server browser orchestration.
- `tests/e2e/public-shell.spec.ts` — real browser smoke witness.
- `apps/api/package.json` — required ValidationPipe runtime dependencies.

## Decisions Made

- Kept production configuration strict while allowing secretless deterministic development/test mode.
- Used API port readiness until the next plan adds the real health controller.

## Deviations from Plan

### Auto-fixed Issues

1. Added a real public-shell E2E witness because Playwright `--list` correctly fails when no tests exist.
2. Added `class-validator` and `class-transformer` after the real API process proved ValidationPipe needs them at runtime.
3. Committed Next 16 generated TypeScript and local agent-guidance files because the framework recreates them on every dev run.

## Issues Encountered

- Vitest worker spawning required execution outside the filesystem sandbox on Windows.
- Chromium was absent and was installed through Playwright.
- Node 25 continues to emit the expected engines warning; Node 24 remains required.

## User Setup Required

None beyond selecting Node 24 LTS.

## Next Phase Readiness

The fixture tracer can now reuse validated config, worker lifecycle state, focused unit tests, and deterministic browser process orchestration.

## Self-Check: PASSED

- Vitest: 6/6 tests pass.
- Config and data-sync typechecks pass.
- Playwright lists one test and the Chromium smoke passes 1/1.
- RED and GREEN commits are present.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
