---
phase: 07-ci-pipeline-quality-gates
verified: 2026-10-21T21:55:00Z
status: passed
score: 10/10 must-haves verified
covered_files:
  - .gitattributes
  - .github/workflows/ci.yml
  - .npmrc
  - .planning/phases/07-ci-pipeline-quality-gates/07-01-PLAN.md
  - .planning/phases/07-ci-pipeline-quality-gates/07-01-SUMMARY.md
  - .planning/phases/07-ci-pipeline-quality-gates/07-02-PLAN.md
  - .planning/phases/07-ci-pipeline-quality-gates/07-02-SUMMARY.md
  - .planning/phases/07-ci-pipeline-quality-gates/07-03-PLAN.md
  - .planning/phases/07-ci-pipeline-quality-gates/07-03-SUMMARY.md
  - package.json
  - playwright.ci.config.ts
  - scripts/verify-release-integration.mjs
  - tests/e2e/live-evidence-stack.ts
  - tests/e2e/live-provider-stack.ts
  - tests/e2e/team-evidence-live.spec.ts
  - tests/integration/mutation-rejection.test.ts
  - tests/integration/privacy-retention.test.ts
  - tests/unit/ci-workflow-contract.test.ts
  - tests/unit/lint-coverage.test.ts
covered_digest: "v3:sha256:dbf93191f3153953dbea57bb8f46f3ecd9546d63565651e6a1748b21f0284504"
behavior_unverified: 0
overrides_applied: 0
gaps: []
---

# Phase 7: CI Pipeline & Quality Gates — Verification Report

**Phase Goal:** A developer can rely on one GitHub Actions pipeline that proves the workspace is installable, schema-valid, type-clean, lint-clean, tested (unit + Docker-backed integration on Linux), and buildable on every push and pull request — with the checks required on main and a proven red-run merge block.
**Verified:** 2026-10-21T21:55:00Z
**Status:** passed
**Re-verification:** No — initial verification (no prior VERIFICATION.md existed)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Three-job pipeline (quality / integration / e2e-portable) runs automatically on push to main and every PR: frozen-lockfile install → schema verify → typecheck → lint → build-before-test → test → build (quality); Docker-backed owned-container integration; portable Playwright E2E | ✓ VERIFIED | `.github/workflows/ci.yml` on disk (77 lines, 3 jobs, all `ubuntu-latest`, `timeout-minutes` 20/25/25); first green run `39665293727` live-confirmed: quality/integration/e2e-portable all `success` (SHA `376d9a7`); latest main run `39680435389` (tip `9e11a0e`) also all green |
| 2 | Quality job keeps the release-gate step order and pinned toolchain (checkout@v6, pnpm/action-setup@v6 no version input, setup-node@v7 node-version 24 cache pnpm) | ✓ VERIFIED | Contract test `tests/unit/ci-workflow-contract.test.ts` asserts the exact order chain and pins; ran it live in this verification: **15/15 passed (2.83 s)** |
| 3 | Lint covers all 7 workspace packages and is a guarded required gate | ✓ VERIFIED | `tests/unit/lint-coverage.test.ts` run live: **3/3 passed**; negative probe recorded in 07-01-SUMMARY (unused const flips `pnpm lint` non-zero); lint green in every CI run; required via branch protection |
| 4 | CI-04 mutation-rejection tests reject raw UPDATE/DELETE on all six protected tables against real Postgres via the owned-container harness | ✓ VERIFIED | `tests/integration/mutation-rejection.test.ts` on disk (ValueReceipt/ValueSettlement/ClosingOddsObservation/ForecastMarket → `/immutable/i`, ResultVersion/SourceObservation → `/append-only/i`); integration harness now passes 467/467 in CI (deferred-items.md closure row) |
| 5 | Integration job is Linux-only, owns its containers, and fails loudly (never skips) when Docker is unavailable | ✓ VERIFIED | `scripts/verify-release-integration.mjs` invokes `execFileSync("docker", …)` with no presence guard — missing docker throws → non-zero; ci.yml contains no `if docker info` / skip branch / `continue-on-error`; fail-loud probe recorded in 07-01 coverage D1 |
| 6 | CI-02 hard constraints: token is read-only (`permissions: contents: read`), no `secrets.` reference, no provider credentials, no live external provider calls; the contract test is the executable backstop inside the quality job | ✓ VERIFIED | On-disk grep of ci.yml: zero matches for `secrets.` / `API_FOOTBALL` / `FOOTBALL_DATA` / `pull_request_target` / `continue-on-error`; contract test asserts all of these and passed live 15/15; 07-REVIEW.md traced every CI-path provider touchpoint to a stub |
| 7 | e2e-portable runs the closed two-spec list under `playwright.ci.config.ts` with no webServer (globalSetup owns the live-evidence stack) | ✓ VERIFIED | `playwright.ci.config.ts` on disk: no `webServer`, `globalSetup: ./tests/e2e/live-evidence-stack.ts`, `forbidOnly`, `retries: 0`; ci.yml passes the explicit two-spec command; green in runs `39665293727` and `39680435389` |
| 8 | Repo parity pins: `.gitattributes` enforces LF, `.npmrc` sets `engine-strict=true` with Node 24 as the sanctioned runtime | ✓ VERIFIED | `.gitattributes` (`* text=auto eol=lf`) and `.npmrc` (`engine-strict=true`) read on disk; `node-version: 24` pinned in ci.yml and asserted by the contract test; portable Node v24.22.0 at `.tools/node24` |
| 9 | Branch protection on main requires exactly [quality, integration, e2e-portable], disallows force pushes and deletions, no required reviews | ✓ VERIFIED | Live read-back this pass: `gh api …/branches/main/protection` → `{"contexts":["quality","integration","e2e-portable"],"strict":false}`, `force_pushes: false`, `deletions: false`, `required_reviews: none` — matches the user-approved payload exactly |
| 10 | Success criterion 4 end-to-end: the three sanctioned drills turn the intended job red, a red run blocks the merge (verbatim refusal), every revert restores green, and zero drill residue remains on main | ✓ VERIFIED | All 8 run ids live-confirmed with matching SHAs and per-job conclusions: drill 1 `39670991039` quality fails at `Run pnpm typecheck` (TS2322); drill 2 `39672401978` quality fails at `Run pnpm test` (`ci-drill-failing.test.ts:5:15`, `1 failed \| 380 passed`, integration+e2e green = isolation); drill 3 `39674495067` integration fails with `P0001 ForecastSnapshot is immutable` at `ci-drill-mutation.test.ts:29` (quality+e2e green = isolation); reverts `39671744988`/`39673236754`/`39675050804` all `success`; PR #4 live-confirmed `CLOSED`, `mergedAt=null`; drill files 404/absent on main (`git ls-files` empty, worktree `Test-Path` false ×3), drill branch deleted; merge refusal recorded verbatim in 07-03-SUMMARY and consistent with the live protection read-back |

