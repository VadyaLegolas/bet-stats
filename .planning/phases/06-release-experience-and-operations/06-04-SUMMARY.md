---
phase: 06-release-experience-and-operations
plan: 04
subsystem: operations-observability
tags: [nestjs, nextjs, prisma, playwright, hmac, secret-safety]
requires:
  - phase: 06-release-experience-and-operations
    provides: owned PostgreSQL/Redis/API/web release harness and desktop Chromium tracer
provides:
  - Closed durable operations overview for readiness, providers, quotas, failures, data quality, and incidents
  - Signed HMAC operations gateway with uniform not-found denial and allowlisted response headers
  - Responsive manual-refresh operations center with bounded failure pagination and accessible correlation copying
affects: [06-05, 06-09, release-verification, operator-recovery]
actuals:
  tokens: 11080
  tasks: 3
  commits: 6
tech-stack:
  added: []
  patterns: [closed operational DTO projection, canonical signed internal gateway, block-local resilient operator UI]
key-files:
  created:
    - apps/api/src/modules/operations/operations.service.ts
    - apps/api/src/modules/operations/operations.controller.ts
    - apps/api/src/modules/operations/operations.module.ts
    - apps/web/app/internal-api/operations/[[...path]]/route.ts
    - apps/web/app/internal/operations/page.tsx
    - tests/integration/operator-overview.test.ts
    - tests/e2e/operator-overview.spec.ts
  modified:
    - apps/api/src/app.module.ts
    - tests/e2e/live-provider-stack.ts
key-decisions:
  - "Operations projections use explicit Prisma selects and reviewed scalar constructors; raw observations, metadata blobs, headers, environments, stacks, and logs are not queried."
  - "Failure diagnostics are bounded to 25 jobs per page and normalized closed reason, scope, impact, retryability, timestamp, logical identity, and correlation fields."
  - "Browser access inherits the replay gateway's canonical subject/timestamp/method/path/query HMAC contract and uniform 404 denial."
patterns-established:
  - "Closed diagnostics: durable records are projected into allowlisted DTOs before crossing the API boundary."
  - "Operations hierarchy: readiness, providers, quotas, failures, data quality, then incidents share one responsive DOM order."
requirements-completed: [OPS-01]
coverage:
  - id: D1
    description: "Authorized operators receive the complete D-09/D-10 overview with bounded grouped failures and no forbidden diagnostic content."
    requirement: OPS-01
    verification:
      - kind: integration
        ref: "tests/integration/operator-overview.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Canonical signed ingress alone reaches the internal operations controller while denial remains indistinguishable from a missing route."
    requirement: OPS-01
    verification:
      - kind: integration
        ref: "tests/integration/operator-overview.test.ts#signed gateway"
        status: pass
    human_judgment: false
  - id: D3
    description: "Desktop and 320px mobile operations views preserve hierarchy, safe correlations, pagination, reflow, and raw-canary absence."
    requirement: OPS-01
    verification:
      - kind: e2e
        ref: "tests/e2e/operator-overview.spec.ts"
        status: pass
    human_judgment: false
duration: 5h 8m
completed: 2026-09-20
status: complete
---

# Phase 06 Plan 04: Secret-Safe Operations Center Summary

**A guarded operations center now turns durable PostgreSQL facts into bounded readiness, provider, quota, failure, quality, and incident views without exposing raw payloads or secrets.**

## Performance

- **Duration:** 5h 8m
- **Started:** 2026-09-20T05:26:54Z
- **Completed:** 2026-09-20T10:35:26Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added an `OperatorGuard`-protected, private/no-store Nest projection with strict query validation, explicit safe fields, closed reason/correlation normalization, bounded windows, grouping, and 25-item pagination.
- Added a canonical HMAC internal gateway that forwards only the server-held operator credential and returns only allowlisted response headers.
- Added a responsive operations page in the locked D-09 order with manual refresh, local state presentation, exact quota denominators, accessible failure disclosure, URL pagination, and copy announcements.
- Proved seeded secrets, raw payloads, headers, environment values, stack traces, and unrestricted-log canaries remain absent recursively from API output and browser DOM.

## Task Commits

1. **Task 1 RED: closed operator overview contract** - `9e4fcc9` (test)
2. **Task 1 GREEN: durable safe projection** - `8092546` (feat)
3. **Task 2 RED: signed gateway contract** - `d1006ca` (test)
4. **Task 2 GREEN: signed internal gateway** - `5b2e858` (feat)
5. **Task 3 RED: responsive real-boundary journey** - `9308fa6` (test)
6. **Task 3 GREEN: operations center UI** - `50ef66d` (feat)

