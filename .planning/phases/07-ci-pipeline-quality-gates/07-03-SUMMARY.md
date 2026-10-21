---
phase: 07-ci-pipeline-quality-gates
plan: 3
subsystem: ci
tags: [ci, github-actions, fix-forward, branch-protection, merge-gate, drill, linux-portability]

# Dependency graph
requires:
  - phase: 07-ci-pipeline-quality-gates
    provides: "Plans 1-2 shipped the three-job ci.yml and the local green chain this plan drove to its first real Linux green and then into an enforced merge gate"
provides:
  - "First green three-job CI run on main (39665293727, all jobs success)"
  - "Branch protection on main: required checks [quality, integration, e2e-portable] (read-back proof)"
  - "Merge-blocked proof: red run refuses gh pr merge (verbatim capture)"
  - "Cross-platform hardening of the live-provider test harness and Linux container bind-mount fix"
affects: [07-ci-pipeline-quality-gates, ci-verification, ship]

# Actuals (#2632)
actuals:
  tokens: 0
  tasks: 3
  commits: 5
plan_head_before: d63008310b3b5c63a177d55aa6f66e86f1f4b73a
plan_head_after: 209067353a287c0f089097f74c2614eb07cee9da

# Tech tracking
tech-stack:
  added: []
  patterns: [build-before-test-in-ci, platform-branched-child-process, fix-forward-until-green]

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml
    - tests/e2e/live-provider-stack.ts
    - tests/integration/privacy-retention.test.ts
    - .planning/STATE.md
    - .planning/phases/07-ci-pipeline-quality-gates/deferred-items.md

key-decisions:
  - "Task 2 human decision (2026-10-21): user approved the branch-protection payload verbatim (required_status_checks strict=false with contexts [quality, integration, e2e-portable], enforce_admins=false, no required reviews, no restrictions, force-push/deletion disabled). strict=false keeps each drill commit attributable to its own run."
  - "Root-cause fix for the first red run (39646299934) is build-before-test in CI, not vitest aliases: fixtures-sync.test.ts deliberately mocks the dist entry points (design contract) and worker-entry-guard.test.ts executes workers/data-sync/dist directly, so the unit project must run against built workspace dist — exactly turbo.json's test.dependsOn:[^build"] intent that the root pnpm test script bypasses."
  - "The vitest.config.ts alias fix was applied first, then reverted before commit: it would have broken the fixtures-sync dist-mock contract (mock keys target ../../packages/database/dist/index.js). vitest.config.ts is unchanged on main."
  - "Drill 3 first attempt (76925fd) failed for the wrong cause (ReferenceError: afterAll is not defined); the drill was fixed forward (1e48ba8) so the red is attributable to the guard trigger, not to a test bug."

patterns-established:
  - "Build-before-test in CI: the quality/integration/e2e jobs run `pnpm exec turbo run build --filter=@bet-stats/config --filter=@bet-stats/domain --filter=@bet-stats/football-data --filter=@bet-stats/database --filter=@bet-stats/data-sync` before tests, making the clean checkout behave like the local dev host (dist present)."
  - "Platform-branched child-process harness: win32 -> cmd.exe /c corepack + taskkill /T /F, posix -> corepack + process.kill(-pid) with detached spawn (tests/e2e/live-provider-stack.ts mirrors live-evidence-stack.ts)."

