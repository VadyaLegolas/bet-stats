---
phase: quick-261016-exf
plan: 1
status: complete
tags: [quick, fixtures-sync, results-sync, api-budget, provider-client]
dependency_graph:
  requires: [quick-261016-d9t (windowed sync + results sync service)]
  provides: [past-window FINISHED fixture backfill, per-chunk API-budget reservation]
  affects: [internal/fixtures/sync operator runs, internal/results-sync operator runs]
tech_stack:
  added: []
  patterns: [optional-client-fetch-option, per-fetch-budget-jobkey]
key_files:
  created: []
  modified:
    - packages/football-data/src/providers/football-data-org/client.ts
    - apps/api/src/modules/fixtures/fixtures-sync.service.ts
    - apps/api/src/modules/fixtures/results-sync.service.ts
    - tests/unit/provider-contract.test.ts
decisions:
  - Client allStatuses option omits the status key entirely (no status=SCHEDULED override) so football-data.org returns every status in the window; default path stays byte-identical.
  - Per-chunk reservation jobKeys embed chunk bounds plus a per-run ISO stamp because reservePriorityRequest is idempotent per jobKey within a day — reuse would under-count.
  - Results mid-run denial returns both fixture and result counts persisted so far (denial is not an exception, so it escapes the failure-mapping catch untouched).
metrics:
  duration: ~21m
  completed: 2026-10-16
  tasks: 3
  commits: 1
---

# Phase quick-261016-exf: Past fixture retrieval task artifacts Summary

Past-window fixture sync now fetches FINISHED matches (optional `allStatuses` client option, byte-identical default URL) and both sync services reserve one API-budget row per provider chunk instead of per league — fixing a live operator run that persisted zero historical fixtures while reporting "synced" and under-counted budget 7-for-21.

## What Was Done

- **Task 1 (TDD):** `FootballDataOrgClient.fetchCompetitionFixtures` gained optional `options?: { allStatuses?: boolean }`. Default path builds the exact `status=SCHEDULED&dateFrom=...&dateTo=...` query (key order pinned by existing assertions); all-status path omits the `status` key. Two ADDED provider-contract tests: exact all-status URL (only `dateFrom`/`dateTo` keys) and FINISHED payload normalizing to `status: "FINISHED"` through the fixtures path. RED confirmed first (new URL test failed pre-implementation), then GREEN (32/32).
- **Task 2:** `FixturesSyncService.syncLeague` and `ResultsSyncService.syncLeague`: pre-loop `reservePriorityRequest` blocks removed; reservation moved inside the chunk loop as the first statement, with jobKeys `manual-fixtures-sync:${code}:${chunk.dateFrom}:${chunk.dateTo}:${runStamp}` and `manual-results-sync:${code}:${chunk.dateFrom}:${chunk.dateTo}:${runStamp}`. Mid-run denial returns counts persisted so far. The fixtures loop passes `{ allStatuses: true }` so past windows persist FINISHED fixtures + `FixtureExternalRef` for `ResultsSyncService` identity resolution. League gates, shared 6_500 ms spacing gate, `chunkSyncDateRange`/`resolveSyncDateRange` and response shapes untouched.
- **Task 3:** Full gate battery (below), single atomic commit `106ee4e` with the exact required subject and a body referencing 261016-exf.

## Verification Results (actual outputs)

| Gate | Result |
| ---- | ------ |
| `pnpm --filter @bet-stats/football-data build` | exit 0 |
| `pnpm --filter @bet-stats/api build` | exit 0 |
| `pnpm --filter @bet-stats/football-data typecheck` | exit 0 |
| `pnpm --filter @bet-stats/api typecheck` | exit 0 |
| `tests/unit/provider-contract.test.ts` | 32/32 pass (pre-existing exact-URL assertions unmodified; test diff 22 additions / 0 deletions) |
| `tests/unit/forecast-sweep.test.ts` + `tests/integration/forecast-publication.test.ts` | 14/14 pass |
| `tests/integration/replay-boundary.test.ts` | 21/21 pass (see env note) |
| Combined final run (all 4 suites) | 67/67 pass |
| `git diff --cached --name-only` | exactly the 4 plan-named files |
| Post-commit deletion check | no deletions |

**Env note (replay-boundary):** the suite initially failed with `OPERATOR_PROXY_SIGNING_SECRET must be supplied by the test process` and then with 20 proxy 404s. Root cause was environmental, not code: the check requires the secret exported in the test process, and `verifyIngressReplayRequest` requires `OPERATOR_AUTHORIZED_SUBJECTS` to contain the test's fixed subject `local-test-operator` — this working copy's `.env` authorizes `bet-stats-operator` instead, so every signed request was rejected with the proxy's deliberate 404. Running the suite with the secret from `.env` plus `OPERATOR_AUTHORIZED_SUBJECTS=local-test-operator` yields 21/21 green. No test was weakened. `tests/integration/replay.test.ts` (6 known pre-existing failures: fixed test clock vs DB time) was not run, per instructions.

## Deviations from Plan

- **Single atomic commit instead of per-task TDD commits:** Task 1 carried `tdd="true"` (RED/GREEN executed and confirmed during the task), but the plan's constraints and the orchestrator's hard constraints both mandate one atomic commit with an exact subject, so RED/GREEN were verified via test runs and committed together in `106ee4e`.
- None otherwise — plan executed as written.

## Known Stubs

None — no placeholder values, TODOs, or unwired components in the changed files.

## Threat Flags

None beyond the plan's threat register (per-chunk jobKeys → T-261016exf-01; mixed-status payload gate unchanged → T-261016exf-02).

## Self-Check: PASSED

- FOUND: all four modified files exist and are committed in `106ee4e`
- FOUND: `106ee4e` in git log
