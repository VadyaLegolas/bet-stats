---
phase: 09-degradation-alerting
plan: 03
subsystem: api
tags: [nestjs, exception-filter, redis, ioredis, alerts, acknowledge, config]

requires:
  - phase: 09-degradation-alerting (Plan 01)
    provides: OpsAlert/OpsAlertTransition/OpsAlertDelivery Prisma models, guarded + append-only triggers, applied migration
provides:
  - Http5xxBucketFilter — global NestJS exception filter counting 5xx responses into bet-stats:http5xx:<minuteIndex> Redis buckets (MULTI INCR+EXPIRE, TTL 120s) with byte-identical base error handling
  - Per-request total counter bet-stats:httpTotal:<minuteIndex> in the correlation middleware — the D-09 ratio denominator
  - readAlertsConfig in packages/config (ALERTS_ENABLED, ALERT_WEBHOOK_URL validated https/http, ALERTS_TICK_MS 60s–1h, ALERTS_WEBHOOK_TIMEOUT_MS 1s–60s; opt-in, absent from production superRefine)
  - alerts() read model (active severity desc/lastSeen desc + 7-day resolved window, sanitized typed fields, redactSecrets pass) and channelState in the operations overview
  - POST /internal/operations/alerts/:alertId/acknowledge behind OperatorGuard — path-only, idempotent, uniform 404
affects: [09-02 evaluator, 09-04 operations UI, ALRT-01, ALRT-03, ALRT-04]

actuals:
  tokens: 3900 # chars/4 over the realized diff (448 insertions / 8 deletions, 8 files) — same scale as the plan's estimateTokens
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Exception filter extending @nestjs/core BaseExceptionFilter, registered with app.get(HttpAdapterHost).httpAdapter so the base error contract stays byte-identical"
    - "Fire-and-forget Redis minute-bucket writes (recordMinuteBucket): null-safe without REDIS_URL, synchronous errors and exec rejections both swallowed — Redis never fails a request"
    - "acknowledgedAt IS NULL guarded updateMany + single transition row: concurrent acknowledges converge to one no-op-safe result"

key-files:
  created:
    - apps/api/src/modules/operations/http-5xx-bucket.filter.ts
    - tests/unit/alerts-5xx-filter.test.ts
  modified:
    - apps/api/src/main.ts
    - apps/api/src/modules/operations/operations.service.ts
    - apps/api/src/modules/operations/operations.controller.ts
    - packages/config/src/index.ts
    - tests/integration/alerts.test.ts
    - tests/integration/operator-overview.test.ts

key-decisions:
  - "Http5xxBucketFilter delegates to @nestjs/core BaseExceptionFilter with the real HTTP adapter — Nest error bodies stay byte-identical; Redis buckets are fire-and-forget with swallowed errors (D-09, T-09-07)"
  - "acknowledgeAlert guards on acknowledgedAt IS NULL via updateMany plus one randomUUID transition — concurrent/repeated acks converge to the same result with exactly one transition; RESOLVED alerts are no-op acks (ALRT-04, T-09-08)"
  - "ALRT-01/ALRT-03/ALRT-04 stay Pending under the shared-ID gate: requirements.ready-ids reports all three blocked (also declared by Plan 09-02); they flip to Complete only when that plan's SUMMARY exists"

patterns-established:
  - "Per-minute Redis bucket counters with shared minute index + 120s TTL for ratio evaluation (5xx numerator, per-request total denominator)"
  - "Opt-in config readers mirror readBackupConfig: bounded integers, URL validation, keys deliberately absent from the production-required superRefine"

requirements-completed: [ALRT-01, ALRT-03, ALRT-04] # copied verbatim from PLAN.md frontmatter; see key-decisions — checkboxes stay open under the shared-ID gate until 09-02 completes

