---
phase: 08-backups-and-restore-verification
plan: 03
subsystem: infra
tags: [backups, operations-center, read-model, five-state, bullmq, operator-guard, hmac-proxy, russian-ui, secret-free]

# Dependency graph
requires:
  - phase: 08-01 (backup engine)
  - phase: 08-02 (restore drill)
provides:
  - "backups() read model + read-time five-state computation (NOT_CONFIGURED/NEVER_VERIFIED/STALE/FAILED/HEALTHY), secret-free BackupFact"
  - "POST internal/operations/backups/run and backups/drill behind OperatorGuard (202 { queued: true }, uniform 404)"
  - "createBullBackupTriggerEnqueuer: ${prefix}-backup queue, data exactly { trigger: MANUAL }, manual-backup-/manual-drill- jobIds"
  - "web proxy POST passthrough (method forwarded; HMAC canonical string already binds the method)"
  - "BackupStatusBlock + Russian label maps (backupStateLabel / offsiteStateLabel) and the two manual trigger buttons"
affects: [9-degradation-alerting]

# Actuals (#2632) — pairs with the plan's estimate (tokens 80000 / raw 40000).
# Same estimateTokens scale: chars/4 over the realized hand-written diff (59,192 chars
# across apps/api + apps/web + tests; .planning metadata excluded from the measure).
actuals:
  tokens: 14798
  tasks: 3
  commits: 6
  plan_head_before: 85e92475a079e3ab9819365ef0d80b51bd853a00
  plan_head_after: 21ec7d568a9d0c0d0d9f23c71e855713c255fbc0

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-time five-state fact (never stored) so worker downtime can never freeze a green state (T-08-15, D-14)"
    - "Closed BackupFact DTO with basename-only safeFileName + safeCheckName + failedDrillChecks bounded extraction"
    - "belt-and-braces redactSecrets(computeBackupFact(...)) pass before serialization (D-15, T-08-13)"
    - "Injectable BackupTriggerQueue surface so the trigger path is unit-provable without a Redis connection"

key-files:
  created:
    - "apps/web/app/internal/operations/backup-status-block.tsx (BackupStatusBlock)"
    - "apps/web/app/internal/operations/backup-status-block.test.ts (18 renderToStaticMarkup cases)"
    - "apps/web/app/internal-api/operations/[[...path]]/route.test.ts (signed POST / method-mismatch / GET unchanged)"
    - ".planning/phases/08-backups-and-restore-verification/red-evidence-08-03-task2.json"
  modified:
    - "apps/api/src/modules/operations/operations.service.ts (BackupRows/BackupFact, computeBackupFact, failedDrillChecks, backups(), createBullBackupTriggerEnqueuer, triggerBackup/triggerDrill)"
    - "apps/api/src/modules/operations/operations.controller.ts (POST backups/run, POST backups/drill)"
    - "apps/web/app/internal-api/operations/[[...path]]/route.ts (method-forwarded fetch, export const POST)"
    - "apps/web/app/internal/operations/page.tsx (Overview.backups type, trigger state, block mounted)"
    - "apps/web/components/enum-labels.ts (+ backupStateLabel, offsiteStateLabel)"
    - "apps/web/components/enum-labels.test.ts, tests/integration/operator-overview.test.ts"

key-decisions:
  - "Five-state precedence is NOT_CONFIGURED > NEVER_VERIFIED > FAILED > STALE > HEALTHY; HEALTHY is impossible without a fresh successful backup AND a passing, fresh drill (D-14)"
  - "Freshness bounds are 25h for the backup (daily + 1h grace) and drillInterval + 24h grace for the receipt, both computed at read time"
  - "file names and receipt check names are sanitized to basenames / safe codes, so a directory path or smuggled value can never cross the boundary"
  - "triggerBackup/triggerDrill are async so the disabled/unconfigured uniform 404 surfaces as a rejected promise (TDD contract); Nest renders it as the same 404 as a sync throw"

