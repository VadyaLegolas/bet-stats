---
status: fixed_pending_ci
trigger: "CI run 44340445683 (head 9387bd0): performance-budget reached BUDGETS_OK at 15:53:28 and then emitted no output until the 25-minute job timeout"
created: "2026-11-19T07:00:00Z"
updated: "2026-11-19T07:00:00Z"
fixed_commit: pending
---

# Debug Session: perf-budget-ci-process-hang

## Symptoms

- **Expected behavior:** `node scripts/perf-audit.mjs --receipt "$RUNNER_TEMP/perf-receipt.json"` measures, asserts, cleans up and exits 0 (`BUDGETS_OK`).
- **Actual behavior:** The audit itself finished on the CI runner: `RECEIPT_WRITTEN` at 15:53:28, medians printed, `BUDGETS_OK: all gated medians within budget`. Then the step produced **no further output** until the runner cancelled it at 16:16:45 (`The job has exceeded the maximum execution time of 25m0s`). Job conclusion `cancelled`, so the gate is red despite a passing audit.
- **Timeline:** CI run 44340445683, job 134928624247, head `9387bd0` (first run after the Chrome-flags fix). The audit portion took 79 s; the remaining 23 minutes were idle.
- **Contrast:** The same command exits 0 in 3–5 minutes on the local Windows machine.

## Root Cause

`start()` spawned the owned API and web services as:

```js
spawn(process.platform === "win32" ? "cmd.exe" : "corepack", [...], { stdio: ["ignore", "pipe", "pipe"] })
```

On POSIX the spawned `corepack` is a **wrapper**; the actual `node` API and `next start` servers are grandchildren.
`stop(pid)` tries `process.kill(-pid, "SIGTERM")` first, which needs a process group — but the child was not
`detached`, so no group exists and the call throws `ESRCH`; the fallback `process.kill(pid)` kills only the
wrapper. The surviving grandchildren keep the harness' inherited stdout/stderr pipes open, so Node's event
loop never empties after `main()` resolves. `process.exitCode` alone therefore never terminates the process.
On Windows `taskkill /T /F` kills the whole tree, which is why the bug never reproduced locally.

## Fix

1. `start()` now passes `detached: process.platform !== "win32"`, making the POSIX wrapper a process-group
   leader so `process.kill(-pid)` reaches `corepack → pnpm → node` in one signal.
2. The main-entry guard captures the assertion code, runs `cleanup()` in `finally`, then calls
   `process.exit(exitCode)` — a completed audit always ends the CI step even if a stray handle survives.
   `cleanup()` is fully synchronous (`taskkill`/`process.kill` + `docker rm --force`), so nothing is left
   to drain before exit.

Source pins added to `tests/unit/perf-audit.test.ts` (`CI process-exit contract`) so either half of the fix
cannot regress silently.

## Verification

- `pnpm vitest run --project unit tests/unit/perf-audit.test.ts tests/unit/ci-workflow-contract.test.ts` → 45/45 pass.
- Local full run `node scripts/perf-audit.mjs --receipt "$env:TEMP\perf-receipt-exitfix.json"` → exit 0,
  `BUDGETS_OK`, medians within budget, receipt removed. Windows path unaffected by the POSIX-only change.
- CI verification pending: push and observe `performance-budget` finish promptly after `BUDGETS_OK`.

## Status

**Fixed, pending first green CI run.**
