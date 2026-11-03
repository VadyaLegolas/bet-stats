---
phase: 08-backups-and-restore-verification
plan: 07
subsystem: workers/data-sync
tags: [gap-closure, backup-drill, fail-closed, cleanup-verdict, wr-05, in-05, tdd]

gap_closure: true
gap_ids: [WR-05]

# Dependency graph
requires:
  - phase: 08-backups-and-restore-verification (plans 01-06)
    provides: restore drill with the inspect-verified containerCleanup verdict, the isDockerUnreachableError classifier and unit cases A-I (08-05/08-06), the fail-closed post-rm contract this plan strengthens with the numeric exit-code requirement
provides:
  - "numeric exit-code guard: `absentPerInspect` now requires `typeof postInspect.code === "number"` ahead of `code !== 0`, so a post-rm inspect with no exit code at all records FAILED — the receipt can never carry `{ postInspect: "spawn_error", verdict: "REMOVED" }` (closes 08-VERIFICATION truth 22 residual / gap WR-05)"
  - "unit case J pinning the verifier's last counterexample (signal-killed docker CLI shape: `{ code: undefined }` without spawnError → FAILED, overall stays VERIFIED, audit verdict FAILED)"
  - "two IN-05 classifier pins: Windows `error during connect` stderr fails closed (FAILED), `Error: No such object` absence wording stays absence evidence (REMOVED)"
  - "invariant and fail-closed absence-proof comments restated to the implemented numeric-exit-code requirement — comment, code and audit agree, with no daemon-contact claim (IN-04 stays open)"
affects: [08-backups-and-restore-verification UAT re-test (WR-05), backup-drill cleanup audit trail, operations UI «Контейнер удалён» label semantics]

# Actuals (#2632)
actuals:
  tokens: 1808
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Numeric-exit-code evidence guard: an exec result whose `code` is `undefined` is never interpreted as non-zero — `typeof x === "number" && x !== 0` instead of `x !== 0` on a `number | undefined` field"
    - "Characterization pins for classifier branches: one stderr literal per phrase branch so a deleted branch fails exactly one pin (H's redundant phrasing cannot cover it)"

key-files:
  created: []
  modified:
    - workers/data-sync/src/jobs/backup-drill.ts
    - tests/unit/backup-drill.test.ts

key-decisions:
  - "REMOVED requires a numeric non-zero post-rm exit code: `typeof postInspect.code === "number" && postInspect.code !== 0 && !spawnError && !isDockerUnreachableError(stderr)` — a codeless result (signal-killed docker CLI settles `close(code ?? undefined)` with spawnError unset at backup.ts:60) fails closed to FAILED, so the audit's `code ?? \"spawn_error\"` marker can never sit beside verdict REMOVED"
  - "Comments state only what the code proves: the invariant and absence-proof blocks require an actually-ran inspect with a numeric non-zero exit code plus no daemon-unreachable phrase in stderr, and explicitly note the phrase blacklist proves nothing about daemon contact itself (IN-04 stays open — no \"reached the daemon\" claim)"
  - "IN-05 pins use literals that isolate the branch under test: the Windows stderr carries only the `error during connect` phrase (H's stderr redundantly carries the other two, so deleting that branch keeps H green but fails the pin), and the `Error: No such object` wording carries none of the three connection phrases"

patterns-established:
  - "Fail-closed evidence classification extended: absence evidence requires an exec result that actually produced an exit code — `undefined` is never coerced into \"non-zero\" (extends the 08-05/08-06 object-verified verdict pattern)"
  - "One classifier phrase per pin so each blacklist branch has an isolated regression guard"

