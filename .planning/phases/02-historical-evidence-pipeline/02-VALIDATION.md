---
phase: 02
slug: historical-evidence-pipeline
status: in_progress
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-29
---

# Phase 02 — Validation Strategy

## Replay lifecycle gap validation (2026-09-05)

Earlier green evidence below applies to the original execution. Plans 02-27 and 02-28 are verified plans, not completed implementation.

| Task | Required witness | Status |
|------|------------------|--------|
| 02-27-1 | Three sequential replay units with fresh quota/circuit admission | pending |
| 02-27-2 | Stable/volatile field classification and legacy/new API fingerprint compatibility | pending |
| 02-28-1 | Lease claim, active-delivery waiting, bounded exhaustion and migration from empty | pending |
| 02-28-2 | Fenced admission and atomic facts/provenance/success publication for all replay endpoints | pending |
| 02-28-3 | Real hard crash, early stalled delivery, stale publication and populated migration upgrade | pending |

Run the automated commands in each plan. Process/container tests may exceed the original 30-second feedback target; report actual duration and nonzero executed test counts.

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
| 02-W0-01 | W0 | 0 | PIPE-01 | T-02-01 | Queue namespace and teardown prevent cross-run contamination | integration | `pnpm exec vitest run tests/integration/pipeline-jobs.test.ts` | ✅ | ✅ green |
| 02-W0-02 | W0 | 0 | PIPE-02 | Facts cannot detach from immutable provenance | integration | `pnpm exec vitest run tests/integration/temporal-provenance.test.ts` | ✅ | ✅ green |
| 02-W0-03 | W0 | 0 | PIPE-03 | Provider spy proves reservation precedes construction/I/O | integration | `pnpm exec vitest run tests/integration/provider-budget-order.test.ts` | ✅ | ✅ green |
| 02-W0-04 | W0 | 0 | PIPE-04 | Optional lanes cannot consume critical headroom | integration | `pnpm exec vitest run tests/integration/quota-priority.test.ts` | ✅ | ✅ green |
| 02-W0-05 | W0 | 0 | PIPE-05 | Bounded retry and circuit state do not leak secrets or spend blocked quota | integration | `pnpm exec vitest run tests/integration/provider-resilience.test.ts` | ✅ | ✅ green |
| 02-W0-06 | W0 | 0 | PIPE-06 | Replay is authorized, bounded, and idempotent | integration | `pnpm exec vitest run tests/integration/replay.test.ts` | ✅ | ✅ green |
| 02-W0-07 | W0 | 0 | PIPE-07 | Evidence API echoes cutoff and preserves null/limitation states | unit/API/E2E | `pnpm exec vitest run tests/unit/form.test.ts tests/integration/evidence-api.test.ts` | ✅ | ✅ green |
| 02-W0-08 | W0 | 0 | PIPE-08 | Post-cutoff facts cannot affect historical features | property/unit | `pnpm exec vitest run tests/unit/chronological-features.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [x] `tests/integration/pipeline-jobs.test.ts` — Redis-backed harness with a unique queue prefix and deterministic teardown.
- [x] `tests/integration/temporal-provenance.test.ts` — empty-database migration and atomic observation/fact witnesses.
- [x] `tests/integration/provider-budget-order.test.ts` — provider spy and reservation-order assertions.
- [x] `tests/integration/quota-priority.test.ts` — critical-headroom concurrency cases.
- [x] `tests/integration/provider-resilience.test.ts` — fake clock and classified 4xx/429/timeout/5xx/circuit failures.
- [x] `tests/integration/replay.test.ts` — dry-run, same logical identity, and explicit revision replay cases.
- [x] `tests/unit/form.test.ts`, `tests/unit/chronological-features.test.ts` — dual-time, stable ordering, DST/UTC, missing timestamps, shuffled input, and post-cutoff invariants.
- [x] `tests/integration/evidence-api.test.ts` plus Playwright evidence journey — cutoff echo, trace, sample size, provenance, and limitation rendering.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Evidence hierarchy remains understandable at mobile/desktop widths and 200% zoom | PIPE-07 | Final visual hierarchy and dense-data readability require human judgment | Open a team evidence view at representative cutoffs, resize to mobile and desktop, zoom to 200%, and confirm cutoff, sample sizes, provenance, limitations, summaries, and trace remain readable without horizontal page scroll. |

## Validation Sign-Off

- [x] All tasks have `<automated>` verification or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verification.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Targeted feedback latency is below 30 seconds (47 tests in 25.42s on 2026-08-30).
- [x] `nyquist_compliant: true` set in frontmatter.

## Execution Evidence

- Wave 0: 9 files, 47 tests passed in 25.42s.
- Unit suite: 8 files, 56 tests passed in 2.33s.
- Integration suite: 14 files, 73 tests passed in 64.54s, including migration from empty PostgreSQL 18.
- Typecheck: 7/7 workspace packages passed.
- Browser E2E: 22/22 journeys passed; evidence and replay added 2/2 axe scans with no serious or critical violations.
- Endpoint review: Phase 2 remains limited to fixtures, results and standings; deferred surfaces remain unauthorized in `COVERAGE.md`.
- Threat review: T-02-14 credential remains server-only, T-02-15 browser rendering uses an allowlist and inert JSON, and T-02-16 freezes preview identity while suppressing duplicate submits.

**Approval:** automated validation complete; manual visual hierarchy judgment remains routed to end-of-phase UAT.
