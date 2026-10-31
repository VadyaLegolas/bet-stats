---
phase: 08-backups-and-restore-verification
plan: 05
subsystem: infra
tags: [backups, docker, restore-drill, tdd, audit-trail, postgres]

gap_closure: true
gap_ids: [G-08-5]

# Dependency graph
requires:
  - phase: 07-ci-pipeline-quality-gates
    provides: CI quality gates and hermetic test conventions
  - phase: 08-backups-and-restore-verification (plans 01-04)
    provides: backup engine, restore drill with containerCleanup receipt column, immutable BackupVerificationReceipt checks JSON (08-02), closed BackupFact DTO + redactSecrets projection (08-03)
provides:
  - inspect-verified containerCleanup verdict in runBackupDrill (pre-rm inspect → rm --force → post-rm inspect, all by the exact recorded name)
  - checks.containerCleanup audit entry { containerName, preInspect, rmExitCode, postInspect, verdict } in the immutable receipt
  - unit FAILED-branch coverage (tests A-F, previously grep-0) and a real-docker integration proof of the verdict on Docker server 29.9.2
affects: [08-backups-and-restore-verification UAT re-test (gap G-08-5), operations UI]

# Actuals (#2632)
actuals:
  tokens: 4000
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Object-verified cleanup verdicts: a drain/removal outcome requires inspect evidence of the object's state before and after the command — a single command's exit code is never trusted (Docker 29.x rm -f is idempotent)"

key-files:
  created: []
  modified:
    - workers/data-sync/src/jobs/backup-drill.ts
    - tests/unit/backup-drill.test.ts
    - tests/integration/backup-restore-drill.test.ts

key-decisions:
  - "containerCleanup = REMOVED requires positive inspect evidence twice (present pre-rm, absent post-rm); identity loss before rm, rm non-zero, post-rm survival, and any spawnError all fail closed to FAILED (T-08-21)"
  - "The pre-rm identity miss never skips the best-effort rm attempt — only the verdict is FAILED, so a still-present container under a resolvable identity still gets removed"
  - "The audit entry is named checks.containerCleanup (no existing check key conflicted: sourceCounts/restore/migrations/chainIntegrity/error/nonEmpty/parity/fkOrphans/curated); per-stage values are exit codes or \"spawn_error\" — no argv, env, or stderr (T-08-22)"
  - "record() untouched: containerCleanup and overall stay independently written, structurally guaranteeing the earned overall is never recolored by cleanup outcome (D-11/T-08-10, test-guarded by unit Test E and the integration negative case)"

patterns-established:
  - "Cleanup/drain verdicts are object-verified via docker inspect evidence, never derived from a single exit code (gap G-08-5 root cause)"

requirements-completed: [BAK-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Inspect-verified containerCleanup verdict in runBackupDrill — pre-rm identity check, best-effort rm, post-rm survival check, fail-closed on every path"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#runBackupDrill container cleanup verdict is inspect-verified (G-08-5)"
        status: pass
      - kind: integration
        ref: "tests/integration/backup-restore-drill.test.ts#restores the newest dump into an owned throwaway container…"
        status: pass
    human_judgment: false
  - id: D2
    description: "Durable cleanup audit trail: receipt checks JSON records containerName plus per-stage exit codes and the verdict"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#A/B/C: cleanupAudit assertions on checks.containerCleanup"
        status: pass
      - kind: integration
        ref: "tests/integration/backup-restore-drill.test.ts (cleanupAudit persisted-row assertions in both drill cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "FAILED branch covered by unit tests A-F and a real-docker negative case (previously grep-0); overall structurally independent of cleanup outcome"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/unit/backup-drill.test.ts#E: never recolors the earned overall"
        status: pass
      - kind: integration
        ref: "tests/integration/backup-restore-drill.test.ts#persists FAILED containerCleanup with the drill overall untouched…"
        status: pass
    human_judgment: false
  - id: D4
    description: "Russian operations labels «Контейнер удалён»/«Не удалось удалить контейнер» still render for both verdicts through the closed DTO"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "apps/web/app/internal/operations/backup-status-block.test.ts (21/21 pass, both labels asserted)"
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-10-31
status: complete
---

# Phase 08 Plan 05: Inspect-Verified Container Cleanup Verdict Summary

**Drill container cleanup is now proven by docker inspect evidence (present pre-rm, absent post-rm, same recorded name) instead of the exit code of idempotent `rm -f` — the Docker 29.x rename race can no longer record a false REMOVED while an orphan lives (gap G-08-5 closed, TDD RED→GREEN).**

## Performance

- **Duration:** 18 min
- **Started:** 2026-10-31T06:48:07Z
- **Completed:** 2026-10-31T07:06:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- runBackupDrill's finally block now runs pre-rm `docker inspect <containerName>` → `docker rm --force <containerName>` → post-rm `docker inspect <containerName>`; REMOVED requires positive inspect evidence twice, every other path (identity lost, rm non-zero, object survived, spawnError) fails closed to FAILED
- The immutable receipt checks JSON gains `containerCleanup: { containerName, preInspect, rmExitCode, postInspect, verdict }` (exit codes or `"spawn_error"`) — the durable audit trail flows through redactSecrets and the closed BackupFact DTO unchanged
- FAILED branch now test-covered: 6 new unit tests (A-F) and 7-test real-docker integration suite, including the rename-race negative case with overall staying VERIFIED in the same receipt
- Verified on the live Docker server 29.9.2 — the exact platform where the UAT rename race produced the false REMOVED; no throwaway containers left behind, live stack untouched

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): failing tests for the inspect-verified verdict** - `b99e75e` (test) — 6 new tests A-F fail against the exit-code-only verdict; 23 pre-existing tests stay green
2. **Task 1 (TDD GREEN): inspect-verified containerCleanup verdict** - `5dcca8e` (feat) — production change + one test-side argv-mapping fix discovered when the implementation began emitting inspect calls; 29/29 pass
3. **Task 2: real-docker integration proof** - `657fb6f` (test) — recordingExec records exit codes and can force the pre-rm inspect to miss; 7/7 pass on the live daemon

