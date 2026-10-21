---
phase: 01-trustworthy-fixture-discovery
plan: 11
subsystem: reconciliation-review
tags: [nestjs, nextjs, prisma, postgresql, playwright, authorization, audit]
requires:
  - phase: 01-05
    provides: Canonical reconciliation cases, candidates, versioning, and append-only decisions
provides:
  - Credential-disabled-by-default operator review API with constant-time authentication
  - Optimistic, idempotent approve, manual-link, create, and superseding correction commands
  - Internal accessible review workspace with server-only credential proxy and safe provider rendering
  - PostgreSQL 18 witness for version conflict and append-only audit enforcement
affects: [provider-ingestion, reconciliation-operations, audit, internal-tools]
actuals:
  tokens: 7688
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [server-only-credential-proxy, deterministic-idempotency-key, optimistic-case-version, append-only-correction]
key-files:
  created: [apps/api/src/modules/reconciliation/operator.guard.ts, apps/api/src/modules/reconciliation/reconciliation.controller.ts, apps/api/src/modules/reconciliation/reconciliation.service.ts, apps/web/app/internal/reconciliation/page.tsx, apps/web/app/internal-api/reconciliation/[[...path]]/route.ts, tests/integration/review.test.ts, tests/e2e/reconciliation-review.spec.ts]
  modified: [apps/api/src/app.module.ts]
key-decisions:
  - "Derive deterministic decision IDs from case, command kind, and idempotency key so retries return the original append without a schema change."
  - "Keep the operator credential exclusively in Nest and Next server processes; the browser uses a same-origin server proxy and never receives the credential."
  - "Treat corrections as new decisions linked through supersedesDecisionId and protect all writes with the case version."
patterns-established:
  - "Internal operator surfaces fail as generic 404 when their server credential is absent or invalid."
  - "Provider snapshots are rendered as inert React text/JSON, never injected HTML."
requirements-completed: [DATA-05]
coverage:
  - id: D1
    description: "Operator review is disabled without a credential, rejects invalid credentials generically, and appends idempotent version-checked decisions."
    requirement: DATA-05
    verification:
      - kind: integration
        ref: "tests/integration/review.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The internal workspace renders escaped evidence and supports approve, manual link, create, correction, validation, and conflict focus flows without public navigation exposure."
    requirement: DATA-05
    verification:
      - kind: e2e
        ref: "tests/e2e/reconciliation-review.spec.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "PostgreSQL enforces optimistic case versioning and rejects mutation of appended audit decisions."
    requirement: DATA-05
    verification:
      - kind: integration
        ref: "tests/integration/review.test.ts#proves optimistic append-only review against PostgreSQL 18"
        status: pass
    human_judgment: false
duration: 23min active
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 11: Protected Reconciliation Review Summary

**Credential-gated reconciliation review with optimistic atomic decisions, superseding audit corrections, an accessible internal workspace, and a live PostgreSQL 18 integrity witness**

## Performance

- **Duration:** 23 min active execution
- **Completed:** 2026-08-28
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added a disabled-by-default operator API whose credential comparison is constant-time and whose absent/invalid responses are intentionally indistinguishable.
- Implemented oldest-first bounded review queries plus approve, manual-link, reject/create, and correction commands with deterministic retry identity and optimistic case versioning.
- Delivered an internal-only workspace with evidence validation, destructive confirmation, audit history, safe raw JSON, live announcements, and focused conflict recovery.
- Proved the command and database protections against a migrated PostgreSQL 18 instance, including rejection of audit UPDATE operations.

## Task Commits

1. **Task 1: Implement protected append-only review API** — `6426752` (feat)
2. **Task 2: Deliver accessible internal review workspace** — `4874de2` (feat)
3. **PostgreSQL witness: Prove review integrity on the production database engine** — `a2c763d` (test)

## Files Created/Modified

