---
phase: 07-ci-pipeline-quality-gates
plan: 1
subsystem: ci
tags: [github-actions, eslint, ci, immutability, postgresql-triggers, vitest, docker-harness]

requires:
  - phase: 06
    provides: release-verified monorepo with owned-container integration harness, guarded snapshot tables, and persist functions
provides:
  - GitHub Actions workflow (.github/workflows/ci.yml) with a quality job: pinned action majors, read-only permissions, no secrets/interpolation, ordered install → schema → typecheck → lint → test → build chain, plus the integration-harness entrypoint (root test:integration:docker script)
  - Flat ESLint coverage across all 7 workspace packages (6 new eslint.config.mjs + lint scripts) with a lint-coverage meta-test guarding against lint-script removal
  - Integration test proving DB triggers reject raw UPDATE and DELETE on ValueReceipt, ValueSettlement, ClosingOddsObservation, ForecastMarket (/immutable/) and ResultVersion, SourceObservation (/append-only/)
affects: [07-ci-contract-and-protection, branch-protection-plans, provider-budget-plans]

actuals:
  tokens: 15417
  tasks: 4
  commits: 5
plan_head_before: 0e4518c61bc3debfa3b00a424cc3c615e0f5def7
plan_head_after: 9f2928909e803fe0064b5e351d9f7e2b35c06d04

tech-stack:
  added: [typescript-eslint@8.72.0, globals@17.13.0, eslint@9.39.5 (exact-pinned root devDependencies)]
  patterns: [per-package flat eslint.config.mjs with scripts.lint = "eslint .", CI quality-job step ordering contract, raw-SQL trigger-rejection integration tests]

key-files:
  created:
    - .github/workflows/ci.yml - quality job with pinned actions, read-only permissions, ordered verification chain
    - tests/unit/lint-coverage.test.ts - meta-test asserting all 7 workspace packages keep a lint script and config
    - tests/integration/mutation-rejection.test.ts - six-table trigger-rejection test against real PostgreSQL
    - packages/{config,database,domain,football-data}/eslint.config.mjs, apps/api/eslint.config.mjs, workers/data-sync/eslint.config.mjs - flat configs for the six previously unlintered packages
  modified:
    - package.json - root devDependencies (typescript-eslint, globals) and test:integration:docker script
    - packages/{config,database,domain,football-data}/package.json, apps/api/package.json, workers/data-sync/package.json - lint scripts
    - apps/api (7 files), workers/data-sync (5), packages/database (2), packages/domain (2) - 28 lint errors fixed (unused imports removed, structural projection types, ReturnType repository params, narrowed "code" in error casts, Prisma.InputJsonValue)
    - apps/web (6 effect sites) - targeted set-state-in-effect silences with reasons
    - .planning/config.json - git.allow_default_branch_commits: true (pre-commit guard override for sequential executor on main)

key-decisions:
  - "Lint debt fixed with real code changes; single-line eslint-disable-next-line with a written reason only at deliberate rest-omits or unused-but-significant params, never in config files"
  - "Mutation-rejection test seeds through the guarded persist functions (persist_settlement_receipt, persist_value_settlement), never raw ValueSettlement INSERT, so the DB invariants stay the single enforcement point"
  - "Package-legitimacy checkpoint pre-approved: typescript-eslint@8.72.0, globals@17.13.0, eslint@9.39.5 verified and exact-pinned"
  - "Integration harness baseline established by A/B run (with and without the new test file) to attribute the 12 pre-existing failures definitively"

patterns-established:
  - "Mutation-rejection integration pattern: namespaced seed INSERTs asserted .resolves.toBe(1), then UPDATE → row-exists SELECT → DELETE, each rejection asserted against its trigger-family message"
  - "Per-pid id namespacing with mut- prefix for new integration seeds in the shared harness database"

requirements-completed: [CI-01, CI-03, CI-04]

coverage:
  - id: D1
    description: "CI quality job (ci.yml) with pinned actions, read-only permissions, no secrets or expression interpolation, and the ordered install → schema → typecheck → lint → test → build chain"
    requirement: CI-01
    verification:
      - kind: other
        ref: "tracer chain run green on 2026-10-20: pnpm install --frozen-lockfile && pnpm verify:release:schema && pnpm typecheck && pnpm lint && pnpm test && pnpm build; fail-loud probe of the integration entrypoint exited 1 with the docker CLI error surfaced"
        status: pass
      - kind: unit
        ref: "ci-workflow-contract.test.ts (plan 07-02, executed next wave — asserts the exact workflow strings)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "Flat ESLint coverage of all 7 workspace packages with a lint-coverage meta-test that fails if any package loses its lint script"
    requirement: CI-03
    verification:
      - kind: unit
        ref: "tests/unit/lint-coverage.test.ts (3 tests pass); pnpm lint exits 0 across 7/7 packages"
        status: pass
      - kind: other
        ref: "negative probe: unused const injected into packages/config flipped pnpm lint to non-zero; probe removed, exit 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Six CI-04 mutation gaps closed: raw UPDATE and DELETE rejected by DB triggers on ValueReceipt, ValueSettlement, ClosingOddsObservation, ForecastMarket, ResultVersion, SourceObservation"
    requirement: CI-04
    verification:
      - kind: integration
        ref: "tests/integration/mutation-rejection.test.ts (6/6 pass inside pnpm run test:integration:docker against owned postgres:18-alpine; harness A/B baseline proves the 12 unrelated failures are pre-existing — see Deviations)"
        status: pass
    human_judgment: false

