---
phase: 09-degradation-alerting
plan: 02
subsystem: worker
tags: [bullmq, prisma, redis, alerts, evaluator, webhook, delivery-probe]

requires:
  - phase: 09-degradation-alerting (Plan 01)
    provides: OpsAlert/OpsAlertTransition/OpsAlertDelivery Prisma models, dedup unique index, guarded + append-only triggers, applied migration
  - phase: 09-degradation-alerting (Plan 03)
    provides: Http5xxBucketFilter Redis buckets (bet-stats:http5xx/httpTotal minute buckets) and readAlertsConfig in @bet-stats/config
provides:
  - evaluateAndDispatch evaluator tick in workers/data-sync/src/jobs/alerts.ts with six signal adapters (quota D-10, circuit OPEN/HALF_OPEN D-03, sync-failure bursts D-11, BullMQ dead letters, 5xx Redis buckets with D-09 min-volume guard, backup staleness D-12)
  - Dedup upsert (one OPEN row per signal\0scope), WARNING flap damping (2 consecutive ticks), auto-resolution D-04, re-open dispatch D-05, in-place escalation with OpsAlertTransition rows
  - dispatchWebhook: native fetch, redirect:manual, per-attempt AbortSignal.timeout, bounded retries with jitter honoring Retry-After, per-attempt OpsAlertDelivery evidence, typed allowlist payload (T-09-04)
  - scheduleAlertingTick self-closing interval chain (injected clock, onError catch-all) and startAlertingRuntime composed beside startBackupRuntime in main.ts, gated on ALERTS_ENABLED
  - Weekly synthetic delivery probe (D-13): runDeliveryProbe + scheduleDeliveryProbe with CRITICAL self-alert on failed delivery
affects: [09-04 operations UI, ALRT-01, ALRT-02, ALRT-04]

actuals:
  tokens: 20956 # chars/4 over the realized diff (1717 insertions / 3 deletions, 6 files, 83824 chars) — same scale as the plan's estimateTokens
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Signal-adapter pattern: each adapter returns typed SignalEvaluation[] (signal, scope, severity, correlations) or [] when clear; the tick owns dedup/damping/resolution centrally"
    - "WARNING flap damping via an injectable WarningTickState consecutive-counter pruned to currently-fired fingerprints each tick; CRITICAL bypasses damping"
    - "OpsAlertDelivery FK anchor row: delivery evidence needs an OpsAlert parent, so the probe keeps a RESOLVED DELIVERY_HEALTH anchor row that never renders as an active alert"

key-files:
  created:
    - workers/data-sync/src/jobs/alerts.ts
    - workers/data-sync/src/jobs/delivery-probe.ts
    - tests/unit/alerts-signals.test.ts
    - tests/unit/alerts-dispatch.test.ts
    - tests/unit/alerts-delivery-probe.test.ts
  modified:
    - workers/data-sync/src/main.ts

key-decisions:
  - "Backup-staleness thresholds are pinned in alerts.ts (BACKUP_STALE_MS 25h / BACKUP_CRITICAL_MS 48h) mirroring computeBackupFact — the worker tsconfig rootDir cannot import apps/api; unit tests guard the mirror (D-12)"
  - "5xx hard threshold pinned at ratio >= 0.5 → CRITICAL: the discussion log fixes 10%+volume for WARNING but no number for the hard tier (D-03); half the window erroring is a hard outage"
  - "Dead-letter CRITICAL is keyed to blocking root causes (QUARANTINE|IDENTITY|PAYLOAD), matching D-03's 'dead-lettered blocking job'; other dead letters are WARNING"
  - "The delivery probe keeps a RESOLVED anchor OpsAlert row because OpsAlertDelivery.alertId is a hard FK — healthy probes append delivery evidence without raising an alert"

