---
phase: quick-261017-pyp
plan: 1
subsystem: web
tags: [fixtures, results-sync, manual-publication, operator-proxy, fail-closed, nextjs, react, vitest, node-env-ui-tests]

# Dependency graph
requires:
  - phase: quick-261016-exf
    provides: Operator-guarded POST /internal/fixtures/results-sync endpoint (ResultsSyncService.sync windowed run) that the new button publishes through
  - phase: quick-261016-d9t
    provides: Fail-closed operator proxy pattern (apps/web/app/internal-api/fixtures/sync/route.ts) mirrored character-for-character by the new results-sync proxy
  - phase: quick-261016-l90
    provides: Manual-only data-loading invariant (FIXTURES_AUTO_SYNC=false) that this plan extends to results publication by reverting the uncommitted auto-scheduler
provides:
  - "Manual «Загрузить результаты» control on the fixtures page: one-click, optionally league-scoped publication of finished-match outcomes with per-league Russian summaries in the shared status area"
  - "New fail-closed Next proxy /internal-api/fixtures/results-sync: 404 { message: \"Not found\" } with no upstream call when OPERATOR_CREDENTIAL is missing; credential attached server-side only"
  - "ResultsSyncService restored to the committed manual-only HEAD — no auto-interval helper, no OnModuleInit timer, no scheduled results publication anywhere in the API"
  - "New tests/unit/results-sync-button-ui.test.tsx (5 cases) + 2 proxy cases in tests/unit/internal-api-route.test.ts"
affects: [fixtures-page, results-publication, operator-proxy, provider-budget, verification]

# Actuals (#2632) — chars/4 over the realized diff (git show 4f315cb patch = 18,999 chars).
actuals:
  tokens: 4750
  tasks: 3
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Node-env UI behavioral tests drive the exported onClick handler (runResultsSync) with vi.stubGlobal fetch/window, plus a probe-verified vi.mock of the resolved next/navigation node_modules path (bare specifier does not intercept from a root test file)"
    - "messageOwner state ('sync' | 'results' | null) lets two buttons share one role=status paragraph without clobbering each other's messages"

key-files:
  created:
    - apps/web/app/internal-api/fixtures/results-sync/route.ts
    - tests/unit/results-sync-button-ui.test.tsx
  modified:
    - apps/web/components/date-range-filter.tsx
    - tests/unit/internal-api-route.test.ts

key-decisions:
  - "Result publication stays a deliberate operator action: the uncommitted auto-scheduler (timer, OnModuleInit, auto-interval helper, untracked auto test, .env interval line) was fully reverted instead of shipped — user decision recorded in the plan (NO auto loading of results)."
  - "runResultsSync is exported (not private) solely so the node-environment unit tests can drive the exact function the button's onClick delegates to — the repo has no DOM library and installing one is out of quick scope (see limitation below)."
  - "Plural correctness follows the existing plural helper over the published-results count (must-have truth 2), not the plan's one literal test string that contradicted it (see Deviations)."

patterns-established:
  - "Second Next internal-api proxy with unit-verified fail-closed + forwarding semantics (credential never reaches the browser or the response headers)."