duration: 151min
completed: 2026-10-20
status: complete
---

# Phase 7 Plan 1: CI Pipeline & Quality Gates Summary

**GitHub Actions quality job, repo-wide ESLint coverage with a meta-test, and an integration test proving PostgreSQL triggers reject raw mutation of all six protected snapshot tables**

## Performance

- **Duration:** 2h 31m
- **Started:** 2026-10-20T14:29:13Z
- **Completed:** 2026-10-20T17:00:00Z
- **Tasks:** 4
- **Files modified:** 40

## Accomplishments

- ci.yml quality job with pinned action majors (checkout@v6, pnpm/action-setup@v6, setup-node@v7), `permissions: contents: read`, zero secrets or `${{ }}` interpolation in run bodies, and the monotonic install → schema → typecheck → lint → test → build chain; deliberate breakage probe confirmed the fail-loud contract (non-zero exit, docker CLI error surfaced)
- ESLint extended from 1 to 7 workspace packages: 6 new flat configs, lint scripts, exact-pinned typescript-eslint/globals/eslint root devDeps, all 28 pre-existing errors fixed (real fixes wherever possible, reasoned single-line disables at deliberate sites), plus tests/unit/lint-coverage.test.ts guarding against future lint-script removal — `pnpm lint` exits 0 across 7/7 packages and fails a single-violation negative probe
- tests/integration/mutation-rejection.test.ts closes all six CI-04 gaps: namespaced seed chain (League → … → ValueSettlement via the guarded persist functions, every INSERT asserted `.resolves.toBe(1)`) then UPDATE → row-exists SELECT → DELETE per table with /immutable/i for the reject_append_only_change() family and /append-only/i for prevent_historical_evidence_mutation() — 6/6 green under the owned-container harness

## Task Commits

Each task was committed atomically:

1. **Task 1: ci.yml quality-job tracer** - `e40290e` (fix: coverage-contract test path), `25b6136` (fix: set-state-in-effect silences), `0bd4bfd` (chore: ci.yml + test:integration:docker script)
2. **Task 2: package-legitimacy checkpoint** - approval recorded 2026-10-20 (typescript-eslint@8.72.0, globals@17.13.0, eslint@9.39.5); no commit (record-only task)
3. **Task 3: ESLint coverage + meta-test** - `c9423e9` (feat: flat ESLint for six packages, 28 error fixes, lint-coverage meta-test)
4. **Task 4: CI-04 mutation-rejection test** - `9f29289` (test: six-table trigger-rejection integration test)

## Files Created/Modified

