---
phase: 08-backups-and-restore-verification
plan: 06
subsystem: workers/data-sync
tags: [gap-closure, backup-drill, fail-closed, cleanup-verdict, in-02, docker]

gap_closure: true
gap_ids: [WR-01]

# Dependency graph
requires:
  - phase: 08-backups-and-restore-verification (plans 01-05)
    provides: backup engine, restore drill with the inspect-verified containerCleanup verdict and unit harness A-F (08-05), immutable BackupVerificationReceipt checks JSON, closed BackupFact DTO projection
provides:
  - "fail-closed post-rm cleanup verdict: REMOVED requires a daemon-clean non-zero post-rm `docker inspect` — post-rm spawnError and daemon-unreachable stderr record FAILED (closes 08-VERIFICATION truth 22 / gap WR-01)"
  - "guarded cleanup exec trio via `safeCleanupRun`: a throwing BackupExec can no longer escape the finally block or skip `record()` (IN-02)"
  - "unit cases G/H/I pinning both fail-open corners and the record()-always-lands guarantee, plus the Test-C canonical-absence regression guard"
affects: [08-backups-and-restore-verification UAT re-test (WR-01), backup-drill cleanup audit trail, operations UI «Контейнер удалён» label semantics]

# Actuals (#2632)
actuals:
  tokens: 2279
  tasks: 2
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed evidence classification: absence evidence requires an exec that actually ran and reached the daemon; connection-failure stderr is never absence evidence"
    - "Exec-result normalization: a thrown exec is mapped into the existing BackupExecResult shape (spawnError set) instead of a new error channel, so verdict logic and audit shape stay unchanged"

key-files:
  created: []
  modified:
    - workers/data-sync/src/jobs/backup-drill.ts
    - tests/unit/backup-drill.test.ts

key-decisions:
  - "isDockerUnreachableError matches only Docker connectivity phrases (cannot connect / error during connect / is the docker daemon running, case-insensitive) — deliberately never the canonical absence wording, which literally contains the word \"daemon\" (\"Error response from daemon: No such container\"), so error-shape drift keeps producing FAILED and can never flip back to a false REMOVED"
  - "safeCleanupRun maps a thrown cleanup exec into BackupExecResult { code: undefined, stdout: empty, stderr: String(error), spawnError: String(error) }, so each cleanup stage fails closed to its own spawn_error and record() always lands (IN-02); audit shape, log event, and record() independence unchanged"
  - "REMOVED contract unchanged in shape, strengthened in evidence: pre-rm inspect found the container + rm exit 0 + post-rm inspect actually ran (no spawnError), exited non-zero, and carries no unreachable-daemon stderr; DrillCleanupState enum stays REMOVED/FAILED/NOT_STARTED"

patterns-established:
  - "Cleanup/drain verdicts fail closed: an exec result that never ran, or whose failure cause is ambiguous by exit code alone, is recorded as FAILED — never as success evidence (extends the 08-05 object-verified verdict pattern)"

