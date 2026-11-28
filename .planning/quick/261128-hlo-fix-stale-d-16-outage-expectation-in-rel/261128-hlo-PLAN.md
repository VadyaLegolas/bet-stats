---
phase: quick
plan: 261128-hlo
type: execute
files_modified:
  - tests/e2e/release-degradation.spec.ts
---

# Quick 261128-hlo: устаревшее ожидание D-16

**Проблема:** `tests/e2e/release-degradation.spec.ts`, случай «D-16 sole-source outage…», ждёт в блоке «Статус поставщика» код `PROVIDER_UNAVAILABLE`. С коммита `e7505c5` интерфейс выводит русскую подпись «Провайдер недоступен» (`apps/web/components/enum-labels.ts`).

## Задача

- **files:** `tests/e2e/release-degradation.spec.ts`
- **action:** в строке ожидания заменить `PROVIDER_UNAVAILABLE` на `Провайдер недоступен`; остальные проверки не менять.
- **verify:** `pnpm verify:release` в отдельном worktree без `.env`.
- **done:** случай проходит в обоих проектах Playwright.