requirements-completed: [BAK-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "WR-05 fail-open closed: a post-rm inspect with `code: undefined` and no spawnError records containerCleanup FAILED (overall stays VERIFIED, audit verdict FAILED) instead of the self-contradicting REMOVED"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#J: records FAILED when the post-rm inspect carries no exit code at all and no spawnError (WR-05 — code: undefined must not pass code !== 0)"
        status: pass
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#G-08-5 describe block (cases A-I regression, 35/35 green at close-out)"
        status: pass
    human_judgment: false
  - id: D2
    description: "IN-05 classifier pins: Windows `error during connect` daemon variant fails closed to FAILED; `Error: No such object` absence wording still earns REMOVED"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#IN-05a: fails closed on the Windows 'error during connect' daemon-unreachable variant (classifier branch pin)"
        status: pass
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#IN-05b: still records REMOVED for the 'Error: No such object' absence wording (classifier over-match pin)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Invariant comments restated to the implemented numeric-exit-code requirement so comment, code and audit agree (the WR-01 comment/behavior divergence class does not recur)"
    verification:
      - kind: other
        ref: "code review of workers/data-sync/src/jobs/backup-drill.ts:464-474 (invariant, contains \"numeric non-zero exit code\") and :491-503 (absence-proof naming the typeof guard) against :499-504 (verdict) — statements agree"
        status: pass
    human_judgment: false

# Metrics
duration: 13min
completed: 2026-11-03
status: complete
---

# Phase 08 Plan 07: WR-05 Numeric Exit-Code Guard Gap Closure Summary

**`containerCleanup = REMOVED` now requires a numeric non-zero post-rm `docker inspect` exit code — a codeless result (`{ code: undefined }` without spawnError, the signal-killed docker CLI shape) fails closed to FAILED — test-guarded by TDD case J and two IN-05 classifier pins, taking the unit file from 32 to 35/35.**

## Performance

- **Duration:** 13 min (task execution + wave gates; close-out re-verification included)
- **Started:** 2026-11-03T15:10:53Z
- **Completed:** 2026-11-03T15:24:00Z
- **Tasks:** 2
- **Files modified:** 2

## Gap Closure Coverage

**Gap ID:** WR-05 — `08-VERIFICATION.md` frontmatter `gaps:` (truth 22 residual) and `08-REVIEW.md` §WR-05 (lines 34-49).

| # | Audit finding | Resolution | Verification |
|---|---------------|------------|--------------|
| D1 | `absentPerInspect` implemented "exited non-zero" as `postInspect.code !== 0` on a `number \| undefined` field: a post-rm inspect with `code: undefined` and no spawnError passed all three conjuncts (`undefined !== 0` is true) and recorded REMOVED with zero absence evidence — the receipt then read `{ postInspect: "spawn_error", verdict: "REMOVED" }`, self-contradicting and re-diverging from the invariant comment | `typeof postInspect.code === "number" &&` added as the first conjunct; the ternary, `identityLostBeforeRm`, `rmFailed` and the audit writer untouched | Unit **J** (codeless post-rm → FAILED, overall VERIFIED, audit verdict FAILED), red→green — RED `7c2ec70`, GREEN `4f200ef` |
| D2 | IN-05 (advisory): the Windows `error during connect` classifier branch is exercised by no test (H's stderr redundantly carries the other two phrases, so a deleted branch keeps H green), and the `Error: No such object` absence wording is unpinned | Two characterization pins in the G-08-5 block, both green immediately against the current classifier — regression guards, not a RED/GREEN cycle | Unit **IN-05a** (FAILED, audit postInspect 1) and **IN-05b** (REMOVED, audit verdict REMOVED) — `649918f` |
| D3 | The invariant comment (464-467) claimed the inspect "reached the daemon … exited non-zero", which the code did not require — the comment/behavior split WR-01 was about | Both comments restated to the implemented requirement: actually ran (no spawnError) **and returned a numeric non-zero exit code** (the field is `number \| undefined`, so a codeless result is not absence evidence), plus no daemon-unreachable phrase in stderr; the stderr test is explicitly labelled a narrow blacklist that proves nothing about daemon contact (IN-04 stays open) | Code review of backup-drill.ts:464-474 / :491-503 vs :499-504 (statements agree; acceptance grep for "numeric non-zero exit code" hits lines 466 and 492) |

## What Was Done

- **Task 1 (WR-05 numeric guard, TDD).** RED `7c2ec70`: case **J** in the G-08-5 describe block feeds `inspects: [INSPECT_FOUND, { code: undefined, stdout: Buffer.alloc(0), stderr: "" }]` (no `spawnError` key — deliberately not `POST_SPAWN_GONE`, whose `spawnError: "ENOENT"` already takes the fixed G path) through the full drill harness and asserts overall `VERIFIED`, `containerCleanup "FAILED"`, exactly one receipt, audit `{ containerName, preInspect: 0, rmExitCode: 0, postInspect: "spawn_error", verdict: "FAILED" }`. Pre-fix it failed exactly as the verifier predicted — `AssertionError: expected 'REMOVED' to be 'FAILED'` (33 tests: 1 failed, 32 passed). GREEN `4f200ef`: `absentPerInspect` gained `typeof postInspect.code === "number" &&` as its first conjunct ahead of `postInspect.code !== 0` (`!spawnError` and `!isDockerUnreachableError(stderr)` kept in the same conjunction; the verdict ternary untouched), and both comment blocks restated to the numeric-exit-code requirement with no daemon-contact claim. 33/33 green — case C's canonical `Error response from daemon: No such container` still earns REMOVED; cases A-I unchanged.
- **Task 2 (IN-05 pins + wave gates).** `649918f`: **IN-05a** (post-rm code 1, stderr `error during connect: Get "\\\.\pipe\docker_engine": The system cannot find the file specified` — contains neither of H's other two phrases) asserts FAILED + audit `postInspect: 1`; **IN-05b** (post-rm code 1, stderr `Error: No such object: bet-stats-drill-pg-unit-test`) asserts REMOVED + audit `verdict: "REMOVED"`. 35/35 green. `workers/data-sync/src/jobs/backup-drill.ts` unchanged in this task (commit diff lists the test file alone).
- **Wave gates:** `pnpm typecheck` 7/7 tasks green (exit 0); `pnpm build` 7/7 tasks green (exit 0); `pnpm test` unit project 47 files — only `tests/unit/fixtures-sync.test.ts` fails (7 failed, documented live-DB auth artifact, out of scope, not fixed), 46 files/450 tests pass; that non-zero exit short-circuits the chained web half, so `pnpm --filter web test` was run separately: 9 files, 82/82 pass. `next-env.d.ts` not modified by the builds (git status clean of it). `tests/integration/backup-restore-drill.test.ts` untouched (no diff over the plan range). No live Docker, no package installs (threat T-08-SC respected).

## TDD Gate Compliance

| Gate | Evidence | Commit |
|------|----------|--------|
| RED 1 | `AssertionError: expected 'REMOVED' to be 'FAILED'` (case J, 1 failed / 32 passed) | `7c2ec70` `test(08-07): failing unit case for the codeless post-rm inspect earning REMOVED (WR-05)` |
| GREEN 1 | 33/33 pass, numeric exit-code conjunct + restated comments | `4f200ef` `fix(08-07): require a numeric post-rm exit code for REMOVED (WR-05)` |
| (Task 2, no cycle) | 35/35 pass, both pins green immediately against the current classifier | `649918f` `test(08-07): pin the IN-05 classifier branches …` |

The plan frontmatter is `type: execute` with a `tdd="true"` Task 1; GREEN uses the plan's `fix(08-07):` prefix as specified. RED-first ordering holds (git log: `7c2ec70` → `4f200ef` → `649918f`).

## Task Commits

Each task committed atomically with the plan's staging rules (one file per commit):

1. **Task 1 RED:** `7c2ec70` (test) — **Task 1 GREEN:** `4f200ef` (fix)
2. **Task 2 (pins):** `649918f` (test)

**Plan metadata:** `docs(08-07): …` (this commit).

`plan_head_before: 26f8bd1`, `plan_head_after: 649918f` — 3 task commits measured (`git rev-list --count 26f8bd1..649918f`).

## Files Created/Modified

- `workers/data-sync/src/jobs/backup-drill.ts` — `absentPerInspect` gains the `typeof postInspect.code === "number"` conjunct; invariant (464-474) and fail-closed absence-proof (491-498) comments restated to the numeric-exit-code requirement
- `tests/unit/backup-drill.test.ts` — unit case J plus pins IN-05a and IN-05b in the G-08-5 describe block (32 → 35 tests)

## Decisions Made

1. **Guard shape** — `typeof postInspect.code === "number" && postInspect.code !== 0` replaces the bare `!== 0` test on a `number | undefined` field; `!spawnError` and the stderr classifier keep their order-insensitive roles in the same conjunction. No new fields, no new error channel: the audit's existing `code ?? "spawn_error"` marker now agrees with the verdict instead of contradicting it.
2. **Comment honesty** — both comments state only what the code proves (an inspect that ran and returned a numeric non-zero exit code, with no daemon-unreachable phrase in stderr) and explicitly record that the phrase classifier proves nothing about daemon contact itself, so finding IN-04 remains visibly open rather than being papered over.
3. **Pin isolation over parametrization** — IN-05a's literal carries only the `error during connect` phrase and IN-05b only the absence wording, so each guards exactly one classifier behaviour; the plan's narrower two-pin delivery was taken over 08-REVIEW's fuller "parametrize H over the three phrases" fix, whose residual (H-parametrization) stays recorded open in `08-REVIEW-DISPOSITION.md`.

## Deviations from Plan

None — plan executed exactly as written (3 commits in the specified order, both tasks complete, only the two scoped files changed).

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** none.

## Issues Encountered

- **Shell-dialect CLI translation (semantics preserved, standing STATE.md operating rule):** `gsd_run` is not on PATH in this executor shell. The protected-branch assertion was re-run through the SDK's underlying binary (`node …/gsd-tools.cjs query git.base-branch --is-protected main` → `false`, consistent with `.planning/config.json` → `git.allow_default_branch_commits: true`, the gate's documented override), and STATE.md/ROADMAP.md tracking + the docs commit follow the documented precedent of manual file edits plus a plain git commit. Auto mode was active (`workflow.auto_advance: true`) — no checkpoint was required by this plan (no `checkpoint:*` tasks).
- **`pnpm test` short-circuit (pre-existing, out of scope):** the script is `vitest run --project unit && pnpm --filter @bet-stats/web test`, so the known 7 fixtures-sync failures exit 1 and skip the web half — the web suite was run separately and is green (82/82). Not modified (scope boundary).
- **No other issues:** no auth gates, no package installs, no Rule 1-4 deviations; the unrelated user working-tree dirt (apps/web FAQ/theme files, capture script, e2e spec, sentinel, untracked PNG/zip) was never staged or reverted.

## Known Stubs

None — stub-marker scan over the plan's diff: 0 hits for TODO/FIXME/XXX/PLACEHOLDER/"coming soon"/"not available"; no hardcoded empty values or unwired data in either changed file.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes; the strengthened verdict feeds only the immutable receipt (T-08-24 mitigated by case J: the `{ postInspect: "spawn_error", verdict: "REMOVED" }` pair can no longer be produced).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 08: all 7 plans complete — ready for `/gsd-verify-work 08` (truth 22 re-check: a post-rm inspect with no exit code can never record REMOVED) and the G-08-5/G-08-6/WR-05 operator UAT re-test.
- Known-deferred findings remain recorded `open` in `08-REVIEW-DISPOSITION.md`: WR-02 (key the verdict on the immutable container ID), WR-03 (app-lifecycle Load-Env on Stop/Status), WR-04 (gateway 0.0.0.0 bind), IN-01 (gateway readiness probe), IN-03 (source-text grep assertion), IN-04 (phrase-blacklist classifier), IN-06 (throwing logger can skip record()), plus IN-05's residual H-parametrization — deliberately out of this gap's scope.

## Self-Check: PASSED

- FOUND: `workers/data-sync/src/jobs/backup-drill.ts` (modified, committed in `4f200ef`)
- FOUND: `tests/unit/backup-drill.test.ts` (modified, committed in `7c2ec70` and `649918f`)
- FOUND: `7c2ec70`, `4f200ef`, `649918f` (ancestors of HEAD via `git merge-base --is-ancestor`)
- Re-ran plan `<verify>` at close-out: unit file 35/35 pass (exit 0); `pnpm typecheck` 7/7; `pnpm build` 7/7; `pnpm test` unit 450/457 with only the documented fixtures-sync 7; web 82/82
- Acceptance criteria spot-checks: RED commit precedes GREEN in `git log`; `absentPerInspect` contains `typeof postInspect.code === "number"` ahead of `postInspect.code !== 0` (lines 500-501); invariant comment contains "numeric non-zero exit code" (lines 466, 492) and the absence-proof comment names the typeof guard (line 493); case J asserts audit `{ postInspect: "spawn_error", verdict: "FAILED" }` with overall `VERIFIED` in exactly one receipt; IN-05a pins `error during connect` → FAILED with audit postInspect 1; IN-05b pins `Error: No such object: bet-stats-drill-pg-unit-test` → REMOVED; each commit's diff touches only its one staged file; `tests/integration/backup-restore-drill.test.ts`, the receipt shape, and the `DrillCleanupState` enum show no diff over the plan range
- Evaluation scope: `git rev-list --count 26f8bd1..649918f` = 3 task commits at SUMMARY write

---
*Phase: 08-backups-and-restore-verification*
*Completed: 2026-11-03*
