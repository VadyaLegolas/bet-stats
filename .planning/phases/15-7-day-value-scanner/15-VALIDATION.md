---
phase: "15"
slug: 7-day-value-scanner
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-25"
---

# Phase 15 — Validation Strategy

> Контракт валидации фазы: частота обратной связи во время исполнения. Полная карта требований → тестов лежит в `15-RESEARCH.md` (раздел Validation Architecture).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (проекты `unit` и `integration`), web-тесты через `pnpm --filter @bet-stats/web test`, Playwright 1.62.1 для E2E |
| **Config file** | `vitest.config.ts`, `apps/web/vitest.config.ts`, `playwright.config.ts`, `playwright.phase06.config.ts` |
| **Quick run command** | `pnpm exec vitest run --project unit tests/unit/scanner-domain.test.ts tests/unit/scanner-service.test.ts tests/unit/scanner-ui.test.tsx tests/unit/scanner-guards.test.ts tests/unit/responsible-copy.test.ts` |
| **Full suite command** | `pnpm test` (unit + web), `pnpm test:integration:docker` (нужен Docker), `pnpm typecheck`, `pnpm lint`, `pnpm build` |
| **Estimated runtime** | quick ~5 s; integration ~1–2 min на файл (старт PostgreSQL) |

---

## Sampling Rate

- **After every task commit:** quick run command (и `components/time-format.test.ts` или `design-tokens.test.ts` при правках этих файлов)
- **After every plan wave:** `pnpm test` + `tests/integration/scanner-api.test.ts` (свой контейнер)
- **Before `/gsd-verify-work`:** `pnpm test`, `pnpm test:integration:docker`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, E2E сканера и `release-accessibility.spec.ts` зелёные
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-xx | — | — | SCAN-01 | integration | `pnpm exec vitest run --project integration tests/integration/scanner-api.test.ts` | ❌ W0 | ⬜ pending |
| 15-xx | — | — | SCAN-01 | unit | `pnpm exec vitest run --project unit tests/unit/scanner-service.test.ts` | ❌ W0 | ⬜ pending |
| 15-xx | — | — | SCAN-02 | unit | `pnpm exec vitest run --project unit tests/unit/scanner-domain.test.ts tests/unit/scanner-ui.test.tsx tests/unit/scanner-guards.test.ts` | ❌ W0 | ⬜ pending |
| 15-xx | — | — | SCAN-03 | unit + integration | `pnpm exec vitest run --project unit tests/unit/responsible-copy.test.ts tests/unit/scanner-guards.test.ts`; `... --project integration tests/integration/scanner-api.test.ts -t "no N+1"` | ✅ частично | ⬜ pending |
| 15-xx | — | — | SCAN-01/02/03 | e2e | `pnpm exec playwright test -c playwright.scanner.config.ts tests/e2e/value-scanner.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/domain/src/value/scanner.ts` + экспорт в `packages/domain/src/index.ts` (константы, `classifyOddsFreshness`, типы DTO)
- [ ] `tests/helpers/scanner-seed.ts` (посев с контролем `kickoffUtc`, `status`, `createdAt`, `supersedesValueReceiptId`, `submittedAt`)
- [ ] `tests/unit/scanner-domain.test.ts`, `scanner-service.test.ts`, `scanner-ui.test.tsx`, `scanner-guards.test.ts`
- [ ] `tests/integration/scanner-api.test.ts` (свой контейнер, `prisma migrate deploy`)
- [ ] `tests/e2e/value-scanner.spec.ts`, стаб API, `playwright.scanner.config.ts`
- [ ] Обновить `tests/e2e/release-accessibility.spec.ts:7` (список пунктов навигации)
- [ ] Расширить `tests/unit/responsible-copy.test.ts`, `tests/unit/home-page-ui.test.tsx`, `apps/web/components/time-format.test.ts`, `apps/web/components/design-tokens.test.ts`
- [ ] Установка фреймворка не нужна

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Живой вид страницы `/scanner` на реальных данных (состояния AVAILABLE и EMPTY) | SCAN-01/02 | На dev-данных кандидатов может не быть (ограничение value-политики dixon-coles), живой AVAILABLE проверяется только на посеянных данных | Открыть `/scanner` при запущенном стеке, сверить с `15-UI-SPEC.md` на 320 px и в обеих темах |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
