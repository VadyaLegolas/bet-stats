---
phase: 06-release-experience-and-operations
plan: 01
subsystem: release-verification
tags: [playwright, postgresql, redis, bullmq, nestjs, nextjs, axe]
requires:
  - phase: 05-provider-aware-coverage-and-enrichment
    provides: owned production-boundary provider acceptance stack
provides:
  - Serial desktop Chromium D-15 lifecycle tracer
  - Owned release settlement worker layered on real PostgreSQL, Redis, Nest and built Next services
  - Audited axe Playwright dependency for later accessibility gates
affects: [06-02, 06-03, 06-04, 06-05, 06-09]
actuals:
  tokens: 2776
  tasks: 2
  commits: 3
tech-stack:
  added: ["@axe-core/playwright@4.13.0"]
  patterns: [serial real-boundary Playwright tracer, exact owned-resource teardown, fail-fast prerequisite validation]
key-files:
  created:
    - tests/e2e/live-release-stack.ts
    - tests/e2e/release-journey.spec.ts
    - playwright.phase06.config.ts
  modified:
    - package.json
    - pnpm-lock.yaml
key-decisions:
  - "The Phase 06 tracer extends the proven Phase 05 owned stack and adds a dedicated BullMQ settlement worker with an exact queue prefix."
  - "Limited forecast evidence remains fail-closed during the journey; the immutable value receipt is asserted as INSUFFICIENT_EVIDENCE rather than fabricating a value candidate."
patterns-established:
  - "Release prerequisite gate: Node 24 and Docker are checked before any resource is created."
  - "Lifecycle identity chain: browser forecast/odds/value IDs are reconciled with PostgreSQL settlement and score facts."
requirements-completed: [OPS-03]
coverage:
  - id: D1
    description: "A deterministic fixture-to-scorecard journey crosses PostgreSQL, Redis, BullMQ, Nest, built Next and Chromium without interception."
    requirement: OPS-03
    verification:
      - kind: e2e
        ref: "pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/release-journey.spec.ts --project=desktop-chromium"
        status: pass
    human_judgment: false
  - id: D2
    description: "The audited accessibility integration is lockfile-pinned and the serial tracer is discoverable."
    requirement: OPS-03
    verification:
      - kind: other
        ref: "pnpm install --frozen-lockfile && playwright test --config=playwright.phase06.config.ts tests/e2e/release-journey.spec.ts --list"
        status: pass
    human_judgment: false
duration: 12min
completed: 2026-09-20
status: complete
---

# Phase 06 Plan 01: Release Journey Tracer Summary

**A serial Chromium tracer now proves immutable fixture, forecast, manual-odds, value, result, BullMQ settlement and scorecard continuity through real production boundaries.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-20T05:12:00Z
- **Completed:** 2026-09-20T05:24:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added an owned release harness that fails before allocation unless Node 24 and Docker are available, then tears down its exact worker and inherited containers/processes.
- Drove one real Chromium journey from fixture and immutable forecast through manual odds, fail-closed value receipt, durable result, BullMQ settlement and scorecard projection.
- Pinned the research-approved `@axe-core/playwright@4.13.0` package and retained serial trace/screenshot-on-failure policy.

## Task Commits

1. **Task 1 RED: release journey contract** - `c6e8005` (test)
2. **Task 1 GREEN: owned real-boundary tracer** - `b2335ed` (feat)
3. **Task 2: accessibility gate dependency** - `e49c278` (chore)

## Verification

- Node `v24.14.0`; Docker daemon `29.7.2`.
- D-15 Playwright tracer: 1/1 passed in 52.5s on `desktop-chromium`.
- Frozen install: passed; lockfile already up to date.
- Playwright discovery: exactly 1 tracer in 1 file.
- Cleanup audit: no `bet-stats-p5-*` owned containers remained.
- Targeted standalone TypeScript compilation exposed pre-existing errors in provider/worker files; the repository's build paths and the executable tracer both compiled successfully. No passing typecheck result is claimed.

## Files Created/Modified

- `tests/e2e/live-release-stack.ts` - prerequisite validation, release worker state and exact teardown.
- `tests/e2e/release-journey.spec.ts` - browser/database identity continuity and scorecard assertions.
- `playwright.phase06.config.ts` - serial desktop Chromium release configuration.
- `package.json` - exact axe Playwright dev dependency.
- `pnpm-lock.yaml` - integrity-pinned dependency resolution.

## Decisions Made

- Reused the already proven Phase 05 owned PostgreSQL/Redis/API/web stack while adding a Phase 06-specific BullMQ settlement worker and queue namespace.
- Preserved honest fail-closed behavior: the deterministic seeded forecast lacks sufficient evidence, so the value boundary returns and renders `INSUFFICIENT_EVIDENCE`; the test does not manufacture a candidate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Matched the canonical forecast hash identity**
- **Found during:** Task 1 GREEN
- **Issue:** The first assertion assumed a human prefix, while production forecast IDs are 64-character SHA-256 identities.
- **Fix:** Asserted the actual immutable hash contract.
- **Files modified:** `tests/e2e/release-journey.spec.ts`
- **Verification:** Subsequent tracer advanced through the odds/value boundary.
- **Committed in:** `b2335ed`

**2. [Rule 1 - Bug] Preserved fail-closed value semantics**
- **Found during:** Task 1 GREEN
- **Issue:** Seeded forecast evidence correctly produces `INSUFFICIENT_EVIDENCE`, not a fabricated candidate.
- **Fix:** Asserted the honest immutable outcome and zero eligible value candidates in the scorecard.
- **Files modified:** `tests/e2e/release-journey.spec.ts`
- **Verification:** D-15 tracer passed.
- **Committed in:** `b2335ed`

**3. [Rule 1 - Bug] Asserted all three market score facts**
- **Found during:** Task 1 GREEN
- **Issue:** Settlement scores each retained market, yielding three facts rather than one.
- **Fix:** Asserted the exact persisted count and selected the ONE_X_TWO score by settlement lineage.
- **Files modified:** `tests/e2e/release-journey.spec.ts`
- **Verification:** D-15 tracer passed 1/1.
- **Committed in:** `b2335ed`

**4. [Rule 3 - Blocking] Explicitly targeted the workspace root for the approved dependency**
- **Found during:** Task 2
- **Issue:** pnpm rejected an implicit root add in the workspace.
- **Fix:** Re-ran the same approved package/version with `-w`; no alternate package was attempted.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** frozen install and test discovery passed.
- **Committed in:** `e49c278`

---

**Total deviations:** 4 auto-fixed (3 Rule 1, 1 Rule 3)
**Impact on plan:** Corrections align assertions with existing immutable and fail-closed production contracts; no product behavior was weakened.

## Known Stubs

None.

## Issues Encountered

- The shell's default Node was 25.2.1, but installed Node 24.14.0 was explicitly activated for every plan command.
- Docker access required the approved host channel; the daemon and real pinned images were used successfully.

## User Setup Required

None.

## Next Phase Readiness

- Later Phase 06 specs can reuse the serial configuration, owned release state reader and exact settlement queue boundary.
- Accessibility plans can import the exact audited axe integration.

## Self-Check: PASSED

- All five planned files exist.
- Commits `c6e8005`, `b2335ed`, and `e49c278` exist.
- Required automated gates passed and no owned containers remained.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-20*
