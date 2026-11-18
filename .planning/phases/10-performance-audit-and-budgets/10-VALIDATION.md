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
- **Nyquist latency note (checker #4 accepted):** the fast unit subset (`pnpm vitest run --project unit …`, incl. `tests/unit/perf-audit.test.ts` and the contract tests) remains the FIRST per-commit feedback and stays within the 60-second bound. The full audit-harness runs (~3–5 min: 3 pinned mobile audits + 3 recorded-only desktop audits per D-04) exceed it by design — they are wave-level/acceptance-level instrumentation (phase acceptance per RESEARCH.md §Test Framework), not per-commit feedback; they run at task completion and wave/phase gates, not after every commit.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-T1 | 01 | 1 | PERF-01 | T-10-01, T-10-02 | receipt carries closed secret-free fields incl. the recorded-only desktop block (D-04, never gated); fail-closed extraction | integration (script run, local) | `node scripts/perf-audit.mjs --record --receipt scripts/perf/perf-receipts/perf-baseline-before.json` | ❌ (task itself) | ⬜ pending |
| 10-01-T2 | 01 | 1 | PERF-01 | T-10-01, T-10-02 | median-of-3 semantics, fail-closed assertions (UNMEASURABLE_*/budget-breach), closed-field secret-free receipt incl. desktop-recorded-only | unit | `pnpm vitest run --project unit tests/unit/perf-audit.test.ts` | ❌ Wave 0 | ⬜ pending |
| 10-01-T3 | 01 | 1 | PERF-01 | T-10-03 | budgets traceable to committed before-receipt; profile-drift fail-loud; recorded-only desktopProfile with no desktop budgets | integration (script run, local) | `node scripts/perf-audit.mjs --receipt <os-temp>/perf-before-assert-check.json` (check receipt in temp, deleted after run) | ❌ (task itself) | ⬜ pending |
| 10-02-T1 | 02 | 2 | PERF-01 | T-10-06 | both post-interaction panels split via next/dynamic inside the client component; no import cycle into the lazy chunk | static typecheck | `pnpm --filter @bet-stats/web exec tsc --noEmit` | ❌ | ⬜ pending |
| 10-02-T2 | 02 | 2 | PERF-01 | T-10-05 | moved panels' tests green against new module paths; responsible-copy source-scanning follows the owning module | unit | `pnpm vitest run --project unit tests/unit/forecast-comparison-ui.test.tsx tests/unit/odds-draft-ui.test.tsx tests/unit/responsible-copy.test.ts` | ✅ (existing files, updated imports) | ⬜ pending |
| 10-02-T3 | 02 | 2 | PERF-01 | T-10-04 | after-receipt scriptTransferBytes median strictly below before; budgets hold/tightened with traced headroom | integration (script run, local) | `node scripts/perf-audit.mjs --receipt <os-temp>/perf-after-assert-check.json` (check receipt in temp, deleted after run) | ❌ (task itself) | ⬜ pending |
| 10-03-T1 | 03 | 3 | PERF-02 | T-10-07, T-10-09 | performance-budget CI job exists, runs the pinned script/config, no skip constructs; contract test guards all four jobs in the same commit | unit (contract test) | `pnpm vitest run --project unit tests/unit/ci-workflow-contract.test.ts` | ❌ | ⬜ pending |
| 10-03-T2 | 03 | 3 | PERF-02 | T-10-08 | gate fails closed: induced budget breach exits 1 naming the breached metric; committed budget file and tree untouched | integration (script dry-run, local) | PowerShell dry-run: doctored budget copy in `$env:TEMP` + `node scripts/perf-audit.mjs --assert-only --receipt scripts/perf/perf-receipts/perf-baseline-after.json --budget $tmp` (exact command in 10-03 Task 2 verify) | ❌ (task itself) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/perf-audit.test.ts` — stubs for PERF-01: median, assertion, receipt-schema (secret-free closed fields)
- [ ] None else — existing test infrastructure covers the workspace; the harness is validated by running it

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Status | Result |
|----------|-------------|------------|--------|--------|
| Свежий полный локальный прогон харнеса (Docker, 3+3 аудита) | PERF-02 / PERF-01 | только живой прогон подтверждает fix parseFlags в сквозном вызове | ✅ DONE (2026-11-18T08:19–08:23 UTC+1) | exit 0; `RECEIPT_WRITTEN`; `BUDGETS_OK: all gated medians within budget`; LCP 12156 / TBT 702 / CLS 0.0871 / bytes 2818955 — все в рамках бюджетов (LCP 26500 / TBT 950 / CLS 0.09 / bytes 5500000); время 3м 49с; temp-квитанция удалена; стек разработчика :3000 не затронут |
| CI `performance-budget` job green на GitHub Actions | PERF-02 | первый живой прогон джобы подтверждает fix ci.yml | ⏳ DEFERRED (2026-11-18) | Нет плагина GitHub — автоматический push/наблюдение недоступны. Два fix-коммита готовы к пушу: `2a91d11` (ci.yml + тест) и `c6d2c83` (parseFlags export + cross-parse). Пользователь: выполните `git push origin main` и проверьте джобу `performance-budget` в GitHub Actions. Ожидается: зелёная, ≤25 мин. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
