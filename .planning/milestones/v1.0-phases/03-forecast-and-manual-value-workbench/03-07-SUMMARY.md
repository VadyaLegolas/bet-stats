---
phase: 03-forecast-and-manual-value-workbench
plan: 07
subsystem: testing
tags: [vitest, playwright, postgres, prisma, nextjs, security, immutability]

requires:
  - phase: 03-forecast-and-manual-value-workbench
    provides: Forecast snapshots, manual odds snapshots, value receipts, and browser workbench from plans 03-01 through 03-06
provides:
  - Adversarial coverage for Phase 3 immutability, cutoff, provenance, exact-pair, authorization, and concurrency boundaries
  - Production-backed browser proof from seeded evidence through forecast, odds, value receipt, clipboard, and download
  - Repository-wide schema, migration, test, browser, type, lint, and production-build evidence
affects: [phase-04, verification, forecast-workbench, value-receipts]

actuals:
  tokens: 12444
  tasks: 2
  commits: 9

tech-stack:
  added: []
  patterns:
    - Concurrent immutable writes converge by exact identity and reject conflicting payload reuse
    - Browser acceptance tests seed durable evidence and compare canonical server JSON structurally with DOM, clipboard, and download outputs

key-files:
  created:
    - tests/integration/phase-03-security.test.ts
  modified:
    - apps/api/src/modules/forecasts/forecasts.service.ts
    - apps/api/src/modules/odds/odds.service.ts
    - packages/domain/src/value/decision.ts
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - tests/e2e/forecast-workbench.spec.ts
    - playwright.config.ts

key-decisions:
  - "Exact forecast/odds pairing requires immutable snapshot identities and market alignment; their capture timestamps need not be equal."
  - "Concurrent requests using the same immutable identity converge only when their canonical payloads match; conflicting reuse remains an error."
  - "Phase 3 browser evidence is seeded through the durable PostgreSQL model and exercised through production Nest and Next boundaries rather than mocked route responses."

patterns-established:
  - "Boundary attack matrix: test hostile labels, unknown fields, cutoff provenance, official lineup status, authorization, download safety, and concurrent convergence together."
  - "Receipt parity: compare parsed canonical JSON across API response, rendered content, clipboard, and fixed-name download."

requirements-completed: [PRED-01, PRED-02, PRED-03, PRED-04, PRED-05, PRED-06, ODDS-01, ODDS-02, ODDS-03, VALUE-01, VALUE-02, VALUE-03, VALUE-04]

coverage:
  - id: D1
    description: Phase 3 snapshot and receipt trust boundaries withstand adversarial inputs and concurrent duplicate requests.
    requirement: PRED-04
    verification:
      - kind: integration
        ref: tests/integration/phase-03-security.test.ts#Phase 3 trust boundaries
        status: pass
      - kind: integration
        ref: node node_modules/vitest/vitest.mjs run --project unit --project integration (44 files, 352 tests)
        status: pass
    human_judgment: false
  - id: D2
    description: The live workbench preserves drafts locally, issues real immutable snapshots, classifies all outcome states, and exports the exact receipt safely.
    requirement: VALUE-04
    verification:
      - kind: e2e
        ref: tests/e2e/forecast-workbench.spec.ts (Chromium, 3 scenarios)
        status: pass
    human_judgment: false
  - id: D3
    description: The complete Phase 3 implementation validates, migrates, typechecks, lints, and builds as one production-ready monorepo.
    requirement: PRED-01
    verification:
      - kind: integration
        ref: tests/integration/migration-empty.test.ts#creates canonical tables and immutable reconciliation audit relations
        status: pass
      - kind: other
        ref: corepack pnpm typecheck && corepack pnpm lint && corepack pnpm build
        status: pass
    human_judgment: false

duration: 47min
completed: 2026-09-06
status: complete
---

# Phase 3 Plan 7: Final Boundary and Workbench Verification Summary

**Adversarial snapshot tests and a production-backed browser chain now prove immutable forecasts, manual odds, exact-pair value receipts, safe exports, and responsive authorized UI behavior.**

