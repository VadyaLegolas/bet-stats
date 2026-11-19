---
status: fixed
trigger: "CI run 44261545363: performance-budget job hangs at 'waiting for dynamic debugging port in chrome-err.log' and is cancelled by the 25-minute job timeout"
created: "2026-11-18T08:20:00Z"
updated: "2026-11-19T07:00:00Z"
fixed_commit: "9387bd0"
---

# Debug Session: perf-budget-ci-chrome-hang

## Symptoms

- **Expected behavior:** `node scripts/perf-audit.mjs --receipt "$RUNNER_TEMP/perf-receipt.json"` runs 3 mobile + 3 desktop Lighthouse audits on the GitHub Actions ubuntu runner, writes the receipt, and exits 0 (`BUDGETS_OK`) or non-zero on a real budget regression.
- **Actual behavior:** On the clean CI runner the step starts Chrome via `chrome-launcher` and stalls. Log shows `waiting for dynamic debugging port in chrome-err.log` at 07:50:03 and then NO further output until the job is cancelled at 08:12:23 (`##[error]The operation was canceled.`). Job conclusion `cancelled` (workflow `timeout-minutes: 25`).
- **Error messages:** None from the harness itself — only `The operation was canceled.` from the runner. Chrome download first timed out (`storage.googleapis.com` 30s) then succeeded from `cdn.playwright.dev`.
- **Timeline:** First CI run that actually reaches the audit step (run 44261545363, head `ede253d`, 2026-11-18). Locally on Windows the full 6-audit run completes in 3m49s (`BUDGETS_OK`, exit 0).
- **Reproduction:** Trigger the `performance-budget` job in `.github/workflows/ci.yml` on GitHub Actions (ubuntu runner, no local Chrome); or run the harness on a Linux runner where Chrome is launched by `chrome-launcher` rather than Playwright's own launcher.

## Root Cause

`scripts/perf-audit.mjs:272` launched Chrome with only:

```js
const chrome = await launch({ chromePath, chromeFlags: ["--headless=new"] });
```

GitHub Actions ubuntu runners execute as root inside a container. Chrome refuses to start as root without `--no-sandbox` and prints nothing to `chrome-err.log`, so `chrome-launcher` waits forever for the dynamic debugging port. `/dev/shm` is also typically 64 MB on those runners, so `--disable-dev-shm-usage` is required to avoid crashes. Playwright's own launcher adds both flags automatically — `chrome-launcher` does not.

## Fix

Added the CI-required flags (commit `9387bd0`):

```js
const chrome = await launch({
  chromePath,
  chromeFlags: [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
  ],
});
```

Locally these are harmless no-ops; on the CI runner they let Chrome expose its debugging port. The flags are identical across local and CI runs, preserving the parity requirement (Pitfall 7).

## Evidence

- `scripts/perf-audit.mjs:272` — original single-flag launch.
- CI job 134655950149, last log line 07:50:03 `waiting for dynamic debugging port in chrome-err.log`, then silence until the 08:12:23 cancellation.

## Verification

- Unit suite green: `pnpm vitest run tests/unit/perf-audit.test.ts` → 26/26 pass (pure helpers untouched by the flag change).
- CI verification pending: pushed `9387bd0` to `origin/main`. The green `performance-budget` job is the phase 10 human-verification item.

## Status

**Fixed and confirmed on CI:** run 44340445683 (head `9387bd0`) launched Chrome and completed all six audits
(`RECEIPT_WRITTEN` + `BUDGETS_OK`). The same run then exposed a separate post-audit exit hang — see
`perf-budget-ci-process-hang.md`.