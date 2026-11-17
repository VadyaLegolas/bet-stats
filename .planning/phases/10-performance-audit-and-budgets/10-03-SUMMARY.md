---
phase: 10-performance-audit-and-budgets
plan: 03
subsystem: ci-perf-gate
tags: [perf, ci, budgets, fail-closed, contract-test, lighthouse]
requires:
  - "10-01 (scripts/perf-audit.mjs harness, perf-budget.json pinned budgets)"
  - "10-02 (perf-baseline-after.json receipt, tightened budgets)"
  - ".github/workflows/ci.yml (e2e-portable job shape)"
  - "tests/unit/ci-workflow-contract.test.ts (executable workflow policy)"
provides:
  - ".github/workflows/ci.yml performance-budget job (runs node scripts/perf-audit.mjs; exits 1 on any budget regression — PERF-02)"
  - "tests/unit/ci-workflow-contract.test.ts extended to guard all four jobs (quality, integration, e2e-portable, performance-budget)"
  - "Local induced-regression dry-run evidence (this SUMMARY): doctored CLS budget → exit 1 with the breached metric named"
affects:
  - "future UI phases (scanner, journal, new markets) — regressions fail CI instead of shipping"
  - "/gsd-verify-work phase audit (PERF-02 first green CI run is the recorded manual check)"
tech-stack:
  added: []
  patterns: ["CI job clones the e2e-portable body and reuses Playwright's chromium via chromium.executablePath() (D-08 — no second browser download)", "contract-test job-block slicing bounded by the next job key so appended jobs cannot leak assertions", "fail-closed gate proven by induced regression (doctored budget copy in OS temp, never committed)"]
key-files:
  created: []
  modified:
    - .github/workflows/ci.yml
    - tests/unit/ci-workflow-contract.test.ts
    - scripts/perf-audit.mjs
    - scripts/perf/perf-receipts/perf-baseline-before.json
    - scripts/perf/perf-receipts/perf-baseline-after.json
    - tests/unit/perf-audit.test.ts
decisions:
  - "The CI job performs no build steps of its own: the harness builds config/domain/database/api dists and the web production build itself (NEXT_DIST_DIR=.next-e2e internal), boots the owned stack, audits and asserts — one instrument everywhere (D-06/D-08)"
  - "Gate failure path proven locally, not inferred: --assert-only against a doctored budget copy (cls 0.000001) exits 1 with `cls: 0.08710918036748198 > budget 0.000001`; the committed budget file and receipts untouched"
  - "buildReceipt reads the top-level lhr.lighthouseVersion (the old environment path never existed and silently dropped the key, making --assert-only reject the harness's own receipts); both committed receipts repaired with the true value 13.6.0"
metrics:
  duration: 12min
  tasks: 2
  files: 6
  completed: 2026-11-17
status: complete
actuals:
  tokens: 3200
  tasks: 2
  commits: 2
  plan_head_before: f82f6600f2312e729595d88e31381edf91f5421b
  plan_head_after: 1e048e1
commits: 2
estimate:
  tokens: 21000
  tasks: 2
---

# Phase 10 Plan 03: Performance-Budget CI Job + Gate Proof Summary

**One-liner:** The budget gate is wired into CI — a `performance-budget` job runs the same pinned `node scripts/perf-audit.mjs` (same script, same `perf-budget.json`, same mobile profile) after the workspace install, the executable policy test guards all four jobs in the same commit, and the failure path is proven locally: an induced CLS regression exits 1 naming the breached metric.

## What Was Built

### Task 1 — performance-budget CI job + contract-test extension (commit c52503d)

**`.github/workflows/ci.yml`** — new `performance-budget` job after `e2e-portable`, cloned from its body:

