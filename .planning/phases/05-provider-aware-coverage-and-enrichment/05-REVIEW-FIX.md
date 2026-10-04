---
phase: 05-provider-aware-coverage-and-enrichment
fixed_at: 2026-09-19T19:32:25+02:00
review_path: .planning/phases/05-provider-aware-coverage-and-enrichment/05-REVIEW.md
iteration: 3
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-09-19T19:32:25+02:00  
**Source review:** `.planning/phases/05-provider-aware-coverage-and-enrichment/05-REVIEW.md`  
**Iteration:** 3

**Summary:**

- Findings in scope: 3
- Fixed: 3
- Skipped: 0
- Verification ran in the main checkout (`workflow.use_worktrees=false`).

## Fixed Issues

### CR-01: Reject all special-use provider-logo destinations

**Files modified:** `apps/api/src/modules/media/provider-logo.service.ts`, `tests/integration/phase-05-security.test.ts`  
**Commit:** `5a9ad1d`  
**Applied fix:** Replaced the permissive `unicast` interpretation with explicit IANA special-purpose IPv4 and IPv6 registry exclusions while retaining mapped-address normalization and DNS pinning. Table-driven tests cover every excluded family, including all six addresses called out by review, plus positive global-routing controls.

### WR-01: Exercise production routing and forecast issuance in live acceptance

**Files modified:** `tests/e2e/live-provider-stack.ts`, `tests/integration/live-provider-harness-smoke.test.ts`, `tests/e2e/forecast-comparison.spec.ts`, `tests/e2e/provider-degradation.spec.ts`  
**Commit:** `e6db080`  
**Applied fix:** The live harness now seeds prerequisites only, executes fallback/success/no-fallback through `executeDurableMappedRoute` and `createProviderRoutingRepository`, and publishes all forecast snapshots through `ForecastOrchestrator` and `createPrismaForecastRepository`. Smoke assertions verify three route receipts, four attempts, and three forecasts before browser checks. Browser tests use immutable production-generated IDs and exact runtime receipt identity.

### WR-02: Project persisted budget protection consistently

**Files modified:** `workers/data-sync/src/jobs/enrichment.ts`, `apps/api/src/modules/forecasts/forecast-comparison.service.ts`, `tests/integration/forecast-comparison-api.test.ts`  
**Commit:** `b8c8436`  
**Applied fix:** Forecast availability now maps the immutable `BUDGET_PROTECTED` decision receipt directly. A production-executor-to-availability regression test starts from a `CRITICAL_HEADROOM` reservation denial, verifies the collapsed persisted reason, and verifies the public availability projection.

## Verification

- Security: `phase-05-security.test.ts` — 40 tests passed.
- API/enrichment: `forecast-comparison-api.test.ts` and `enrichment-admission.test.ts` — 16 tests passed.
- Live composition: `live-provider-harness-smoke.test.ts` — 3 tests passed against owned PostgreSQL, Redis, API, web, and worker processes.
- Browser acceptance: `provider-degradation.spec.ts` and `forecast-comparison.spec.ts` — 5 tests passed in Chromium.
- Typechecks passed for `@bet-stats/api`, `@bet-stats/data-sync`, and `@bet-stats/database`.
- Vitest and Playwright ran outside the Windows sandbox because Vite process spawning inside the sandbox fails with `spawn EPERM`.
- Unrelated `apps/web/next-env.d.ts`, the modified review artifact, and pre-existing untracked files were preserved.

## Skipped Issues

None — all findings were fixed.

---

_Fixed: 2026-09-19T19:32:25+02:00_  
_Fixer: the agent (gsd-code-fixer)_  
_Iteration: 3_
