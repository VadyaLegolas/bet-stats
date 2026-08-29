---
phase: 02
slug: historical-evidence-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-29
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 + Playwright 1.62.1 |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `pnpm exec vitest run <target-file>` |
| **Full suite command** | `pnpm test && pnpm test:integration && pnpm typecheck && pnpm test:e2e` |
| **Estimated runtime** | Targeted checks under 30 seconds; full suite measured during execution |

## Sampling Rate

- **After every task commit:** Run the targeted Vitest file(s) named by the plan task.
- **After every plan wave:** Run `pnpm test && pnpm test:integration && pnpm typecheck`.
- **Before `$gsd-verify-work`:** Run the full suite plus migration-from-empty and evidence/replay Playwright journeys.
- **Max feedback latency:** 30 seconds for targeted task checks.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-W0-01 | W0 | 0 | PIPE-01 | T-02-01 | Queue namespace and teardown prevent cross-run contamination | integration | `pnpm exec vitest run tests/integration/pipeline-jobs.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-02 | W0 | 0 | PIPE-02 | Facts cannot detach from immutable provenance | integration | `pnpm exec vitest run tests/integration/temporal-provenance.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-03 | W0 | 0 | PIPE-03 | Provider spy proves reservation precedes construction/I/O | integration | `pnpm exec vitest run tests/integration/provider-budget-order.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-04 | W0 | 0 | PIPE-04 | Optional lanes cannot consume critical headroom | integration | `pnpm exec vitest run tests/integration/quota-priority.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-05 | W0 | 0 | PIPE-05 | Bounded retry and circuit state do not leak secrets or spend blocked quota | integration | `pnpm exec vitest run tests/integration/provider-resilience.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-06 | W0 | 0 | PIPE-06 | Replay is authorized, bounded, and idempotent | integration | `pnpm exec vitest run tests/integration/replay.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-07 | W0 | 0 | PIPE-07 | Evidence API echoes cutoff and preserves null/limitation states | unit/API/E2E | `pnpm exec vitest run tests/unit/form.test.ts tests/integration/evidence-api.test.ts` | ❌ W0 | ⬜ pending |
| 02-W0-08 | W0 | 0 | PIPE-08 | Post-cutoff facts cannot affect historical features | property/unit | `pnpm exec vitest run tests/unit/chronological-features.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [ ] `tests/integration/pipeline-jobs.test.ts` — Redis-backed harness with a unique queue prefix and deterministic teardown.
- [ ] `tests/integration/temporal-provenance.test.ts` — empty-database migration and atomic observation/fact witnesses.
- [ ] `tests/integration/provider-budget-order.test.ts` — provider spy and reservation-order assertions.
- [ ] `tests/integration/quota-priority.test.ts` — critical-headroom concurrency cases.
- [ ] `tests/integration/provider-resilience.test.ts` — fake clock and classified 4xx/429/timeout/5xx/circuit failures.
- [ ] `tests/integration/replay.test.ts` — dry-run, same logical identity, and explicit revision replay cases.
- [ ] `tests/unit/form.test.ts`, `tests/unit/chronological-features.test.ts` — dual-time, stable ordering, DST/UTC, missing timestamps, shuffled input, and post-cutoff invariants.
- [ ] `tests/integration/evidence-api.test.ts` plus Playwright evidence journey — cutoff echo, trace, sample size, provenance, and limitation rendering.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Evidence hierarchy remains understandable at mobile/desktop widths and 200% zoom | PIPE-07 | Final visual hierarchy and dense-data readability require human judgment | Open a team evidence view at representative cutoffs, resize to mobile and desktop, zoom to 200%, and confirm cutoff, sample sizes, provenance, limitations, summaries, and trace remain readable without horizontal page scroll. |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verification or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verification.
- [ ] Wave 0 covers all missing references.
- [ ] No watch-mode flags.
- [ ] Targeted feedback latency is below 30 seconds.
- [ ] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
