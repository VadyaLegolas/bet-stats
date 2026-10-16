---
phase: quick-261016-kpi
plan: 01
subsystem: worker
tags: [data-sync, entry-guard, bullmq, forecast-sweep, vitest, child-process, node-esm]

# Dependency graph
requires:
  - phase: quick-261016-bf3
    provides: "Auto-issued INITIAL/PRE_MATCH forecast sweep whose accidental second instance caused the 09:02:31Z empty-evidence snapshot incident"
provides:
  - "isDirectExecution() main-module entry guard in workers/data-sync/src/main.ts so importing the module never boots the sweep-enabled BullMQ worker"
  - "Hermetic child-node unit test proving both directions: import is silent, direct execution still reports readiness"
affects: [tests/integration/replay-boundary.test.ts, tests/integration/live-provider-harness-smoke.test.ts, tests/e2e/live-provider-stack.ts, quick-261016-bf3]

# Actuals (#2632) — pairs with the plan's `estimate` (tokens: 14000, tasks: 2) on the same chars/4 scale.
actuals:
  tokens: 1110
  tasks: 2
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Main-module entry guard: top-level start() wrapped in isDirectExecution() comparing realpathSync(process.argv[1]) against realpathSync(fileURLToPath(import.meta.url)) with pathToFileURL fallback"
    - "Hermetic child-process unit testing via promisified execFile with guaranteed-closed dummy ports (55999 Postgres, 6390 Redis)"

key-files:
  created:
    - tests/unit/worker-entry-guard.test.ts
  modified:
    - workers/data-sync/src/main.ts

key-decisions:
  - "Guard compares realpath on both sides so relative argv[1] ('dist/main.js' from the package dev script), Windows casing and symlinks cannot cause false negatives; pathToFileURL(entry).href === import.meta.url is the fallback when realpath throws."
  - "Guard is module-private and non-exported, so all six existing exports keep their exact signatures and the module stays import side-effect-free."
  - "Child tests force NODE_ENV=test and strip the four server-config keys from the inherited env (re-adding them only for the import case) so readServerConfig cannot trip the production superRefine and the direct case stays Docker-free."
  - "Accepted edge: `node dist/main` without the .js extension would not match — the package dev script always passes the full filename."

patterns-established:
  - "Entry-guard pattern for worker entry modules: side-effect-free imports, boot only under direct execution."

requirements-completed: []

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "workers/data-sync/src/main.ts start() invocation guarded behind isDirectExecution() so static imports from vitest/playwright never construct BullMQ queues, start the 5s/60s forecast sweep timers or register signal handlers"
    verification:
      - kind: unit
        ref: "tests/unit/worker-entry-guard.test.ts#importing dist/main.js never starts the worker"
        status: pass
      - kind: unit
        ref: "corepack pnpm --filter @bet-stats/data-sync typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "Hermetic child-process test proving both directions: importing compiled dist/main.js with all four dummy config values exits 0 with no worker.initialized/forecast.sweep output, and running dist/main.js directly with those values absent still logs worker.initialized and exits 0"
    verification:
      - kind: unit
        ref: "tests/unit/worker-entry-guard.test.ts#direct execution of dist/main.js still reports readiness"
        status: pass
      - kind: unit
        ref: "corepack pnpm vitest run --project unit (31 files / 268 tests)"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-10-16
status: complete
---

# Phase quick-261016-kpi: Entry-guarded data-sync worker Summary

**Main-module entry guard stops test/e2e imports from booting the sweep-enabled BullMQ worker (closing the empty-evidence INITIAL-snapshot incident class) while `node dist/main.js` direct execution stays byte-identical.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-16T13:03:00Z
- **Completed:** 2026-10-16T13:08:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- RED→GREEN TDD executed as planned: the import-side-effect test failed against the unguarded build (child hung on live queue/sweep handles and was killed at the 15s timeout) and passes after the guard was added.
- `start()` now runs only when `process.argv[1]` realpath-equals the module's own file URL; all six exports (`startReplayWorker`, `createLiveProviderFactories`, `resolveReplayProviderFactories`, `createSyncWorkers`, `createWorkerReadiness`, `scheduleFixtureEnrichment`) are untouched and the module is import side-effect-free.
- Hermetic test touches no Docker, no live Redis/Postgres — dummy URLs point at guaranteed-closed ports 55999 (Postgres) and 6390 (Redis).
- Full unit project green (31 files, 268 tests), data-sync typecheck clean, exactly one atomic 2-file commit; dev stack never restarted (running worker keeps its already-loaded dist and picks up the rebuild only on a future manual restart — expected).

## Task Commits

1. **Task 1: RED the import-side-effect test, GREEN with the main-module entry guard** — code staged, committed together with Task 2 (plan mandated a single atomic commit).
2. **Task 2: Full unit gate, import-consumer sanity, single atomic commit** — `0ffc248` (fix)

**Plan metadata:** orchestrator-owned (planning artifacts not committed by the executor).

## Files Created/Modified

- `tests/unit/worker-entry-guard.test.ts` (created) — child-node cases for the import-silent and direct-readiness directions, `describe.skipIf` on a missing dist build, 15s execFile timeout, full env inheritance.
- `workers/data-sync/src/main.ts` (modified) — `node:fs`/`node:url` imports, module-private `isDirectExecution()`, and the pre-existing `try { start(); } catch { ... process.exitCode = 1; }` block now wrapped in `if (isDirectExecution())` with the error message and `start()` body byte-for-byte unchanged.

## Decisions Made

- Realpath comparison on both sides (plan-specified) rather than string equality, so Windows path casing, symlinks and the relative `dist/main.js` argv[1] used by the dev script cannot produce false negatives.
- `NODE_ENV=test` pinned in both child processes so a host `NODE_ENV=production` cannot make the direct case throw `ConfigValidationError` (which would have failed the readiness assertion for reasons unrelated to the guard).

## Deviations from Plan

### Auto-fixed Issues

None — no deviation rules (Rules 1–4) triggered.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Plan executed as written; both tasks completed in the prescribed RED→GREEN order with a single atomic commit.

**Minor notes (non-deviations):**
- Commit message merges the plan wording with the caller's quick-task convention: `fix(worker): guard data-sync auto-start behind main-module entry check (261016-kpi)`.
- Per-test timeouts use the Vitest 4 options-object form (`it(name, { timeout: 30_000 }, fn)`) to let the RED case reach the 15s child timeout past Vitest's 5s default.

## Issues Encountered

None. RED produced exactly the predicted signal (import case `killed: true` at the child timeout, direct case already passing); GREEN passed on the first rebuild.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The 09:02:31Z incident class is closed at the source: no test/e2e process can publish immutable INITIAL snapshots with empty evidence by importing the worker module.
- The running dev stack must still be restarted manually to pick up the rebuilt `dist/main.js` (noted in STATE.md Ops 2026-10-16 as expected); the orchestrator handles STATE.md/ROADMAP/planning-artifact commits.
- Known accepted edge: `node dist/main` (no extension) would not match the guard; the package script always passes `dist/main.js`.

## Self-Check: PASSED

- `tests/unit/worker-entry-guard.test.ts` — FOUND
- `workers/data-sync/src/main.ts` — FOUND
- `0ffc248` — FOUND (`git log` / `git show --stat HEAD` lists exactly the two plan files)
- `261016-kpi-SUMMARY.md` — FOUND

---
*Phase: quick-261016-kpi*
*Completed: 2026-10-16*