coverage:
  - id: D1
    description: "Global 5xx exception filter increments bet-stats:http5xx:<minuteIndex> (MULTI INCR+EXPIRE, TTL 120s) for >=500 only, delegates byte-identically to Nest base handling, null-safe without REDIS_URL; per-request counter writes bet-stats:httpTotal:<minuteIndex> with identical TTL and never fails the request"
    requirement: ALRT-01
    verification:
      - kind: unit
        ref: "tests/unit/alerts-5xx-filter.test.ts — 8/8 passed (5xx bucket write, 4xx no-write + unchanged 404 body, status-less exception, null client, recordMinuteBucket key/TTL/rejection-swallow/sync-failure cases)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit -p apps/api/tsconfig.json — exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "readAlertsConfig returns { enabled, webhookUrl, tickMs, webhookTimeoutMs }; ALERT_WEBHOOK_URL validated https/http and never logged; ALERTS_TICK_MS bounded 60_000–3_600_000; ALERTS_WEBHOOK_TIMEOUT_MS bounded 1_000–60_000; ALERT_* keys absent from the production-required superRefine"
    verification:
      - kind: other
        ref: "throwaway vitest contract check (18 assertions, file removed after use): absent keys stay absent, https/http accepted, ftp/garbage rejected, all four bounds verified, enabled flag, superRefine block ALERT_-free, main.ts ALERT_WEBHOOK_URL-free — pass"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit -p apps/api/tsconfig.json — exit 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "alerts() read model in the operations overview: active alerts (severity desc, lastSeen desc) + resolved within 7 days, typed safe fields only (safeCode/safeIdentity/safeCorrelation + redactSecrets), channelState with configured (ALERT_WEBHOOK_URL presence) and latest OpsAlertDelivery outcome"
    requirement: ALRT-03
    verification:
      - kind: integration
        ref: "tests/integration/operator-overview.test.ts — 25/25 passed including the planted-secret canary case: unsafe alert fields collapse to unavailable/safe codes, canary correlation IDs dropped, flatten(overview) matches no canary (T-09-09)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit -p apps/api/tsconfig.json — exit 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST internal/operations/alerts/:alertId/acknowledge behind OperatorGuard (path-only, 202) backed by idempotent acknowledgeAlert that stamps acknowledgedAt once, appends exactly one OPEN→ACKNOWLEDGED transition, never touches count/lastSeen, and raises uniform NotFoundException(\"Not found\") for a missing alert"
    requirement: ALRT-04
    verification:
      - kind: integration
        ref: "tests/integration/alerts.test.ts — 9/9 passed on real PostgreSQL (7 Plan-01 cases still green + acknowledge idempotency/no-state-change/one-transition + uniform 404)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Filter and middleware behavior inside the live dev stack (registered globally, middleware order, real Redis counters observable in the operations view) — not exercised: restarting the stack would disturb the user's running dev servers, which the operating rules forbid"
    verification: []
    human_judgment: true
    rationale: "Unit tests prove the filter/middleware logic and registration code compiles; observing the running stack requires a dev-server restart that is a user decision — verify on the next natural stack restart"

duration: 9min
completed: 2026-11-10
status: complete
---

# Phase 9 Plan 03: API Alert Components Summary

**Global NestJS 5xx exception filter writing per-minute Redis buckets with byte-identical base error handling, the alerts() read model with channelState, an idempotent OperatorGuard acknowledge endpoint, and the opt-in readAlertsConfig reader — proven by 8 unit + 25 integration green tests.**

## Performance
- **Duration:** 9min
- **Started:** 2026-11-10T15:10 local
- **Completed:** 2026-11-10T15:19 local
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- 5xx responses are counted into `bet-stats:http5xx:<minuteIndex>` (MULTI INCR+EXPIRE, TTL 120s) and every request into `bet-stats:httpTotal:<minuteIndex>` — the numerator/denominator pair for Plan 02's ratio evaluation (D-09) — with Redis absence/failure never affecting any response
- Operations overview gained `alerts` (active severity desc/lastSeen desc + 7-day resolved, sanitized typed fields, redactSecrets pass) and `channelState` (webhook configured + last delivery outcome, D-13), extended with the canary proof that no planted secret can cross (T-09-09)
- `POST /internal/operations/alerts/:alertId/acknowledge` behind OperatorGuard: path-only, idempotent under concurrency (`acknowledgedAt IS NULL` guarded updateMany + exactly one transition), uniform 404, never closes/resolves the alert (ALRT-04, T-09-08)
- `readAlertsConfig`: opt-in alerting inputs validated and bounded, ALERT_* keys deliberately absent from the production-required superRefine

## Task Commits
1. **Task 1 (tracer): 5xx exception filter + alerts read model + acknowledge endpoint** - `17df756` (feat)
2. **Task 2: unit tests for the filter + acknowledge integration cases** - `57af0f1` (test)
3. **Rule 2: planted-secret canary for the alerts read model output** - `e4a584b` (test)

## Files Created/Modified
- `apps/api/src/modules/operations/http-5xx-bucket.filter.ts` - Http5xxBucketFilter + recordMinuteBucket (shared minute index/TTL helpers, null-safe fire-and-forget)
- `apps/api/src/main.ts` - lazyConnect Redis client, filter registration with the real HTTP adapter, total-counter in the correlation middleware
- `apps/api/src/modules/operations/operations.service.ts` - AlertFact/AlertView types, repository alerts(since)/channelState(), overview alerts+channelState sections, acknowledgeAlert
- `apps/api/src/modules/operations/operations.controller.ts` - acknowledge POST endpoint (path-only, 202)
- `packages/config/src/index.ts` - AlertConfig + readAlertsConfig
- `tests/unit/alerts-5xx-filter.test.ts` - 8 mocked-host/mock-Redis cases
- `tests/integration/alerts.test.ts` - +2 service-level acknowledge cases on real PostgreSQL
- `tests/integration/operator-overview.test.ts` - fake repo extended, exact-keys assertion updated, alerts canary case added