patterns-established:
  - "Evaluator tick with injectable clock/redis/inspector/state so every concern is testable without PostgreSQL, Redis or BullMQ"
  - "Delivery evidence discipline: every webhook attempt lands in OpsAlertDelivery before backoff; the alert state never depends on delivery success (D-02, T-09-06)"

requirements-completed: [ALRT-01, ALRT-02, ALRT-04] # copied verbatim from PLAN.md frontmatter; ALRT-01/ALRT-02 marked Complete (ready-ids), ALRT-04 stays Pending — shared with Plan 09-04 under the shared-ID gate

coverage:
  - id: D1
    description: "Evaluator tick with six signal adapters: quota (>=80% WARNING, >=100%/criticalReservations CRITICAL), circuit (OPEN→CRITICAL first tick, HALF_OPEN→WARNING damped, CLOSED silent), sync failures (>=5 FAILED/10min WARNING, BLOCKING CRITICAL, grouped by rootCause+scope), dead letters (per job name+root cause), 5xx (>=10% AND >=10 requests WARNING, hard threshold CRITICAL, rolling 5-min Redis window), backup staleness (NOT_CONFIGURED silent, >=25h WARNING, FAILED/>=48h CRITICAL)"
    requirement: ALRT-01
    verification:
      - kind: unit
        ref: "tests/unit/alerts-signals.test.ts — 29/29 passed (threshold matrix, damping, grouping, min-volume guard, NOT_CONFIGURED exclusion)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit -p workers/data-sync/tsconfig.json — exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Dedup upsert (exactly one OPEN row per dedupFingerprint, count/lastSeen bumps), WARNING 2-tick flap damping, auto-resolution D-04 (clear adapter → RESOLVED + resolvedAt + exactly one OpsAlertTransition), re-open D-04/D-05 (RESOLVED fires again → OPEN + transition + re-open dispatch), in-place escalation with transition row, dispatch only on open/escalation/re-open"
    requirement: ALRT-02
    verification:
      - kind: unit
        ref: "tests/unit/alerts-signals.test.ts dedup/lifecycle cases — one-row count=2 dedup, OPEN/ACKNOWLEDGED resolution with exactly one transition, no second transition on repeated clear, re-open payload event=alert_reopened, D-05 occurrence anti-fatigue"
        status: pass
    human_judgment: false
  - id: D3
    description: "Webhook dispatch: bounded 3 attempts, exponential backoff + jitter, Retry-After honored on 429, 3xx failure under redirect:manual, AbortError → TIMEOUT errorCode, every attempt in OpsAlertDelivery, typed allowlist payload with planted-secret canary, no ALERT_WEBHOOK_URL → detection continues without dispatch, alerts.webhook_delivery_failed event"
    requirement: ALRT-04
    verification:
      - kind: unit
        ref: "tests/unit/alerts-dispatch.test.ts — 8/8 passed (fetch globally stubbed, no real endpoints)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Weekly synthetic delivery probe (D-13): armed at last synthetic OpsAlertDelivery + 7d with idle-poll, success records delivery and raises no alert (resolves a previously failing probe), failure marks delivery FAILED and raises the CRITICAL self-alert with transition row, typed allowlist payload, import-side-effect-free"
    verification:
      - kind: unit
        ref: "tests/unit/alerts-delivery-probe.test.ts — 10/10 passed (cadence anchoring, self-alert, repeat-failure count bump, success-after-failure resolution, no-provider-call canary, import side-effect check)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Evaluator tick behavior inside the live stack against real PostgreSQL/Redis/BullMQ with ALERTS_ENABLED=true — not exercised: arming it requires restarting the user's running dev servers, which the operating rules forbid; the evaluator is opt-in and unconfigured in this environment"
    verification: []
    human_judgment: true
    rationale: "All adapter/upsert/dispatch logic is proven by 47 unit tests against fakes mirroring the Prisma/Redis/BullMQ contracts; observing a live tick needs ALERTS_ENABLED env config plus a stack restart that is a user decision — verify on the next natural restart with ALERTS_ENABLED=true"