requirements-completed: [BAK-03]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "backups() read model projects BackupRun + BackupVerificationReceipt into a closed, secret-free BackupFact with an explicit-select repository method"
    requirement: BAK-03
    verification:
      - kind: integration
        ref: "tests/integration/operator-overview.test.ts (backups section in the overview; serialized payload has no connection-string scheme marker and no directory path; basename-only assertions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Five states computed at read time with an injected clock, each distinguishable and non-green when unhealthy"
    requirement: BAK-03
    verification:
      - kind: integration
        ref: "tests/integration/operator-overview.test.ts (NOT_CONFIGURED / NEVER_VERIFIED x2 / HEALTHY at 24h59m+191h59m / STALE backup at 25h01m / drill-stale at 192h01m / FAILED for UNVERIFIED and FAILED receipts)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Manual Backup now / Drill now enqueue job backup|drill with data exactly { trigger: MANUAL } and a manual- jobId; disabled config yields the uniform 404 without enqueueing"
    requirement: BAK-03
    verification:
      - kind: integration
        ref: "tests/integration/operator-overview.test.ts#manual backup and drill triggers (data keys === [trigger], jobId ^manual-(backup|drill)-\\d+$, disabled -> NotFoundException + zero adds, bad credential -> 404 without reaching the service)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Web proxy forwards the request method and exports POST; a signature computed for a different method is denied; GET passthrough is unchanged"
    requirement: BAK-03
    verification:
      - kind: unit
        ref: "apps/web/app/internal-api/operations/[[...path]]/route.test.ts (signed POST reaches upstream with method POST; method-mismatched signature denied with no upstream call; GET unchanged)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Russian-labeled operations block renders all five states, the four non-green states never render «Здорово», the two trigger buttons carry their Russian labels, and off-host distinguishes «Не настроено» from «Деградировано»"
    requirement: BAK-03
    verification:
      - kind: unit
        ref: "apps/web/app/internal/operations/backup-status-block.test.ts (18 cases) + apps/web/components/enum-labels.test.ts (label maps with raw-code fallback)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live operator check: the running operations page shows the new block; «Создать резервную копию сейчас» produces a dated dump and a green last-backup row; unconfigured hosts render «Не настроено» in non-green"
    requirement: BAK-03
    verification:
      - kind: manual
        ref: "operator clicks the two buttons on /internal/operations against the opt-in BACKUP_* deployment"
        status: pending
    human_judgment: true
    rationale: "The executor must not touch the operator's running dev stack (web :3000 / API :3001 / worker), read the secret .env, or bind its ports. Trigger endpoints are proven end-to-end through the gateway -> signed proxy -> OperatorGuard -> enqueue chain by the integration and route tests; the human click against the live opt-in BACKUP_* deployment is the operator's opt-in step."

# Metrics
duration: 18min (code) + 12min (verification + summary) = 30min
completed: 2026-10-24
status: complete
---

# Phase 8 Plan 03: Operations Visibility Summary

**BAK-03 shipped: a read-time five-state `backups()` read model (secret-free, basename-only), two OperatorGuard manual trigger endpoints with proxy POST passthrough and method-bound HMAC, and the Russian-labeled «Резервные копии и проверка восстановления» operations block with honest non-green states and «Создать резервную копию сейчас» / «Запустить проверку восстановления сейчас»**

## Performance

- **Duration:** ~18 min for the three code tasks (one prior executor session) + ~12 min for finalization (verification battery, one Rule-1 fix, summary, state updates)
- **Started:** 2026-10-23T13:53Z (Task 1 commit `ef22b6a`); resumed 2026-10-24T11:27Z
- **Completed:** 2026-10-24
- **Tasks:** 3
- **Files modified:** 10 hand-written (apps/api 2, apps/web 7, tests 1) plus one .planning RED-evidence record

## Accomplishments