**Score:** 10/10 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `.github/workflows/ci.yml` | Three jobs, ordered steps, read-only token, timeouts | ✓ VERIFIED | On disk; `timeout-minutes: 20/25/25` (review fix `9e11a0e`); build-before-test turbo step in all three jobs |
| `tests/unit/ci-workflow-contract.test.ts` | Executable CI-02 security policy, 15 assertions | ✓ VERIFIED | Ran live: 15/15 green; negative self-check (continue-on-error flips red) recorded in 07-02 |
| `playwright.ci.config.ts` | webServer-less CI config, closed spec list | ✓ VERIFIED | On disk, matches |
| `tests/integration/mutation-rejection.test.ts` | Six-table trigger rejection | ✓ VERIFIED | On disk, all six tables + both trigger families |
| `scripts/verify-release-integration.mjs` + root `test:integration:docker` | Owned-container harness, fail-loud | ✓ VERIFIED | On disk; `docker()` has no fallback path; script wired in package.json:19 |
| `tests/unit/lint-coverage.test.ts` | Meta-test guarding 7-package lint coverage | ✓ VERIFIED | Ran live: 3/3 green |
| `.gitattributes`, `.npmrc` | LF pin + engine-strict | ✓ VERIFIED | On disk, exact content |
| `tests/e2e/live-evidence-stack.ts`, `tests/e2e/live-provider-stack.ts` | Owned stack lifecycle, cross-platform teardown | ✓ VERIFIED | POSIX `detached: process.platform !== "win32"` + `process.kill(-pid, SIGTERM → 5 s → SIGKILL)` and win32 `taskkill /T /F` both present (review fix `6afb2bd`) |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| push/PR → ci.yml → three required checks → merge gate | branch protection | required_status_checks contexts | ✓ WIRED | Live read-back shows exactly the three job names as contexts; job names in ci.yml match verbatim |
| ci.yml integration job | `test:integration:docker` → `verify-release-integration.mjs` → vitest integration project (incl. mutation-rejection) | run step | ✓ WIRED | Step present; contract test asserts it and forbids direct vitest calls in that job |
| ci.yml e2e-portable job | `playwright.ci.config.ts` → live-evidence-stack globalSetup → two portable specs | run step | ✓ WIRED | Command line on disk names config + both specs |
| quality job | `tests/unit/ci-workflow-contract.test.ts` (CI-02 backstop) | `pnpm test` unit project | ✓ WIRED | File under `tests/unit/` which the unit project runs; 15/15 green locally |

### Data-Flow Trace (Level 4)

