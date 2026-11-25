---
phase: 14-asian-handicap-and-exact-score-markets
plan: 09
subsystem: ui
tags: [css, layout, container-queries, sticky, playwright, gap-closure]
requires:
  - phase: 14-asian-handicap-and-exact-score-markets
    provides: сетка точного счёта (14-04) и сценарии 14-08, на которых найден дефект UAT теста 7
provides:
  - читаемая раскладка сетки точного счёта на 320, 375 и 768 px (подпись, ось строк, ось столбцов)
  - закреплённые подписи сетки лежат выше текста ячеек при прокрутке вправо
  - Playwright-сценарий, измеряющий боксы подписи, осей и закреплённых ячеек, и охранные unit-тесты раскладки
affects: [14-UAT тест 7, повторный /gsd-verify-work 14]
tech-stack:
  added: []
  patterns:
    - "размерный контейнер (container-type: inline-size) на области прокрутки таблицы, чтобы caption занимал видимую ширину через 100cqw"
    - "сброс унаследованного overflow-wrap: anywhere на th таблицы вместо правки общего правила .workbench-card"
key-files:
  created: []
  modified:
    - apps/web/app/globals.css
    - "apps/web/app/fixtures/[fixtureId]/extended-markets-sections.tsx"
    - apps/web/components/design-tokens.test.ts
    - tests/unit/extended-markets-ui.test.tsx
    - tests/e2e/extended-markets.spec.ts
key-decisions:
  - "Общее правило .evidence-table-scroll и ResponsiveEvidence не менялись; контейнерная ширина включается модификатором market-grid-scroll только на сетке точного счёта"
  - "caption не делается sticky: поведение в Firefox и Safari не проверялось, достаточно ширины подписи, равной видимой ширине области"
  - "Названия осей и все тексты сетки оставлены как есть: причина дефекта была в раскладке, а не в длине текста"
requirements-completed: [MKT-02]
status: complete
duration: 55min
completed: 2026-11-25
estimate:
  tokens: 20000
  raw_tokens: 40000
  tasks: 3
  confidence: high
actuals:
  tokens: 3500
  tasks: 3
  commits: 2
plan_head_before: b0fc58cc507362664f9dbc0ec7d0468f75522707
plan_head_after: 6c6779daa88eed3c4304b0afb093d8615546e672
---

# Phase 14 Plan 09: Раскладка сетки точного счёта на узком экране Summary

**Размерный контейнер на области прокрутки (подпись шириной 100cqw), сброс унаследованного overflow-wrap на th и z-index закреплённых подписей: сетка точного счёта читаема на 320, 375 и 768 px в светлой, тёмной темах и forced-colors, данные и тексты не тронуты.**

## Что сделано

Задача 3 плана не меняла исходники (сводный гейт), поэтому коммитов с кодом два.

- **Задача 1 (tracer, `66982fd`):** красный замер на неизменённом коде, затем четыре правила в блоке `.market-*` файла globals.css (`.market-grid th`, `.market-grid thead th[scope="colgroup"]`, `.market-grid-scroll`, `.market-grid caption`) и класс `market-grid-scroll` на области прокрутки в `extended-markets-sections.tsx`. Добавлена `measureExactGrid` и сценарий в `visual backstops`.
- **Задача 2 (`6c6779d`):** охранные тесты до правки, затем правила закрепления (`position: sticky; inset-inline-start: 0; z-index: 1` для угловой ячейки и `tfoot th`, `z-index: 1` для `tbody th`), сценарий расширен до матрицы 3 ширины x 3 режима и функции `measureStuckHeaders` (hit-test закреплённых ячеек после прокрутки в конец).
- **Задача 3:** сводный гейт без правок исходников, контейнер удалён.

Причина дефекта 2 подтверждена измерением: `overflow-wrap: anywhere` наследуется от `.workbench-card` и сводит минимальную ширину первого столбца к одной букве. Скрытый дефект закрепления (после 14-08 `td { position: relative }` перекрывал закреплённый th) найден при диагностике на планировании и подтверждён красным замером ниже.

## Красные замеры (до правки)

Сообщения `measureExactGrid` на неизменённом коде, 320 px, светлая тема (Задача 1):

```
caption box 33..492 is outside the visible 33..287
caption text-align is -webkit-center, expected start or left
row-axis header "Голы хозяев" takes 10 lines, expected at most 2
tfoot header "Любой другой счёт" takes 9 lines, expected at most 3
column-axis text "Голы гостей" 242..326 is outside the visible 33..287
```

Сообщения `measureStuckHeaders` до CSS-правил закрепления (Задача 2), 320 px, светлая тема (правила Задачи 1 уже были применены, поэтому проверка боксов проходила, а красной была только закреплённость):

