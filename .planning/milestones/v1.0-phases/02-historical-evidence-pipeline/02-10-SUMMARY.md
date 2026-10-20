---
phase: 02-historical-evidence-pipeline
plan: 10
subsystem: ui
tags: [nextjs, playwright, axe-core, evidence, replay, accessibility]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: cutoff-aware evidence API and protected bounded replay API
provides:
  - Exact-kickoff fixture-to-team evidence journey with honest limitations and provenance
  - Protected preview-first replay workspace with server-only credential proxy
  - Green Phase 2 Nyquist matrix, full browser suite and accessibility scans
affects: [phase-03, verification, operations-ui, historical-evidence]
actuals:
  tokens: 9611
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: [no-store browser projection, allowlisted operator DTO rendering, preview-frozen confirmation, axe-core browser scan]
key-files:
  created:
    - apps/web/app/teams/[teamId]/evidence/page.tsx
    - apps/web/components/evidence-state-notice.tsx
    - apps/web/app/internal/pipeline/replay/page.tsx
    - apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts
  modified:
    - apps/web/app/fixtures/[fixtureId]/page.tsx
    - tests/e2e/team-evidence.spec.ts
    - tests/e2e/pipeline-replay.spec.ts
    - .planning/phases/02-historical-evidence-pipeline/02-VALIDATION.md
key-decisions:
  - "Phase 2 evidence views fetch a no-store allowlisted browser projection and never substitute a newer cutoff."
  - "Replay credentials remain server-only; the browser receives only classified provider and operation fields."
patterns-established:
  - "Unavailable evidence is null plus an adjacent reason, never a numeric zero."
  - "Replay mutations require a fresh preview identity and an explicit confirmation, with a separate audited revision path."
requirements-completed: [PIPE-05, PIPE-06, PIPE-07, PIPE-08]
coverage:
  - id: D1
    description: Fixture teams link to evidence at the exact kickoff cutoff with honest samples, trace and reproduction receipt
    requirement: PIPE-07
    verification:
      - kind: e2e
        ref: tests/e2e/team-evidence.spec.ts
        status: pass
      - kind: automated_ui
        ref: axe serious/critical scan at 320px
        status: pass
    human_judgment: true
    rationale: Dense evidence hierarchy and readability at zoom still benefit from final human visual judgment.
  - id: D2
    description: Post-cutoff, invalid-cutoff and missing-provenance states fail closed without newer evidence substitution
    requirement: PIPE-08
    verification:
      - kind: e2e
        ref: tests/e2e/team-evidence.spec.ts#fails closed for invalid cutoff, missing freshness, and missing provenance
        status: pass
      - kind: unit
        ref: tests/unit/chronological-features.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Operators preview and confirm bounded replay while secrets and raw exceptions remain server-side
    requirement: PIPE-06
    verification:
      - kind: e2e
        ref: tests/e2e/pipeline-replay.spec.ts
        status: pass
      - kind: integration
        ref: tests/integration/replay.test.ts
        status: pass
    human_judgment: false
  - id: D4
    description: Provider circuit and quota uncertainty remain written, explicit and fail-closed
    requirement: PIPE-05
    verification:
      - kind: e2e
        ref: tests/e2e/pipeline-replay.spec.ts#provider uncertainty fails closed without widening configured allowance
        status: pass
      - kind: integration
        ref: tests/integration/provider-resilience.test.ts
        status: pass
    human_judgment: false
duration: 45min
completed: 2026-08-30
status: complete
---

# Phase 02 Plan 10: Evidence and Replay Journeys Summary

**Exact-cutoff historical evidence and preview-first operator replay journeys with no-store projections, immutable provenance, and green accessibility/security validation**

## Performance

- **Duration:** 45 min
- **Started:** 2026-08-30T07:58:00Z
- **Completed:** 2026-08-30T08:43:00Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Added canonical home/away links from fixture detail to the exact kickoff evidence cutoff, with requested/resolved UTC, 5/10 samples, component limitations, ordered trace and inert receipt.
- Added a protected replay workspace with bounded preview, stale-preview blocking, idempotent and forced-revision confirmations, provider headroom visibility and a server-only credential proxy.
- Closed the Phase 2 validation matrix: Wave 0 47/47, unit 56/56, integration 73/73, typecheck 7/7 packages, full E2E 22/22, and two axe scans with no serious/critical violations.

