---
phase: 08-backups-and-restore-verification
plan: 04
subsystem: infra
tags: [operator-gateway, basic-auth, hmac, playwright, powershell, backups, operations]
gap_closure: true
gap_ids: [G-08-6]

# Dependency graph
requires:
  - phase: 08-backups-and-restore-verification (08-03)
    provides: "backups() read model, manual trigger endpoints behind OperatorGuard, fail-closed HMAC web proxy at /internal-api/operations"
  - phase: 06-release-hardening
    provides: "operator gateway (replay-only scope), OPERATOR_* env contract, owned live-release e2e stack"
provides:
  - "Gateway Basic-auth + HMAC signing extended to /internal/operations and /internal-api/operations (segment-boundary matched, same OPERATOR_PROXY_SIGNING_SECRET)"
  - "Dev launcher (scripts/app-lifecycle.ps1) starts/stops/reports the operator gateway as part of the documented topology; GATEWAY_PORT documented in .env.example"
  - "E2E proof that a real browser with only Basic auth reaches the operations centre through the gateway and presses both trigger buttons; unsigned paths refused at both layers"
affects: [08-05, uat, operations-ingress, operator-gateway]

# Actuals (#2632)
actuals:
  tokens: 7800    # chars/4 over the realized 9-file diff (31219 bytes)
  tasks: 3
  commits: 3      # measured: git rev-list --count a98c1cb..HEAD (ledger gsd-plan-head-before-08-04)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gateway protected-path classification (isProtectedPath) covers /internal*/operations* with exact-or-slash segment boundaries; unsigned requests are never forwarded with operator headers"
    - "Playwright under test.use({ httpCredentials }): request.newContext() silently inherits credentials (runBeforeCreateRequestContext merges _combinedContextOptions) — anonymous probes must use plain fetch"
    - "Launcher child processes (daemon/gateway) spawn best-effort with dedicated log files; readiness probes warn without failing the stack"

key-files:
  created:
    - tests/e2e/operations-gateway.spec.ts
  modified:
    - infra/operator-gateway/security.mjs
    - infra/operator-gateway/server.mjs
    - tests/unit/operator-gateway.test.ts
    - tests/integration/operator-gateway.test.ts
    - scripts/app-lifecycle.ps1
    - .env.example
    - tests/e2e/live-provider-stack.ts
    - package.json

key-decisions:
  - "Gateway logs to a sibling %TEMP%\\bet-stats-gateway.log: the running stack daemon holds bet-stats-stack.log append-locked, and a second writer throws a sharing violation under $ErrorActionPreference='Stop' (Rule 3 deviation, 0ea8210)"
  - "Integration boundary case asserts 401 with no upstream hop for unsigned gateway requests (not 'reaches upstream unsigned'): extending the protected prefixes to operations means the gateway itself now refuses unsigned operations requests — fail-closed preserved and strengthened (ad57d8b)"
  - "E2E negative probe uses plain Node fetch, not a Playwright request context: test.use({ httpCredentials }) injects credentials into every request.newContext(), which made the 'anonymous' probe return 200 (the gateway was correct — manually reproduced 401 against a standalone instance) (5da9972)"
  - "E2E stack grants the API BACKUP_ENABLED=true + mkdtemp BACKUP_DIR so the trigger POSTs return 202; enqueued BullMQ jobs need no consumer and die with the throwaway Redis"

requirements-completed: [BAK-03]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Gateway authenticates (Basic) and HMAC-signs /internal/operations and /internal-api/operations requests with the existing OPERATOR_PROXY_SIGNING_SECRET; replay behavior unchanged"
    requirement: BAK-03
    verification:
      - kind: unit
        ref: "tests/unit/operator-gateway.test.ts — protects/public segment-boundary cases"
        status: pass
      - kind: integration
        ref: "tests/integration/operator-gateway.test.ts — signed-operations boundary case through a spawned gateway"
        status: pass
    human_judgment: false
  - id: D2
    description: "Documented dev launcher starts, stops and reports the operator gateway; GATEWAY_PORT documented in .env.example; missing gateway config warns without breaking the stack"
    verification:
      - kind: other
        ref: "pwsh Parser::ParseFile scripts/app-lifecycle.ps1 → 'parse ok'; live probe: launcher-spawned gateway healthy on :8080 (proxied homepage 200, Status shows gateway(:8080)=up, port freed on cleanup)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A real browser with only Basic auth (zero synthesized HMAC headers) sees «Центр операций» with the five-state backup block and both trigger buttons acknowledge «поставлена в очередь…»; unsigned access gets gateway 401 and uniform web 404"
    requirement: BAK-03
    verification:
      - kind: e2e
        ref: "tests/e2e/operations-gateway.spec.ts — 4/4 pass (desktop + mobile chromium) against the owned release stack"
        status: pass
    human_judgment: false
  - id: D4
    description: "Human operator re-test of gap G-08-6 through the documented launcher with real .env credentials"
    verification: []
    human_judgment: true
    rationale: "Automation proves the full chain with test secrets; UAT gap closure requires the operator's own browser and their real .env OPERATOR_* credentials at http://127.0.0.1:8080/internal/operations"

