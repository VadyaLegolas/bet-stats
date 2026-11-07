---
phase: "9"
slug: "degradation-alerting"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-07"
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (root), separate web project config `apps/web/vitest.config.ts` |
| **Config file** | `vitest.config.ts` (projects: `unit` = `packages/**/*.test.ts` + `tests/unit/**`; `integration` = `tests/integration/**`, `fileParallelism: false`) |
| **Quick run command** | `pnpm test` (= `vitest run --project unit && pnpm --filter @bet-stats/web test`) |
| **Full suite command** | `pnpm test:integration` / CI: `pnpm run test:integration:docker`; release gate: `pnpm verify:release` |
| **Estimated runtime** | ~30s unit · ~2-4min integration |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test` (unit + web).
- **After every plan wave:** Run `pnpm test` + `pnpm test:integration:docker` + `pnpm typecheck` + `pnpm lint`.
- **Before `/gsd-verify-work`:** Full CI suite green (schema validate → typecheck → lint → unit → build → Docker integration).
- **Max feedback latency:** 30 seconds (unit) / 240 seconds (integration).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {9}-01-01 | 01 | 1 | ALRT-01 | T-9-NN / — | Five signal adapters raise CRITICAL/WARNING per D-10..D-12 | unit | `pnpm exec vitest run --project unit tests/unit/alerts-signals.test.ts` | ❌ Wave 0 | ⬜ pending |
| — | 01 | 1 | ALRT-02 | T-9-NN | One OPEN row per fingerprint; transitions append; UPDATE/DELETE rejected | integration | `pnpm exec vitest run --project integration tests/integration/alerts.test.ts` | ❌ Wave 0 | ⬜ pending |
| — | 01 | 1 | ALRT-02 | — | Acknowledge is idempotent and never closes/deletes | integration | same file, `…alerts.test.ts` acknowledge cases | ❌ Wave 0 | ⬜ pending |
| — | 02 | 2 | ALRT-03 | — | Block renders states (empty/loading/error/populated) + ordering | web unit | `pnpm --filter @bet-stats/web exec vitest run -c vitest.config.ts app/internal/operations/alerts-block.test.ts` | ❌ Wave 0 | ⬜ pending |
| — | 02 | 2 | ALRT-03 | T-9-NN | Canary secrets never reach JSON/DOM | integration/e2e | `pnpm exec vitest run --project integration tests/integration/alerts.test.ts` + extend `tests/e2e/operator-overview.spec.ts` | ❌ Wave 0 | ⬜ pending |
| — | 03 | 3 | ALRT-04 | T-9-NN | Dispatcher: timeout, non-2xx → bounded retry → FAILED delivery row; payload allowlist | unit | `pnpm exec vitest run --project unit tests/unit/alerts-dispatch.test.ts` | ❌ Wave 0 | ⬜ pending |
| — | 03 | 3 | ALRT-04 | — | 5xx filter counts buckets without changing error contract | unit/integration | `tests/unit/alerts-5xx-filter.test.ts` (mock host) + integration error-contract regression | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/alerts-signals.test.ts` — thresholds, flap damping, NOT_CONFIGURED exclusion, min-volume guard
- [ ] `tests/unit/alerts-dispatch.test.ts` — fetch stub (timeout/429/3xx/bounded attempts), payload canary
- [ ] `tests/unit/alerts-5xx-filter.test.ts` — bucket writes + unchanged error contract
- [ ] `tests/integration/alerts.test.ts` — real Postgres: dedup upsert, guarded triggers, acknowledge idempotency, read-model ordering/pagination
- [ ] `apps/web/app/internal/operations/alerts-block.test.ts` — SSR states, Russian copy, ordering (mirror `backup-status-block.test.ts`)
- [ ] Framework install: **none** (Vitest/Playwright already configured — Package Legitimacy Audit clean; `pnpm-lock.yaml` unchanged)

*Existing test infrastructure covers the harness; all phase-specific files are new.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real webhook delivery to an operator-owned endpoint | ALRT-04 | Needs an operator-provisioned external endpoint; probes/alerting never call live external providers | Configure `ALERT_WEBHOOK_URL` at a request-bin endpoint, raise a test alert, confirm the payload arrives redacted (canary secret absent) |
| Rate-limit warn behavior against a real channel (Slack/Discord) | ALRT-04 | External service rate limits cannot be exercised in CI (D-02 warn-only) | Operator posts to a real channel during a manual drill; confirm WARN surfaced, no alert loss |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 240s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
