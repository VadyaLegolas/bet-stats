---
phase: 06-release-experience-and-operations
plan: 08
subsystem: privacy-api-ui
tags: [privacy, consent, withdrawal, postgresql, redis, accessibility, playwright]
requires:
  - phase: 06-release-experience-and-operations
    provides: approved fail-closed D-13/D-14 persistence boundary from 06-06 and 06-07
provides:
  - Transactional versioned consent and retained-history writes serialized on the subject row
  - Atomic one-way withdrawal with revocation, link deletion, cache invalidation, and future-write denial
  - Accessible fail-closed privacy page with signed-subject ingress and honest destructive outcomes
affects: [06-09, release-verification, privacy-retention]
tech-stack:
  added: []
  patterns: [shared PostgreSQL subject lock, serializable withdrawal retry, HMAC subject assertion, server-authoritative privacy state]
key-files:
  created:
    - apps/api/src/modules/privacy/privacy.service.ts
    - apps/api/src/modules/privacy/privacy.controller.ts
    - apps/api/src/modules/privacy/privacy.module.ts
    - apps/web/app/privacy/page.tsx
    - apps/web/app/internal-api/privacy/[[...path]]/route.ts
    - tests/e2e/privacy-retention.spec.ts
  modified:
    - apps/api/src/app.module.ts
    - tests/integration/privacy-retention.test.ts
    - tests/e2e/live-provider-stack.ts
key-decisions:
  - "Browser requests never establish identity by assertion alone; the API accepts only bounded HMAC-signed subject-provider headers, and missing configuration remains unavailable."
  - "Consent writes, retained-history writes, and withdrawal serialize on the same subject row; withdrawal retries serialization conflicts without retrying cache failures."
  - "Cache invalidation executes inside the withdrawal transaction boundary so invalidation failure rolls back revocation and history deletion and is never shown as success."
actuals:
  tokens: 13415
  tasks: 2
  commits: 4
duration: 35min active
completed: 2026-09-23
status: complete
---

# Phase 06 Plan 08: Transactional Privacy API and Withdrawal UX Summary

**Race-safe consent and one-way withdrawal now cross real PostgreSQL, Redis, Nest, Next, and browser boundaries while incomplete policy or subject inputs remain deterministically unavailable.**

## Performance

- **Duration:** 35 min active execution across resumed sessions
- **Tasks:** 2
- **Files modified:** 9
- **Node runtime for final evidence:** 24.14.0

## Accomplishments

- Added strict consent, status, retained-view, and withdrawal API routes backed by shared subject-row locking and serializable transactions.
- Made withdrawal revoke active consent, delete both approved personal-history inventories, invalidate the subject cache, deny future writes, and preserve immutable analytical facts without reverse links.
- Added a privacy page with exact unavailable, off, on, confirmation, pending, failure, and success copy plus dialog focus trap, cancel focus restoration, success focus movement, and blocking-error focus.
- Proved opt-in, cancellation, complete deletion, future denial, and fail-closed ordinary-analysis access through the real production boundary without route interception.

## Verification Evidence

| Gate | Result |
|---|---|
| `pnpm exec vitest run --project integration tests/integration/privacy-retention.test.ts -t "consent transaction\|withdrawal race\|future deny\|unlinkable immutable"` under Node 24 | PASS — 4 passed, 18 skipped |
| `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/privacy-retention.spec.ts` under Node 24 | PASS — 3 passed on desktop Chromium |
| API and web typecheck | PASS |
| API and Next production build | PASS — `/privacy` and `/internal-api/privacy/[[...path]]` emitted |

## Task Commits

1. **Task 1 RED: transactional privacy expectations** — `451f4b6`
2. **Task 1 GREEN: transactional consent and withdrawal** — `de74d42`
3. **Task 2 RED: accessible withdrawal journey** — `2a29fb9`
4. **Task 2 GREEN: signed privacy API and accessible UI** — `14e412b`

## Decisions Made

- Kept durable opt-in closed unless all 06-06 policy values and an approved signed subject adapter are explicitly configured; test fixture values exist only inside the owned acceptance stack.
- Derived a one-way database subject key from the verified signed subject rather than persisting browser/session/correlation metadata.
- Returned only a random support-safe correlation ID on withdrawal failure; no subject identifier enters the failure payload or logs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Retried PostgreSQL serialization conflicts during withdrawal**
- **Found during:** Task 2 final integration gate
- **Issue:** A concurrent retained write could win while withdrawal surfaced a serialization failure, leaving the subject active.
- **Fix:** Retry only serialization/deadlock conflicts up to three times; cache failures remain non-retryable and roll back.
- **Files modified:** `apps/api/src/modules/privacy/privacy.service.ts`
- **Committed in:** `14e412b`

**2. [Rule 3 - Blocking] Extended the deterministic lineup capability fixture**
- **Found during:** Task 2 Playwright setup
- **Issue:** The shared release harness used a capability expiry of 2026-09-22, so the production-boundary seed failed after that date before privacy tests could start.
- **Fix:** Extended only the deterministic test capability to the existing 2027 acceptance horizon.
- **Files modified:** `tests/e2e/live-provider-stack.ts`
- **Committed in:** `14e412b`

## Known Stubs

None. Missing production policy and subject-provider values are the approved fail-closed configuration state, not placeholders.

## Threat Flags

No unplanned threat surface was introduced. Signed privacy ingress, bounded timestamps, strict retained-view DTO keys, subject-row locks, cache rollback, and correlation-only failures directly implement T-06-17 through T-06-19.

## Self-Check: PASSED

- All planned API, UI, proxy, integration, and browser artifacts exist.
- Commits `451f4b6`, `de74d42`, `2a29fb9`, and `14e412b` exist in git history.
- Exact integration, Playwright, typecheck, and build gates passed under Node 24.
- No unrelated working-tree files were staged or committed.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-23*
