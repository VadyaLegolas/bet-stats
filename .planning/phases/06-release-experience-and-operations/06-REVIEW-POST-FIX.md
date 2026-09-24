---
phase: 06-release-experience-and-operations
reviewed: 2026-09-24T10:05:00Z
depth: deep
reviewed_commits:
  - db18139
  - 7e6a213
  - f72d504
  - 220df05
  - 0b37f6d
  - cd9a825
  - 733400f
  - ed49cb3
  - 7ef872b
  - ed28d9d
files_reviewed: 19
files_reviewed_list:
  - apps/api/src/modules/operations/operations.service.ts
  - apps/api/src/modules/privacy/privacy.service.ts
  - apps/web/app/internal-api/privacy/[[...path]]/route.ts
  - packages/database/prisma/migrations/20260924_retained_view_bounds/migration.sql
  - packages/database/prisma/migrations/20260924_retention_purge_audit/migration.sql
  - packages/database/prisma/schema.prisma
  - tests/e2e/live-provider-stack.ts
  - tests/e2e/live-release-stack.ts
  - tests/e2e/release-degradation.spec.ts
  - tests/integration/operator-overview.test.ts
  - tests/integration/privacy-retention.test.ts
  - tests/unit/privacy-consent-retry.test.ts
  - tests/unit/privacy-proxy-assertion.test.ts
  - tests/unit/privacy-retained-view-input.test.ts
  - tests/unit/release-db-lifecycle.test.ts
  - workers/data-sync/src/jobs/retention-purge.ts
  - workers/data-sync/src/main.ts
findings:
  critical: 4
  warning: 0
  info: 0
  total: 4
status: issues_found
---

# Phase 06: Post-remediation Code Review

**Reviewed:** 2026-09-24T10:05:00Z  
**Depth:** deep  
**Files reviewed:** 19  
**Status:** issues_found

## Remediation evidence — 2026-09-24

- **CR-01:** the web proxy derives its subject exclusively from a server-signed `privacy_session` cookie and ignores caller-controlled `x-privacy-subject`; missing or invalid sessions fail closed. Regression coverage includes an attempted withdrawal for `victim-subject` while the authenticated session belongs to `owner-subject`.
- **CR-02:** all proxied POST bodies are parsed once, normalized to canonical JSON (`{}` for an empty body), signed, and forwarded in that exact representation. Coverage exercises empty consent, empty withdrawal, and formatted retained-view bodies through the proxy assertion verifier.
- **CR-03:** the worker now arms the purge at the earliest persisted `expiresAt` and recomputes after every run, rather than using a daily interval. The PG18 persistence suite includes the `expiresAt` equality boundary.
- **CR-04:** the narrowing migration writes every legacy non-canonical retained-view row to `RetentionMigrationQuarantine` with its source payload and reason before removing the association. The PG18 migration test applies the preceding migrations, inserts a previously-valid legacy row, applies this migration, and verifies `0:1` live-to-quarantined rows.

## Summary

The remediation commits correctly address the owned Prisma-client lifecycle, bounded consent retry, endpoint/nonce binding, operational release probes, and the closed retained-view vocabulary. However, Phase 06 is still not shippable. Four blocker-class defects remain at the privacy boundary and in the forward migration: the proxy treats a caller-controlled header as identity, all bodyless POST privacy actions produce signatures the API rejects, expiry is only swept up to almost 24 hours late, and the new narrowing migration cannot run on values the preceding deployed schema explicitly permitted.

## Original Findings Re-check

| Original finding | Verdict after remediation |
| --- | --- |
| CR-01 replay across endpoint/body | **Open** — nonce/method/path binding exists, but identity is still caller-controlled; POST assertion canonicalization also breaks valid requests. |
| CR-02 old-policy consent | Fixed by exact current-policy tuple checks. |
| CR-03 expiry retained indefinitely | **Open** — a 24-hour sweep leaves data after its stated expiry. |
| CR-04 D-16 matrix bypasses production paths | Fixed: reviewed scenarios now invoke the provider, parser, replay and owned worker boundaries. |
| CR-05 post-readiness child failure swallowed | Fixed: fatal supervision is armed for the release owner. |
| CR-06 partial startup leaks owned resources | Fixed: ownership is published before fallible allocations. |
| WR-01 owned Prisma client | Fixed. |
| WR-02 serializable consent retry | Fixed. |
| WR-03 unbounded retained-view fields | **Open as CR-04 below** — runtime validation is bounded, but the forward migration is not compatible with old valid rows. |

