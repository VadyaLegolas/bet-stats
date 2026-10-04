---
phase: 06-release-experience-and-operations
plan: 05
subsystem: operator-recovery
tags: [nestjs, nextjs, postgresql, bullmq, playwright, accessibility, immutable-audit]
requires:
  - phase: 06-release-experience-and-operations
    provides: owned release stack and secret-safe operations center
provides:
  - Frozen ingestion and evaluation recovery envelopes with preview-confirm enforcement
  - Idempotent PostgreSQL plan/outbox convergence with safe correlation state
  - Accessible three-step recovery UI with stale-preview focus recovery
affects: [06-09, release-verification, operator-operations]
actuals:
  tokens: 14182
  tasks: 2
  commits: 6
tech-stack:
  added: []
  patterns: [server-owned recovery envelope, exact evaluation identity, preview-confirm focus recovery]
key-files:
  created:
    - tests/e2e/operator-recovery.spec.ts
  modified:
    - apps/api/src/modules/replay/replay.service.ts
    - apps/web/app/internal/pipeline/replay/page.tsx
    - tests/integration/replay-boundary.test.ts
key-decisions:
  - "Recovery reasons are frozen at preview time and must contain 10-500 trimmed characters."
  - "Evaluation recovery identity is exactly ResultVersion ID, ForecastSnapshot ID, and policy hash; ingestion identity remains its closed provider scope."
  - "All confirmations re-lock and revalidate the persisted preview before converging to one durable plan and delivery."
patterns-established:
  - "Frozen recovery: browser confirmation carries only preview identity/version/fingerprint; PostgreSQL owns scope and audit reason."
  - "Immutable proof: before/after comparisons include exact IDs, hashes, receipts, payload byte counts, and fact fields."
requirements-completed: [OPS-02]
coverage:
  - id: D1
    description: "Ingestion and evaluation recovery require a bounded reason, server-owned impact preview, exact identity, policy/quota revalidation, and idempotent durable confirmation."
    requirement: OPS-02
    verification:
      - kind: integration
        ref: "tests/integration/replay-boundary.test.ts - recovery preview|evaluation recovery|immutable"
        status: pass
    human_judgment: false
  - id: D2
    description: "Keyboard operators can preview, inspect, cancel or confirm recovery and are returned to preview when the frozen envelope becomes stale."
    requirement: OPS-02
    verification:
      - kind: e2e
        ref: "tests/e2e/operator-recovery.spec.ts"
        status: pass
    human_judgment: false
duration: 5h 3m
completed: 2026-09-20
status: complete
---

# Phase 06 Plan 05: Safe Recovery Preview and Confirmation Summary

**Server-owned recovery envelopes now bind exact ingestion or evaluation scope to audited reasons, policy/quota impact, idempotent delivery, and an accessible preview-confirm interaction.**

## Performance

- **Duration:** 5h 3m
- **Started:** 2026-09-20T10:42:29Z
- **Completed:** 2026-09-20T15:45:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Generalized replay into closed ingestion and evaluation recovery while preserving exact `ResultVersion + ForecastSnapshot + policy hash` identity.
- Rejected short reasons, altered fingerprints, expired/changed previews, and policy drift before any plan or delivery is created.
- Converged duplicate confirmation to one PostgreSQL-owned plan/outbox and returned safe plan, correlation, lane, queued/existing, and immutable-guarantee state.
- Added a keyboard-complete three-step UI with exact frozen impact, modal focus containment, Escape/cancel restoration, stale-preview recovery, and success audit copy.
- Proved observations, issued forecasts, value receipts, results, and settlements retain identical IDs, hashes, receipts, payload facts, and counts across recovery.

## Task Commits

1. **Task 1 RED: recovery envelope contracts** - `3fe23ed` (test)
2. **Task 1 RED: exact evaluation identity** - `d32d43c` (test)
3. **Task 1 GREEN: frozen recovery envelopes** - `c8f77c9` (feat)
4. **Task 2 RED: operator recovery journey** - `b1be57b` (test)
5. **Task 2 GREEN: accessible confirmation flow** - `730a1cd` (feat)
6. **Task 1 verification: exact immutable facts** - `ab7b169` (test)

## Verification

- `pnpm exec vitest run --project integration tests/integration/replay-boundary.test.ts -t "recovery preview|evaluation recovery|immutable"`: 4/4 passed.
- `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-recovery.spec.ts`: 2/2 passed against owned PostgreSQL 18, Redis 8, Nest, built Next, and Chromium boundaries.
- API and Web typechecks passed under Node 24.
- API TypeScript build and Next production build passed; the sandboxed Next build first hit `spawn EPERM`, then passed unchanged through the approved host execution channel.

## Files Created/Modified

- `apps/api/src/modules/replay/replay.service.ts` - strict recovery normalization, frozen envelopes, evaluation identity, confirmation revalidation, durable convergence, and safe response projection.
- `apps/web/app/internal/pipeline/replay/page.tsx` - three-step ingestion/evaluation recovery interaction and accessible confirmation dialog.
- `tests/integration/replay-boundary.test.ts` - reason, tamper, stale, evaluation, convergence, delivery, and exact immutable-fact evidence.
- `tests/e2e/operator-recovery.spec.ts` - real-boundary keyboard, focus, stale-preview, and success journey.

## Decisions Made

- Kept recovery persistence inside the existing append-only replay preview/plan/outbox envelope; no direct retry endpoint or mutable job payload was introduced.
- Stored evaluation scope inside the frozen JSON envelope while using existing durable plan/delivery records, avoiding an unplanned schema change.
- Treated ordinary audited recovery as neutral/primary interaction rather than destructive-red styling.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added deterministic signed-ingress and circuit prerequisites to real-boundary recovery tests**
- **Found during:** Task 2 GREEN
- **Issue:** The private recovery gateway correctly denied unsigned browser requests, and replay policy correctly failed closed without a fresh RESULTS circuit fact.
- **Fix:** Signed each preview/queue browser request with the owned test HMAC boundary and seeded a deterministic fresh circuit fact.
- **Files modified:** `tests/e2e/operator-recovery.spec.ts`
- **Verification:** Production-boundary Playwright passed 2/2.
- **Committed in:** `730a1cd`

**2. [Rule 1 - Bug] Restored preview focus only after pending state cleared**
- **Found during:** Task 2 GREEN
- **Issue:** A stale response attempted to focus the preview button while it was still disabled during the pending request.
- **Fix:** Restored focus from an effect after pending became false and the preview was marked stale.
- **Files modified:** `apps/web/app/internal/pipeline/replay/page.tsx`
- **Verification:** Stale-confirmation Playwright scenario passed.
- **Committed in:** `730a1cd`

---

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1)
**Impact on plan:** Both fixes enforce the planned secure gateway and accessibility contract without expanding recovery authority.

## Known Stubs

None.

## Threat Flags

No unplanned threat surface. Browser input, durable confirmation, and API-to-queue boundaries were all declared in T-06-11 through T-06-13 and are covered by automated tamper, stale, reason, and convergence tests.

## User Setup Required

None beyond the existing production operator credential/signing-secret deployment contract.

## Next Phase Readiness

- Plan 06-09 can exercise the same frozen preview-confirm flow in the complete D-16 degradation matrix.
- Safe recovery state exposes only reviewed identity, quota, lane, guarantee, plan, and correlation fields.

## Self-Check: PASSED

- All four created/modified plan files exist.
- Commits `3fe23ed`, `d32d43c`, `c8f77c9`, `b1be57b`, `730a1cd`, and `ab7b169` exist.
- Exact integration, production-boundary Playwright, typecheck, and production build gates passed.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-20*