requirements-completed: []

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Fixtures page shows «Загрузить результаты» next to «Обновить матчи», disabled while either sync runs; no background/scheduled results loading exists anywhere in the API"
    verification:
      - kind: unit
        ref: "tests/unit/results-sync-button-ui.test.tsx#renders both sync buttons and the results hint (static markup) + service file byte-identical to manual-only HEAD via git diff --exit-code"
        status: pass
      - kind: other
        ref: "git diff --exit-code -- apps/api/src/modules/fixtures/results-sync.service.ts = 0 after git checkout; tests/unit/results-sync-auto.test.ts deleted (was untracked); .env interval line removed"
        status: pass
    human_judgment: false
  - id: D2
    description: "Per-league Russian summaries with correct plural via the existing helper; the two buttons never overwrite each other's messages"
    verification:
      - kind: unit
        ref: "tests/unit/results-sync-button-ui.test.tsx#posts the scoped run, reports published results and refreshes quota + page; #omits the competitions key for a full run and skips refresh while nothing published; #maps per-league statuses and published-result plurals (1/2/5)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A run with any synced league dispatches fixtures-quota-refresh and calls router.refresh(); failures render results-specific Russian copy without claiming success"
    verification:
      - kind: unit
        ref: "tests/unit/results-sync-button-ui.test.tsx (synced case asserts dispatchEvent once with CustomEvent type fixtures-quota-refresh + refresh once; skipped case asserts refresh NOT called while quota event fires; 503 DETERMINISTIC_MODE case asserts results-specific copy with neither event nor refresh)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Proxy fails closed 404 { message: \"Not found\" } with NO upstream call when OPERATOR_CREDENTIAL is missing; otherwise forwards the body verbatim with x-operator-credential added server-side"
    verification:
      - kind: unit
        ref: "tests/unit/internal-api-route.test.ts#fails closed for results publication when the operator credential is missing (fetch not called) and #forwards results publication with the credential attached server-side (verbatim body, no credential in response headers)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Bottom hint explains that «Загрузить результаты» публикует итоги завершённых матчей; all UI strings Russian, identifiers English"
    verification:
      - kind: unit
        ref: "tests/unit/results-sync-button-ui.test.tsx#renders both sync buttons and the results hint (asserts «публикует итоги завершённых матчей» substring)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Gates green: full unit project passes (291 baseline + 7 new = 298) and web typecheck exits 0; nothing about fixtures/lineups/odds sync behavior changes"
    verification:
      - kind: other
        ref: "corepack pnpm vitest run --project unit = 298/298 across 35 files, exit 0; corepack pnpm --filter @bet-stats/web typecheck = exit 0; targeted run of the two touched test files = 11/11; diff touches only the 4 plan files (runSync body, autoSync mount path and the fixtures sync proxy byte-unchanged)"
        status: pass
    human_judgment: false

# Metrics
duration: "~10m (2026-10-17T17:05Z–17:15Z)"
completed: 2026-10-17
status: complete
---

# Phase quick-261017-pyp: Manual Results Publication Button Summary

**Results publication is now an explicit button: the uncommitted auto-scheduler was reverted to manual-only HEAD, and a fail-closed operator proxy + «Загрузить результаты» button publish finished-match outcomes with per-league Russian summaries — proven by 7 new unit cases, 298/298 green**

## Performance

- **Started:** 2026-10-17T17:05Z
- **Completed:** 2026-10-17T17:15Z
- **Tasks:** 3
- **Files changed:** 4 committed (+240/−5), plus ops-only .env edit (gitignored, never staged)

## Accomplishments