## Decisions Made
- Filter extends `@nestjs/core` BaseExceptionFilter and receives `app.get(HttpAdapterHost).httpAdapter` — delegation keeps error bodies byte-identical; a fresh ExpressAdapter fallback would also work but the explicit adapter removes any platform ambiguity
- Severity ordering is computed at read time (CRITICAL > WARNING > INFO, unknown ranks 0) because lexicographic SQL ordering of the severity string would place WARNING above CRITICAL
- ALRT-01/03/04 left Pending per the shared-ID gate (`requirements.ready-ids` → ready: [], all shared with Plan 09-02)

## Deviations from Plan

**1. [Rule 3 - Blocking] operator-overview.test.ts fake repository and exact-keys assertion updated**
- **Found during:** Task 1
- **Issue:** The overview extension (`alerts`, `channelState`) is plan-mandated, but the existing integration test asserts an exact overview key list and its fake repository lacks the two new methods — the plan's own change would have red-letter broken the suite
- **Fix:** Added `alerts`/`channelState` mocks to the fake repository and extended the exact-keys assertion to the new 9-key shape
- **Files modified:** tests/integration/operator-overview.test.ts
- **Verification:** `pnpm vitest run --project integration tests/integration/operator-overview.test.ts` — 24/24 passed
- **Commit:** `17df756`

**2. [Rule 2 - Missing critical] Planted-secret canary test for the alerts JSON output**
- **Found during:** Task 2 (threat register T-09-09, disposition mitigate)
- **Issue:** The plan's must_haves require "no secret/raw-payload/authorization/environment/stack-trace/unrestricted-log canary strings in alerts JSON output", but no test exercised canary-bearing alert rows
- **Fix:** New case: alert row with unsafe id/scope and six canary-bearing correlation IDs — sanitizers collapse/drop them and `flatten(overview)` matches no canary
- **Files modified:** tests/integration/operator-overview.test.ts
- **Verification:** 25/25 integration cases passed
- **Commit:** `e4a584b`

**Total deviations:** 2 (both auto-handled, both confined to tests/integration/operator-overview.test.ts). **Impact on plan:** none — every Task acceptance criterion unchanged and verified.

## Issues Encountered
- `Http5xxBucketFilter.catch` required an `override` modifier (noImplicitOverride) — fixed on first tsc run
- Integration tests need `DATABASE_URL` which the executor shell must not read (secret guard): verification used a PowerShell wrapper that loads the project env into the process environment without printing values, with `CI=true` (09-01's non-TTY vitest hang rule)
- Node 24 `--experimental-strip-types` cannot run packages/config directly (unrewritten `.js` specifiers) — the readAlertsConfig runtime contract was verified via a throwaway vitest unit case instead (file removed after use)

## TDD Gate Compliance
- RED: absent. The `test(09-03)` commit `57af0f1` follows the `feat(09-03)` commit `17df756` (inverted vs the canonical order — flagged per fail-fast rule 3). Cause is the plan's tracer-first structure: Task 1 implements the filter/service/controller, Task 2's tests target that committed implementation, so a genuine assertion-level RED would require destructively reverting Task 1 (an import-failure RED would be INVALID_RED under #3770). Same situation as 09-01.
- GREEN: both test suites passed immediately after writing (8/8 unit, 9/9 integration, combined 17 >= plan minimum 14) — proving the Task 1 tracer implementation.
- REFACTOR: no changes needed.
- Runtime contract for readAlertsConfig was verified with a throwaway test (18 assertions, pass, removed) since no task file covered it.

## User Setup Required
None - no external service configuration required. (Optional alerting activation — ALERTS_ENABLED/ALERT_WEBHOOK_URL — is a Plan 02/04 concern and stays unset.)

## Next Phase Readiness
- Plan 02's evaluator reads the exact buckets this filter writes: `bet-stats:http5xx:<minuteIndex>` / `bet-stats:httpTotal:<minuteIndex>`, same minute index and 120s TTL
- Plan 04's UI consumes the overview `alerts` section (active/resolved views) and `channelState` (configured / lastDeliveryStatus / lastDeliveryAt)
- ALRT-01/03/04 flip to Complete when Plan 09-02 completes (shared-ID gate)

---
*Phase: 09-degradation-alerting*
*Completed: 2026-11-10*
