---
phase: 09-degradation-alerting
reviewed: 2026-11-13T07:20:00Z
depth: standard
scope: incremental gap-closure review (base 895b017; prior 09-REVIEW.md and its disposition untouched)
files_reviewed: 7
files_reviewed_list:
  - apps/api/src/modules/operations/http-5xx-bucket.filter.ts
  - tests/unit/alerts-5xx-filter.test.ts
  - tests/unit/alerts-composition.test.ts
  - tests/unit/alerts-delivery-probe.test.ts
  - workers/data-sync/src/jobs/alerts.ts
  - workers/data-sync/src/jobs/delivery-probe.ts
  - workers/data-sync/src/main.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
  necessity: 1
status: issues_found
---

# Phase 09: Incremental Gap-Closure Code Review Report

**Reviewed:** 2026-11-13T07:20:00Z
**Depth:** standard
**Files Reviewed:** 7 (exactly the resolver-computed gap-closure scope)
**Base:** `895b01701b7d93daebad606a153bd108d544e229` (prior full-phase review)
**Scope:** commits `8948374`, `7a8ce59`, `a08e05c` (09-05: CR-01/CR-02/IN-05) and `87fee2e`, `d86112e`, `f142f61`, `a511349` (09-06: WR-01/WR-02)
**Status:** issues_found

## Summary

Incremental adversarial review of the gap-closure changes on top of the prior 09-REVIEW.md (findings CR-01/CR-02/WR-01/WR-02/IN-05, already dispositioned in 09-REVIEW-DISPOSITION.md). Verification of the closures themselves:

- **CR-01 closed correctly** — `startAlertingRuntime` (workers/data-sync/src/main.ts:187) now passes `inspector` into `scheduleAlertingTick`; the composition test proves one tick consumes `inspector.getFailed` and lands a durable OPEN/CRITICAL DEAD_LETTER row. The `dependencies` injection seam closes only runtime-owned clients; `close()` returns early for caller-owned deps (main.ts:209).
- **CR-02 closed correctly** — `resolveClearedAlerts` excludes `signal: { not: PROBE_ANCHOR_SIGNAL }` (workers/data-sync/src/jobs/alerts.ts:409); the composition test proves the probe anchor survives a tick while a control non-probe alert still auto-resolves. The constant is pinned in alerts.ts (not reverse-imported from delivery-probe.js — circular-import hazard correctly avoided) with a drift-guard test asserting `PROBE_ANCHOR_SIGNAL === DELIVERY_PROBE_SIGNAL`.
- **IN-05 closed correctly** — probe success resolves any non-RESOLVED anchor (OPEN or ACKNOWLEDGED) with a truthful `from → RESOLVED` transition (workers/data-sync/src/jobs/delivery-probe.ts:92-95), covered by both tests.
- **WR-01 closed correctly** — `Http5xxBucketFilter.catch` condition `status === null || status >= 500` (apps/api/src/modules/operations/http-5xx-bucket.filter.ts:80) counts raw exceptions — the exact class BaseExceptionFilter answers with 500 — while the response contract stays byte-identical (test asserts `{ statusCode: 500, message: "Internal server error" }` and the 404 body).
- **WR-02 closed correctly** — `BUCKET_TTL_SECONDS = 420` covers the evaluator's offsets-0..4 read window with the TTL-refresh reasoning verified arithmetically (a minute-M−4 key expires at latest ~420 s after the end of minute M−4; the last read is ~240 s after that point). The cross-module mirror guard (`BUCKET_TTL_SECONDS >= HTTP5XX_WINDOW_MINUTES * 60 + 60`) is directional-correct and imports the real reader-side constant.
- **Threat register T-09-13…T-09-18 verified in code:** T-09-13 signal-scoped exclusion + control case (alerts.ts:409, composition test); T-09-14 truthful ACKNOWLEDGED→RESOLVED transition (delivery-probe.ts:94); T-09-15 caller-owned deps never torn down (main.ts:209-212); T-09-16 raw exceptions counted with minute-index-only keys (filter.ts:43,80); T-09-17 TTL 420 + mirror guard; T-09-18 accepted — no payload fields added, keys remain `prefix + minuteIndex`.

