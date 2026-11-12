---
phase: 09-degradation-alerting
plan: 05
subsystem: workers/alerts
tags: [alerts, delivery-probe, dead-letter, bullmq, gap-closure, tdd]
requires:
  - "09-04 (alerts runtime composition in main.ts; alerts.ts adapters; delivery-probe.ts)"
provides:
  - "Dead-letter inspector wired into production scheduleAlertingTick composition (CR-01)"
  - "PROBE_ANCHOR_SIGNAL constant + evaluator-side exclusion of the probe anchor from auto-resolution (CR-02)"
  - "Delivery probe success resolves OPEN and ACKNOWLEDGED anchors with truthful transitions (IN-05)"
affects:
  - "09-06 (WR-01/WR-02 webhook reliability plan reuses the same alerts modules and test harness)"
tech-stack:
  added: []
  patterns:
    - "Caller-owned dependency injection seam (dependencies?: { database; redis; inspector }) in startAlertingRuntime for testability without teardown hazards"
    - "Pinned signal constants across worker modules with unit-test drift guards (worker rootDir cannot import apps/api or reverse-import delivery-probe)"
key-files:
  created:
    - tests/unit/alerts-composition.test.ts
  modified:
    - workers/data-sync/src/main.ts
    - workers/data-sync/src/jobs/alerts.ts
    - workers/data-sync/src/jobs/delivery-probe.ts
    - tests/unit/alerts-delivery-probe.test.ts
key-decisions:
  - "PROBE_ANCHOR_SIGNAL pinned in alerts.ts rather than imported from delivery-probe.js — delivery-probe imports from alerts, so a reverse import would be circular; drift is guarded by a unit test"
  - "startAlertingRuntime close() guards teardown with `instanceof Redis` / `instanceof Queue` checks so caller-injected dependencies are never closed by the runtime"
  - "Task 1 executed as a single fix commit (tracer slice, test + fix together); Task 2 followed the TDD RED→GREEN contract with tdd-red-evidence validation"
requirements-completed: [ALRT-02]
requirements-deferred: [ALRT-01]
commits: 3
plan_head_before: 71545424f95c69f604660a8f7c1f48b65a1e32ec
plan_head_after: a08e05cd26e739c8123619827bbc523d4f6612f6
status: complete
actuals:
  tokens: 3300
  tasks: 2
  commits: 3
estimate:
  tokens: 55000
  raw_tokens: 27500
  tasks: 2
duration: ~25 min
completed: 2026-11-12
---

# Phase 09 Plan 05: Alerts Gap-Closure (CR-01, CR-02, IN-05) Summary

**One-liner:** Wired the BullMQ dead-letter inspector into the production alerting composition and closed two cross-regression gaps in the probe-anchor lifecycle: the evaluator no longer auto-resolves the DELIVERY_HEALTH probe anchor, and probe success now resolves OPEN *and* ACKNOWLEDGED anchors with truthful transitions.

## What Was Built

### Task 1 — CR-01: dead-letter inspector composition (tracer)

- `workers/data-sync/src/main.ts`: `startAlertingRuntime` now passes `inspector` into `scheduleAlertingTick`, so the DEAD_LETTER adapter actually runs in production — one evaluator tick calls `inspector.getFailed(0, max)`.
- Added an optional `dependencies?: { database; redis; inspector }` injection seam plus `setTimeout`/`clearTimeout` pass-through; `close()` tears down only runtime-owned resources (guarded by `instanceof Redis` / `instanceof Queue`), never caller-owned dependencies.
- New `tests/unit/alerts-composition.test.ts`: proves the armed tick consumes `inspector.getFailed` and lands a durable OPEN/CRITICAL DEAD_LETTER row, and that `close()` stops the scheduler chain.

### Task 2 — CR-02 + IN-05: probe-anchor lifecycle (TDD RED→GREEN)

RED (commit `7a8ce59`): three failing cross-regression tests — probe-failure anchor must stay OPEN after an evaluator tick; success must resolve an ACKNOWLEDGED anchor with a truthful ACKNOWLEDGED→RESOLVED transition; `PROBE_ANCHOR_SIGNAL` drift guard. All three validated as `RED_EVIDENCE_OK` by `gsd-tools check tdd-red-evidence`.

GREEN (commit `a08e05c`):

- `workers/data-sync/src/jobs/alerts.ts`: exported `PROBE_ANCHOR_SIGNAL = "DELIVERY_HEALTH"` and extended the `resolveClearedAlerts` query with `signal: { not: PROBE_ANCHOR_SIGNAL }` — the probe anchor (`DELIVERY_HEALTH\0synthetic`, D-13) is owned exclusively by the probe lifecycle (CR-02).
- `workers/data-sync/src/jobs/delivery-probe.ts`: on successful webhook delivery, any non-RESOLVED anchor (OPEN or ACKNOWLEDGED) transitions to RESOLVED with a truthful `from → RESOLVED` transition row instead of the hardcoded `OPEN` (IN-05).

## Verification Results

| Deliverable | Verify | Result |
|---|---|---|
| CR-01 composition | `pnpm vitest run --project unit tests/unit/alerts-composition.test.ts` (tracer re-run after commit) | 2/2 pass |
| CR-02 + IN-05 RED evidence | `gsd-tools check tdd-red-evidence` on 3 TAP records | `RED_EVIDENCE_OK` ×3 |
| CR-02 + IN-05 GREEN | full verify suite: alerts-composition + alerts-delivery-probe + alerts-signals + alerts-dispatch | 44/44 pass (incl. 3 target tests + all controls) |
| Type-safety | `npx tsc --noEmit -p workers/data-sync/tsconfig.json` | exit 0 |
| Drift gates | `PROBE_ANCHOR_SIGNAL` present in alerts.ts; no changes under packages/database/prisma/** | pass |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surface; the webhook dispatch and probe payload allowlists were not modified.

## Notes for 09-06

Plan 5 of 6 for phase 09. Remaining: 09-06 (WR-01/WR-02 webhook reliability). The `dependencies` injection seam added in Task 1 is the pattern 09-06 should reuse when touching `startAlertingRuntime` again.

**Requirement completion:** ALRT-02 marked complete. ALRT-01 remains open pending 09-06 — it is jointly declared by 09-01/09-02/09-03/09-05/09-06, so it can only be checked off once the last declaring plan completes.