- `backups()` projects the Plan 01/02 durable rows through explicit Prisma selects into a closed `BackupFact`: basenames (via `safeFileName`), sizes, instants, durations, safe reason codes and a bounded `failedDrillChecks` extraction — raw rows, metadata and logs never cross the boundary; the whole fact additionally passes through `redactSecrets` (D-15, T-08-13).
- The five states are computed **at read time** with an injected clock, never stored, so worker downtime can never freeze a green state (T-08-15): `NOT_CONFIGURED` (disabled or absent `BACKUP_DIR`) → `NEVER_VERIFIED` (no receipt yet) → `FAILED` (newest receipt FAILED/UNVERIFIED) → `STALE` (backup older than 25h, or receipt older than `drillInterval + 24h` grace) → `HEALTHY` only when the backup is fresh AND the drill passed AND the drill is not stale (D-14).
- `POST internal/operations/backups/run` and `backups/drill` inherit the class-level `OperatorGuard`, resolve to `202 { queued: true }`, and enqueue job `backup`/`drill` on the `${prefix}-backup` queue with data **exactly `{ trigger: "MANUAL" }`** and `manual-backup-…`/`manual-drill-…` jobIds (T-08-17). Disabled/unconfigured backups raise the same uniform `NotFoundException("Not found")` as bad credentials — no configuration oracle (T-08-16).
- The web proxy now forwards the request method and exports `POST`; because the HMAC canonical string already binds the method, a signed GET can never become a POST — zero added secret surface (T-08-14). The bad-credential POST stays at the uniform 404 without reaching the service.
- The operations page gains «Резервные копии и проверка восстановления»: a `BackupStatusBlock` with the five-state Russian badge («Не настроено»/«Никогда не проверялось»/«Устарело»/«Сбой»/«Здорово»), off-host row («Не настроено»/«Скопировано»/«Деградировано»), backup/drill age with explicit stale wording, the drill's failed-check list, container cleanup, retention count, and the two trigger buttons with `role="status"` feedback and pending-disable (D-13).
- No new npm packages (T-08-SC vacuously clean — verified zero package.json/pnpm-lock hunks across all six commits).

## Task Commits

Each task was committed atomically (ledger base `85e9247`; 6 commits measured via `git rev-list --count 85e9247..HEAD`):

1. **Task 1: Tracer — `backups()` read model with five-state computation** — `ef22b6a` (feat: BackupRows/BackupFact, computeBackupFact, backups(), redactSecrets pass + integration five-state/no-secrets cases)
2. **Task 2 (TDD): manual trigger endpoints and proxy POST passthrough** — `a5b4100` (test: RED behavior cases + route.test.ts + `red-evidence-08-03-task2.json`), `90ca3e1` (feat: GREEN — createBullBackupTriggerEnqueuer, triggerBackup/triggerDrill, two guarded POSTs, method-forwarded proxy + `export const POST`)
3. **Task 3: Russian-labeled operations block** — `49eca4f` (feat: backupStateLabel / offsiteStateLabel + tests), `1010239` (feat: BackupStatusBlock, page mount, 18 render cases)
4. **Finalization fix** — `21ec7d5` (fix: disabled-config 404 rejects as a promise, not a synchronous throw — see Deviation 1)

## TDD Gate Compliance

- **RED:** `a5b4100` `test(08-03): add failing behavior tests for manual backup and drill triggers` — integration suite `4 failed | 18 passed (22)` (all 4 on the missing trigger symbols) and web route suite `2 failed | 57 passed (59)` (both on the missing `POST` export); the two deliberate guard cases (bad credential, GET-unchanged) passed by design. Evidence record: `.planning/phases/08-backups-and-restore-verification/red-evidence-08-03-task2.json` with manual `semanticAssessment: "VALID RED"` (the `gsd_run check tdd-red-evidence` CLI is unavailable on this host — same as plans 08-01/08-02).
- **GREEN:** `90ca3e1` — trigger enqueuer + guarded endpoints + proxy POST passthrough; the enqueue payload, jobId, disabled-404, bad-credential-404 and proxy-method cases pass. Route suite green.
- **REFACTOR / fix:** `21ec7d5` — the disabled-config case revealed the trigger methods threw synchronously, so `await expect(...).rejects.toThrow` could not observe the uniform 404; the methods are now `async` (the promise-rejection shape the RED test specified). Behavior for Nest is identical (the controller returns either shape as the same 404).

## Files Created/Modified

- `apps/api/src/modules/operations/operations.service.ts` — `BackupRows`/`BackupFact` DTOs, `BACKUP_FRESH_MS`/`DRILL_GRACE_MS`, `safeFileName`/`safeCheckName`/`failedDrillChecks`, `computeBackupFact`, `backups()` repository method, `backupTriggerQueueName`/`createBullBackupTriggerEnqueuer`, `OperationsService.triggerBackup/triggerDrill` behind `requireBackupsConfigured`, lazy queue closed in `onModuleDestroy`
- `apps/api/src/modules/operations/operations.controller.ts` — `POST backups/run`, `POST backups/drill` (both `@HttpCode(ACCEPTED)`)
- `apps/web/app/internal-api/operations/[[...path]]/route.ts` — method-forwarded upstream fetch, `export const POST = proxy`
- `apps/web/app/internal-api/operations/[[...path]]/route.test.ts` — signed POST / method-mismatch denial / GET-unchanged
- `apps/web/app/internal/operations/backup-status-block.tsx` (+ `.test.ts`) — the block and its 18 static-render cases
- `apps/web/app/internal/operations/page.tsx` — `Overview.backups` type, trigger state machine, block mounted inside the existing `Block` wrapper
- `apps/web/components/enum-labels.ts` (+ test) — `backupStateLabel`, `offsiteStateLabel` with raw-code fallback
- `tests/integration/operator-overview.test.ts` — five-state, boundary, no-secrets, trigger-enqueue and guard cases