```
corner cell left edge -208 is -241 px from the region edge 33
corner cell centre -168,263 is outside the viewport
first row header is covered by <td class="">
tfoot header left edge -208 is -241 px from the region edge 33
tfoot header centre -168,723 is outside the viewport
```

Красный замер CSS-охранных тестов до правила закрепления: упал ровно один тест (`pins the corner cell and the tfoot label above the cell text`), остальные охранные тесты были зелёными, потому что правила Задачи 1 уже существовали. Новый static-markup тест прошёл сразу (он закрепляет разметку, а не правило).

Красно-зелёный переход сценария «exact-score grid caption …»: красный до CSS Задачи 1, зелёный после неё для среза 320/light (Задача 1); красный по закреплённым ячейкам до правил Задачи 2, зелёный после (все 9 комбинаций ширины и режима).

## Результаты проверок

| Проверка | Результат |
|---|---|
| `playwright ... -g "exact-score grid caption"` (9 комбинаций 320/375/768 x light/dark/forced colors, закреплённые подписи при прокрутке на 320 и 375) | 1 passed |
| `vitest run --project unit tests/unit/extended-markets-ui.test.tsx` | 34 passed |
| `pnpm --filter @bet-stats/web test` | 14 файлов, 276 passed |
| `pnpm test` (unit + web) | unit: 89 файлов passed, 1 skipped, 1532 passed, 2 skipped; web: 276 passed; код выхода 0 |
| `pnpm typecheck` | 7 из 7 задач успешно (6 из кэша turbo, `@bet-stats/web` выполнен заново), ошибок нет |
| `pnpm --filter @bet-stats/web lint` | 0 ошибок, 9 предупреждений (как раньше) |
| вся спецификация `tests/e2e/extended-markets.spec.ts` | 16 passed, 0 skipped (15 прежних + новый), включая axe, forced colors, 200% масштаб, главную линию на краях |

Окружение: Node v24.22.0, pnpm 10.34.5, одноразовый контейнер `bs14-09-e2e-pg` на порту 55439 (образ `postgres:18-alpine`, взят локальный: `postgres:18` не скачивался из-за отсутствия `docker-credential-desktop`; сценарии 14-08 раньше шли на PostgreSQL 18), миграции применены `prisma migrate deploy`, контейнер удалён после прогона. Dev-база `football-prediction-platform-postgres-1` не затрагивалась.

## Не проверялось

- Firefox и WebKit: в проекте Playwright только chromium. Поддержка `cqw` и `container-type` (Chrome 105, Firefox 110, Safari 16) заявлена, но в этих браузерах не измерялась; в браузере без поддержки объявление игнорируется и подпись остаётся шириной в таблицу (прежнее поведение).
- Подпись таблицы АГ (ResponsiveEvidence) в объём не входила: она помещается в область (замерено при планировании).
- Живой просмотр глазами (человеческая проверка Задачи 3 и повторный UAT тест 7 через `/gsd-verify-work 14`) не выполнялся. Пробел закрыт по автоматике.
- Интеграционные тесты с БД (`pnpm test:integration`) не запускались: вне объёма плана (CSS и класс обёртки), код расчётов не менялся.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Образ `postgres:18` недоступен, взят локальный `postgres:18-alpine`**
- **Found during:** Задача 1, шаг 0
- **Issue:** `docker run postgres:18` падает с `docker-credential-desktop not found` при попытке скачать образ.
- **Fix:** использован уже имеющийся локально `postgres:18-alpine` (та же мажорная версия), имя контейнера и порт по плану.
- **Files modified:** нет
- **Commit:** нет

Других отклонений нет: план выполнен как написан. Лимит попыток автоисправления не затрагивался.

## Known Stubs

Нет.

## Threat Flags

Нет: изменены только CSS, класс обёртки и тесты, новой сетевой или файловой поверхности нет. Угрозы T-14-26, T-14-27, T-14-28, T-14-29 из плана закрыты: тексты и расчёты не менялись, предупреждение об ответственной игре лежит вне таблицы, одноразовая БД использована и удалена, z-index остаётся внутри контекста наложения области (axe зелёный в светлой и тёмной темах).

## Self-Check: PASSED

- FOUND: `apps/web/app/globals.css`, `apps/web/app/fixtures/[fixtureId]/extended-markets-sections.tsx`, `apps/web/components/design-tokens.test.ts`, `tests/unit/extended-markets-ui.test.tsx`, `tests/e2e/extended-markets.spec.ts`
- FOUND commits: `66982fd`, `6c6779d` (оба предки HEAD)
- `git diff --numstat` по globals.css: только добавления (9 + 5 строк, 0 удалённых); `.evidence-table-scroll` не менялся
- Контейнер `bs14-09-e2e-pg` удалён; `apps/web/next-env.d.ts` не коммитился