Tests: all three scoped test files green (25/25 via `pnpm vitest run --project unit`, verified during this review).

The gap closures themselves contain no defects. However, the closure work touched the probe-anchor lifecycle, and the surrounding lifecycle still has two reachable dead-ends/inconsistencies that no code path resolves (WR-G1, WR-G2), plus one necessity finding and two minor info items. Per the disposition note, WR-03…WR-07 and IN-01…IN-04 from the prior review remain consciously open and are NOT re-reported here.

## Warnings

### WR-G1: Probe anchor is stranded OPEN/CRITICAL forever once the webhook is removed after a failed probe

**File:** `workers/data-sync/src/jobs/delivery-probe.ts:92` (with `workers/data-sync/src/jobs/alerts.ts:409` and `workers/data-sync/src/main.ts:194-201`)
**Severity:** Warning
**Issue:** After the CR-02 fix, the DELIVERY_HEALTH anchor can only transition through `runDeliveryProbe` — the evaluator excludes the signal from auto-resolution (alerts.ts:409) and no adapter emits `DELIVERY_HEALTH`. But `startAlertingRuntime` arms the probe scheduler **only when `config.webhookUrl` is set** (main.ts:194). Reachable sequence: webhook configured → probe fails (anchor → OPEN/CRITICAL) → operator removes `ALERT_WEBHOOK_URL` and restarts the worker (alerting stays enabled). Now the probe never arms, the evaluator never resolves the anchor, and the row is stuck OPEN/CRITICAL permanently — it renders as a permanent active CRITICAL alert in the operations center (D-06) and has no resolution path short of manual DB surgery. This also contradicts D-01's honesty contract: a deliberately unconfigured channel must be shown as the non-green state «не настроен», not as a persisting CRITICAL delivery failure.
**Evidence chain:** `delivery-probe.ts:92` is the sole resolver of the anchor; `alerts.ts:409` excludes it from `resolveClearedAlerts`; `main.ts:194` arms the probe only with `webhookUrl`; no other code path writes to the DELIVERY_HEALTH fingerprint (verified by grep across the repo's alert code).
**Fix:** When alerting is enabled but the webhook is unconfigured, give the anchor a resolution path — e.g., in the evaluator's cleanup (or runtime arming), resolve the anchor with a truthful transition when `webhookConfig.webhookUrl` is absent; alternatively arm the probe scheduler regardless of `webhookUrl` and let `runDeliveryProbe`'s unconfigured branch settle the anchor to a resolved/neutral state consistent with D-01.

### WR-G2: Repeated probe failure on an ACKNOWLEDGED anchor flips it to OPEN with no transition row (D-04 violation)

**File:** `workers/data-sync/src/jobs/delivery-probe.ts:100-114`
**Severity:** Warning
**Scope note:** The failure-path block predates the gap closure (this diff touched only the success path, lines 88-97), but it lives in the exact anchor lifecycle IN-05/CR-02 now own, and the gap plans did not cover it. Reported as adjacent-scope because the closure made this inconsistency the only remaining untruthful transition on the anchor.
**Issue:** For an anchor in ACKNOWLEDGED/CRITICAL (operator acknowledged the failing-probe alert), a repeated probe failure executes `update({ status: "OPEN", severity: "CRITICAL", resolvedAt: null, count: { increment: 1 } })` with `reopened === false` (`anchor.status === "RESOLVED"` is false) and `escalated === false` (severity already CRITICAL), so **no OpsAlertTransition row is appended** for the ACKNOWLEDGED→OPEN state change. D-04 requires every state change to append an immutable transition row. Additionally `acknowledgedAt` is left set while `status` becomes OPEN — an internally inconsistent row shape. The evaluator's own `dedupUpsert` (alerts.ts:377-397) never resets an ACKNOWLEDGED row's status, so the probe path is the sole deviator.
**Fix:** Mirror the truthful-transition discipline: if `anchor.status === "ACKNOWLEDGED"`, either keep the status ACKNOWLEDGED and only bump `count`/`lastSeen` (matching `dedupUpsert`'s treatment of acknowledged rows), or append a transition row `{ from: "ACKNOWLEDGED", to: "OPEN", severityFrom: anchor.severity, severityTo: "CRITICAL" }`. The `reopened || escalated` condition should include the ACKNOWLEDGED→OPEN case.

### WR-G3: Impossible-state guard — `instanceof Redis` / `instanceof Queue` checks in `close()` can never be false

**File:** `workers/data-sync/src/main.ts:210-211`
**Severity:** Warning
**Category:** necessity (impossible-state guard)
**Issue:** These checks execute only after `if (deps) return;` (main.ts:209), i.e. exclusively on the production path where `redis` and `inspector` were constructed two lines above as exactly `new Redis(...)` (main.ts:174) and `new Queue(...)` (main.ts:176). The guarded state (redis not an ioredis `Redis` / inspector not a BullMQ `Queue` while `deps` is falsy) cannot occur — proven within the same function: both values come from `deps?.X ?? new <ExactClass>(...)` and the `deps`-truthy branch has already returned. The type signature (`dependencies?: { database: PrismaClient; redis: BucketReader; inspector: DeadLetterInspector }`) closes the remaining gap for typed callers.
**Fix:** Remove the `instanceof` branches and call `redis.disconnect()` / `await inspector.close()` unconditionally after the `if (deps) return;` guard; keep the caller-ownership invariant documented in the existing comment. Removal is a scope decision for a human, not a defect fix — the code is harmless today.

## Info

### IN-G1: Non-integer `HttpException` status is counted into the 5xx numerator on a false premise

**File:** `apps/api/src/modules/operations/http-5xx-bucket.filter.ts:53-59,80`
**Severity:** Info
**Issue:** `exceptionStatus` maps any non-integer `getStatus()` to `null`, and WR-01's new condition treats `status === null` as "Nest renders it 500 «Internal server error»". That premise holds for raw (non-HttpException) values, but a `new HttpException("msg", <fractional>)` — programmer error — also yields `null` and is now counted as a 5xx, while BaseExceptionFilter would render it with that same fractional status, not 500. Judgment-based: fractional status is a contrived misuse, and the pre-WR-01 behavior (not counting it) was also wrong for the raw-exception case this fix targets.
**Fix:** Key the numerator on the actual rendering rule, e.g. count when `exception instanceof HttpException ? Number.isInteger(status) && status >= 500 : true`, or clamp `exceptionStatus` to integer HttpExceptions only and let truly-unknown exceptions fall into the raw branch explicitly.

### IN-G2: Dead parameter in the `runOneTick` test helper

**File:** `tests/unit/alerts-composition.test.ts:222`
**Severity:** Info
**Issue:** `async function runOneTick(runtime: { close(): Promise<void> }, timers: CapturedTimer[])` never uses `runtime`; both call sites pass it, misleading readers into thinking the helper drives runtime teardown.
**Fix:** Drop the `runtime` parameter (or use it to assert the runtime stays open during the tick).

---

_Carried, consciously open per 09-REVIEW-DISPOSITION.md (not re-reported): WR-03 (de-escalation dispatched as `alert_escalated`), WR-04 (unbounded Retry-After), WR-05 (ALERT_SIGNAL_LABELS misses real signal codes — flagged there as the top candidate), WR-06 (acknowledge race), WR-07, IN-01 (dead `MAX_TIMER_DELAY`, alerts.ts:582), IN-02, IN-03, IN-04._

---

_Reviewed: 2026-11-13T07:20:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard (incremental, base 895b017)_
