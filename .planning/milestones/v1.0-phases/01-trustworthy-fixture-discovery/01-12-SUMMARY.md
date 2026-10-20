---
phase: 01-trustworthy-fixture-discovery
plan: 12
subsystem: phase-validation
tags: [vitest, playwright, eslint, prisma, security, nyquist]
requires:
  - phase: 01-09
    provides: Deny-by-default eligibility and responsible-use copy
  - phase: 01-10
    provides: Canonical fixture discovery dashboard and detail
  - phase: 01-11
    provides: Credential-protected append-only reconciliation review
provides:
  - Held-out Phase 1 security and prohibited-surface probes
  - Responsive visual evidence at 360px and 1280px
  - Executable Next.js flat ESLint and complete root unit-test gates
  - Nyquist-compliant requirement, decision and coverage validation matrix
affects: [phase-verification, ci, fixture-discovery, reconciliation-review]
tech-stack:
  added: [eslint@9.39.5, eslint-config-next@16.3.3]
  patterns: [held-out-boundary-probes, flat-eslint-config, screenshot-buffer-evidence, frozen-validation-matrix]
key-files:
  created: [tests/integration/phase-01-security.test.ts, apps/web/eslint.config.mjs]
  modified: [tests/e2e/fixture-discovery.spec.ts, tests/e2e/reconciliation-review.spec.ts, tests/e2e/walking-skeleton.spec.ts, apps/web/app/fixtures/page.tsx, apps/web/app/internal/reconciliation/page.tsx, package.json, packages/config/package.json, apps/web/package.json, pnpm-lock.yaml, .planning/phases/01-trustworthy-fixture-discovery/01-VALIDATION.md]
key-decisions:
  - "Use ESLint 9.39.5 with eslint-config-next 16.3.3 because the official Next transitive React/import/a11y plugins crash under ESLint 10 despite the top-level peer range."
  - "Treat the test-only OPERATOR_CREDENTIAL and syntactic Prisma DATABASE_URL as process-local verification inputs and never persist their values."
  - "Set Nyquist compliant only after a single fresh frozen chain passed install, lint, typecheck, 34 unit tests, 37 integration tests, 14 browser tests, all builds, and Prisma validation."
actuals:
  tokens: 47071
  tasks: 2
  commits: 8
duration: 34min active
completed: 2026-08-28
status: complete
---

# Phase 01 Plan 12: Final Security, UI and Nyquist Validation Summary

**Held-out fail-closed security probes, responsive visual evidence, executable quality gates, and a fully green frozen Phase 1 validation matrix**

## Performance

- **Duration:** 34 min active execution
- **Completed:** 2026-08-28
- **Tasks:** 2
- **Files changed:** 14

## Accomplishments

- Added held-out tests for eligibility denial, server-only operator credentials, unknown state handling, deferred/provider opt-outs, escaping, large payloads, mobile overflow, forced colors, reduced motion, text zoom, and empty/populated fixture states.
- Corrected fixture filter and reconciliation grid overflow exposed by the new 360px/1280px browser probes.
- Restored an executable Next.js flat ESLint gate, fixed the React/Next defects it found, and repaired root unit orchestration so `pnpm test` runs all 34 unit tests rather than one package only.
- Completed the requirement, threat, D-01–D-19 and COVERAGE opt-out audit and set `nyquist_compliant: true` only after a fresh full matrix exited zero.

## Task Commits

1. **Task 1 RED: Add failing held-out boundary probes** — `1ba7c73` (test)
2. **Task 1 GREEN: Activate held-out security/UI matrix** — `22ce756` (test)
3. **Corrective: Restore executable flat ESLint gate** — `90e0721` (chore)
4. **Corrective: Run package config tests from workspace root** — `5ecce0c` (fix)
5. **Corrective: Align walking-skeleton witness** — `5502ebf` (test)
6. **Visual evidence: Capture responsive screenshot buffers** — `4075c31` (test)
7. **Corrective: Run complete root unit project** — `fea86ef` (fix)
8. **Task 2: Sign the complete validation matrix** — `93f953f` (test)

## Verification

- `pnpm install --frozen-lockfile` — green; lockfile current.
- `pnpm lint` — green.
- `pnpm typecheck` — 7/7 workspace tasks green.
- `pnpm test` — 5 files, 34/34 unit tests green.
- `pnpm test:integration` — 7 files, 37/37 tests green, including PostgreSQL 18 migration/review/capability witnesses.
- `pnpm test:e2e` — 14/14 Chromium tests green.
- `pnpm build` — 7/7 workspace builds green.
- `pnpm --filter @bet-stats/database prisma validate` — schema valid with a process-local syntactic `DATABASE_URL`.
- Automated human-check — dashboard/detail rendered at 360px and 1280px with non-empty screenshot buffers; hierarchy, visible state/provenance/null wording, no prohibited controls, forced colors, reduced motion, text zoom and overflow assertions passed. Eligibility/held-out suites passed 16/16 for empty, allowed, blocked, missing-age and stale decisions.