# Metrics
duration: 15h 35m wall (2 executor sessions; ~1h 30m active in final session)
completed: 2026-10-31
status: complete
plan_head_before: a98c1cb3647dfd4f2ffe9486fc1ae38995b21790
plan_head_after: 5da9972
---

# Phase 8 Plan 04: Operations Ingress Gap Closure (G-08-6) Summary

**Operator gateway now Basic-auth-gates and HMAC-signs /internal/operations* paths, runs in the dev launcher, and a real browser reaches the operations centre through it — closing gap G-08-6**

## Performance

- **Duration:** 15h 35m wall clock across two executor sessions (Task 1 by the prior session; Tasks 2-3 ≈ 1h 30m active in this session)
- **Started:** 2026-10-30T14:53Z (first plan commit)
- **Completed:** 2026-10-31T06:28Z (last task commit); gates finished 2026-10-31T06:35Z
- **Tasks:** 3
- **Files modified:** 9 (exactly the plan's files_modified list)

## Accomplishments

- Gap G-08-6 root-cause half 1 fixed: the gateway's protected-path allowlist (`security.mjs`, renamed `isProtectedPath`) now covers `/internal/operations` and `/internal-api/operations` with segment-boundary matching — those requests require Basic auth and receive signed `x-operator-*` headers over the same `OPERATOR_PROXY_SIGNING_SECRET`; replay behavior unchanged.
- Root-cause half 2 fixed: `scripts/app-lifecycle.ps1` spawns the gateway best-effort after stack readiness (mirrors the `-Daemon` pattern), reports it in `Status`/already-running branches, kills it in Stop-Stack, and prints the operator URL `http://127.0.0.1:8080/internal/operations` when healthy; `.env.example` documents `GATEWAY_PORT=8080`.
- Real-browser e2e (`operations-gateway.spec.ts`, 4/4 pass desktop+mobile): Basic-auth browser through the gateway renders «Центр операций» with the five-state `backup-status` block (no «Этот операционный блок недоступен»), and both trigger buttons acknowledge «поставлена в очередь…». Negative half: unsigned gateway request → 401 `{"message":"Authentication required"}`, direct web request → uniform 404 `{"message":"Not found"}` — no bypass, no configuration oracle.
- Full-chain live probe during launcher verification: gateway+Basic → overview 200; gateway no-auth → 401; web direct unsigned → 404; Status shows `gateway(:8080)=up`; cleanup leaves 3000/3001 untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Sign operations paths through the gateway end-to-end** - `ad57d8b` (feat) — tracer; executed by the prior session, verify re-run this session (unit 17/17, integration 12/12) before expanding
2. **Task 2: Run the operator gateway in the documented dev topology** - `0ea8210` (feat)
3. **Task 3: E2E — the operator's real browser sees the operations blocks** - `5da9972` (test)

**Plan commits (measured from ledger `gsd-plan-head-before-08-04`):** 3 — `ad57d8b`, `0ea8210`, `5da9972` (base `a98c1cb`)

## Files Created/Modified
- `infra/operator-gateway/security.mjs` - `isProtectedPath` covers replay + operations prefixes (segment boundaries)
- `infra/operator-gateway/server.mjs` - applies Basic gate + operator-header signing to all protected paths
- `tests/unit/operator-gateway.test.ts` - protects/public cases extended (`/internal/operations*` protected, `/internal/operation`, `/internal-api/operations-backup` stay public)
- `tests/integration/operator-gateway.test.ts` - spawned-gateway boundary case: signed operations request verified against the proxy canonical string
- `scripts/app-lifecycle.ps1` - `-Gateway` switch, best-effort spawn after readiness (15s probe, Russian warning naming missing config), gateway in Get-StackPids/Stop-Stack/Status, operator URL printed when healthy
- `.env.example` - `GATEWAY_PORT=8080` with operator-entry-point comment
- `tests/e2e/live-provider-stack.ts` - owned API gets `BACKUP_ENABLED=true` + mkdtemp `BACKUP_DIR`, cleaned up on teardown
- `tests/e2e/operations-gateway.spec.ts` - (new) browser-through-gateway flow + fail-closed negatives; spawned gateway on an ephemeral port, killed in afterAll
- `package.json` - spec added to the `verify:release` playwright list

## Decisions Made
- Gateway logs go to a sibling `%TEMP%\bet-stats-gateway.log` — the running daemon holds the shared stack log append-locked (FileShare.Read); a second `*>>` writer throws a sharing violation that would kill the `-Gateway` branch before node starts.
- The integration boundary case asserts 401-with-no-upstream-hop rather than the plan's literal "reaches upstream unsigned": once operations prefixes join the protected set, unsigned operations requests are refused at the gateway — strictly stronger fail-closed, consistent with the web proxy's 404.
- `gsd_run` is not on PATH in this executor shell; STATE/ROADMAP tracking and docs commits are manual file edits + plain git commits (established 07-01..08-01 precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Gateway cannot share the stack log file**
- **Found during:** Task 2 (Run the operator gateway in the dev launcher)
- **Issue:** The plan said the gateway logs to the same `$log`; the running stack daemon holds it append-locked, so the second writer throws a sharing violation under `$ErrorActionPreference="Stop"`, killing the `-Gateway` branch before node starts.
- **Fix:** Gateway logs to sibling `%TEMP%\bet-stats-gateway.log`; added a `-Gateway` switch mirroring `-Daemon`.
- **Files modified:** `scripts/app-lifecycle.ps1`
- **Verification:** parser `parse ok`; live spawn healthy (proxied homepage 200), Status reports gateway, cleanup frees :8080
- **Committed in:** 0ea8210

**2. [Rule 1 - Bug] E2E "anonymous" probe was silently authenticated**
- **Found during:** Task 3 (E2E spec; first run failed 2/4)
- **Issue:** `request.newContext()` under `test.use({ httpCredentials })` inherits the operator Basic credentials (Playwright merges `_combinedContextOptions` in `runBeforeCreateRequestContext`), so the negative probe returned 200. Manually reproduced a genuine 401 against a standalone gateway — the product behavior was correct, the probe was wrong.
- **Fix:** negative test uses plain Node `fetch` (no credential inheritance); root-cause comment left in the spec.
- **Files modified:** `tests/e2e/operations-gateway.spec.ts`
- **Verification:** full spec re-run 4/4 pass (desktop + mobile)
- **Committed in:** 5da9972

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both forced by runtime facts (file locking, framework behavior); product security surface unchanged or strictly stronger.

## Issues Encountered
- Plan Task 1's literal integration-test ask ("unsigned GET reaches upstream unsigned") was already superseded in the prior session's commit by the stronger 401-at-gateway assertion — documented as deviation #2 of that session's approach and preserved here for the audit trail.
- Known pre-existing `tests/unit/fixtures-sync.test.ts` failure (DB-auth in emulated-db unit test) present in the `pnpm test` gate; 46/47 files, 438/445 tests green. File untouched by this plan (verified via `git log --name-only`) — out of scope per plan rules.

## UAT Re-test (gap G-08-6)

1. `scripts\app-lifecycle.ps1 -Action Start` (existing stack: web/API/worker + gateway on :8080).
2. Open **http://127.0.0.1:8080/internal/operations** in a normal browser; authenticate with the Basic credentials from `.env` (`OPERATOR_BASIC_USERNAME` / `OPERATOR_BASIC_PASSWORD`).
3. Expect: «Центр операций» renders, the «Резервные копии и проверка восстановления» block shows real five-state data (no «Этот операционный блок недоступен»), and both trigger buttons report «поставлена в очередь…».
4. `scripts\app-lifecycle.ps1 -Action Status` must show `gateway(:8080)=up`; `-Action Stop` must free the port.

## User Setup Required
None - no external service configuration required (`GATEWAY_PORT=8080` documented in `.env.example`; `.env` already carries the OPERATOR_* block).

## Next Phase Readiness
- Gap G-08-6 is closed pending operator UAT re-test (D4 above); 08-05 (gap G-08-5, drill cleanup verdict) is independent and unblocked.
- The gateway is now part of the documented dev topology — future phases touching operations ingress must keep the protected-prefix list and the e2e negative probes in sync.

## Self-Check: PASSED

All 10 created/modified files found on disk; all 3 task commits (`ad57d8b`, `0ea8210`, `5da9972`) verified as ancestors of HEAD.

---
*Phase: 08-backups-and-restore-verification*
*Completed: 2026-10-31*