## Verification

- `pnpm exec vitest run --project integration tests/integration/operator-overview.test.ts`: 5/5 passed.
- `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts`: 2/2 passed against owned PostgreSQL 18, Redis 8, Nest, built Next, and Chromium boundaries.
- API and web typechecks passed on Node 24.19.0.
- API TypeScript build and Next production build passed.
- D-12 scan confirmed production code never selects `SourceObservation.rawPayload`; all six seeded canary families were absent from closed JSON and DOM.

## Files Created/Modified

- `apps/api/src/modules/operations/operations.service.ts` - bounded durable repository and closed overview projection.
- `apps/api/src/modules/operations/operations.controller.ts` - guarded private/no-store overview route.
- `apps/api/src/modules/operations/operations.module.ts` and `apps/api/src/app.module.ts` - module composition.
- `apps/web/app/internal-api/operations/[[...path]]/route.ts` - signed ingress verification and safe proxy.
- `apps/web/app/internal/operations/page.tsx` - responsive accessible operator surface.
- `tests/integration/operator-overview.test.ts` - authorization, projection, strict-input, pagination, and recursive-canary evidence.
- `tests/e2e/operator-overview.spec.ts` - production-boundary desktop/mobile hierarchy and DOM-canary evidence.
- `tests/e2e/live-provider-stack.ts` - deterministic test-only operator credentials for the owned release stack.

## Decisions Made

- Derived incidents from open/half-open durable circuit records and data-quality groups from open reconciliation cases; no new mutable incident store was introduced.
- Kept Redis as a readiness/coordination signal only; PostgreSQL facts remain authoritative for outcomes.
- Used stable reason codes and safe logical identities rather than arbitrary exception text or metadata.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Supplied deterministic operator boundary inputs to the owned release harness**
- **Found during:** Task 3
- **Issue:** The Phase 06 shared stack did not start API/web with the operator credential, signing secret, or authorized subject needed to cross the new real gateway.
- **Fix:** Added fixed test-only values to owned child-process environments; no production credential or user secret was introduced.
- **Files modified:** `tests/e2e/live-provider-stack.ts`
- **Verification:** Both real-boundary desktop/mobile tests passed.
- **Committed in:** `50ef66d`

**2. [Rule 1 - Bug] Replaced an invalid browser date-format option combination**
- **Found during:** Task 3 GREEN
- **Issue:** `dateStyle`/`timeStyle` cannot be combined with `timeZoneName`, causing the hydrated page to enter the route error boundary.
- **Fix:** Used explicit localized date/time fields plus the required visible time-zone abbreviation.
- **Files modified:** `apps/web/app/internal/operations/page.tsx`
- **Verification:** Both Chromium viewport cases passed.
- **Committed in:** `50ef66d`

---

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1)
**Impact on plan:** Both fixes were required to exercise and render the planned secure operator boundary; no scope expansion or diagnostic weakening occurred.

## Known Stubs

None. `Not available` is an intentional safe rendering for nullable operational facts, not placeholder data.

## Issues Encountered

- Concurrent Plan 06-02 and 06-04 Playwright runs share fixed owned-stack ports 3240/3241 and `.next`; final verification was serialized after 06-02 released those resources.
- The default shell resolved Node 25, so all release-boundary verification explicitly activated the installed Node 24.19.0 runtime.

## Threat Flags

No unplanned threat surface. The signed gateway and database-to-browser boundary were both listed in the plan threat model and are covered by T-06-08/T-06-09/T-06-10 mitigations.

## User Setup Required

Production deployment must supply `OPERATOR_CREDENTIAL`, `OPERATOR_PROXY_SIGNING_SECRET`, and `OPERATOR_AUTHORIZED_SUBJECTS` through its existing secret-management boundary. No value is committed for production.

## Next Phase Readiness

- Plan 06-05 can link reviewed recovery previews from the safe failure scopes and correlations exposed here.
- Plan 06-09 can reuse the closed DTO and signed live stack for the full D-16 degradation matrix.

## Self-Check: PASSED

- All nine planned or required harness files exist.
- Commits `9e4fcc9`, `8092546`, `d1006ca`, `5b2e858`, `9308fa6`, and `50ef66d` exist.
- Targeted integration, production-boundary E2E, API/web typechecks, and builds passed.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-20*