## Decisions Made

- Pinned `eslint-config-next` to the application version (`16.3.3`) and ESLint to `9.39.5`. ESLint 10.9.1 was registry-verified and attempted first, but `eslint-plugin-react@7.37.5` crashed through the official Next config; all current transitive plugin peer ranges support ESLint 9.
- Kept review authorization verification process-local. The credential was supplied only through the test process environment and is absent from client code, hydration, storage, URLs and committed artifacts.
- Used semantic assertions plus in-memory screenshot output as auto-mode visual evidence, avoiding brittle committed pixel snapshots while proving both target viewports rendered.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prevented narrow viewport overflow**
- **Found during:** Task 1 held-out Playwright GREEN
- **Issue:** Fixed-width filter inputs and an intrinsic-width review grid caused horizontal overflow with mobile/large-text and large provider payloads.
- **Fix:** Bounded fixture controls to their container and used a `minmax(0, 1fr)` review grid with safe wrapping/contained raw JSON.
- **Files modified:** `apps/web/app/fixtures/page.tsx`, `apps/web/app/internal/reconciliation/page.tsx`
- **Commit:** `22ce756`

**2. [Rule 3 - Blocking] Restored the missing lint toolchain**
- **Found during:** Task 2 frozen matrix
- **Issue:** The documented `eslint .` workspace command had no dependency or flat config.
- **Fix:** Added exact-pinned ESLint/Next config, then corrected `<a>` navigation and effect-state defects exposed by lint.
- **Files modified:** `apps/web/package.json`, `apps/web/eslint.config.mjs`, `pnpm-lock.yaml`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/internal/reconciliation/page.tsx`
- **Commit:** `90e0721`

**3. [Rule 3 - Blocking] Repaired incomplete unit-test orchestration**
- **Found during:** Task 2 frozen matrix
- **Issue:** The package Vitest path resolved from the wrong directory, then root Turbo discovery ran only that package and omitted repository unit suites.
- **Fix:** Corrected the package root path and made root `pnpm test` run the complete Vitest unit project.
- **Files modified:** `packages/config/package.json`, `package.json`
- **Commits:** `5ecce0c`, `fea86ef`

**4. [Rule 1 - Bug] Updated the stale walking-skeleton locator**
- **Found during:** Task 2 browser matrix
- **Issue:** A text locator became ambiguous after the fixture filter was introduced and the test rejected every button rather than prohibited betting controls.
- **Fix:** Targeted the competition field and fixture link semantically and scoped the negative control assertion.
- **Files modified:** `tests/e2e/walking-skeleton.spec.ts`
- **Commit:** `5502ebf`

---

**Total deviations:** 4 auto-fixed (2 bugs, 2 blocking quality-gate defects). No deferred product scope was added.

## Issues Encountered

- One full integration attempt hit transient Prisma schema-engine startup errors in two Docker PostgreSQL suites. The focused rerun passed 13/13 and the final fresh full matrix passed 37/37; no result was marked green from the failed attempt.
- The host uses Node 25.2.1 while the repository requires Node 24 LTS, so pnpm emitted engine warnings throughout. All validation commands exited zero.
- The text-zoom probe intentionally changes the rendered body style after hydration; Next development logging reports the resulting test-induced hydration attribute warning. Production markup is unchanged and the full browser/build gates pass.

## Known Stubs

None. Null fixture fields and absent credentials/allowlists are deliberate fail-closed inputs, not unwired UI data.

## Threat Flags

No unplanned trust boundary was introduced. The only new process inputs are test-only environment values, and the held-out suite confirms they do not reach browser code.

## Next Phase Readiness

- All 14 Phase 1 requirements, D-01–D-19, high threats and capability opt-out fences have passing witnesses.
- Phase 1 is ready for goal-backward verification with `nyquist_compliant: true`.

## Self-Check: PASSED

- All four key validation artifacts exist on disk.
- All eight Task 1/Task 2 and corrective commits exist in git history.
- Stub scan found only deliberate negative-test patterns for prohibited “coming soon” copy; no production stubs, skipped tests or unrun verification remain.

---
*Phase: 01-trustworthy-fixture-discovery*
*Completed: 2026-08-28*
