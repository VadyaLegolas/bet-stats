---
phase: 06-release-experience-and-operations
reviewed: 2026-09-24T15:48:00+02:00
depth: deep
reviewed_commits:
  - 526f878
  - 762607b
  - 2db89ef
  - 3b345a2
files_reviewed: 8
files_reviewed_list:
  - apps/web/app/internal-api/privacy/[[...path]]/route.ts
  - apps/api/src/modules/privacy/privacy.service.ts
  - workers/data-sync/src/jobs/retention-purge.ts
  - workers/data-sync/src/main.ts
  - packages/database/prisma/migrations/20260924_retained_view_bounds/migration.sql
  - tests/unit/privacy-proxy-assertion.test.ts
  - tests/unit/retention-purge-scheduler.test.ts
  - tests/integration/privacy-retention.test.ts
findings:
  critical: 3
  warning: 0
  info: 0
  total: 3
status: resolved
---

# Phase 06: Final Adversarial Review

**Reviewed:** 2026-09-24T15:48:00+02:00  
**Depth:** deep  
**Status:** issues_found — do not ship

## Summary

The four remediation commits correctly canonicalize proxied POST bodies, move normal purge scheduling to the earliest persisted expiry, and quarantine legacy retained-view values before narrowing the schema. The migration's quarantine SQL is compatible with the legacy rows described by the prior review.

However, Phase 06 still has three blocker-class defects. The replacement privacy identity mechanism is neither issued by an authentication provider nor time-bounded; a transient failure while re-arming the purge permanently disables future deletion; and the new proxy unit suite cannot run under the repository's own root unit-test project. This means the claimed privacy remediation and its release evidence are not reliable.

## Original Blocker Re-check

| Prior blocker | Final verdict | Evidence |
| --- | --- | --- |
| Caller-controlled privacy identity / body assertion | **Open in a new form** | Identity is no longer read from `x-privacy-subject`, and canonical bodies fix the previous wire-format mismatch. But no application component issues the required cookie and its HMAC contains neither an expiry nor an auth-session identifier. |
| Expiry purge | **Open** | The scheduler normally targets the earliest expiry, but a failed re-arm has no retry path and stops all future purges. |
| Legacy retained-view narrowing migration | **Fixed** | The forward migration quarantines both non-`RESULT` types and noncanonical/oversized IDs before enum/VARCHAR conversion. |
| Remediation evidence / release testability | **Open** | The new root unit test imports `next/server`, but `next` is only a dependency of `apps/web`; the configured root unit project cannot resolve it. |

## Critical Issues

### CR-01: The required privacy session credential is never issued and never expires

**File:** `apps/web/app/internal-api/privacy/[[...path]]/route.ts:17-20,49-51`  
**Issue:** `createPrivacySessionAssertion` creates only `subjectId.HMAC(subjectId)`. No route, middleware, or configured authentication-provider adapter issues `privacy_session`; repository-wide search finds this function only in this route and tests. Consequently, production privacy routes fail closed for every normal browser. If an external caller does mint the documented cookie, it stays valid indefinitely until the global signing secret rotates because the signed payload has no issued-at, expiry, session ID, or revocation lookup. A copied cookie therefore remains an enduring authorization to read, consent for, or irreversibly withdraw that subject's retained history.

**Fix:** Integrate the proxy with the application's authenticated server-side session rather than inventing an unissued cookie protocol. Bind the assertion to a server-authenticated subject plus a short expiry and session/revocation version; issue it with `Secure`, `HttpOnly`, `SameSite` attributes from the auth boundary. Add an end-to-end test that obtains a real session and proves expired/revoked sessions are denied.

### CR-02: A transient database failure while re-arming the purge disables retention deletion permanently

**File:** `workers/data-sync/src/jobs/retention-purge.ts:52-59`  
**Issue:** The timer callback invokes `void run()`. `run()` catches failures from `purgeExpiredRetention`, but then awaits `arm()` outside that `try`. If the `min(expiresAt)` query fails during a transient PostgreSQL outage, `run()` rejects unobserved and no replacement timer is created. The scheduler remains alive but never purges again, so expired personal associations can persist indefinitely. The initial `void arm().catch(input.onError)` only covers startup, not this ordinary post-purge re-arm path.

**Fix:** Make both purge and re-arm failures enter a retrying error path. For example, wrap the full run in `try/catch/finally`, report the error, and schedule a bounded retry timer when `arm()` fails; attach a `.catch` to the timer-launched promise. Add a fake-database test where the second minimum-expiry query rejects and assert that a retry is armed and a later expiry is deleted.

### CR-03: The proxy regression suite cannot execute in the repository's configured unit-test environment

**File:** `tests/unit/privacy-proxy-assertion.test.ts:3`; `apps/web/package.json:10-15`; `vitest.config.ts:14-23`  
**Issue:** The new root unit test directly imports `NextRequest` from `next/server`. `next` is declared only in `apps/web/package.json`, while the unit project runs tests from `tests/unit/**` at the repository root and has no alias or root dependency for `next`. Under Node 24.14.0, after `pnpm install --frozen-lockfile`, the focused command fails before collecting tests with `Cannot find package 'next/server' imported from .../tests/unit/privacy-proxy-assertion.test.ts`. Thus `pnpm test`/`pnpm verify:release` cannot provide the claimed regression evidence.

**Fix:** Move this test into the web workspace and run it using that workspace's test configuration, or avoid importing Next in the root test by testing a framework-independent request adapter. Ensure the root release command executes the selected test and add its successful Node 24 output to the remediation evidence.

## Verification Evidence

- Node 24 was selected explicitly: `C:\Program Files\nodejs\node.exe --version` → `v24.14.0`.
- `pnpm install --frozen-lockfile` completed successfully.
- Docker daemon access was available after authorization: `docker version --format '{{.Server.Version}}'` → `29.7.2`.
- `tests/unit/retention-purge-scheduler.test.ts` passed (1/1) under Node 24.
- The focused proxy suite failed at module resolution before running any test: `Cannot find package 'next/server' imported from D:/Documents/Atom/bet-stats/tests/unit/privacy-proxy-assertion.test.ts`.
- The PostgreSQL 18 migration test is present and its SQL was inspected; it was not accepted as independent green evidence because the Vitest integration invocation did not produce a completed test summary in this environment.

---

## Resolution Evidence (2026-09-24)

All three blockers were resolved in `0bea1cb` and `6232b41`.

- CR-01: the web proxy now creates `privacy_session` only from a signed `auth_session`; both credentials have signed subject, session ID, version, and expiry. The privacy credential is capped at 15 minutes, emitted as `HttpOnly; Secure; SameSite=Lax`, and rejected when expired, invalid, or bound to a different subject/session/version.
- CR-02: re-arm failures are caught, reported, and scheduled through a bounded retry timer. The deterministic scheduler test simulates a failed second minimum-expiry query and proves the retry re-arms the idle poll.
- CR-03: NextRequest-based proxy tests now run in `apps/web`, the workspace that owns `next`; root `pnpm test` invokes `pnpm --filter @bet-stats/web test`.

Verification (Node 24 requested by release policy; this workstation currently exposes Node 25.2.1, so the commands passed with an engine warning):

- `pnpm --filter @bet-stats/web typecheck` — passed.
- `pnpm --filter @bet-stats/web test` — 1 file, 5 tests passed.
- `pnpm vitest run --project unit tests/unit/retention-purge-scheduler.test.ts` — 1 file, 2 tests passed.

_Reviewer: the agent (gsd-code-reviewer)_  
_Reviewed commits: 526f878, 762607b, 2db89ef, 3b345a2, 0bea1cb, 6232b41_