- **Task 1 (revert):** precondition check confirmed the working-tree delta of `results-sync.service.ts` was exactly the auto-scheduler blocks (interval helper, OnModuleInit import/clause, timer + re-entrancy fields, onModuleInit/runAutoSync, widened onModuleDestroy); `git checkout --` restored the committed manual-only form (`git diff --exit-code` = 0). Untracked `tests/unit/results-sync-auto.test.ts` deleted; gitignored `.env` lost the `RESULTS_AUTO_SYNC_INTERVAL_MINUTES=60` line while keeping `FIXTURES_AUTO_SYNC=false`. `.gsd/dispatch-isolation-sentinel.json` untouched, never staged.
- **Task 2 (proxy + button):** new `apps/web/app/internal-api/fixtures/results-sync/route.ts` is a character-level mirror of the sibling fixtures sync proxy (fail-closed 404 before any upstream fetch; upstream `/internal/fixtures/results-sync`; body passed through verbatim; only status/content-type/cache-control copied back). `date-range-filter.tsx` gained `FilterSyncState` (named reuse), `SyncResult.results?`, `formatResultsSyncResults` (synced/skipped/restricted/request-failed/отказ fallback incl. the service's `denied` status, ` · ` join, plural helper), results-specific `describeResultsSyncFailure` (503 DETERMINISTIC_MODE / DATABASE_NOT_CONFIGURED / PROVIDER_TOKEN_NOT_CONFIGURED, 404, generic), exported `runResultsSync` mirroring `runSync` (POST body `{ force: true, ...(league ? { competitions: [league] } : {}) }`, quota-refresh dispatch always on success, `refresh()` only when some league synced), `resultsSyncState` + `messageOwner` state, the «Загрузить результаты» button (disabled while either sync pending, pending label «Загружаю результаты…»), and the hint sentence ««Загрузить результаты» публикует итоги завершённых матчей.». `runSync` semantics changed only by the one `setMessageOwner("sync")` line; `autoSync` mount path and the fixtures sync proxy untouched. Web typecheck exit 0 after Task 2.
- **Task 3 (tests + gates + commit):** new `tests/unit/results-sync-button-ui.test.tsx` (5 cases: static render; scoped synced run — URL/method/body/summary/quota event/refresh; full skipped run — `{ force: true }` only, refresh withheld while quota event fires; 503 DETERMINISTIC_MODE — results-specific copy, no event/refresh; direct formatResultsSyncResults status mapping + 1/2/5 plurals). Extended `tests/unit/internal-api-route.test.ts` with the proxy's fail-closed (fetch NOT called) and forwarding (verbatim body, `x-operator-credential` server-side, no credential in response headers, cache-control stamp) cases. Gates: targeted 11/11, full unit project **298/298 across 35 files** (291 pre-existing + 7 new, zero failures), web typecheck **exit 0**. Exactly one atomic commit, only the 4 planned code files staged.

## Test-Driving Limitation (documented per plan)

DOM click simulation was **impossible** in the existing setup: the unit project runs in the `node` environment with **no jsdom, happy-dom, @testing-library or react-test-renderer anywhere in the repo, apps/web or the pnpm store**, and installing a dependency is out of quick scope (package-legitimacy gate). A probe additionally verified that `vi.mock("next/navigation", …)` with the bare specifier does NOT intercept the component's import from a root test file; the working recipe (used here) mocks the resolved `../../apps/web/node_modules/next/navigation.js` path with `vi.hoisted` refresh spy. The behavioral cases therefore drive `runResultsSync` — **the exact exported function the button's onClick delegates to** — with `vi.stubGlobal("fetch", …)` and `vi.stubGlobal("window", { dispatchEvent: vi.fn() })`, while the render case asserts the button/hint markup statically via `renderToStaticMarkup`.

## Task Commits

Single atomic commit (per plan):

1. **Task 1: Revert the uncommitted auto-scheduler** — `4f315cb` (no net diff of its own; the revert + ops edit are uncommitted by design)
2. **Task 2: Proxy route + button** — `4f315cb`
3. **Task 3: Tests, gates and one atomic commit** — `4f315cb`

**Commit:** `4f315cb` `feat(web): add manual results publication button with operator proxy route` — exactly 4 files: `route.ts` (new, +13), `date-range-filter.tsx` (+73/−5), `results-sync-button-ui.test.tsx` (new, +112), `internal-api-route.test.ts` (+42); zero tracked-file deletions; body references 261017-pyp.

## Files Created/Modified

- `apps/web/app/internal-api/fixtures/results-sync/route.ts` - New operator proxy: fail-closed `NextResponse.json({ message: "Not found" }, { status: 404 })` when `OPERATOR_CREDENTIAL` is missing (no upstream fetch), otherwise POST to `${API_ORIGIN ?? "http://127.0.0.1:3001"}/internal/fixtures/results-sync` with `content-type` + `x-operator-credential` and `await request.text()` verbatim; response passthrough copies only status/content-type/`cache-control: private, no-store, max-age=0`.
- `apps/web/components/date-range-filter.tsx` - `FilterSyncState` exported and reused for both buttons; `SyncResult.results?`; new `formatResultsSyncResults`, private `describeResultsSyncFailure`, exported `runResultsSync`; component state `resultsSyncState` + `messageOwner` with `statusState` selecting the owner for the single `role="status"` paragraph; new «Загрузить результаты» `btn-secondary` (disabled `syncState.pending || resultsSyncState.pending`) between «Обновить матчи» and the status area; hint paragraph gained the results sentence. `runSync` body byte-unchanged except the added `setMessageOwner("sync")` first line.
- `tests/unit/results-sync-button-ui.test.tsx` - New 5-case suite (see Accomplishments), probe-verified router mock, `afterEach` with `vi.unstubAllGlobals()` + `vi.clearAllMocks()`.
- `tests/unit/internal-api-route.test.ts` - Import of the new proxy's POST plus 2 cases (fail-closed 404 with fetch not called; forwarding with verbatim body and server-side credential).
- `.env` (ops-only, gitignored, never staged) - `RESULTS_AUTO_SYNC_INTERVAL_MINUTES=60` removed; `FIXTURES_AUTO_SYNC=false` retained.
- `apps/api/src/modules/fixtures/results-sync.service.ts` - Restored to committed manual-only HEAD via `git checkout --` (no diff in the commit); `tests/unit/results-sync-auto.test.ts` deleted from the working tree (was untracked).

## Decisions Made

- Publication stays operator-controlled end to end: the button narrows optionally to the selected league, the service's capability/budget/spacing gates are unchanged, and the only unattended ticker (uncommitted) was removed rather than shipped.
- `messageOwner` ("sync" | "results" | null) resolves the shared-status-area conflict: the most recently started action owns the paragraph, and the other button's message survives until it runs again — both buttons' messages are preserved in state.
- The proxy mirrors the proven fixtures sync proxy character-for-character except the upstream path and the doc-comment wording (Next 16.3.3 per apps/web/AGENTS.md; `route.md` guide confirmed the `export const POST` convention is current).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan Task 3 case (2) literal expectation contradicted the plural helper and must-have truth 2**
- **Found during:** Task 3 (writing the synced-run test)
- **Issue:** The plan's case (2) expected `«Премьер-лига: опубликовано 3 результатов»`, but the existing `plural` helper renders 3 → «результата» (the "few" form — correct Russian), and must-have truth 2 requires «correct Russian plural via the existing plural helper». The plan's own case (5) (1 результат / 2 результата / 5 результатов) is fully helper-consistent, so case (2)'s word form was a planner slip.
- **Fix:** Kept the plan's exact response data (`fixtures: 3, results: 3`) and the helper-based formatter; the test asserts the helper-correct `«Премьер-лига: опубликовано 3 результата»`. No production-code change.
- **Files modified:** tests/unit/results-sync-button-ui.test.tsx
- **Verification:** suite green; case (5) still proves 1/2/5 forms.
- **Ledger:** WINDOWS.md entry 26 (`kind: deviation`).

---

**Total deviations:** 1 (test-expectation-only; zero production-code deviation)
**Impact on plan:** All six must-have truths verified by the gates; production diff is exactly the planned proxy + button.

## Issues Encountered

- **First commit attempt aborted by PowerShell quoting:** the ASCII `\"` escapes inside the double-quoted `-m` string terminated the argument early (`error: pathspec 'Загрузить' …`, exit 1, nothing committed — HEAD unchanged at 29a22e6, index intact); retried with a here-string message and guillemet quoting → clean commit `4f315cb`.
- **Node engine warning** (`wanted >=24 <25, current v25.2.1`) appears on every pnpm invocation — pre-existing repository-wide, non-blocking, out of scope.

## Known Stubs

None — no hardcoded empty values, placeholder copy or unwired data sources were introduced.

## Threat Flags

None — no new security surface beyond the plan's `<threat_model>`: the proxy fails closed without the operator credential (T-261017pyp-01, unit-verified), copies no credential or upstream-only headers (T-02), the button runs through the unchanged server-side capability/budget/spacing gates and this plan removes the only unattended results ticker (T-03), and no code path parses the auto-interval variable anymore (T-04). No installs, no new dependencies (T-SC).

## User Setup Required

None — the orchestrator restarts the stack and live-verifies the button; no external service configuration changed.

## Next Phase Readiness

- **Stack restart pending (orchestrator's action):** the no-restart rule forbade touching the running API (:3001, still serving the pre-revert dist with the auto-scheduler code) — after restart, results publication is manual-only and reachable via the new «Загрузить результаты» button; live check = press it on /fixtures and read the per-league summary line.
- Ops hygiene completed: `.env` no longer carries `RESULTS_AUTO_SYNC_INTERVAL_MINUTES`; keep it that way (manual-only invariant from quick 261016-l90 now covers results too).
- Untouched and unstaged: `.gsd/dispatch-isolation-sentinel.json`, `.planning/**`, `apps/api` (beyond the revert-to-HEAD), ROADMAP.md, no integration/e2e suites run.

---
*Phase: quick-261017-pyp*
*Completed: 2026-10-17*

## Self-Check: PASSED

- Commit `4f315cb` found in git log; `git show --numstat` = exactly the 4 planned files (+240/−5), zero tracked-file deletions.
- Both new files exist on disk (`route.ts`, `results-sync-button-ui.test.tsx`); `apps/api/src/modules/fixtures/results-sync.service.ts` diff vs HEAD = 0; `tests/unit/results-sync-auto.test.ts` gone; `.env` keeps `FIXTURES_AUTO_SYNC=false` and has no auto-interval line — all re-verified this session.
- Gates re-verified: targeted 11/11, unit project 298/298 (35 files), web typecheck exit 0; `git diff --cached --name-only` listed exactly the 4 files at commit time; `.env`, `.gsd/**` and `.planning/**` absent from the commit.
- Frontmatter carries `status: complete`; deviation ledger entry 26 appended to `.planning/WINDOWS.md` (`kind: deviation`).