- `apps/api/src/modules/reconciliation/operator.guard.ts` — constant-time disabled-by-default operator guard.
- `apps/api/src/modules/reconciliation/reconciliation.controller.ts` — protected queue, case, and decision endpoints.
- `apps/api/src/modules/reconciliation/reconciliation.service.ts` — atomic versioned commands, deterministic idempotency, creation, and correction logic.
- `apps/web/app/internal/reconciliation/page.tsx` — accessible queue and decision workspace.
- `apps/web/app/internal-api/reconciliation/[[...path]]/route.ts` — server-only credential forwarding proxy.
- `tests/integration/review.test.ts` — authorization, commands, conflict, retry, and PostgreSQL audit witness.
- `tests/e2e/reconciliation-review.spec.ts` — escaping, navigation exclusion, actions, validation, and focus behavior.

## Decisions Made

- Used deterministic decision IDs rather than a new idempotency database column because the existing decision primary key can safely make retries converge without architectural schema expansion.
- Forwarded the credential only from a Next server route, keeping it out of URLs, hydration data, browser storage, UI copy, and client telemetry.
- Allowed the API process to boot without a database while making reconciliation routes fail closed; this preserves unrelated deterministic fixture E2E startup without exposing review data.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Made Nest injection explicit for the operator credential**
- **Found during:** Task 2 browser startup
- **Issue:** Nest attempted to inject the optional constructor string as an unresolved Object dependency.
- **Fix:** Added an optional named injection token with environment fallback.
- **Files modified:** `apps/api/src/modules/reconciliation/operator.guard.ts`
- **Verification:** API startup and all browser tests pass.
- **Committed in:** `4874de2`

**2. [Rule 2 - Missing Critical] Added the server-only Next proxy**
- **Found during:** Task 2 credential-flow design
- **Issue:** A browser-to-Nest request would require exposing the operator credential to client code.
- **Fix:** Added a same-origin server route that injects the credential and returns private, non-cacheable responses.
- **Files modified:** `apps/web/app/internal-api/reconciliation/[[...path]]/route.ts`
- **Verification:** Web typecheck and credential-safe Playwright flow pass.
- **Committed in:** `4874de2`

**3. [Rule 2 - Missing Critical] Added a live PostgreSQL integrity witness**
- **Found during:** Final acceptance review
- **Issue:** Transaction-double tests alone did not prove the production database trigger and concurrent version predicate.
- **Fix:** Applied migrations to PostgreSQL 18, executed a real service decision, asserted stale conflict, and asserted audit UPDATE rejection.
- **Files modified:** `tests/integration/review.test.ts`
- **Verification:** Review integration suite passes 8/8 with PostgreSQL 18.
- **Committed in:** `a2c763d`

---

**Total deviations:** 3 auto-fixed (2 missing critical, 1 blocking)
**Impact on plan:** All changes were required to preserve authorization, audit integrity, or executable verification; no public feature scope was added.

## Issues Encountered

- Docker Desktop was initially unavailable; execution resumed after Docker Engine 29.7.2 became ready and the PostgreSQL witness then passed.
- The host runs Node 25.2.1 while the project specifies Node 24 LTS. Commands passed with the existing engine warning.

## User Setup Required

- Configure `OPERATOR_CREDENTIAL` only in the API and web server environments to enable the internal review deployment. With no credential, the surface remains disabled and returns generic not-found responses.
- Configure `DATABASE_URL` for review operations; absence fails closed.

## Known Stubs

None.

## Next Phase Readiness

- DATA-05 review behavior is ready for provider-created ambiguity cases.
- Future identity/session middleware may replace the shared operator credential while preserving command, version, and audit semantics.

## Self-Check: PASSED

- All eight changed implementation/test files exist.
- Commits `6426752`, `4874de2`, and `a2c763d` exist in history.
- API and web typechecks pass.
- Review integration suite passes 8/8, including PostgreSQL 18.
- Reconciliation browser suite passes 3/3.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