## Performance

- **Duration:** 47 min
- **Started:** 2026-09-06T07:32:26Z
- **Completed:** 2026-09-06T08:19:50Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Added a Phase 3 security matrix covering policy order, cutoff/source provenance, official lineup eligibility, hostile labels, unknown fields, download safety, and concurrent immutable-write convergence.
- Replaced the thin browser smoke with a real PostgreSQL → Nest → Next → browser flow that proves local-only drafts, all value outcome states, exact receipt parity, unauthorized denial, and 360px/200% reflow.
- Passed all nine Prisma migrations, the empty-schema contract, 44 Vitest files/352 tests, 3 Chromium scenarios, all seven package typechecks, lint, and production builds.

## Task Commits

1. **Task 1: Attack immutability, cutoff, authorization, pairing, and receipt boundaries**
   - `f12c5df` — RED boundary-attack tests
   - `4a10d6b` — official confirmed-lineup provenance fix
   - `a9d0691` — RED concurrent snapshot race
   - `bb9d170` — concurrent immutable-write convergence
2. **Task 2: Run the live workbench chain and record complete requirement evidence**
   - `55c7fff` — production-backed browser workbench proof and supporting fixes
3. **Verification deviations closed during the full repository gate**
   - `cb80764` — restored cross-phase authorization and budget contracts
   - `acb229d` — stabilized the container-backed migration assertion timeout
   - `4c30402` — isolated replay reservation state between cases
   - `f880344` — aligned client state initialization with React 19 lifecycle rules

## Files Created/Modified

- `tests/integration/phase-03-security.test.ts` — adversarial Phase 3 boundary and concurrency matrix.
- `tests/e2e/forecast-workbench.spec.ts` — seeded live browser chain and exact receipt parity assertions.
- `apps/api/src/modules/forecasts/forecasts.service.ts` — official lineup provenance and collision-safe immutable forecast publication.
- `apps/api/src/modules/odds/odds.service.ts` — collision-safe, payload-aware manual odds publication.
- `packages/domain/src/value/decision.ts` — exact-pair validation without an invalid timestamp-equality constraint.
- `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` — responsive workbench sizing and lifecycle-safe draft restoration.
- `playwright.config.ts` — builds the domain package before starting production-backed API and web servers.
- `apps/api/src/modules/reconciliation/operator.guard.ts` — preserves the established authorization result contract.
- `workers/data-sync/src/jobs/results.ts` — forwards already-authorized critical budget state.
- `tests/integration/migration-empty.test.ts` — realistic timeout for Docker-backed schema assertions.
- `tests/integration/replay-boundary.test.ts` — per-case budget reservation isolation.
- `apps/web/app/internal/pipeline/replay/page.tsx` — lazy browser-timezone initialization.
- `apps/web/app/teams/[teamId]/evidence/page.tsx` — asynchronous evidence loading-state reset.

## Decisions Made

- Exact-pair validation binds forecast ID, odds ID, fixture, market, and immutable contents; requiring equal capture instants would reject every legitimately entered post-forecast odds book.
- Duplicate immutable IDs converge only for identical canonical payloads. A different payload using an existing ID remains a conflict.
- Acceptance evidence comes from real seeded evidence and production application boundaries, with no mocked analysis response.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected official lineup status lookup**
- **Found during:** Task 1
- **Issue:** Forecast publication queried `CONFIRMED`, while durable lineup observations use `OFFICIAL_CONFIRMED`.
- **Fix:** Queried the canonical durable status.
- **Verification:** Focused Phase 3 integration matrix passed.
- **Committed in:** `4a10d6b`

**2. [Rule 1 - Bug] Converged simultaneous immutable snapshot writes**
- **Found during:** Task 1
- **Issue:** Concurrent identical forecast publication could surface Prisma P2002, and odds ID reuse did not distinguish identical from conflicting payloads.
- **Fix:** Re-read the exact immutable identity after insert races and compare odds input hashes before reuse.
- **Verification:** Concurrent forecast, odds, and value requests converge to one durable row each.
- **Committed in:** `bb9d170`