requirements-completed: [CI-01, CI-04]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "First green three-job run observed on real Linux runners before protection (CI-01; plans 1-2 acceptance)"
    requirement: CI-01
    verification:
      - kind: other
        ref: "gh run view 39665293727 — conclusion success, jobs quality 1m26s / integration 4m5s / e2e-portable 1m58s all success (SHA 376d9a7); follow-up run 39665978922 (STATE.md push) also success"
        status: pass
    human_judgment: false
  - id: D2
    description: "Branch protection makes the three checks required for merge (read-back proof recorded per plan Task 2)"
    requirement: CI-01
    verification:
      - kind: other
        ref: "gh api GET branches/main/protection → 'protection ok: quality,integration,e2e-portable' (PUT exit 0, strict=false, allow_force_pushes=false, allow_deletions=false)"
        status: pass
    human_judgment: true
  - id: D3
    description: "Red run blocks merge while green reverts restore it: three sanctioned drills each turned their job red and merge was refused (success criterion 4)"
    requirement: CI-01
    verification:
      - kind: other
        ref: "Drill 1 type error run 39670991039 (quality failure at typecheck step, TS2322, later steps skipped) → gh pr merge refused verbatim 'Pull request VadyaLegolas/bet-stats#4 is not mergeable: the base branch policy prohibits the merge' exit 1; Drill 2 failing test run 39672401978 (quality fails at test step, 1 failed | 380 passed, integration+e2e success); Drill 3 frozen-table mutation run 39674495067 (integration fails with 'ForecastSnapshot is immutable' P0001 from the guard trigger, quality+e2e success = isolation); each revert run green (39671744988, 39673236754, 39675050804)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Frozen-table mutation enforcement (CI-04) is visible in CI on a real runner, not just locally"
    requirement: CI-04
    verification:
      - kind: integration
        ref: "Drill 3 integration job log: 'Raw query failed. Code: P0001. Message: ForecastSnapshot is immutable' at tests/integration/ci-drill-mutation.test.ts:29; 1 failed | 56 passed"
        status: pass
    human_judgment: false

# Metrics
duration: 118min
completed: 2026-10-21
status: complete
---

# Phase 7 Plan 3: CI Pipeline and Quality Gates Summary

**First green three-job run on real runners, enforced branch protection on main, and the three sanctioned red drills that prove a failing pipeline blocks the merge**

## Performance

- **Duration:** ~118 min (CI runs dominate: 9 runs × 3 jobs)
- **Completed:** 2026-10-21
- **Tasks:** 3
- **CI runs observed:** 9 (2 green on main pre-protection + 6 drill runs + 1 green final); all run ids recorded below

## Accomplishments

- **Fix-forwarded the first red CI run to green** — all five root causes diagnosed in the run 39646299934 log were fixed minimally: build-before-test in all three jobs, platform-branched child-process harness (cmd.exe/taskkill on win32, corepack/process.kill(-pid) on posix), and `chmodSync 0o755` on the mkdtemp init dir so the Linux postgres entrypoint can read the bind mount
- **First green run:** `39665293727` — quality 1m26s / integration 4m5s / e2e-portable 1m58s, all `success` (SHA `376d9a7`); confirmation run `39665978922` after the STATE.md push also green
- **Branch protection enabled with the user's explicit approval** — read-back proof: `protection ok: quality,integration,e2e-portable`
- **Success criterion 4 executed end-to-end:** type error, failing test and frozen-table mutation each turned exactly the intended job red; merge was refused while red; every revert restored green; zero drill residue on main

## Task Commits