**Plan metadata:** (this commit)

_TDD note: no REFACTOR commit — the GREEN implementation was already minimal; the optional refactor phase produced no changes._

## Files Created/Modified
- `workers/data-sync/src/jobs/backup-drill.ts` - Finally-block cleanup verdict replaced with the three-step object verification; checks.containerCleanup audit entry added; record() untouched
- `tests/unit/backup-drill.test.ts` - drillExec stub gained ordered `inspects` overrides + `rm` override; new describe block with tests A-F
- `tests/integration/backup-restore-drill.test.ts` - recordingExec records `{ command, args, code }` and supports `failPreRmInspect`; VERIFIED-drill test asserts the inspect sequence with real exit codes; new negative case persists FAILED with overall VERIFIED

## Decisions Made
- **Audit key name:** `checks.containerCleanup` (verified no conflict with existing keys sourceCounts/restore/migrations/chainIntegrity/error/nonEmpty/parity/fkOrphans/curated); the column keeps its DrillCleanupState enum, the JSON key carries the evidence object — consistent, not colliding
- **Fail-closed spawnError mapping:** per-stage values are `exit code | "spawn_error"`; a spawnError at any stage forces FAILED
- **Best-effort rm preserved:** a pre-rm identity miss records FAILED but still attempts the rm, so a container resolvable under any identity still gets removed
- **Integration injection seam:** the rename race is injected at the exec boundary (forced pre-rm inspect exit 1) rather than renaming a live container — exactly the seam the UAT diagnosis identified, with no daemon disruption

## TDD Gate Compliance

| Phase | Commit | Evidence |
|-------|--------|----------|
| RED | `b99e75e` | `pnpm vitest run --project unit tests/unit/backup-drill.test.ts` → 6 failed (A-F) / 23 passed; each target test failed on its planned assertion (verdict `REMOVED` vs expected `FAILED`, missing audit entry, missing inspect sequence) — not on syntax, import, or fixture faults |
| GREEN | `5dcca8e` | Same command → 29/29 passed after the minimal implementation |
| REFACTOR | — (no changes) | Not needed; GREEN was already minimal |

_RED evidence was assessed semantically and manually: the `gsd_run check tdd-red-evidence` classifier is unavailable in this environment (gsd_run not on PATH — see operating-rule note in STATE.md); the full vitest report above was inspected directly._

## Deviations from Plan

None - plan executed exactly as written. (One in-cycle test fix: the new Test C initially read the rm container name from `args[1]` instead of the last argv slot — a bug in the new RED test itself, fixed within the GREEN cycle per TDD error-handling, not a plan deviation.)

**Total deviations:** 0 auto-fixed.
**Impact on plan:** None.

## Issues Encountered
- Plan verification listed `pnpm vitest run --project unit apps/web/app/internal/operations/backup-status-block.test.ts`, but the root vitest workspace only defines `unit` and `integration` projects — the web block test lives in the web package's own vitest config. Ran it as `pnpm --filter @bet-stats/web test backup-status-block` → 21/21 pass, both Russian labels asserted.
- `gsd_run` CLI not on PATH (documented operating rule): STATE/ROADMAP updated as manual file edits, docs commit via plain git — same precedent as 07-01..08-04.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 08 has all 5 plans complete — ready for `/gsd-verify-work` and the operator UAT re-test of gaps G-08-5 and G-08-6.
- UAT re-test note for G-08-5: a live drill receipt now carries `checks.containerCleanup` with the container name and per-stage exit codes; `containerCleanup = REMOVED` means the named object was verified present before rm and absent after. A rename during the drill window records FAILED (never a false REMOVED) while overall stays earned.
- Known pre-existing failure outside this plan's scope: `tests/unit/fixtures-sync.test.ts` (7 failed, live DB) — unchanged, deferred as established.

## Self-Check: PASSED

- FOUND: workers/data-sync/src/jobs/backup-drill.ts (modified), tests/unit/backup-drill.test.ts, tests/integration/backup-restore-drill.test.ts
- FOUND: commits b99e75e, 5dcca8e, 657fb6f (verified ancestors of HEAD)
- Verification re-run at SUMMARY time: unit 29/29, integration 7/7 (live Docker 29.9.2), typecheck 7/7 tasks, web backup-status-block 21/21

---
*Phase: 08-backups-and-restore-verification*
*Completed: 2026-10-31*