- `runs-on: ubuntu-latest`, `timeout-minutes: 25` with a justification comment (workspace dist builds + web production build + 3 pinned Lighthouse audits over one page; Assumption A5 sizing — bump only with evidence from the first measured run).
- Steps: `actions/checkout@v6`, `pnpm/action-setup@v6` (no version input), `actions/setup-node@v7` (node-version 24, cache pnpm), `pnpm install --frozen-lockfile`, `corepack enable`, `pnpm exec playwright install chromium --with-deps`, `node scripts/perf-audit.mjs`.
- The job adds **no build steps**: the harness performs all builds itself and boots the owned stack; comments above the steps explain why (mirroring the e2e-portable comment style). The script runs in default (measure + write + assert) mode and exits 1 on any budget regression — the build fails (PERF-02). Receipt goes to its default path, raw HTML to the OS temp dir; CI commits nothing (D-07), no upload-artifact needed for the gate to function.
- Chromium is reused from Playwright's install (`chromium.executablePath()` inside the harness) — no second browser download, no third-party Lighthouse action (D-08). No `continue-on-error`, no `secrets.`, no `${{ }}` in run bodies, `--frozen-lockfile` everywhere.

**`tests/unit/ci-workflow-contract.test.ts`** (same commit) — the executable policy now guards all four jobs:

- `PERF_JOB = "\n  performance-budget:\n"` added; the job-existence test asserts all four jobs.
- The `runs every job on ubuntu-latest` loop covers `[E2E_JOB, PERF_JOB]` and `[PERF_JOB, undefined]`.
- The e2e block slicing is bounded by `PERF_JOB` (`jobBlock(E2E_JOB, PERF_JOB)` instead of `slice(indexOf(E2E_JOB))` to EOF), so appended jobs can never leak into e2e assertions.
- New job-body test with job-scoped positives only (file-wide negative policy already covers the bans): `corepack enable`, `playwright install chromium --with-deps`, `node scripts/perf-audit.mjs`, and `timeout-minutes:` declared.
- Messages updated: «every commit must execute all four jobs».

**Verify:** `pnpm vitest run --project unit tests/unit/ci-workflow-contract.test.ts` — 16/16 green. Full unit project 531/538 (only the 7 known pre-existing `fixtures-sync.test.ts` failures, deferred in 10-01, scope-untouched). After the Task-fix below: 35/35 for the two touched test files, 532/539 full unit.

### Task 2 — Induced-regression dry-run: the gate fails loudly (evidence-only)

**Exact command** (doctored budget copy in OS temp, never the repo):

```
$raw = Get-Content scripts/perf/perf-budget.json -Raw
$doctored = $raw -replace '"cls": [0-9.]+', '"cls": 0.000001'   # CLS set impossibly low
Set-Content $tmp -Value $doctored                                # $env:TEMP\perf-budget-regression-dryrun.json
node scripts/perf-audit.mjs --assert-only --receipt scripts/perf/perf-receipts/perf-baseline-after.json --budget $tmp
```

**Result (the PERF-02 failure-path evidence):**

```
cls: 0.08710918036748198 > budget 0.000001
DRYRUN_EXIT=1
```

- Exit code **exactly 1**; the breached metric is **named in the output** with its median vs budget — the assertion layer fails closed.
- The throwaway file was deleted (`Test-Path` → False); `git status` on `scripts/perf/` shows only the intentionally patched receipts (see Deviation 1) — **`scripts/perf/perf-budget.json` itself unmodified**; nothing new committed for this task.
- **Outstanding manual verification (per 10-VALIDATION.md Manual-Only):** the CI-green half of PERF-02 — the first green `performance-budget` job run on GitHub Actions after push. The failure path is proven here; the first push observation stays manual.

## Deviations from Plan

