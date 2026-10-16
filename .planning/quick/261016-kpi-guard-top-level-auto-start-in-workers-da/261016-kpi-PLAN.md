---
phase: quick-261016-kpi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - workers/data-sync/src/main.ts
  - tests/unit/worker-entry-guard.test.ts
autonomous: true
requirements: []

estimate:
  tokens: 14000
  raw_tokens: 10000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "A vitest or playwright process that statically imports workers/data-sync/src/main.ts (tests/integration/replay-boundary.test.ts, tests/integration/live-provider-harness-smoke.test.ts, tests/e2e/live-provider-stack.ts) never executes start(): no readiness log line, no BullMQ queue/worker construction, no 5s-start / 60s-interval forecast sweep timers — even when process.env carries DATABASE_URL, REDIS_URL, FOOTBALL_DATA_API_TOKEN and API_FOOTBALL_API_KEY, so the 09:02:31Z empty-evidence INITIAL-snapshot incident class cannot recur from a test process."
    - "Direct execution stays byte-identical: `node dist/main.js` (pnpm --filter @bet-stats/data-sync dev, launched by scripts/dev-full.ps1 via turbo) still logs the readiness event and, when all four config values are present, still boots startReplayWorker with forecastSweep intervalMs 60_000 plus the SIGTERM/SIGINT close handlers."
    - "All existing exports of workers/data-sync/src/main.ts (startReplayWorker, createLiveProviderFactories, resolveReplayProviderFactories, createSyncWorkers, createWorkerReadiness, scheduleFixtureEnrichment) keep their exact signatures and the module stays import side-effect-free."
    - "A focused hermetic unit test proves both directions: importing the compiled dist/main.js with the four dummy env vars set exits 0 without the startup log, and running dist/main.js directly with the four vars absent still emits the readiness log and exits 0 — no Docker, no Redis, no Postgres touched (dummy ports are guaranteed-closed ports)."
  artifacts:
    - "workers/data-sync/src/main.ts contains a module-private isDirectExecution() guard (realpath comparison + pathToFileURL fallback) wrapping the existing top-level try { start(); } catch block"
    - "tests/unit/worker-entry-guard.test.ts with the direct-execution and import-side-effect child-node cases"
  key_links:
    - "process.argv[1] (node dist/main.js entry) -> realpathSync equality with fileURLToPath(import.meta.url) -> start() invoked exactly as before"
    - "vitest/playwright argv[1] (their own bin) != module URL -> guard false -> imports side-effect-free"
    - "child-process dummy env ports (55999/6390) -> regression cannot reach the live dev Postgres/Redis even if the guard breaks"
---

<objective>
Guard the top-level auto-start in workers/data-sync/src/main.ts behind a main-module entry check so importing the module from tests never boots a background forecast sweep worker, while direct execution via `node dist/main.js` behaves identically.

Purpose: `start()` currently runs unconditionally at module top level (main.ts lines 105-110). Three test/e2e files statically import this module, so any vitest/playwright process whose env carries the four server-config values (after `.env` was loaded into the shell) starts a SECOND sweep-enabled BullMQ worker against the dev database as an import side effect. This already caused the 09:02:31Z incident: a sweep tick 5 seconds after boot published 4 immutable INITIAL forecasts with EMPTY evidence before results were ingested (DB triggers forbid deleting those snapshots). A main-module entry check (recommended follow-up in STATE.md Ops 2026-10-16) eliminates the accidental write path at its root.

Output: entry-guarded main.ts + one hermetic child-process unit test; unit project and data-sync typecheck green; exactly one atomic commit. No API/database changes, no stack restarts.
</objective>

<execution_context>
@C:/Users/Vlad/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Vlad/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md

# The file to guard (top-level invocation at lines 105-110; start() at 91-103; exports at 16-89 must stay side-effect-free):
workers/data-sync/src/main.ts

# Launch facts establishing the entry path (dev script = `node --enable-source-maps dist/main.js`; scripts/dev-full.ps1 loads .env then runs `corepack pnpm dev` -> turbo -> that script; NO tsx/ts-node variant exists anywhere):
workers/data-sync/package.json
scripts/dev-full.ps1

# Vitest projects (unit = fast Docker-free suite; include pattern tests/unit/**/*.test.ts):
vitest.config.ts

# Consumers whose imports must keep working (read only, do NOT modify):
tests/integration/replay-boundary.test.ts (line 17), tests/integration/live-provider-harness-smoke.test.ts (line 2), tests/e2e/live-provider-stack.ts (line 6)

