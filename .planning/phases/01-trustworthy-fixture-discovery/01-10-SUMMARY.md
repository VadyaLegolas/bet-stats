---
phase: 01-trustworthy-fixture-discovery
plan: 10
subsystem: fixture-discovery
tags: [nestjs, nextjs, prisma, playwright, accessibility, iana]
requires:
  - phase: 01-07
    provides: Idempotent canonical fixture and provenance persistence
  - phase: 01-08
    provides: Five-state data-quality and configurable freshness contracts
provides:
  - Database-backed bounded fixture list and canonical detail REST projections
  - URL-owned fixture filters with explicit IANA local-date grouping
  - Accessible read-only fixture detail with provenance, freshness, null, and limitation semantics
affects: [fixture-discovery, forecasting, data-quality, public-navigation]
actuals:
  tokens: 5354
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [database-backed-read-projection, bounded-utc-query, url-owned-filters, non-color-data-state-notice]
key-files:
  created: [apps/web/app/fixtures/[fixtureId]/page.tsx, apps/web/components/data-state-notice.tsx, tests/e2e/fixture-discovery.spec.ts]
  modified: [apps/api/src/modules/fixtures/fixtures.controller.ts, apps/api/src/modules/fixtures/fixtures.service.ts, apps/web/app/fixtures/page.tsx, apps/api/package.json, pnpm-lock.yaml]
key-decisions:
  - "Use PostgreSQL through Prisma whenever DATABASE_URL is configured, retaining the established deterministic test adapter only for secret-free browser verification."
  - "Validate exact UTC instants and cap list windows at 31 days before querying, while the public default remains a rolling 48-hour window."
  - "Preserve fixture filter state in the URL and carry a sanitized fixtures-only return URL into canonical detail navigation."
patterns-established:
  - "Fixture read DTOs expose canonical IDs/names, season, status, provenance, timestamps, state reason, applied freshness threshold, and nullable value together."
  - "Public data-quality explanations combine a textual state label with source/capture metadata and never rely on color alone."
requirements-completed: [DATA-01, DATA-02, DATA-07]
coverage:
  - id: D1
    description: "Bounded list and safe detail endpoints read canonical database relations with stable sorting and honest provenance/null semantics."
    requirement: DATA-01
    verification:
      - kind: e2e
        ref: "tests/e2e/fixture-discovery.spec.ts#fixture discovery API"
        status: pass
    human_judgment: false
  - id: D2
    description: "Users can retain UTC/competition filters in the URL and browse fixtures grouped by calendar date in an explicit IANA zone."
    requirement: DATA-02
    verification:
      - kind: automated_ui
        ref: "tests/e2e/fixture-discovery.spec.ts#keeps filters in the URL and renders local-date groups"
        status: pass
    human_judgment: false
  - id: D3
    description: "Canonical detail is read-only and visibly explains provenance, freshness, missing values, limited data, and missing fixtures without deferred betting controls."
    requirement: DATA-07
    verification:
      - kind: automated_ui
        ref: "tests/e2e/fixture-discovery.spec.ts#shows read-only canonical detail, provenance, freshness and limitations"
        status: pass
    human_judgment: false
duration: 22min
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 10: Trustworthy Fixture Discovery Summary

**Prisma-backed fixture list/detail reads with bounded UTC filtering, URL-owned browsing, IANA date grouping, and visible provenance and limitation semantics**

## Performance

- **Duration:** 22 min
- **Completed:** 2026-08-28
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Replaced the tracer array with canonical Prisma list/detail projections, stable kickoff/ID sorting, bounded UTC validation, safe 404s, and a deterministic no-secret test adapter.
- Added URL-backed competition/range filters and explicit `DISPLAY_TIME_ZONE` grouping without converting absent values to zero.
- Delivered responsive semantic list/detail surfaces with visible state, reason, provider, capture/source time, and distinct empty/error/not-found behavior.
- Kept fixture discovery neutral and read-only; no prediction, odds, value, eligibility bypass, or certainty copy was introduced.

## Task Commits

1. **Task 1 RED: Define fixture discovery API contract** — `ba77e5c` (test)
2. **Task 1 GREEN: Expose canonical fixture read APIs** — `611cf44` (feat)
3. **Task 2 RED: Define accessible fixture journeys** — `5a465f1` (test)
4. **Task 2 GREEN: Deliver trustworthy fixture discovery UI** — `f6b409b` (feat)

## Verification

- `pnpm test:e2e -- fixture-discovery --project=chromium` — 6/6 API and browser tests passed.
- `pnpm typecheck` — 7/7 workspace tasks passed.
- `pnpm build` — 7/7 workspace tasks passed; Next.js produced dynamic list/detail routes.

## Decisions Made

- Production reads select Prisma automatically when `DATABASE_URL` exists; deterministic mode remains an explicit local/test path rather than a provider-ID-coupled production projection.
- Exact `Z`-suffixed ISO instants are accepted, ranges must be positive, and requests beyond 31 days fail before database work.
- Missing provider update time downgrades the projection to `LIMITED` through the shared domain classifier and renders “Not available,” never a fabricated timestamp or zero.
- Detail back-navigation accepts only local `/fixtures` destinations, preventing an externally supplied return URL.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Sanitized detail return navigation**
- **Found during:** Task 2
- **Issue:** URL-owned navigation needs to restore filters without accepting an open redirect target.
- **Fix:** Restricted `returnTo` to local `/fixtures` paths and otherwise falls back to `/fixtures`.
- **Files modified:** `apps/web/app/fixtures/[fixtureId]/page.tsx`
- **Verification:** Browser detail journey verifies the restored fixture-filter URL.
- **Committed in:** `f6b409b`

**2. [Rule 3 - Blocking] Registered API database workspace dependency**
- **Found during:** Task 1
- **Issue:** The API could not consume the established Prisma client until its workspace dependency and lockfile edge were explicit.
- **Fix:** Added `@bet-stats/database` to the API and refreshed the frozen lockfile.
- **Files modified:** `apps/api/package.json`, `pnpm-lock.yaml`
- **Verification:** Full typecheck and build passed.
- **Committed in:** `611cf44`

**Total deviations:** 2 auto-fixed (1 security, 1 blocking). No product scope was added.

## Issues Encountered

- The sandbox blocked Playwright/Next child-process spawning; verification was rerun with approved local process permissions.
- Node 25.2.1 is installed while the repository specifies Node 24 LTS; pnpm emitted engine warnings, but all verification passed.

## Known Stubs

None. “Not available” is the intentional honest-null presentation required by D-13, not unwired data.

## Threat Flags

No security-relevant surface beyond the plan threat model was introduced. List/detail remain public read-only endpoints, with range validation and canonical database projection at the documented browser boundary.

## User Setup Required

Production database-backed reads require the existing validated `DATABASE_URL`. No new external service or secret was introduced.

## Next Phase Readiness

- Fixture discovery now supplies stable canonical read contracts for later forecast eligibility and analytics links.
- Plan 09 eligibility and responsible-copy enforcement remain unchanged and passing.

## Self-Check: PASSED

- All eight created/modified implementation and test files exist.
- Commits `ba77e5c`, `611cf44`, `5a465f1`, and `f6b409b` exist.
- Fresh full E2E, workspace typecheck, and production build evidence is recorded above.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