duration: 25min
completed: 2026-11-11
status: complete
---

# Phase 9 Plan 02: Worker Alert Evaluator Summary

**One evaluator tick reads six signal sources (PostgreSQL + Redis + BullMQ), upserts deduplicated flap-damped OpsAlert rows with automatic resolution/re-open and immutable transitions, and dispatches to the optional webhook with per-attempt delivery evidence — plus the weekly synthetic delivery probe with a CRITICAL self-alert (D-13).**

## Performance
- **Duration:** 25min
- **Started:** 2026-11-11T07:30 local
- **Completed:** 2026-11-11T07:55 local
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- `evaluateAndDispatch` runs six adapters per tick and converges every signal into deduplicated `OpsAlert` rows — PostgreSQL is the only alert state; Redis carries only the disposable 5xx/total buckets written by Plan 03
- Lifecycle per D-04/D-05: WARNING opens after 2 consecutive ticks, CRITICAL on first detection; cleared signals auto-resolve with an immutable transition row; recurring fingerprints re-open and dispatch; occurrences bump count/lastSeen and never notify
- `dispatchWebhook` records every attempt in `OpsAlertDelivery` (bounded 3, jittered backoff, Retry-After, redirect:manual, per-attempt timeout) with a typed allowlist payload — a failed channel never loses an alert (D-02, T-09-06)
- Weekly delivery probe arms from persisted delivery state, keeps a RESOLVED FK anchor row for delivery evidence, and raises the CRITICAL `DELIVERY_HEALTH` self-alert when the channel breaks (D-13)
- `startAlertingRuntime` composed beside `startBackupRuntime` behind the ALERTS_ENABLED opt-in gate; no timers exist when alerting is off; webhook URL never logged (T-09-04)

## Task Commits
1. **Task 1 (tracer): evaluator tick + six adapters + dedup + webhook dispatch** - `7f0f4a8` (feat)
2. **Rule 1 fix: dead-letter root-cause extraction** - `e2beb14` (fix)
3. **Task 2: signal evaluator + dispatch unit tests** - `90310ea` (test)
4. **Task 3: weekly delivery probe + CRITICAL self-alert** - `0b55d52` (feat)

**Plan metadata:** committed together with STATE/ROADMAP/REQUIREMENTS updates (docs commit).

## Files Created/Modified
- `workers/data-sync/src/jobs/alerts.ts` - evaluateAndDispatch, six adapters, dedupUpsert, shouldWarn damping, resolveClearedAlerts, dispatchWebhook, scheduleAlertingTick
- `workers/data-sync/src/jobs/delivery-probe.ts` - runDeliveryProbe + scheduleDeliveryProbe (D-13)
- `workers/data-sync/src/main.ts` - startAlertingRuntime (opt-in gate, Redis client, dead-letter inspector, probe wiring) composed in start()
- `tests/unit/alerts-signals.test.ts` - 29 threshold/damping/lifecycle cases with injected clock and fake Prisma/Redis
- `tests/unit/alerts-dispatch.test.ts` - 8 dispatch cases with vi.stubGlobal fetch (no real endpoints)
- `tests/unit/alerts-delivery-probe.test.ts` - 10 probe cases (cadence, self-alert, import side-effect)

## Decisions Made
- Backup thresholds pinned in the worker mirroring `computeBackupFact` (import across apps/api is impossible under the worker tsconfig rootDir); unit tests guard the mirror — D-12 honored as "reuse the read-time rule"
- 5xx hard CRITICAL threshold pinned at ratio ≥ 0.5 (plan specifies 10%+volume for WARNING but no hard-tier number)
- Dead-letter CRITICAL tied to blocking root causes (QUARANTINE|IDENTITY|PAYLOAD) per D-03's "dead-lettered blocking job"
- Delivery probe keeps a RESOLVED `DELIVERY_HEALTH` anchor alert row as the FK parent for delivery evidence — healthy probes never render as active alerts and never notify
- ALRT-01/ALRT-02 marked Complete; ALRT-04 stays Pending — `requirements.ready-ids` reports it blocked (also declared by Plan 09-04)