# Config fact (read only): readServerConfig's four values are all zod .optional() with NO defaults, so start() only boots the sweep worker when all four exist in process.env:
packages/config/src/index.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED the import-side-effect test, GREEN with the main-module entry guard</name>
  <files>tests/unit/worker-entry-guard.test.ts, workers/data-sync/src/main.ts</files>
  <behavior>
    - Import case: child `node --input-type=module -e "await import('<file URL of workers/data-sync/dist/main.js>')"` with env = process.env plus DATABASE_URL=postgresql://user:pass@127.0.0.1:55999/dummy, REDIS_URL=redis://127.0.0.1:6390, FOOTBALL_DATA_API_TOKEN=dummy-token, API_FOOTBALL_API_KEY=dummy-key → exit code 0, stdout does NOT contain the readiness event name worker.initialized, combined output does NOT contain forecast.sweep, and the process exits well inside a 15s child timeout (no hanging queue connections).
    - Direct case: child `node workers/data-sync/dist/main.js` with those four keys REMOVED from the inherited env → exit code 0 and stdout DOES contain worker.initialized (proves the guard still admits the real entry path; with config absent, start() logs readiness and returns, so nothing connects anywhere).
    - Both cases skip only when workers/data-sync/dist/main.js does not exist (clean checkout that has not run a build); in this dev environment the file exists after `corepack pnpm --filter @bet-stats/data-sync build`, so the suite runs for real.
  </behavior>
  <action>RED first: create tests/unit/worker-entry-guard.test.ts. Resolve the target once as distMain = fileURLToPath(new URL("../../workers/data-sync/dist/main.js", import.meta.url)) using the same relative-path style as the other tests/unit files; guard the suite with describe.skipIf(!existsSync(distMain)). Use node:child_process execFile with promisify, a 15000ms timeout, and full env inheritance. Dummy ports 55999 (Postgres) and 6390 (Redis) are deliberately non-default and closed, so even a regression cannot reach the live dev database or Redis the orchestrator's stack uses. Encode the two behaviors above as separate its. Run `corepack pnpm --filter @bet-stats/data-sync build && corepack pnpm vitest run --project unit tests/unit/worker-entry-guard.test.ts` against the CURRENT, unguarded dist/main.js: the import case MUST FAIL (the old module auto-starts — it either logs worker.initialized and then fails on the dummy URL, or is killed by the timeout; both outcomes are the RED signal), while the direct case should already pass. Expect RED to take up to the 15s child timeout — that is fine.

GREEN: edit workers/data-sync/src/main.ts. Add `import { realpathSync } from "node:fs";` and `import { fileURLToPath, pathToFileURL } from "node:url";`. Add a module-private, NON-exported function isDirectExecution(): boolean that reads process.argv[1], returns false when it is undefined, then compares realpathSync(fileURLToPath(import.meta.url)) against realpathSync(entry) inside try/catch (realpath normalizes the relative argv[1] "dist/main.js" against cwd and Windows case/symlink differences), falling back to pathToFileURL(entry).href === import.meta.url when realpath throws. Replace the unconditional top-level invocation so the EXISTING try { start(); } catch { console.error("Data-sync worker configuration is invalid"); process.exitCode = 1; } block only runs inside `if (isDirectExecution()) { ... }` — keep the error message, exitCode and start() itself byte-for-byte unchanged, and keep every export untouched and side-effect-free. Note the known accepted edge: `node dist/main` without the .js extension would not match (the package script always passes the full filename). Then rebuild the worker (`corepack pnpm --filter @bet-stats/data-sync build`) — the running dev worker executes the already-loaded dist/main.js and is NOT restarted or affected; do NOT kill or restart anything. Re-run the test file and confirm both cases pass. English identifiers; no comments needed; no user-facing strings anywhere. Do NOT commit — the quick-task constraint requires exactly one atomic commit in Task 2. Do NOT run any integration or e2e suite (tests/integration/replay.test.ts has 6 pre-existing failures), do NOT touch ROADMAP.md, STATE.md, package.json, or the three consumer test files.</action>
  <verify>
    <automated>corepack pnpm --filter @bet-stats/data-sync build && corepack pnpm vitest run --project unit tests/unit/worker-entry-guard.test.ts && corepack pnpm --filter @bet-stats/data-sync typecheck</automated>
  </verify>
  <done>tests/unit/worker-entry-guard.test.ts passes both its against a freshly built dist: importing dist/main.js with all four dummy env vars present exits 0 with no worker.initialized and no forecast.sweep output, and running dist/main.js directly with the four vars absent logs worker.initialized and exits 0; main.ts's start() invocation is guarded by isDirectExecution() with all exports unchanged; data-sync typecheck clean; nothing committed yet.</done>