**1. [Rule 1 - Bug] `buildReceipt` read `lhr.environment.lighthouseVersion` — a path that does not exist in Lighthouse 13**
- **Found during:** Task 2 (first dry-run attempt)
- **Issue:** the first dry-run exited 1 but with `INVALID_RECEIPT: missing lighthouseVersion`, not the budget breach: `validateReceipt` requires the field (RECEIPT_FIELDS), but both committed baseline receipts lack it. Root cause: `buildReceipt` read `mobileLhrs[0]?.environment?.lighthouseVersion`; in Lighthouse 13 the version is a **top-level** LHR field (`types/lhr/lhr.d.ts` line 31 — `environment` carries benchmarkIndex/networkUserAgent only). The optional chain produced `undefined`, `JSON.stringify` silently dropped the key, and `--assert-only` rejected receipts the harness itself wrote — `--assert-only` was unusable against every receipt this harness ever produced (default-mode runs assert in memory and never hit the path).
- **Fix:** read `mobileLhrs[0]?.lighthouseVersion`; repair both committed receipts with the true value `"13.6.0"` (the pinned root devDependency, the only version ever installed, recorded in 10-01); add a unit test pinning the provenance (buildReceipt output carries the version from the top-level field and round-trips through `validateReceipt`).
- **Files modified:** scripts/perf-audit.mjs, scripts/perf/perf-receipts/perf-baseline-before.json, scripts/perf/perf-receipts/perf-baseline-after.json, tests/unit/perf-audit.test.ts
- **Commit:** 1e048e1

**2. [Rule 3 - Blocking] The plan's literal doctoring regex targeted a nested budget shape that does not exist**
- **Found during:** Task 2 (pre-run inspection)
- **Issue:** the `<automated>` verify used `-replace '"cls": \{[^}]*"budget": [0-9.]+', ...`, matching a `"cls": { "budget": ... }` object; the committed budget file uses flat numbers (`"cls": 0.09`). The regex would match nothing and the doctoring would silently no-op — the gate would pass with an un-doctored copy and the verify would (correctly) throw GATE_DID_NOT_FAIL, masking the real receipt bug above.
- **Fix:** replacement adjusted to the real flat shape (`'"cls": [0-9.]+'` → `'"cls": 0.000001'`) with a `DOCTOR_NOOP` guard that throws if the replacement changes nothing.
- **Files modified:** none (command-only; the doctored file is a throwaway in `$env:TEMP`)

**3. [Operating rule] `gsd_run`/`gsd-tools` unavailable** — STATE.md/ROADMAP.md/REQUIREMENTS.md updated as manual file edits + plain git commits (07-01..10-02 precedent); plan ledger recorded manually (`gsd-plan-head-before-10-03` = f82f660).

## Known Stubs

None — no new runtime code was produced by this plan; the CI job and policy tests are complete declarations, and the dry-run evidence is a real run recorded verbatim above.

## Deferred Issues

- 7 pre-existing `tests/unit/fixtures-sync.test.ts` failures (PrismaClientKnownRequestError, provider-sync domain) — carried from 10-01/10-02 (`.planning/phases/10-performance-audit-and-budgets/deferred-items.md`), untouched by this plan.
- PERF-02's CI-green half: first green `performance-budget` run on GitHub Actions — manual push-time observation per 10-VALIDATION.md (watch the Actions run after the next push to main).
- Assumption A5 (timeout 25 min) sized generously; confirm against the first real CI run and bump only with evidence (T-10-09 accepted).

## Threat Flags

None — no new trust-boundary surface. T-10-07 (workflow tampering) mitigated as planned: the executable policy guards the new job in the same commit. T-10-08 (budget loosening) unchanged; the plan's dry-run doubles as evidence that a lowered budget is *detected* (the breach message names both numbers). T-10-09 accepted with the timeout comment.

## Self-Check: PASSED

- All 6 modified files exist on disk and are committed.
- Commits c52503d and 1e048e1 are ancestors of HEAD; plan ledger base f82f660 recorded before the first commit.
- Contract test 16/16 green (four-job policy); perf-audit tests 19/19; full unit 532/539 (7 known pre-existing fixtures-sync failures).
- Dry-run evidence: exit 1, `cls: 0.08710918036748198 > budget 0.000001`; temp file deleted; committed budget file byte-identical (not in `git status`).
