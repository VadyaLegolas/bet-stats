---
phase: "09"
slug: "degradation-alerting"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-11"
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Reconstructed (State B) from the four plan SUMMARYs after execution — all four requirements map to green automated tests; no gaps found.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (projects: `unit`, `integration`) |
| **Config file** | root vitest workspace config (`vitest` projects discovered via pnpm) |
| **Quick run command** | `$env:PATH = "D:\Documents\Atom\bet-stats\.tools\node24;$env:PATH"; $env:CI = "true"; pnpm vitest run --project unit <files>` (non-TTY shells need `CI=true` + null stdin, else the forks pool hangs) |
| **Full suite command** | `$env:PATH = "D:\Documents\Atom\bet-stats\.tools\node24;$env:PATH"; $env:CI = "true"; pnpm vitest run --project unit; pnpm vitest run --project integration` (integration requires Docker/Testcontainers + DATABASE_URL) |
| **Estimated runtime** | ~60–120 seconds (unit), ~30–60 seconds (integration, container startup dominates) |

---

## Sampling Rate

- **After every task commit:** Run quick command over the plan's touched test files
- **After every plan wave:** Run full unit project; integration suite at plan boundaries
- **Before `/gsd-verify-work`:** Full suite must be green (except documented pre-existing fixtures-sync DB-credential failures, out of scope)
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | ALRT-02 | T-09-01/02/03 | DB-level tamper guards: append-only audit triggers, guarded identity-freeze trigger | integration | `pnpm vitest run --project integration tests/integration/alerts.test.ts` | ✅ | ✅ green (7/7) |
| 09-01-02 | 01 | 1 | ALRT-02 | T-09-01/02/03 | Mutation rejection + dedup convergence + ack idempotency on real PostgreSQL | integration | same as above | ✅ | ✅ green |
| 09-02-01 | 02 | 3 | ALRT-01 | T-09-06 | Six signal adapters (quota, circuit, sync, dead letters, 5xx ratio, backup staleness) | unit | `pnpm vitest run --project unit tests/unit/alerts-signals.test.ts` | ✅ | ✅ green (29/29) |
| 09-02-02 | 02 | 3 | ALRT-02, ALRT-04 | T-09-06 | Dedup/damping/auto-resolution lifecycle + webhook dispatch with per-attempt evidence | unit | `pnpm vitest run --project unit tests/unit/alerts-dispatch.test.ts tests/unit/alerts-signals.test.ts` | ✅ | ✅ green (37/37) |
| 09-02-03 | 02 | 3 | ALRT-04 | T-09-04 | Weekly synthetic delivery probe, CRITICAL self-alert on channel failure (D-13) | unit | `pnpm vitest run --project unit tests/unit/alerts-delivery-probe.test.ts` | ✅ | ✅ green (10/10) |
| 09-03-01 | 03 | 2 | ALRT-01 | T-09-07 | Http5xxBucketFilter: Redis buckets, byte-identical base errors, Redis never fails a request | unit | `pnpm vitest run --project unit tests/unit/alerts-5xx-filter.test.ts` | ✅ | ✅ green (8/8) |
| 09-03-02 | 03 | 2 | ALRT-03, ALRT-04 | T-09-08/09 | Sanitized alerts read model (canary), idempotent OperatorGuard acknowledge | integration | `pnpm vitest run --project integration tests/integration/operator-overview.test.ts tests/integration/alerts.test.ts` | ✅ | ✅ green (25/25 + 9/9) |
| 09-04-01 | 04 | 4 | ALRT-03 | — | Typed-field rendering: secrets/payloads/headers cannot reach the DOM (canary case) | unit (SSR) | `pnpm vitest run apps/web/app/internal/operations/alerts-block.test.ts` | ✅ | ✅ green (39/39) |
| 09-04-02 | 04 | 4 | ALRT-04 | — | Non-destructive acknowledge semantics (D-04) at the view layer | unit (SSR) | same as above | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. (vitest projects + Testcontainers harness from phases 01–08 reused; no new framework wiring needed.)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Evaluator tick inside the live stack (real PostgreSQL/Redis/BullMQ) | ALRT-01 | Arming requires `ALERTS_ENABLED=true` + a dev-server restart, which the operating rules forbid the agent from doing | On the next natural stack restart, set `ALERTS_ENABLED=true`, force a threshold condition, confirm an OpsAlert row appears and renders on /internal/operations |
| Filter + middleware counters observable in the running stack | ALRT-01 | Observing real Redis counters through the live API needs the running dev stack (never kill/restart it) | On the next natural stack open, trigger a 5xx and inspect `bet-stats:http5xx:<minuteIndex>` / `bet-stats:httpTotal:<minuteIndex>` in Redis |
| Visual adequacy of the «Алерты» block (themes, 320px, 200% zoom, keyboard ack, live round-trip behind OperatorGuard+HMAC) | ALRT-03, ALRT-04 | Human visual/interaction judgment on the user's running stack (D4 in 09-04 coverage) | Open /internal/operations, check light/dark themes, narrow viewport, keyboard-only acknowledge focus on the «Подтверждён» marker |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are classified Manual-Only with rationale
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — no MISSING)
- [x] No watch-mode flags (`vitest run`, `CI=true` in non-TTY shells)
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-11-11 (automated reconstruction — all four requirements COVERED, no gaps found)
