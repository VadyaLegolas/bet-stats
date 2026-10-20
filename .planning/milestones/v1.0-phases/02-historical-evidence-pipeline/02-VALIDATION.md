---
phase: 02
slug: historical-evidence-pipeline
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-29
---

# Phase 02 — Validation Strategy

## Replay lifecycle gap validation (2026-09-05)

Plans 02-27 and 02-28 are implemented and have direct behavioral evidence. The commands below were rerun during the Nyquist audit; every required behavior passed in an isolated environment.

| Task | Required witness | Automated evidence | Status |
|------|------------------|--------------------|--------|
| 02-27-1 | Three sequential replay units under one stable approval, with fresh quota/circuit admission for every unit | `replay-boundary.test.ts`: new and legacy three-unit cases plus intervening live denial | ✅ green |
| 02-27-2 | Exhaustive stable/volatile field classification and legacy/`identity-v2` compatibility | `provider-resilience.test.ts`: 44/44 passed | ✅ green |
| 02-28-1 | Lease claim, active-owner waiting, expired reclaim, stale-owner fencing, bounded exhaustion and empty migration | `pipeline-jobs.test.ts`, `replay.test.ts`, `migration-empty.test.ts` | ✅ green |
| 02-28-2 | Production logical key, fenced admission and atomic facts/provenance/success publication for FIXTURES, RESULTS and STANDINGS | `replay.test.ts`, `pipeline-jobs.test.ts`, isolated production-boundary cases | ✅ green |
| 02-28-3 | Real hard crash, stalled redelivery, stale-effect rejection and populated upgrade | `replay-crash-recovery.test.ts`, `replay-lease-upgrade.test.ts` | ✅ green |

The full `replay-boundary.test.ts` file shares daily request reservations across cases. A selected fresh run passed six cases, then the STANDINGS case was denied by accumulated `CRITICAL_HEADROOM`; the same STANDINGS case passed 1/1 on a new database. This is an intra-file isolation warning, not missing behavioral coverage.

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
| 02-27-1 | 02-27 | 22 | PIPE-03/04/05/06 | T-02-G27-02/03 | Stable approval coexists with fresh fail-closed admission for every replay unit | integration | `node node_modules/vitest/vitest.mjs run tests/integration/replay-boundary.test.ts --project integration -t "runs three sequential\|multi-unit replay stops"` | ✅ | ✅ green |
| 02-27-2 | 02-27 | 22 | PIPE-03/04/05/06 | T-02-G27-01/03 | Stable policy drift invalidates approval; volatile observations still govern live admission | integration | `node node_modules/vitest/vitest.mjs run tests/integration/provider-resilience.test.ts --project integration` | ✅ | ✅ green (44/44) |
| 02-28-1 | 02-28 | 23 | PIPE-01/05/06 | T-02-G28-01/02/03/04 | Database-clock lease claim/reclaim, active waiting, fencing, exhaustion and empty migration | integration | `node node_modules/vitest/vitest.mjs run tests/integration/pipeline-jobs.test.ts tests/integration/replay.test.ts --project integration` plus `migration-empty.test.ts` | ✅ | ✅ green |
| 02-28-2 | 02-28 | 23 | PIPE-01/05/06 | T-02-G28-03/05/06 | Production logical key and current fencing token guard provider admission and atomic publication | integration | `node node_modules/vitest/vitest.mjs run tests/integration/pipeline-jobs.test.ts tests/integration/replay.test.ts --project integration` | ✅ | ✅ green |
| 02-28-3 | 02-28 | 23 | PIPE-01/05/06 | T-02-G28-01/03/07 | OS-killed worker is reclaimed once; populated upgrade preserves history and terminal rows | process/integration | `node node_modules/vitest/vitest.mjs run tests/integration/replay-crash-recovery.test.ts tests/integration/replay-lease-upgrade.test.ts --project integration` | ✅ | ✅ green |

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
- Replay policy audit: 44/44 provider-policy cases passed, including every stable/volatile field and both persisted fingerprint formats.
- Replay lifecycle audit: 27/27 lease, fencing, exhaustion, production logical-key, publication and hard-crash cases passed.
- Migration audit: empty PostgreSQL 18 deploy passed 1/1 on retry after one transient Prisma schema-engine startup failure; populated pre-lease upgrade passed 1/1.
- Boundary isolation audit: six selected production-boundary cases passed together; the seventh hit accumulated critical headroom and then passed 1/1 on a fresh database. The verifier's intra-file quota-contamination warning remains valid.

## Validation Audit 2026-09-05

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Newly audited task behaviors | 5/5 green |

**Approval:** automated validation complete; manual visual hierarchy judgment remains routed to end-of-phase UAT.
