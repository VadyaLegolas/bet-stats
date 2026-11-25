---
phase: "14"
slug: asian-handicap-and-exact-score-markets
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-25"
---

# Phase 14 — Validation Strategy

> Контракт валидации фазы: частота обратной связи во время исполнения. Полная карта требований → тестов лежит в `14-RESEARCH.md` (раздел Validation Architecture).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (проекты `unit` и `integration`), web-тесты через `pnpm --filter @bet-stats/web test`, Playwright для E2E |
| **Config file** | `vitest.config.ts`, `apps/web/vitest.config.ts` |
| **Quick run command** | `pnpm exec vitest run --project unit <touched test files>` |
| **Full suite command** | `pnpm test` (unit + web), `pnpm test:integration` (нужен Docker), `pnpm typecheck` |
| **Estimated runtime** | quick ~2 s; integration ~1–2 min на файл (старт PostgreSQL) |

---

## Sampling Rate

- **After every task commit:** `pnpm exec vitest run --project unit <touched test files>`
- **After every plan wave:** `pnpm test` + новые integration-файлы (Docker) + `pnpm typecheck`
- **Before `/gsd-verify-work`:** `pnpm test`, `pnpm test:integration`, `pnpm typecheck`, `pnpm build` — всё зелёное
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-xx | — | — | MKT-01 | unit | `pnpm exec vitest run --project unit tests/unit/asian-handicap.test.ts tests/unit/extended-view.test.ts` | ❌ W0 | ⬜ pending |
| 14-xx | — | — | MKT-02 | unit | `pnpm exec vitest run --project unit tests/unit/exact-score.test.ts` | ❌ W0 | ⬜ pending |
| 14-xx | — | — | MKT-03 | unit + integration | `pnpm exec vitest run --project unit tests/unit/markets-registry.test.ts tests/unit/extended-value-decision.test.ts`; `pnpm exec vitest run --project integration tests/integration/extended-markets-guards.test.ts tests/integration/extended-markets-api.test.ts` | ❌ W0 | ⬜ pending |
| 14-xx | — | — | MKT-04 | unit + integration | `pnpm exec vitest run --project unit tests/unit/extended-settlement.test.ts`; `pnpm exec vitest run --project integration tests/integration/extended-settlement-pipeline.test.ts` | ❌ W0 | ⬜ pending |
| 14-xx | — | — | MKT-05 | unit + integration | `pnpm exec vitest run --project unit tests/unit/score-matrix.test.ts`; `pnpm exec vitest run --project integration tests/integration/score-matrix-persistence.test.ts` | ❌ W0 | ⬜ pending |
| 14-xx | — | — | UI | unit / e2e | `pnpm --filter @bet-stats/web test`; `pnpm exec playwright test -c playwright.config.ts tests/e2e/extended-markets.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/markets-registry.test.ts`, `asian-handicap.test.ts`, `exact-score.test.ts`, `score-matrix.test.ts`, `extended-view.test.ts`, `extended-value-decision.test.ts`, `extended-settlement.test.ts`
- [ ] `tests/integration/extended-markets-guards.test.ts`, `extended-settlement-pipeline.test.ts`, `score-matrix-persistence.test.ts`, `extended-markets-api.test.ts`
- [ ] `tests/unit/extended-markets-ui.test.tsx`, `tests/e2e/extended-markets.spec.ts`
- [ ] Пины в существующих тестах: литерал `SCORE_FORMULA_HASH`, `forecastConfigHashFor` для обеих моделей, bit-identity `createForecast` до/после выноса `buildScoreMatrix`
- [ ] Установка фреймворка не нужна

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Тогл, экспандер (`aria-expanded`, фокус), выбор линии, 17 полей ввода, axe-скан | UI | В репозитории нет Testing Library/jsdom; интерактив покрывает только Playwright | Запустить `tests/e2e/extended-markets.spec.ts`, визуально сверить с `14-UI-SPEC.md` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
