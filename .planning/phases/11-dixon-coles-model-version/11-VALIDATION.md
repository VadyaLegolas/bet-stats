---
phase: "11"
slug: "dixon-coles-model-version"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-20"
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (`unit` and `integration` projects in root `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` (aliases `@bet-stats/*` to package sources) |
| **Quick run command** | `pnpm vitest run --project unit tests/unit/dixon-coles.test.ts tests/unit/forecast-v1-regression.test.ts tests/unit/forecast-model-version.test.ts` |
| **Full suite command** | `pnpm test` (unit) + `pnpm test:integration` (PostgreSQL required) |
| **Estimated runtime** | unit subset < 30 s; full unit ~2 min; integration ~5–10 min |

---

## Sampling Rate

- **After every task commit:** the task's own automated unit command (fast subset).
- **After every plan wave:** `pnpm vitest run --project unit` plus `pnpm typecheck` (the identity widening is a compile-time guarantee).
- **Before `/gsd-verify-work`:** `pnpm test` and `pnpm test:integration` green; V1 regression vector unchanged.
- **Max feedback latency:** 30 seconds for the per-commit subset.
- **Nyquist note:** integration tests need PostgreSQL and are wave-level feedback, not per-commit.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-T1 | 01 | 1 | MODEL-02 | T-11-01, T-11-02 | Version union is the only accepted identity; a V1-typed draft cannot carry a DC config version; unknown literals rejected fail-closed | unit | `pnpm vitest run --project unit tests/unit/forecast-model-version.test.ts tests/unit/forecast-v1-regression.test.ts` | ❌ Wave 0 | ⬜ pending |
| 11-01-T2 | 01 | 1 | MODEL-01 | T-11-01, T-11-03 | τ sign convention pinned; every τ strictly positive for the tested λ grid; correction applied before normalization so every market still sums to 1 | unit | `pnpm vitest run --project unit tests/unit/dixon-coles.test.ts` | ❌ Wave 0 | ⬜ pending |
| 11-01-T3 | 01 | 1 | MODEL-01 | T-11-04 | Estimator is pure and deterministic; returns `rho=0` with an explicit method instead of an out-of-band value; never returns non-finite ρ | unit | `pnpm vitest run --project unit tests/unit/dixon-coles.test.ts` | ❌ Wave 0 | ⬜ pending |
| 11-02-T1 | 02 | 2 | MODEL-02, MODEL-01 | T-11-05, T-11-06 | ρ fit uses only settled forecasts with `cutoff < kickoff <= asOf`; league sample gates and pooled fallback are explicit; no result read after `asOf` | integration | `pnpm vitest run --project integration tests/integration/dixon-coles-rho.test.ts` | ❌ | ⬜ pending |
| 11-02-T2 | 02 | 2 | MODEL-02 | T-11-07 | Production default is DC through configuration; V1 selectable; a DC forecast without resolvable ρ fails closed | integration + unit | `pnpm vitest run --project unit tests/unit/forecast-model-version.test.ts` and `pnpm vitest run --project integration tests/integration/forecast-api.test.ts` | ✅ (extended) | ⬜ pending |
| 11-02-T3 | 02 | 2 | MODEL-02 | T-11-08 | Sweep and LINEUP_CONFIRMED paths carry the configured version; no backfill or UPDATE of issued rows | integration | `pnpm vitest run --project integration tests/integration/forecast-publication.test.ts tests/integration/forecast-snapshots.test.ts` | ✅ (extended) | ⬜ pending |
| 11-03-T1 | 03 | 3 | MODEL-03, MODEL-02 | T-11-09, T-11-10 | Backtest plan pins its own version/config hash; ρ is fitted at `trainingEndsAt`, never at `forecastCutoff` | integration | `pnpm vitest run --project integration tests/integration/backtest-origin.test.ts tests/integration/backtest-production.test.ts` | ✅ (extended) | ⬜ pending |
| 11-03-T2 | 03 | 3 | MODEL-03 | T-11-11, T-11-12 | Comparison refuses mixed versions, mismatched windows and unequal samples; receipt is closed-field and secret-free | unit + integration | `pnpm vitest run --project unit tests/unit/model-comparison.test.ts` and `pnpm vitest run --project integration tests/integration/model-comparison-api.test.ts` | ❌ | ⬜ pending |
| 11-04-T1 | 04 | 3 | MODEL-03 | T-11-13 | Card names the integration as hybrid, publishes τ convention and ρ policy, states O/U 2.5 neutrality and V1 availability | unit | `pnpm vitest run --project unit tests/unit/model-card.test.ts` | ❌ | ⬜ pending |
| 11-04-T2 | 04 | 3 | MODEL-03 | T-11-13 | UI shows the DC section and current model; e2e pin matches the card rather than a hardcoded old version | e2e | `pnpm playwright test tests/e2e/methodology.spec.ts` | ✅ (updated) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/forecast-model-version.test.ts` — union membership, per-version config version/hash, contract accept/reject matrix
- [ ] `tests/unit/forecast-v1-regression.test.ts` — committed numeric vector proving V1 probabilities, `configHash` and `inputHash` are unchanged
- [ ] `tests/unit/dixon-coles.test.ts` — τ sign/normalization/bounds and estimator determinism/failure behaviour

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Status | Result |
|----------|-------------|------------|--------|--------|
| Rolling-origin comparison of V1 vs DC on real settled history | MODEL-03 | Requires an operator-run pair of backtest plans over identical windows against the operator's database; the automated tests prove the mechanism, not the football result | ⬜ pending | — |
| Methodology page copy review (Russian wording, no over-claiming) | MODEL-03 | Legal/honesty review of user-facing prose is a human judgement | ⬜ pending | — |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60 s for the per-commit subset
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