- `.github/workflows/ci.yml` - CI quality job (and integration-job contract hooks) with the security posture asserted by plan 2
- `tests/unit/lint-coverage.test.ts` - fixed set of 7 packages must each declare scripts.lint and an eslint config
- `tests/integration/mutation-rejection.test.ts` - six protected tables, trigger-family-accurate message assertions, no skip branches
- `packages/*/eslint.config.mjs`, `apps/api/eslint.config.mjs`, `workers/data-sync/eslint.config.mjs` - flat configs; database ignores src/generated/**
- root + 6 package `package.json` files - lint scripts and exact-pinned devDependencies
- 12 source files across apps/api, workers/data-sync, packages/database, packages/domain - lint-error fixes; 6 apps/web effect sites - reasoned silences
- `.planning/config.json` - git.allow_default_branch_commits: true (executor guard override; the pre-commit protected-branch assertion was verified still active and returned false for main only because of this explicit override)

## Decisions Made

- **Real fixes over disables:** unused imports removed, projection params typed structurally, repository params typed via `ReturnType<typeof createProviderRoutingRepository>`, caught errors narrowed with `"code" in error`, jsonValue typed `Prisma.InputJsonValue`. Single-line disables with written reasons only at deliberate rest-omits (e.g., intentionally unused error-scoping params).
- **Seeding through persist functions:** ValueSettlement rows are created exclusively via `persist_settlement_receipt` + `persist_value_settlement` so `guard_value_settlement`'s INSERT validation remains the single enforcement point; a raw INSERT would have bypassed exactly what the test exists to protect.
- **A/B baseline for harness attribution:** the failing-harness question (12 failures) was settled by running the full harness twice — with and without the new test file — proving identical failure sets rather than reasoning from symptoms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] git.allow_default_branch_commits override**
- **Found during:** Task 1 (pre-commit guard refused commits on main)
- **Issue:** The pre-commit protected-branch assertion blocks commits on main, but this executor runs sequentially on the main working tree
- **Fix:** Set `git.allow_default_branch_commits: true` in .planning/config.json — the sanctioned override; the guard itself remains active (verified: `git.base-branch --is-protected main` → false only via the explicit override)
- **Committed in:** `.planning/config.json` (final docs commit)

**2. [Rule 1 - Bug] coverage-contract unit test pointed at a moved file**
- **Found during:** Task 1 (tracer chain, unit test failed)
- **Issue:** The test referenced the phase-02 COVERAGE.md at its pre-archive path
- **Fix:** Pointed the test at the archived location
- **Files modified:** tests/unit/… (coverage-contract test)
- **Committed in:** `e40290e`

**3. [Rule 1 - Bug] Six pre-existing react-hooks/set-state-in-effect errors in apps/web**
- **Found during:** Task 1 (tracer `pnpm lint` chain)
- **Issue:** Six deliberate effect sites failed the newly enforced lint chain
- **Fix:** Line-level silences with reasons at those exact sites (no config-level silencing)
- **Committed in:** `25b6136`

**4. [Rule 1 - Bug] ManualOddsSnapshot receipt JSON shape**
- **Found during:** Task 4 (pre-flight single-file run)
- **Issue:** The seed serialized a bare `[...]` array as the odds snapshot receipt, but `guard_value_pair` reads `receipt->'selections'` — the ValueReceipt INSERT failed with "value receipt selection must exist in both immutable source snapshots"
- **Fix:** Wrapped as `{ selections: [...] }`; pre-flight then passed 6/6
- **Committed in:** `9f29289`

### Documented Non-Conformance

**5. Harness-exit-0 acceptance criterion unmet due to pre-existing failures**
- The plan's Task 4 acceptance says the Docker harness exits 0. It exits 1 with 12 failures in replay.test.ts (6), evidence-publication.test.ts (2, one cascading), evidence-browser-contract.test.ts (2), privacy-retention.test.ts (2). An A/B baseline run (file renamed out of the include pattern) reproduces the identical 12 failures without this plan's test; this plan adds 6 passing tests and zero new failures. Root causes (stale English label expectations since the `d44f65f` Russian localization commit; host↔container clock skew tripping ReplayPreview_consumed_after_created with cascading 409s; a privacy.service catch block masking Serializable conflicts as RETENTION_DENIED) are documented in `.planning/phases/07-ci-pipeline-quality-gates/deferred-items.md` for a future repair plan. Per the scope boundary, unrelated pre-existing failures were not fixed here.

---

**Total deviations:** 4 auto-fixed (2 bugs introduced by enforcing new gates on pre-existing debt, 1 blocking guard override, 1 seed-shape bug) + 1 documented non-conformance (pre-existing harness failures, deferred with baseline proof)
**Impact on plan:** All auto-fixes were required for correctness of the newly enforced gates. No scope creep; the deferred failures predate phase 07 and touch none of this plan's deliverables.

## Issues Encountered

- **Package-legitimacy checkpoint (Task 2):** typescript-eslint@8.72.0, globals@17.13.0, eslint@9.39.5 verified against npm and pre-approved; exact pins applied. No slopsquat risk accepted.
- **guard_value_pair receipt shape:** discovered only by running the test against real PostgreSQL — JSON-shape assumptions about the odds receipt cannot be validated by typecheck alone (root tsconfig does not cover tests/); the cheap single-file pre-flight caught it before the 9-minute harness run.
- **12 pre-existing integration failures:** see Deviations #5 and deferred-items.md; attribution established by A/B baseline.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ci.yml is in place for plan 07-02's ci-workflow-contract.test.ts to assert exact strings against; the workflow file is the contract under test.
- ESLint covers 7/7 packages, so CI-03's ordering requirement (lint complete before branch protection goes live) is satisfied.
- The mutation-rejection test will run in the CI integration job from its first push; the 12 pre-existing harness failures will make that job red until a repair plan fixes them — flagged for the wave-2 planner so the required-check rollout accounts for the known-red baseline (deliberate-breakage drill aside).
- No blockers for the remaining wave-2 plans (07-02 contract tests, 07-03 branch protection).

---
*Phase: 07-ci-pipeline-quality-gates*
*Completed: 2026-10-20*

## Self-Check: PASSED

All 9 key files found on disk; all 5 task commits (`e40290e`, `25b6136`, `0bd4bfd`, `c9423e9`, `9f29289`) verified as ancestors of HEAD.