Not applicable in the classic sense (no rendered dynamic data). The data-equivalent chain — CI run conclusion → GitHub required check → branch-protection merge decision — was traced live end-to-end: red run `39670991039` → required check unsatisfied → merge refusal (verbatim, exit 1) → PR #4 closed unmerged; green runs → mergeable again.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| CI-02 contract test (executable backstop) | `pnpm exec vitest run --project unit tests/unit/ci-workflow-contract.test.ts` (Node 24) | 15 passed, 2.83 s | ✓ PASS |
| Lint-coverage meta-test | `pnpm exec vitest run --project unit tests/unit/lint-coverage.test.ts` | 3 passed, 3.02 s | ✓ PASS |
| First green run all three jobs | `gh run view 39665293727 --json jobs` | quality/integration/e2e-portable all `success` | ✓ PASS |
| Branch protection read-back | `gh api repos/VadyaLegolas/bet-stats/branches/main/protection` | contexts `[quality, integration, e2e-portable]`, force-pushes/deletions disabled | ✓ PASS |
| Drill attribution (all three drills) | `gh run view <id> --json jobs` + `gh run view --job=<id> --log` for `39670991039`, `39672401978`, `39674495067` | Intended job/step failed with the exact injected defect (TS2322 / `ci-drill-failing.test.ts:5` / `P0001 ForecastSnapshot is immutable`) | ✓ PASS |
| PR #4 teardown | `gh pr view 4 --json state,mergedAt` | CLOSED, mergedAt=null | ✓ PASS |
| Drill residue absent | `git ls-files \| Select-String ci-drill` + `Test-Path` ×3 + `git branch -a` | empty / False ×3 / no drill branch | ✓ PASS |
| Review fixes strengthen (not weaken) | `git show 6afb2bd`, `git show 9e11a0e` | 6afb2bd: +detached spawn + SIGKILL escalation (harness teardown reliability); 9e11a0e: +timeout-minutes only (5 insertions, fail-closed bounds) — neither touches a gate, both reduce silent-failure surface | ✓ PASS |

### Probe Execution

No phase-declared `probe-*.sh` scripts. Equivalent executable evidence run directly by the verifier: the two named unit files above (single-file runs), plus live `gh` read-backs listed in Behavioral Spot-Checks. The "fail-loud on missing docker" probe and the contract-test negative self-check were executed during execution and are recorded in 07-01/07-02 coverage metadata; the mechanism (unguarded `execFileSync("docker")`, `continue-on-error`-forbidding contract test) was re-confirmed on disk this pass.

### Requirements Coverage

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| CI-01 (pipeline on every push/PR: frozen install, schema, typecheck, lint, unit + Docker integration, build; required checks; drills block merge) | ✓ SATISFIED | Truths 1–5, 9, 10; live run + protection evidence |
| CI-02 (Linux + Docker fail-loud; never calls live providers; contract test backstop) | ✓ SATISFIED | Truths 5–6 |
| CI-03 (lint covers all workspace packages before becoming required) | ✓ SATISFIED | Truth 3; lint landed in wave 1 before protection in wave 3 |
| CI-04 (CI-enforced mutation rejection at DB layer) | ✓ SATISFIED | Truths 4, 10 (drill 3 shows the guard trigger firing on a real runner) |

No orphaned requirements: REQUIREMENTS.md maps exactly CI-01…CI-04 to Phase 7, all claimed by plans.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| 07-03-SUMMARY.md drill-1 row | Records only the quality failure for drill 1 (`39670991039`), but live per-job data shows all three jobs were red in that run: the injected root-`src/` type error also broke `pnpm --filter @bet-stats/api build`, which the integration harness and e2e globalSetup legitimately invoke | ⚠️ Warning (documentation completeness, not a gate defect) | The corresponding job did fail at the intended step and SC4 ("turns the pipeline red") is fully satisfied; drills 2 and 3 prove per-job isolation. Causal chain of the collateral reds is legitimate, not flaky. Summary under-discloses; no fix required for the goal |
| — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` debt markers in any phase-created/modified file | ✓ clean | — |
| 07-REVIEW.md MEDIUM-02/03/04, LOW-01…06, NITs | Remaining hardening findings from the code-review gate (shared tmpdir pointer, contract-test evasion surface, static `/health/ready`, mutable action majors, no artifact upload on red e2e, etc.) | ℹ️ Info | Tracked in 07-REVIEW.md as follow-ups; none touches a phase must-have; HIGH-01 and MEDIUM-01 were fixed (`6afb2bd`, `9e11a0e`) |
| commit `4f8e3b9` | Subject "x" on a bulk planning-docs commit | ℹ️ Info | Hygiene only; no code impact |
| worktree | Untracked `bet-stats-main.zip`, modified `apps/web/next-env.d.ts` | ℹ️ Info | Pre-existing local noise, not phase artifacts; orchestrator commit hygiene item |

### Human Verification Required

N/A — infrastructure/foundation phase with no user-facing elements. All acceptance criteria were verified programmatically, including the live GitHub reads (branch protection, run conclusions, drill logs, PR state). The one human decision the phase required (branch-protection payload approval) was executed and recorded during wave 3, and this pass re-read the live protection state against that payload.

### Gaps Summary

No gaps. Every roadmap success criterion (1–4) and every plan must-have truth is backed by on-disk artifacts re-checked by the verifier and by live GitHub evidence (run ids, per-job conclusions, failure-log text, branch-protection read-back, PR state) that matches the summaries' claims. The only finding is a documentation-completeness nuance on the drill-1 row of 07-03-SUMMARY.md (non-isolation of the other two jobs in that run, causally legitimate), recorded above as a warning that does not affect the goal.

---

_Verified: 2026-10-21T21:55:00Z_
_Verifier: the agent (gsd-verifier, subagent spawn)_