1. **Task 1: observe → fix-forward → green** — `ca3ec6c` (docs: verified root causes), `5277a47` (fix(ci): build workspace dist before tests in all three jobs), `a791b01` (fix(test): cross-platform live provider stack), `376d9a7` (fix(test): relax init dir mode), `2090673` (docs(state): /internal/dev-session user confirmation)
2. **Task 2: branch protection (checkpoint:human-verify)** — payload approved by the user, PUT + read-back; payload file deleted after use
3. **Task 3: three drills on `ci/phase7-drill` (PR #4)** — drill commits `eddbbf5`, `0f86d31`, `76925fd` (+ fix `1e48ba8`), reverted by `b628f45`, `1d68a26`, `84df056`+`3cc47bf`; branch and PR closed unmerged

**Plan ledger:** before `d630083` → after `2090673` (5 commits on main)

## Files Created/Modified
- `.github/workflows/ci.yml` — turbo build step (5 workspace packages) before `pnpm test` (quality), before `test:integration:docker` (integration), before corepack enable (e2e-portable); contract-test step order untouched
- `tests/e2e/live-provider-stack.ts` — `corepackSync()` helper + platform-branched `run` (detached on posix for group-kill) and `stop` (taskkill /T /F vs process.kill(-pid))
- `tests/integration/privacy-retention.test.ts` — `chmodSync(initDirectory, 0o755)` after `mkdtempSync` (container entrypoint runs as another uid and could not traverse the 0700 bind mount)
- `.planning/STATE.md` — record of the user's confirmation that /internal/dev-session helped with the privacy checkbox

## Drill Evidence (run ids, conclusions, verbatim)

| Drill | Commit | Run | Result |
|---|---|---|---|
| 1 type error | `eddbbf5` | `39670991039` | quality `failure` at `Run pnpm typecheck`: `src/ci-drill-type-error.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'`, exit 2; lint/test/build steps never started |
| revert 1 | `b628f45` | `39671744988` | `success` |
| 2 failing test | `0f86d31` | `39672401978` | quality `failure` at `Run pnpm test`: `FAIL tests/unit/ci-drill-failing.test.ts:5:15`, `1 failed | 380 passed`; integration + e2e-portable `success` |
| revert 2 | `1d68a26` | `39673236754` | `success` |
| 3 mutation (attempt 1) | `76925fd` | `39673830261` | integration `failure` but for the wrong cause (`afterAll is not defined`) — fixed forward |
| 3 mutation (attempt 2) | `1e48ba8` | `39674495067` | integration `failure`: `Raw query failed. Code: P0001. Message: ForecastSnapshot is immutable` at `ci-drill-mutation.test.ts:29`; quality + e2e-portable `success` (isolation proof) |
| revert 3 | `84df056` + `3cc47bf` | `39675050804` | `success` |

**Merge-refusal (verbatim, drill 1 while red):**
```
X Pull request VadyaLegolas/bet-stats#4 is not mergeable: the base branch policy prohibits the merge.
To have the pull request merged after all the requirements have been met, add the `--auto` flag.
To use administrator privileges to immediately merge the pull request, add the `--admin` flag.
```
(exit code 1)

**Teardown proof:** PR #4 `CLOSED`, `merged=never`, branch deleted (local + remote + prune), drill files 404 on main, `git log main -- <drill paths>` empty, payload file removed, worktree clean, main's newest run `2090673` → `success`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's assumed quality fix (vitest aliases) contradicted a test design contract**
- **Found during:** Task 1 fix-forward — reading fixtures-sync.test.ts lines 27-29: "the service graph resolves @bet-stats/* … to the built package dist … the mock keys must target the dist entry points"
- **Fix:** reverted the alias edit (vitest.config.ts unchanged); replaced with build-before-test in ci.yml — the root cause was that the root `pnpm test` script bypasses turbo's `test.dependsOn:["^build"]`
- **Verification:** local gates green (typecheck, turbo filter build, 380 unit + 56 web, full pnpm build), then run `39665293727` all three jobs green

**2. [Rule 1 - Bug] Drill 3 failed for the wrong cause (missing afterAll import)**
- **Found during:** Task 3 Drill 3 first run `39673830261` — integration failed with `ReferenceError: afterAll is not defined` instead of the guard trigger
- **Fix:** added `afterAll` to the vitest import (`1e48ba8`); re-ran and captured the real trigger failure
- **Files modified:** tests/integration/ci-drill-mutation.test.ts (drill artifact; reverted with the rest)

### Non-auto Deviations

**3. Drill 3 needed a fix-forward commit** (recorded above as attempt 1) — the plan's single-commit-per-drill intent was kept for attribution: attempt 2 is a separate run id, both recorded in the evidence table.

## Issues Encountered
- The first red run 39646299934 had five Linux-only root causes (diagnosis log at `$env:TEMP\bet-stats\ci-run1-failed.log`); all fixed, none worked around — no gate was weakened (`git diff ci.yml` only adds build steps)
- PowerShell mangles double quotes inside `gh --jq` expressions; used single-quoted jq filters / file input to avoid re-quoting issues

## Known Stubs
None — no placeholder values or TODOs introduced.

## User Setup Required
None — protection, drills and teardown needed no external configuration beyond the user's approval (granted).

## Next Phase Readiness
- main is protected by three required checks; any future red run blocks merge by policy, not by convention
- Success criterion 4 is fully evidenced (run ids + verbatim refusal) — `/gsd-verify-work` can consume this summary directly
- Drills are proven reproducible: the sanctioned red path is create-branch → one drill commit → observe → merge-refusal → revert → green

---
*Phase: 07-ci-pipeline-quality-gates*
*Completed: 2026-10-21*

## Self-Check: PASSED

All 5 main-branch commits (ca3ec6c, 5277a47, a791b01, 376d9a7, 2090673) are ancestors of HEAD; PR #4 closed unmerged; drill files absent on main (404 ×3); main's newest CI run conclusion = success.
