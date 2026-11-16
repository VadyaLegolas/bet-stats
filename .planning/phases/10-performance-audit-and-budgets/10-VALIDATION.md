---
phase: "10"
slug: "performance-audit-and-budgets"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-16"
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (root devDependency) + existing apps/web vitest config for component tests |
| **Config file** | existing `vitest.config.*` per workspace; new tests in `tests/unit/` |
| **Quick run command** | `pnpm test` (config `test_command`) |
| **Full suite command** | `pnpm test` + the audit harness run itself is the phase acceptance |
| **Estimated runtime** | ~60 seconds (unit subset); audit harness run ~3–5 minutes |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test` (fast unit subset)
- **After every plan wave:** Run full `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-T1 | 01 | 1 | PERF-01 | — | receipt carries closed secret-free fields | unit | `pnpm vitest run --project unit tests/unit/perf-audit.test.ts` | ❌ Wave 0 | ⬜ pending |
| 10-01-T2 | 01 | 1 | PERF-01 | — | harness produces a receipt for the seeded production stack, workbench fully rendered | integration (script run, local) | `node scripts/perf-audit.mjs` (once, manually in the executor session) | ❌ (task itself) | ⬜ pending |
| 10-02-T1 | 02 | 2 | PERF-02 | — | CI job exists, reuses pinned config, exits 1 on regression | review + dry run of the same script locally; CI green/red observed on first push | CI run | ❌ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/perf-audit.test.ts` — stubs for PERF-01: median, assertion, receipt-schema (secret-free closed fields)
- [ ] None else — existing test infrastructure covers the workspace; the harness is validated by running it

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CI `performance-budget` job green on the PR | PERF-02 | first push observation | push the branch, watch the GitHub Actions run |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