## Critical Issues

### CR-01: Public proxy signs an attacker-selected privacy subject

**File:** `apps/web/app/internal-api/privacy/[[...path]]/route.ts:17-28`  
**Issue:** The supposed trusted proxy takes `x-privacy-subject` directly from the browser request and uses it as the HMAC subject. Any unauthenticated caller can set this header to another known subject ID; the proxy will mint a valid nonce-bound upstream assertion for that victim. The API correctly trusts that assertion in `signedEnvironmentSubjectProvider` (`apps/api/src/modules/privacy/privacy.service.ts:141-157`), so an attacker can read that subject's status, create consent for it, or irreversibly withdraw its retained history. HMAC binding prevents replay, not impersonation.

**Fix:** Derive `subjectId` only from an authenticated server-side session/provider identity, never from an inbound browser header. Reject privacy requests without that authenticated identity. Add an integration test proving that a caller cannot obtain an assertion for a different subject by setting `x-privacy-subject`.

### CR-02: Bodyless privacy POST requests always fail signature verification

**File:** `apps/web/app/internal-api/privacy/[[...path]]/route.ts:21-29`; `apps/api/src/modules/privacy/privacy.service.ts:149-152`  
**Issue:** For `POST /privacy/consent` and `POST /privacy/withdrawal`, the proxy signs the literal empty request body (`request.text()` returns `""`). Nest then exposes no body (or `{}`), and the verifier hashes `JSON.stringify(typed.body ?? {})`, i.e. `"{}"`. The HMAC digests therefore differ and the API rejects every normal consent/withdrawal request. Any whitespace or JSON-serialization difference in `history/view` has the same failure mode. The unit test signs `"{}"` manually and misses the wire-format path.

**Fix:** Use one canonical representation at both hops. For example, have the proxy parse/validate JSON once, serialize it with `JSON.stringify(parsed ?? {})`, sign that exact canonical string, and forward that same string; or capture the raw body in Nest and hash the exact bytes. Add proxy-to-API integration tests for empty `POST /consent`, empty `POST /withdrawal`, and formatted `POST /history/view` bodies.

### CR-03: Retention purge permits personal data to survive nearly 24 hours past `expiresAt`

**File:** `workers/data-sync/src/main.ts:61-64`; `workers/data-sync/src/jobs/retention-purge.ts:7-24`  
**Issue:** The purge runs at worker startup and then at a fixed 24-hour interval. A retained row that expires immediately after a successful run remains in PostgreSQL until the next interval, despite `expiresAt` being the declared end of approved retention. No database constraint, read filter, or per-expiry schedule closes that gap. This does not meet the original required deletion at or before the retention boundary.

**Fix:** Schedule deletion at the earliest outstanding `expiresAt` (and reschedule after each run), or use a database/job schedule with a bounded, documented maximum delay that the policy and UI explicitly disclose. Until then, do not represent the stored expiry as an exact deletion guarantee. Add an integration test that starts the scheduler, creates an item expiring just after a sweep, and proves deletion by the contractual deadline.

### CR-04: Retained-view bounds migration fails on rows the prior release accepted

**File:** `packages/database/prisma/migrations/20260924_retained_view_bounds/migration.sql:3-8`  
**Issue:** The prior schema allowed arbitrary non-empty `resourceType` and unbounded `resourceId`. This migration casts every existing value directly to the single-value enum and `VARCHAR(128)`. Any existing type other than `RESULT`, invalid identifier, or identifier longer than 128 characters aborts `migrate deploy`, preventing the release from starting. This is especially likely because the old application accepted exactly those values. There is neither a preflight/data remediation step nor a safe compatibility strategy.

**Fix:** Add a deploy-time preflight that reports incompatible row IDs and a reviewed, auditable remediation plan before the type change. Prefer an expand/backfill/validate/contract migration: preserve or explicitly delete expired personal rows under an audited procedure, map only demonstrated safe values, and fail before schema mutation with actionable diagnostics for all others. Test migration against representative legacy non-`RESULT` and 129-character rows.

---

_Reviewer: the agent (gsd-code-reviewer)_  
_Reviewed commits: db18139, 7e6a213, f72d504, 220df05, 0b37f6d, cd9a825, 733400f, ed49cb3, 7ef872b, ed28d9d_
