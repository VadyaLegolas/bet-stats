---
phase: "14"
slug: asian-handicap-and-exact-score-markets
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-25"
validated: "2026-11-25"
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
| **Full suite command** | `pnpm test` (unit + web), `pnpm test:integration` (нужен Docker; файлы, которым нужны DATABASE_URL, Redis и секрет оператора, — через `pnpm test:integration:docker`), `pnpm typecheck` |
| **Estimated runtime** | quick ~2 s; integration ~1–2 min на файл (старт PostgreSQL), весь набор ~17 мин |

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
| 14-02 | 02 | 2 | MKT-01 | unit | `pnpm exec vitest run --project unit tests/unit/asian-handicap.test.ts tests/unit/extended-view.test.ts` | ✅ | ✅ green |
| 14-02 | 02 | 2 | MKT-02 | unit | `pnpm exec vitest run --project unit tests/unit/exact-score.test.ts` | ✅ | ✅ green |
| 14-02, 14-03, 14-05, 14-07 | 02, 03, 05, 07 | 2–5 | MKT-03 | unit + integration | `pnpm exec vitest run --project unit tests/unit/markets-registry.test.ts tests/unit/extended-value-decision.test.ts`; `pnpm exec vitest run --project integration tests/integration/extended-markets-guards.test.ts tests/integration/extended-markets-api.test.ts` | ✅ | ✅ green |
| 14-03, 14-05 | 03, 05 | 3–4 | MKT-04 | unit + integration | `pnpm exec vitest run --project unit tests/unit/extended-settlement.test.ts`; `pnpm exec vitest run --project integration tests/integration/extended-settlement-pipeline.test.ts` | ✅ | ✅ green |
| 14-01 | 01 | 1 | MKT-05 | unit + integration | `pnpm exec vitest run --project unit tests/unit/score-matrix.test.ts`; `pnpm exec vitest run --project integration tests/integration/score-matrix-persistence.test.ts` | ✅ | ✅ green |
| 14-04, 14-06, 14-08 | 04, 06, 08 | 3, 4, 6 | UI | unit / e2e | `pnpm --filter @bet-stats/web test`; `pnpm exec playwright test -c playwright.config.ts tests/e2e/extended-markets.spec.ts` | ✅ | ✅ green (15 сценариев, живой стек) |
| 14-08 | 08 | 6 | D-21 (методология) | unit / e2e | `pnpm exec vitest run --project unit tests/unit/model-card.test.ts tests/unit/inner-pages-design-ui.test.tsx tests/unit/responsible-copy.test.ts`; `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/methodology.spec.ts --project=desktop-chromium` | ✅ | ✅ green |
| 14-08 | 08 | 6 | perf (Phase 10, повторный аудит) | perf | `node scripts/perf-audit.mjs --receipt <вне репозитория>` | ✅ | ⚠️ LCP, TBT, CLS в бюджете; scriptTransferBytes 5 960 160 > 5 500 000 (превышение уже было до фазы 14: 5 921 263 на конце фазы 13, вклад фазы 14 +38 897 байт; см. deferred-items.md) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/markets-registry.test.ts`, `asian-handicap.test.ts`, `exact-score.test.ts`, `score-matrix.test.ts`, `extended-view.test.ts`, `extended-value-decision.test.ts`, `extended-settlement.test.ts`
- [x] `tests/integration/extended-markets-guards.test.ts`, `extended-settlement-pipeline.test.ts`, `score-matrix-persistence.test.ts`, `extended-markets-api.test.ts` (плюс `extended-markets-parity.test.ts`)
- [x] `tests/unit/extended-markets-ui.test.tsx`, `tests/e2e/extended-markets.spec.ts`
- [x] Пины в существующих тестах: литерал `SCORE_FORMULA_HASH` (`tests/unit/evaluation.test.ts`), `forecastConfigHashFor` для обеих моделей (`tests/unit/forecast-model-version.test.ts`), bit-identity `createForecast` до/после выноса `buildScoreMatrix` (`tests/unit/forecast-v1-regression.test.ts`)
- [x] Установка фреймворка не нужна

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Тогл, экспандер (`aria-expanded`, фокус), выбор линии, 17 полей ввода, axe-скан | UI | В репозитории нет Testing Library/jsdom; интерактив покрывает только Playwright | Закрыто автоматически: `tests/e2e/extended-markets.spec.ts` (15 сценариев, настоящие PostgreSQL, Nest и Next); визуальная сверка с `14-UI-SPEC.md` выполнена через вычисляемые стили и снимки при провале, живой глазомерный просмотр не выполнялся |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s (на уровне unit и web; integration-файлы стартуют PostgreSQL и дольше)
- [x] `nyquist_compliant: true` set in frontmatter

**Открытое замечание (не относится к покрытию тестами):** бюджет `scriptTransferBytes` фазы 10 превышен (5 960 160 против 5 500 000). Превышение возникло до фазы 14 и остаётся незакрытым; решение (поднять бюджет с обоснованием или сократить клиентский пакет) принимает владелец фазы 10. Бюджеты LCP, TBT и CLS не превышены.

**Approval:** 2026-11-25 (исполнитель плана 14-08); перф-превышение вынесено в deferred-items.md