## Decisions Made

- **Precedence order:** `FAILED` outranks `STALE` — a receipt that is both failed and old renders as the more actionable `FAILED`; both remain non-green (D-14).
- **`NEVER_VERIFIED` covers "no receipt at all"** (including "no backup has ever run"), matching the plan's never-run branch; the integration cases pin both shapes.
- **Queue name and payload parity with the worker:** the API-side enqueuer computes `${prefix}-backup` exactly like `workers/data-sync/src/jobs/backup.ts`, so the manual and scheduler paths share one queue and cannot drift.
- **Async trigger methods:** the 404 contract is a rejected promise (TDD-specified), not a synchronous throw — see Deviation 1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Trigger methods threw the uniform 404 synchronously, so the disabled-config test could not observe a rejection**
- **Found during:** finalization verification (`pnpm vitest run --project integration tests/integration/operator-overview.test.ts` → `1 failed | 21 passed (22)`; `requireBackupsConfigured` threw before a promise existed).
- **Issue:** the RED behavior test (written first, per the plan's TDD contract) asserted `await expect(service.triggerBackup()).rejects.toThrow(NotFoundException)`; the GREEN implementation threw synchronously, which the executor had not verified before it stopped.
- **Fix:** `triggerBackup`/`triggerDrill` are now `async`, so the uniform 404 surfaces as a rejection. Nest renders both shapes as the same 404, so the HTTP contract is unchanged; the enqueue payload, jobId and no-oracle behavior are untouched.
- **Files modified:** `apps/api/src/modules/operations/operations.service.ts`
- **Verification:** integration suite `22 passed (22)`, exit 0
- **Committed in:** `21ec7d5`

**2. [Rule 3 - Tooling] `gsd_run` CLI unavailable → manual state tracking**
- **Found during:** finalization (same as plans 07-01..07-03, 08-01, 08-02).
- **Issue:** SDK verbs (`state.advance-plan`, `roadmap.update-plan-progress`, `requirements.mark-complete`), the `windows` ledger and the SDK `commit` verb are not on PATH in this executor shell.
- **Fix:** STATE.md / ROADMAP.md / REQUIREMENTS.md updated by hand with equivalent semantics; docs commit via plain `git commit`.
- **Committed in:** final docs commit of this plan

### What the plan asked vs what shipped (spot-check notes)

- **All 10 planned files were created/modified** and no unplanned source file changed; the only extra artifact is the `.planning` RED-evidence record (same convention as plans 08-01/08-02).
- **No new packages:** every one of the six commits has an empty package.json/pnpm-lock diff — `T-08-SC` is vacuously clean.
- **The plan's artifact table named `backup-status-block.tsx` receiving "pending/onBackup/onDrill callbacks"; the shipped component also takes `notice`/`noticeFailed` for the `role="status"`/`role="alert"` feedback the plan's action text requires — a strictly additive surface, no restyling.
- **The controller resolves `202 { queued: true }` exactly as specified**, and the queue close is folded into the existing `onModuleDestroy` alongside the owned Prisma client.
- **The build gate ran with `NEXT_DIST_DIR=.next-verify-0803`** so Next 16's per-distDir lock could never disturb the operator's running `next dev` on `.next` (same isolation convention as the E2E/CI stacks); the temporary directory was removed after the gate and nothing was committed.

---

**Total deviations:** 2 auto-fixes + 1 build-isolation note (no repo change) — no scope creep; every change serves plan acceptance criteria.
**Impact on plan:** the plan's goals are fully delivered; the single fix restores the exact TDD contract the plan specified.

## Issues Encountered

- **Prior-session handoff:** the code executor committed `ef22b6a`…`1010239` but terminated before the final gates and SUMMARY. This finalization session verified those five commits as ancestors of HEAD, spot-checked each against the acceptance criteria, ran the full verification battery, found and fixed the one real defect (Deviation 1), and completed the bookkeeping.
- **Pre-existing environmental failure (out of scope, unchanged):** `tests/unit/fixtures-sync.test.ts` — 7 tests fail on this machine with real-DB auth errors (`provided database credentials for 'user' are not valid`); CI green. Already logged in `deferred-items.md` by Plan 01. Full unit run: 417/424 pass with exactly those 7 failures and no other failing file, which is the agreed green condition for the full-suite gate.

## Verification

Run on the final tree (real output excerpts):

- `pnpm vitest run --project integration tests/integration/operator-overview.test.ts` — `Test Files 1 passed (1) / Tests 22 passed (22)`, `EXIT=0`
- `pnpm --filter web test` — `Test Files 9 passed (9) / Tests 79 passed (79)`, `EXIT=0`
- `pnpm --filter web exec vitest run -c vitest.config.ts app/internal/operations/backup-status-block.test.ts` (Task 3 AC, run alone) — `Test Files 1 passed (1) / Tests 18 passed (18)`, `EXIT=0`
- `pnpm typecheck` — `Tasks: 7 successful, 7 total`, `TYPECHECK_EXIT=0`
- `pnpm lint` — `Tasks: 7 successful, 7 total`, `LINT_EXIT=0`
- `pnpm build` (with `NEXT_DIST_DIR=.next-verify-0803`) — `Tasks: 7 successful, 7 total`, `BUILD_EXIT=0`; the route manifest lists `ƒ /internal-api/operations/[[...path]]` and `○ /internal/operations`
- `pnpm test` (full) — `Test Files 1 failed | 45 passed (46) / Tests 7 failed | 417 passed (424)`; the sole failing file is the documented pre-existing `tests/unit/fixtures-sync.test.ts` (real-DB auth), no other file failed — the agreed green condition holds
- `pnpm verify:release:schema` — `The schema at prisma\schema.prisma is valid`, `SCHEMA_EXIT=0`
- Secret/credential scan of the fact surface: the integration suite asserts the serialized `backups` payload carries no connection-string scheme marker and no directory path; the trigger-enqueue cases assert `Object.keys(data)` is exactly `["trigger"]`.

## Known Stubs

None. Every planned symbol (`BackupFact`, `backups()`, `computeBackupFact`, `triggerBackup`/`triggerDrill`, the two POST routes, `export const POST`, `BackupStatusBlock`, `backupStateLabel`/`offsiteStateLabel`) is implemented and tested. The only pending item is the live operator click-through (coverage D6), which by the project's operating rule must not be executed by the agent against the operator's running stack.

## Threat Flags

None — no network endpoints, auth paths or schema changes beyond the plan's registered surface (T-08-13..T-08-17, T-08-SC). Mitigations verified on the final tree: the projection uses explicit selects on closed scalars with basename/safe-code sanitization and a `redactSecrets` pass; the two POSTs inherit the class-level `OperatorGuard` with a uniform 404 for both bad credentials and disabled backups; the proxy forwards only the method (already bound in the HMAC canonical string) and no request body upstream; the Redis-persisted job payload is exactly `{ trigger: "MANUAL" }`; no package was installed. (`gsd_run windows append` unavailable — no stubs or unrun verifies exist, so the ledger would have been empty.)

## Next Phase Readiness

- Phase 8's three plans are now all executed; the phase-level goal (opt-in dumps + scheduled restore drills + honest operator visibility with on-demand triggers) holds end-to-end, pending only the operator's live click-through (D6) and the orchestrator's wave/phase verification.
- Phase 9 (degradation alerting) can consume backup age/state from the `backups()` read model as an alert signal.
- Deferred: `tests/unit/fixtures-sync.test.ts` environmental red — see `deferred-items.md`.

## Self-Check: PASSED

All key files found (`operations.service.ts` with `computeBackupFact`/`backups()`/`createBullBackupTriggerEnqueuer`/async `triggerBackup`/`triggerDrill`; controller POSTs; proxy `export const POST` with method forwarding; `backup-status-block.tsx` with the two Russian button labels; `enum-labels.ts` label maps; page mount; all four test files). All six plan commits (`ef22b6a`, `a5b4100`, `90ca3e1`, `49eca4f`, `1010239`, `21ec7d5`) are ancestors of HEAD; `git rev-list --count 85e9247..HEAD` measured `6` at SUMMARY write, matching `commits: 6`. Every verification command above was executed on this tree with the recorded real output.

---
*Phase: 08-backups-and-restore-verification*
*Completed: 2026-10-24*
