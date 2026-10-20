---
phase: 02-historical-evidence-pipeline
plan: 22
subsystem: browser-evidence-verification
tags: [playwright, postgresql, nestjs, nextjs, prisma, docker, tdd]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: exact immutable evidence provenance and published EvidenceBuild projection
provides:
  - Independent non-intercepted browser witness for real PostgreSQL published evidence
  - Disposable migrated PostgreSQL 18 stack with readiness-gated Nest and Next processes
  - Cutoff-invariance proof across a later immutable correction and publication
affects: [phase-03, evidence-ui, release-gates, browser-e2e]
actuals:
  tokens: 4215
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [owned disposable infrastructure, direct API-to-DOM comparison, readiness polling, cutoff invariance]
key-files:
  created:
    - tests/e2e/live-evidence-stack.ts
    - playwright.live-evidence.config.ts
    - tests/e2e/team-evidence-live.spec.ts
  modified: []
key-decisions:
  - "The live evidence gate owns a uniquely named PostgreSQL container and exact child PIDs, and cleanup targets only those recorded resources."
  - "Browser assertions compare the production Nest payload with the Next DOM without installing any request interception."
patterns-established:
  - "Production-boundary browser tests seed immutable inputs, publish via the worker adapter, and wait on HTTP readiness instead of sleeping."
requirements-completed: [PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: A real published PostgreSQL EvidenceBuild crosses Nest and Next into an independent Chromium page without interception
    requirement: PIPE-07
    verification:
      - kind: automated_ui
        ref: tests/e2e/team-evidence-live.spec.ts#live published cutoff crosses PostgreSQL, Nest, Next, and the browser
        status: pass
    human_judgment: false
  - id: D2
    description: The browser renders full evidence provenance and preserves the requested cutoff after a later correction is published
    requirement: PIPE-08
    verification:
      - kind: automated_ui
        ref: tests/e2e/team-evidence-live.spec.ts#renders the full live evidence matrix and preserves the original cutoff after correction
        status: pass
    human_judgment: false
duration: 19min
completed: 2026-09-01
status: complete
---

# Phase 02 Plan 22: Independent Live Evidence Browser Gate Summary

**A disposable PostgreSQL 18, Nest, Next, and Chromium stack now proves real published evidence rendering and immutable cutoff behavior without browser interception.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-09-01T06:33:54Z
- **Completed:** 2026-09-01T06:52:54Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Migrated and seeded a uniquely named PostgreSQL 18 container with ten immutable results, a complete sync run, and a production-published evidence build.
- Started isolated Nest and Next processes on dedicated ports, waited for real readiness, and compared the live Nest cutoff response with the rendered browser DOM.
- Verified 5/10 samples, chronological trace, receipt provenance, an explicit null component limitation, later correction publication, original-cutoff invariance, and removal of every harness-owned resource.

## Task Commits

1. **Task 1 RED: Add failing live evidence browser contract** — `e28a2ce`
2. **Task 1 GREEN: Run disposable published evidence stack** — `0de5914`
3. **Task 2 RED: Expand live evidence correction matrix** — `46490bb`
4. **Task 2 GREEN: Prove live evidence correction invariance** — `a7680a0`

## Files Created/Modified

- `tests/e2e/live-evidence-stack.ts` — owns container/process lifecycle, migrations, publication seeds, later correction publication, readiness, and scoped cleanup.
- `playwright.live-evidence.config.ts` — isolates the live Chromium project from ordinary mocked E2E servers.
- `tests/e2e/team-evidence-live.spec.ts` — compares direct Nest data with Next-rendered cutoff, samples, trace, receipt, limitations, and correction invariance.

## Decisions Made

- Store only non-secret database/process ownership metadata in an OS temporary directory so teardown can identify exact resources after setup completes.
- Use the actual worker rebuild adapter for initial and corrected publication instead of inserting fixture-shaped API JSON or intercepting the browser request.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected the repository-specific Playwright CLI path**
- **Found during:** Task 1 RED
- **Issue:** The planned `node_modules/playwright/cli.js` path does not exist under this pnpm installation.
- **Fix:** Ran the equivalent checked-in dependency at `node_modules/@playwright/test/cli.js`.
- **Files modified:** None.
- **Verification:** Focused and full live Playwright commands passed.
- **Committed in:** Not applicable (execution-command correction).

**2. [Rule 3 - Blocking] Resolved root Playwright workspace imports and Windows command spawning**
- **Found during:** Task 1 GREEN
- **Issue:** Root-loaded Playwright setup could not resolve workspace aliases, and Node 25 rejected direct `.cmd` execution with `EINVAL`.
- **Fix:** Used a relative database source import, the built worker entrypoint, and narrowly constructed `cmd.exe /d /s /c corepack` invocations on Windows.
- **Files modified:** `tests/e2e/live-evidence-stack.ts`.
- **Verification:** Full two-test live browser suite and both package typechecks passed.
- **Committed in:** `0de5914`.

**Total deviations:** 2 auto-fixed (2 blocking issues).
**Impact on plan:** Execution mechanics only; the intended production-boundary evidence and security scope were preserved.

## Issues Encountered

- The host runs Node 25 while the workspace declares Node 24; pnpm emitted engine warnings, but builds, typechecks, and browser verification completed.
- Initial DOM assertions were made precise after duplicate visible cutoff/unavailable strings triggered Playwright strict-locator errors.

## User Setup Required

None.

## Known Stubs

None.

## Verification

- Focused live Chromium gate — 1 test passed.
- Full dedicated live Chromium gate — 2 tests passed.
- Plan 02-19 evidence browser contract smoke — 2 tests passed.
- `@bet-stats/api` and `@bet-stats/web` typechecks — passed.
- Docker cleanup scan — no `bet-stats-live-evidence-*` containers remained.

## Next Phase Readiness

- PIPE-07/08 now have an automatic production-browser witness rather than only mocked and direct-service tests.
- Later prediction and backtesting phases can rely on the published evidence cutoff remaining immutable after corrections.

## Self-Check: PASSED

- All three declared files exist.
- Task commits `e28a2ce`, `0de5914`, `46490bb`, and `a7680a0` exist in git history.
- The focused, full, smoke, typecheck, and cleanup gates passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-09-01*