requirements-completed: [BAK-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Fail-closed post-rm cleanup verdict (WR-01, truth 22): REMOVED requires daemon-clean absence evidence from a post-rm inspect that actually ran; post-rm spawnError and daemon-unreachable stderr record FAILED"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#G: records FAILED without crashing when the post-rm inspect cannot spawn (the WR-01 fail-open counterexample, mirror of F)"
        status: pass
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#H: records FAILED when the post-rm inspect fails because the Docker daemon is unreachable"
        status: pass
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#C: records REMOVED only on inspect evidence — canonical \"No such container\" absence still earns REMOVED (classifier regression guard)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Guarded cleanup exec trio (IN-02): a throwing BackupExec can no longer escape the finally block or skip record() — exactly one receipt always lands with the FAILED cleanup verdict and the earned overall intact"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#I: a throwing cleanup exec still lands exactly one receipt with FAILED cleanup and the earned overall intact (IN-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Invariant comment block in backup-drill.ts aligned with the implemented fail-closed requirement (the gap's core complaint was comment/behavior divergence)"
    verification:
      - kind: other
        ref: "code review of workers/data-sync/src/jobs/backup-drill.ts:456-472 (invariant comment) against :483-490 (verdict) — statements agree"
        status: pass
    human_judgment: false

# Metrics
duration: 11min
completed: 2026-11-01
status: complete
---

# Phase 08 Plan 06: Fail-Closed Cleanup Verdict Gap Closure (WR-01) Summary

**`containerCleanup = REMOVED` now requires daemon-clean absence evidence — a post-rm `docker inspect` that actually ran, exited non-zero, and carries no unreachable-daemon stderr — and a `safeCleanupRun` guard makes `record()` unskippable, test-guarded by new unit cases G/H/I (RED→GREEN, 4 commits).**

## Performance

- **Duration:** 11 min (task execution; all wave gates re-verified at close-out)
- **Completed:** 2026-11-01
- **Tasks:** 2
- **Files modified:** 2

## Gap Closure Coverage

**Gap ID:** WR-01 — `08-VERIFICATION.md` frontmatter `gaps:` (truth 22) and `08-REVIEW.md` §WR-01.

| # | Audit finding | Resolution | Verification |
|---|---------------|------------|--------------|
| D1 | Verdict fail-open: a post-`rm` inspect that never spawned, or exited non-zero with daemon-unreachable stderr, fell through to `REMOVED` with zero positive absence evidence (backup-drill.ts:450-453; grep-0 test coverage) | `isDockerUnreachableError()` classifier + verdict requires `!spawnError && code !== 0 && !isDockerUnreachableError(stderr)` on the post-rm inspect, on top of the pre-rm hit and `rm` exit 0 | Unit G (post-rm `spawnError` → `FAILED`) and H (daemon-unreachable stderr → `FAILED`), red→green — RED `86f801c`, GREEN `8eb37e3` |
| D2 | IN-02: the three cleanup `exec.run` calls were unguarded, so a throwing BackupExec could escape the finally block, lose the outcome, and skip `record()` | `safeCleanupRun()` wraps each cleanup call individually; a throw maps to that stage's `spawn_error`, the fail-closed verdict records `FAILED`, the trio continues, `record()` always lands | Unit I (throwing exec still lands exactly one receipt), red→green — RED `5085314`, GREEN `8d2eab1` |
| D3 | The invariant comment (lines 445-446) described a stronger requirement than the code implemented — the gap's core complaint | Comment block rewritten to state the daemon-clean non-zero post-rm requirement, matching the verdict exactly | Code review of backup-drill.ts:456-472 vs :483-490 (statements agree) |

## What Was Done

- **Task 1 (WR-01 fail-closed verdict).** RED `86f801c`: two unit cases in the G-08-5 describe block — **G** (post-rm inspect that never spawned: `POST_SPAWN_GONE` = `{ code: undefined, spawnError: "ENOENT" }` → must record `FAILED`, audit `postInspect: "spawn_error"`) and **H** (post-rm inspect exit 1 with `Cannot connect to the Docker daemon…` → must record `FAILED`, audit `postInspect: 1`), both with overall staying `VERIFIED`. Both failed pre-fix exactly as the verifier predicted (`expected 'REMOVED' to be 'FAILED'`). GREEN `8eb37e3`: module-local `isDockerUnreachableError()` (matches `cannot connect` / `error during connect` / `is the docker daemon running` case-insensitively; never the canonical `No such object` / `No such container` / `Error response from daemon: No such container` absence family) plus the strengthened verdict — `REMOVED` only when the container was present at the pre-rm inspect, `rm` exited 0, and the post-rm inspect actually ran, exited non-zero, and shows no daemon-unreachable indicator; everything else records `FAILED`. Invariant comment aligned. 31/31 unit tests green (Test C's canonical-absence `REMOVED` regression intact).
- **Task 2 (IN-02 record() always lands).** RED `5085314`: test I — an exec double whose `run` throws `Error("exec blew up"` for the cleanup verbs (rm + both inspects) while the drill body stays healthy; pre-fix the throw escaped the finally block and no receipt was written. GREEN `8d2eab1`: `safeCleanupRun()` routes each of the three cleanup calls (pre-rm inspect, `rm --force`, post-rm inspect) through its own try/catch, mapping a throw to `{ code: undefined, stdout: Buffer.alloc(0), stderr: String(error), spawnError: String(error) }`; stages continue independently and `record()` always runs. `drillQuery.disconnect`'s existing catch and all non-cleanup exec call sites untouched. 32/32 unit tests green.
- **Wave gates (re-run at close-out):** `pnpm typecheck` 7/7, `pnpm build` 7/7, `pnpm test` (unit) 447/454 — only failures are the 7 pre-existing `tests/unit/fixtures-sync.test.ts` live-DB auth failures (documented at 08-05, out of scope, not fixed); the web half of the `pnpm test` script is short-circuited by that non-zero exit (`&&`), so it was run separately: `pnpm --filter "@bet-stats/web" test` 82/82. `tests/integration/backup-restore-drill.test.ts` untouched. No live Docker required; no package installs (threat T-08-SC respected).

## TDD Gate Compliance

| Gate | Evidence | Commit |
|------|----------|--------|
| RED 1 | `expected 'REMOVED' to be 'FAILED'` × 2 (tests G, H) | `86f801c` `test(08-06): failing unit cases for the fail-open post-rm cleanup verdict` |
| GREEN 1 | 31/31 pass, classifier + strengthened verdict | `8eb37e3` `fix(08-06): fail closed the post-rm cleanup verdict on spawn and daemon errors (WR-01)` |
| RED 2 | `Error: exec blew up` escaped `runBackupDrill`, no receipt (test I) | `5085314` `test(08-06): failing unit case for the throwing cleanup exec skipping record() (IN-02)` |
| GREEN 2 | 32/32 pass, `safeCleanupRun` on the cleanup trio | `8d2eab1` `fix(08-06): guard cleanup exec calls so record() always lands (IN-02)` |

`workflow.tdd_mode` is off (config.json) and the plan is `type: execute`, so GREEN commits use the plan's `fix(08-06):` prefix (orchestrator-accepted as semantically honest); RED-first ordering holds for both behavior-adding tasks.

## Task Commits

Each task committed atomically (RED → GREEN per TDD task):

1. **Task 1 RED:** `86f801c` (test) — **Task 1 GREEN:** `8eb37e3` (fix)
2. **Task 2 RED:** `5085314` (test) — **Task 2 GREEN:** `8d2eab1` (fix)

**Plan metadata:** `docs(08-06): complete fail-closed cleanup verdict plan` (this commit).

`plan_head_before: 6aee3de`, `plan_head_after: 8d2eab1` — 4 task commits measured (`git rev-list --count 6aee3de..8d2eab1`).

## Files Created/Modified

- `workers/data-sync/src/jobs/backup-drill.ts` — `isDockerUnreachableError()` classifier, strengthened fail-closed post-rm verdict, `safeCleanupRun()` guard on the cleanup trio, aligned invariant comment
- `tests/unit/backup-drill.test.ts` — `POST_SPAWN_GONE` fixture constant + unit cases G, H, I in the G-08-5 describe block

## Decisions Made

1. **Classifier scope** — `isDockerUnreachableError()` matches only connectivity phrases (`cannot connect`, `error during connect`, `is the docker daemon running`, case-insensitive), deliberately *not* a bare `/daemon/i` (the WR-01 suggested patch's literal regex would misclassify the canonical `Error response from daemon: No such container` absence message). Narrow scope means error-shape drift keeps producing `FAILED`, never a false `REMOVED`.
2. **Guard shape** — `safeCleanupRun()` returns the existing `BackupExecResult` type with `spawnError` set rather than introducing a new error channel; the verdict logic, audit shape, and every non-cleanup call site keep consuming the same shape.
3. **Contract preservation** — the `REMOVED`/`FAILED`/`NOT_STARTED` enum, the audit shape `{ containerName, preInspect, rmExitCode, postInspect, verdict }` (per-stage exit codes or `"spawn_error"`, no new fields), the `backup_drill.container_cleanup_failed` log event, `record()`'s structural independence of `containerCleanup` and `overall`, and the best-effort rm after a pre-rm identity miss are all untouched (test-guarded by A-F, E in particular).

## Deviations from Plan

None — plan executed as written (4 RED/GREEN commits, both tasks complete, both files scoped).

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** none.

## Issues Encountered

- **Interrupted prior execution pass:** the task commits (`86f801c`…`8d2eab1`) and the STATE.md/ROADMAP.md workflow updates were produced by an earlier execution pass that stopped before the SUMMARY close-out (SUMMARY left untracked — the illegal partial state under the atomic close-out invariant). This session re-ran every plan `<verify>`/wave gate against the committed code (all green, results above), corrected factual errors in the draft artifacts, and completed the close-out commit.
- **Draft-artifact corrections at close-out (not plan deviations):** draft SUMMARY referenced a non-existent `08-08-VERIFICATION.md` path, swapped the G/H case descriptions (and stated exit 0 for H's daemon case, which is exit 1), named a nonexistent `docker rmi` as the cleanup trio member (actual trio: pre-rm inspect, `rm --force`, post-rm inspect), said `UNKNOWN` for the column enum (actual: `NOT_STARTED`, per the `containerCleanup IN ('REMOVED','FAILED','NOT_STARTED')` CHECK), and omitted the required `coverage:` block — all fixed here; the matching `rmi`/`UNKNOWN` errors in the STATE.md 08-06 decision line were corrected in the same close-out.
- **Shell-dialect gate translation (semantics preserved):** `gsd_run` is not on PATH (standing operating rule, STATE.md), so the root-pin guard was re-run verbatim through Git Bash before the close-out commit, and the protected-branch assertion consulted `.planning/config.json` → `git.allow_default_branch_commits: true` (the gate's own documented override, #3819) instead of the missing `gsd_run query git.base-branch --is-protected` CLI.
- **`pnpm test` short-circuit (pre-existing, out of scope):** the script is `vitest run --project unit && pnpm --filter @bet-stats/web test`, so the known 7 fixtures-sync failures exit 1 and skip the web half — the web suite was run separately and is green (82/82). Not modified (scope boundary).
- **Naming variance only:** the plan prose called the fixture `postSpawnGone`; the committed constant is `POST_SPAWN_GONE` (same shape, same role).

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources in the two changed files (stub-marker scan: 0 hits for TBD/FIXME/XXX/PLACEHOLDER/"coming soon").

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes; the verdict feeds only the immutable receipt (T-08-23 mitigated by unit cases G/H/I).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 08: all 6 plans complete — ready for `/gsd-verify-work 08` (truth 22 re-check against this SUMMARY's strengthened REMOVED contract) and the G-08-5/G-08-6/WR-01 operator UAT re-test.
- Known-deferred review findings remain recorded `open` in `08-REVIEW-DISPOSITION.md`: WR-02 (key the verdict on the immutable container ID), WR-03 (app-lifecycle Load-Env on Stop/Status), WR-04 (gateway 0.0.0.0 bind), IN-01 (gateway readiness probe), IN-03 (source-text grep assertion) — deliberately out of this gap's scope.

## Self-Check: PASSED

- FOUND: workers/data-sync/src/jobs/backup-drill.ts (modified, committed)
- FOUND: tests/unit/backup-drill.test.ts (modified, committed)
- FOUND: `86f801c`, `8eb37e3`, `5085314`, `8d2eab1` (ancestors of HEAD)
- Re-ran plan `<verify>` at close-out: unit file 32/32 pass; `pnpm typecheck` 7/7; `pnpm build` 7/7; `pnpm test` unit 447/454 with only the documented fixtures-sync 7; web 82/82
- Acceptance criteria spot-checks: post-rm `spawnError` and daemon-unreachable stderr both record `FAILED` (G/H); canonical `No such container` still earns `REMOVED` (C); throwing exec still lands exactly one receipt (I); audit shape, enum, log event, and `record()` independence untouched; commits touch only the two scoped files
- Evaluation scope: `git rev-list --count 6aee3de..HEAD` = 4 task commits at SUMMARY write

---
*Phase: 08-backups-and-restore-verification*
*Completed: 2026-11-01*
