---
quick_id: 261123-quu
status: complete
completed: "2026-11-23"
commits:
  - sha: 2f8cea6
    message: "fix(phase-11): read stored expectedGoals shape for rho fit and guard model-comparison with OperatorGuard"
---

# Quick Task 261123-quu — Summary

- **CR-01 fixed.** The rho fit read `receipt.expectedGoals`, but `ForecastSnapshot.receipt` stores the whole forecast DTO, so every snapshot was skipped and rho always fell back to 0. It now reads `receipt.receipt.expectedGoals`. The seed in `dixon-coles-rho.test.ts` uses the real stored shape; with the fix reverted, 4 tests fail, with it they pass.
- **CR-02 fixed.** `@UseGuards(OperatorGuard)` on `modelComparison` (stacks with the class-level `EligibilityGuard`, so operator callers still need eligibility headers). New test checks route metadata, that `valueCandidates` stays unguarded, and 404 for missing, wrong and unconfigured credentials.
- **Verification:** 41/41 related integration tests pass (backtest-origin, backtest-production, forecast-api, forecast-publication, evaluation-api, model-comparison-api, dixon-coles-rho); api and database `tsc --noEmit` clean.
- **Not done:** WR-01..WR-06 and IN-01..IN-04 remain open. Existing forecast snapshots keep their stored rho provenance; the fix affects new rho fits only.
- **Process note:** executed inline without spawning planner/executor agents (configured agent models `openrouter/free` are not usable from Claude Code; the change was two small fixes).
