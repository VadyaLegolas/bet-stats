---
phase: 06-release-experience-and-operations
reviewed: 2026-09-24T16:05:00+02:00
depth: deep
reviewed_commits:
  - 0bea1cb
  - 6232b41
  - 0275524
files_reviewed: 8
files_reviewed_list:
  - apps/web/app/internal-api/privacy/[[...path]]/route.ts
  - apps/web/app/internal-api/privacy/[[...path]]/route.test.ts
  - apps/web/vitest.config.ts
  - tests/e2e/privacy-retention.spec.ts
  - tests/e2e/live-provider-stack.ts
  - workers/data-sync/src/jobs/retention-purge.ts
  - tests/unit/retention-purge-scheduler.test.ts
  - packages/config/src/index.ts
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 06: Release Review Report

**Reviewed:** 2026-09-24T16:05:00+02:00  
**Depth:** deep  
**Files reviewed:** 8  
**Status:** issues_found — do not ship

## Summary

The session parser, request-body canonicalization, expiry-bound privacy cookie, retention re-arm retry, and legacy migration remediation are sound in the reviewed code. Focused Node 24 tests passed: web proxy 5/5 and retention scheduler 2/2.

One release blocker remains: the mandatory D-15 privacy E2E flow still sends the retired `privacy_session=<subject>.<hmac>` credential and the production-like stack does not configure the newly required `AUTH_SESSION_SIGNING_SECRET`. Therefore the deployed proxy rejects every privacy API request from that release test before forwarding it, invalidating the claimed end-to-end privacy evidence.

## Critical Issues

### CR-01: Production-like privacy release flow cannot satisfy the authenticated session boundary

**File:** `tests/e2e/privacy-retention.spec.ts:14-20`, `tests/e2e/live-provider-stack.ts:15`, `apps/web/app/internal-api/privacy/[[...path]]/route.ts:70-81`

**Issue:** The proxy now requires a valid, signed `auth_session` before it will accept or issue a `privacy_session` (lines 74-80). The release test still constructs the old two-component privacy credential (`subjectId.signature`) and never sends an `auth_session`; its live web/API environment also omits `AUTH_SESSION_SIGNING_SECRET`. Consequently `trusted` is null, `subjectId` is null, and `/internal-api/privacy/status`, consent, retention, and withdrawal return `400 SUBJECT_IDENTITY_UNAVAILABLE`. The D-15 command includes this Playwright suite, so the gate cannot prove the required privacy journey and the normal release configuration has no demonstrated issuer for the required trusted credential.

**Fix:** Add the real authenticated-session issuer/boundary to the web runtime and require its signing configuration in the production config contract. Update the owned release stack to provide that secret, then have the E2E test obtain a signed `auth_session` and POST `/internal-api/privacy/session` to receive the short-lived privacy cookie before exercising status/consent/withdrawal. Keep a negative assertion that the legacy credential is rejected. Re-run the complete `pnpm verify:release` gate under Node 24.

## Verified Closed Items

- Proxy signatures cover the canonical JSON body and exact upstream pathname; malformed/non-object POST bodies fail closed.
- A privacy token includes expiry, is capped to 15 minutes, and is bound to subject, session ID, and version of the trusted session.
- A failed re-arm of the retention scheduler schedules a bounded retry; its deterministic regression test covers the failure.
- The migration quarantines invalid legacy retained-view rows before enum and length narrowing.
- D-16 and lifecycle artifacts were inspected; this report does not identify an additional blocker there.

## Verification Evidence

- `C:\Program Files\nodejs\node.exe --version` → `v24.14.0`.
- `corepack pnpm --filter @bet-stats/web test` → 1 file, 5 tests passed.
- `corepack pnpm vitest run --project unit tests/unit/retention-purge-scheduler.test.ts` → 1 file, 2 tests passed.
- `git diff --check 0bea1cb^..0275524` produced no whitespace errors.

---

_Reviewer: independent release reviewer_  
_Reviewed commits: 0bea1cb, 6232b41, 0275524_