## Task Commits

1. **Task 1: Navigate from fixture to exact-cutoff team evidence** — `038a47d`
2. **Task 2: Build the protected replay workspace** — `75ce427`
3. **Task 3: Close Nyquist, security and full phase verification** — `dad8ece`

## Files Created/Modified

- `apps/web/app/teams/[teamId]/evidence/page.tsx` — responsive exact-cutoff evidence view and fail-closed states.
- `apps/web/components/evidence-state-notice.tsx` — written pending, unavailable, stale and limited semantics.
- `apps/web/app/internal/pipeline/replay/page.tsx` — preview-first bounded replay UI and confirmation flow.
- `apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts` — private no-store operator credential proxy.
- `apps/web/app/fixtures/[fixtureId]/page.tsx` — exact kickoff evidence links for both teams.
- `tests/e2e/team-evidence.spec.ts` — evidence journey and axe witness.
- `tests/e2e/pipeline-replay.spec.ts` — replay safety, secret projection and axe witness.
- `.planning/phases/02-historical-evidence-pipeline/02-VALIDATION.md` — completed Nyquist evidence matrix.

## Decisions Made

- The browser renders a narrow, no-store evidence/replay projection and never receives the operator credential or unclassified internal error data.
- Forced replay revisions use a distinct reason and confirmation while ordinary replay retains existing logical identities.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Removed certainty language from the neutral Phase 2 shell**
- **Found during:** Task 1
- **Issue:** The global footer contained `guaranteed`, which violated the Phase 2 evidence copy boundary.
- **Fix:** Rephrased the disclosure as outcome uncertainty without weakening the financial-risk warning.
- **Files modified:** `apps/web/app/layout.tsx`
- **Verification:** Team evidence forbidden-copy E2E passes.
- **Committed in:** `038a47d`

**2. [Rule 1 - Bug] Replaced unavailable Playwright matcher**
- **Found during:** Task 2
- **Issue:** Playwright 1.62 did not expose `toBeRequired`, so the test failed before evaluating behavior.
- **Fix:** Asserted the native `required` attribute directly.
- **Files modified:** `tests/e2e/pipeline-replay.spec.ts`
- **Verification:** Replay E2E 4/4 passed before the final accessibility extension.
- **Committed in:** `75ce427`

**3. [Rule 1 - Bug] Corrected exact optional-property types**
- **Found during:** Task 3
- **Issue:** New UI DTO helpers passed explicit `undefined` under `exactOptionalPropertyTypes`.
- **Fix:** Made boundary types explicitly accept absent upstream fields.
- **Files modified:** evidence page and notice component.
- **Verification:** Typecheck passed in 7/7 packages.
- **Committed in:** `dad8ece`

**4. [Rule 3 - Blocking] Stabilized the fixed-time walking skeleton**
- **Found during:** Task 3
- **Issue:** The browser clock was fixed but the Server Component used the real date, eventually moving the deterministic fixture outside the default range.
- **Fix:** Passed the fixed 48-hour UTC range in the URL.
- **Files modified:** `tests/e2e/walking-skeleton.spec.ts`
- **Verification:** Full E2E suite passed 22/22.
- **Committed in:** `dad8ece`

---

**Total deviations:** 4 auto-fixed (3 Rule 1/2 correctness issues, 1 Rule 3 blocker)
**Impact on plan:** Fixes were limited to enforcing the documented copy/security/type/test contracts; no product scope was added.

## Issues Encountered

- The PowerShell-installed `pnpm exec` wrapper misparsed Playwright's `test` command; validation used the installed Node CLIs directly with identical project configuration.
- Full E2E emitted a pre-existing hydration warning during the 200% fixture test, but all assertions passed and no Phase 2 task behavior depended on it.

## User Setup Required

None — the replay route remains intentionally unavailable unless `OPERATOR_CREDENTIAL` is configured server-side.

## Known Stubs

None.

## Next Phase Readiness

- Phase 2 requirements PIPE-01 through PIPE-08 now have green automated witnesses across the completed plan set.
- Final human UAT should judge dense evidence readability at mobile/desktop widths and 200% zoom.

## Self-Check: PASSED

- All key files exist.
- Task commits `038a47d`, `75ce427`, and `dad8ece` exist in git history.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-08-30*