## Deviations from Plan

**1. [Rule 1 - Bug] Dead-letter root-cause extraction swallowed a trailing separator**
- **Found during:** Task 2 (test "groups per job name + root cause")
- **Issue:** `extractRootCause` regex included `:` so `QUARANTINE_PAYLOAD: detail` grouped as scope `QUARANTINE_PAYLOAD:` — a colon-bearing scope string instead of the clean safe code
- **Fix:** Regex narrowed to `[A-Z0-9][A-Z0-9_.-]*`
- **Files modified:** workers/data-sync/src/jobs/alerts.ts
- **Verification:** dead-letter grouping test green; full suite green
- **Commit:** `e2beb14`

**2. [Note - Process] Test fixtures refined against adapter contracts during Task 2**
- **Found during:** Task 2
- **Issue:** First run had 10 failures — all in the new fakes (a `where.state.in` filter the fake ignored, a 24h-off backup fixture, a leaked BACKUP_ENABLED stub) plus the real regex bug above; no production behavior was wrong except the regex
- **Fix:** Fakes made contract-accurate; isolation stubs added
- **Files modified:** tests/unit/alerts-signals.test.ts, tests/unit/alerts-dispatch.test.ts
- **Verification:** 37/37 green
- **Commit:** `90310ea`

**Total deviations:** 2 auto-handled (1 Rule 1 fix, 1 test-fixture note). **Impact on plan:** none — every acceptance criterion unchanged and verified.

## Issues Encountered
- Pre-existing `tests/unit/fixtures-sync.test.ts` failures (7 cases, "Authentication failed against the database server") appear when the full unit project runs in the executor shell without database credentials — unrelated to this plan (fixtures-sync is not in this plan's files); out-of-scope per the scope boundary and logged to deferred-items.md
- `pnpm vitest` in this non-TTY shell needs `CI=true` + null stdin (known from 09-01); used via `cmd /c ... < NUL`

## TDD Gate Compliance
- RED: absent. The plan is tracer-first: Task 1 commits the full evaluator implementation (`feat(09-02)` `7f0f4a8`), Task 2's tests target that committed implementation, so a genuine assertion-level RED would require destructively reverting Task 1 — an import-failure RED would be INVALID_RED under #3770. Same situation as 09-01/09-03; flagged per fail-fast rule 3 rather than fabricating evidence.
- GREEN: Task 2's 37 signal/dispatch tests passed after fake-fixture refinement (catching the real root-cause bug, fixed in `e2beb14`); Task 3's 10 probe tests passed immediately after implementation (`0b55d52`).
- REFACTOR: no changes needed.
- Net proof: 47/47 new unit tests + full unit project green (except pre-existing fixtures-sync DB-credential failures) + tsc exit 0.

## User Setup Required
None - no external service configuration required. (Alerting activation — ALERTS_ENABLED=true plus optional ALERT_WEBHOOK_URL/ALERTS_TICK_MS/ALERTS_WEBHOOK_TIMEOUT_MS — is a deliberate operator decision and stays unset; without ALERT_WEBHOOK_URL the UI shows the channel as «не настроен» and detection still runs.)

## Next Phase Readiness
- Plan 09-04's UI consumes the overview `alerts` + `channelState` read model (Plan 03) which this evaluator now feeds; the «не настроен» channel state and OpsAlertDelivery evidence rows are exercised end-to-end
- ALRT-04 flips to Complete when Plan 09-04 ships (shared-ID gate)
- 09-USER-SETUP.md not created — plan frontmatter has no user_setup field

---
*Phase: 09-degradation-alerting*
*Completed: 2026-11-11*