**3. [Rule 1 - Bug] Removed invalid forecast/odds cutoff equality**
- **Found during:** Task 2
- **Issue:** Real manual odds captured after a forecast were always classified as a cutoff mismatch.
- **Fix:** Retained exact identity/fixture/market validation without requiring equal timestamps.
- **Verification:** Live candidate, no-value, and insufficient-evidence browser cases passed.
- **Committed in:** `55c7fff`

**4. [Rule 3 - Blocking] Built the domain package before Playwright servers**
- **Found during:** Task 2
- **Issue:** The production API process could load stale compiled domain output.
- **Fix:** Added the domain build to the Playwright web-server startup chain.
- **Verification:** Production-backed Chromium suite passed.
- **Committed in:** `55c7fff`

**5. [Rule 1 - Bug] Removed 360px/200% horizontal overflow**
- **Found during:** Task 2
- **Issue:** The long immutable forecast identifier widened the snapshot select beyond the viewport.
- **Fix:** Added a minmax-zero workbench grid and constrained the select width.
- **Verification:** Browser overflow assertion passed at 360px and 200% font size.
- **Committed in:** `55c7fff`

**6. [Rule 3 - Blocking] Restored cross-phase gate contracts**
- **Found during:** Full repository verification
- **Issue:** Operator authorization no longer returned its established identity, and result jobs stopped forwarding already-authorized critical reservations.
- **Fix:** Restored both narrow compatibility contracts.
- **Verification:** Three focused integration files/22 tests and the full matrix passed.
- **Committed in:** `cb80764`

**7. [Rule 3 - Blocking] Stabilized empty-database migration timing**
- **Found during:** Full repository verification
- **Issue:** Docker-backed SQL assertions exceeded Vitest's default five-second per-test timeout despite a correct schema.
- **Fix:** Applied a bounded 30-second timeout to the assertion body.
- **Verification:** Empty-database migration contract passed repeatedly.
- **Committed in:** `acb229d`

**8. [Rule 3 - Blocking] Isolated replay budget state**
- **Found during:** Full repository verification
- **Issue:** Reservations accumulated across cases until a later STANDINGS preview hit critical headroom and cascaded into timeouts.
- **Fix:** Cleared reservations after each case in the suite's isolated database.
- **Verification:** Replay boundary suite passed 17/17; full matrix passed 352/352.
- **Committed in:** `4c30402`

**9. [Rule 3 - Blocking] Corrected React effect-state lifecycle violations**
- **Found during:** Full repository verification
- **Issue:** React 19 lint rejected synchronous state writes in three effects.
- **Fix:** Deferred draft hydration, initialized timezone lazily, and sequenced evidence reset through the asynchronous request path.
- **Verification:** Lint, typecheck, and all three browser scenarios passed.
- **Committed in:** `f880344`

---

**Total deviations:** 9 auto-fixed (4 bugs, 5 blocking verification defects).
**Impact on plan:** Every change was required to make the specified trust-boundary and repository-wide verification gates reliable; no product scope was added.

## Issues Encountered

- The shared Phase 3 PostgreSQL container disappeared during one full-suite attempt. It was recreated with the same approved name and port, migrated, and left running for parent cleanup.
- Next.js initially hit a Windows sandbox `spawn EPERM` after successful compilation. The same build completed outside that process-spawn restriction.
- The host runs Node 25.2.1 while the repository engine range is Node 24.x; pnpm emitted warnings, but every verification gate passed.

## Known Stubs

None. “Not available” strings in the reviewed UI are deliberate limited-data states backed by explicit null/absence checks, not placeholder data.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 requirements have deterministic integration and browser evidence and are ready for verification/transition.
- No open implementation blocker remains. The disposable `bet-stats-phase03-pg` container is still running for orchestrator cleanup.

## Self-Check: PASSED

The summary file and all nine implementation/verification commits were found in the repository history.

---
*Phase: 03-forecast-and-manual-value-workbench*
*Completed: 2026-09-06*