</task>

<task type="auto">
  <name>Task 2: Full unit gate, import-consumer sanity, single atomic commit</name>
  <files>workers/data-sync/src/main.ts, tests/unit/worker-entry-guard.test.ts</files>
  <action>Run the final gates: the whole fast unit project (`corepack pnpm vitest run --project unit` — Docker-free, no integration suites), the worker typecheck, and a quick sanity check that the three static importers still compile against the unchanged exports by confirming the worker build emitted dist/main.js containing the isDirectExecution guard (e.g. grep the built file for isDirectExecution). Then commit EXACTLY ONE atomic commit staging only: workers/data-sync/src/main.ts and tests/unit/worker-entry-guard.test.ts — message `fix(worker): guard data-sync auto-start behind main-module entry check`. HARD BLACKLIST — never stage: .env, .env2, infra/docker-compose.yml, package.json, pnpm-lock.yaml, packages/database/src/generated/**, tsconfig.json, apps/web/next-env.d.ts, .agents/, .claude/, .planning/** (planning artifacts are committed by the orchestrator), workers/data-sync/dist/**, untracked scripts, plus every other unrelated working-tree file. Do not touch ROADMAP.md or any docs.</action>
  <verify>
    <automated>corepack pnpm vitest run --project unit && corepack pnpm --filter @bet-stats/data-sync typecheck && git show --stat HEAD | grep -E 'workers/data-sync/src/main.ts|tests/unit/worker-entry-guard.test.ts'</automated>
  </verify>
  <done>Full unit project green (including the new entry-guard test) and data-sync typecheck clean; HEAD is a single commit whose stat lists exactly workers/data-sync/src/main.ts and tests/unit/worker-entry-guard.test.ts; the running dev stack was never restarted and no integration/e2e suite was executed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test/e2e process env -> workers/data-sync module import | A vitest/playwright process may carry real provider credentials and DB/Redis URLs (loaded from .env); statically importing the worker module previously crossed this boundary and booted a live sweep worker as a side effect. |
| OS process entry (`node dist/main.js`) -> worker boot | Only the real process entry point may cross into queue construction, forecast sweep timers and signal handlers. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-kpi-01 | Tampering | Top-level start() in workers/data-sync/src/main.ts | high | mitigate | Main-module entry guard: start() only runs when process.argv[1] realpath-equals the module's own file URL, so importing test/e2e processes can never publish immutable INITIAL snapshots with empty evidence (the confirmed 09:02:31Z incident). |
| T-quick-kpi-02 | Denial of Service | Entry guard accidentally suppressing the real worker | medium | mitigate | Hermetic direct-execution test case spawns `node dist/main.js` and asserts the readiness log still appears with exit 0; comparison uses realpath on both sides so relative argv[1], Windows casing and symlinks cannot cause false negatives. |
| T-quick-kpi-03 | Information Disclosure | Dummy credentials/URLs in the child-process test | low | accept | Test values are inert literals (dummy-token/dummy-key) against guaranteed-closed ports 55999/6390; they never leave the child process, no real credentials are read or logged. |
| T-quick-kpi-04 | Tampering | npm/pip/cargo installs | high | mitigate | No package installs in this task; none permitted (package-legitimacy gate not triggered — only node:child_process, node:fs, node:url builtins are used). |
</threat_model>

<verification>
- `corepack pnpm --filter @bet-stats/data-sync build` succeeds and dist/main.js contains the isDirectExecution guard.
- `corepack pnpm vitest run --project unit tests/unit/worker-entry-guard.test.ts` — both child-process cases pass (import silent + exits 0; direct run logs readiness + exits 0).
- `corepack pnpm vitest run --project unit` — whole fast suite green, Docker-free.
- `corepack pnpm --filter @bet-stats/data-sync typecheck` clean.
- `git show --stat HEAD` contains exactly workers/data-sync/src/main.ts and tests/unit/worker-entry-guard.test.ts.
- Running dev stack untouched: no process killed, no stack restart performed.
</verification>

<success_criteria>
Importing workers/data-sync/src/main.ts can never again boot the sweep-enabled BullMQ worker (the immutable empty-evidence-snapshot incident class is closed at the source), while `node dist/main.js` direct execution — readiness log, sweep, queues, signal handlers — is unchanged and proven by the hermetic test; unit gates green; one atomic commit of exactly the two files.
</success_criteria>

<output>
Create `.planning/quick/261016-kpi-guard-top-level-auto-start-in-workers-da/261016-kpi-SUMMARY.md` when done
</output>
