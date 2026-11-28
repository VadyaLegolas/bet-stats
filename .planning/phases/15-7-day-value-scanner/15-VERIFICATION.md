---
phase: 15-7-day-value-scanner
verified: 2026-11-28T03:07:03Z
status: gaps_found
score: 15/20 must-haves verified
covered_files:
  - ".gitignore"
  - ".planning/phases/15-7-day-value-scanner/15-01-PLAN.md"
  - ".planning/phases/15-7-day-value-scanner/15-01-SUMMARY.md"
  - ".planning/phases/15-7-day-value-scanner/15-02-PLAN.md"
  - ".planning/phases/15-7-day-value-scanner/15-02-SUMMARY.md"
  - ".planning/phases/15-7-day-value-scanner/15-03-PLAN.md"
  - ".planning/phases/15-7-day-value-scanner/15-03-SUMMARY.md"
  - ".planning/phases/15-7-day-value-scanner/15-04-PLAN.md"
  - ".planning/phases/15-7-day-value-scanner/15-04-SUMMARY.md"
  - ".planning/phases/15-7-day-value-scanner/15-05-PLAN.md"
  - ".planning/phases/15-7-day-value-scanner/15-05-SUMMARY.md"
  - "apps/api/src/modules/value/scanner.controller.ts"
  - "apps/api/src/modules/value/scanner.service.ts"
  - "apps/api/src/modules/value/value.module.ts"
  - "apps/web/app/globals.css"
  - "apps/web/app/methodology/page.tsx"
  - "apps/web/app/page.tsx"
  - "apps/web/app/scanner/page.tsx"
  - "apps/web/app/scanner/scanner-data.ts"
  - "apps/web/app/scanner/scanner-labels.ts"
  - "apps/web/app/scanner/scanner-rows.tsx"
  - "apps/web/app/scanner/scanner-types.ts"
  - "apps/web/app/scanner/scanner-view.tsx"
  - "apps/web/components/design-tokens.test.ts"
  - "apps/web/components/release-navigation.tsx"
  - "apps/web/components/time-format.test.ts"
  - "apps/web/components/time-format.ts"
  - "apps/web/eslint.config.mjs"
  - "package.json"
  - "packages/domain/src/index.ts"
  - "packages/domain/src/value/scanner.ts"
  - "playwright.scanner.config.ts"
  - "tests/e2e/release-accessibility.spec.ts"
  - "tests/e2e/scanner-stub-api.mjs"
  - "tests/e2e/value-scanner-live.spec.ts"
  - "tests/e2e/value-scanner.spec.ts"
  - "tests/helpers/scanner-seed.ts"
  - "tests/integration/scanner-api.test.ts"
  - "tests/unit/home-page-ui.test.tsx"
  - "tests/unit/responsible-copy.test.ts"
  - "tests/unit/scanner-domain.test.ts"
  - "tests/unit/scanner-guards.test.ts"
  - "tests/unit/scanner-service.test.ts"
  - "tests/unit/scanner-ui.test.tsx"
covered_digest: "v4:sha256:2c94eedf2649897fcf5cfeec5e9a766940b246101cc601185ec03412df9403f2"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "D-11: страница сканера не увеличивает клиентский пакет; scriptTransferBytes не выше 5 960 160 (фазовый гейт плана 15-05)"
    status: failed
    reason: "Константы нового доменного модуля сканера экспортированы через барель @bet-stats/domain и попали в клиентский чанк (237 байт, измерено по сборке). Аудит исполнителя: 5 960 540 байт, на 380 выше границы. Цель фазы и SCAN-01..03 этим не затронуты."
    artifacts:
      - path: "packages/domain/src/index.ts"
        issue: "export * from ./value/scanner.js добавляет модуль в барель, который импортируют клиентские файлы"
      - path: "packages/domain/src/value/scanner.ts"
        issue: "Три вызова Object.freeze на верхнем уровне не отбрасываются при tree-shaking"
    missing:
      - "Убрать константы сканера из клиентского чанка (например, пометить Object.freeze как /*#__PURE__*/ или не тянуть значения через барель в клиент), затем повторить perf-audit; либо принять отклонение через overrides"
human_verification:
  - test: "pnpm verify:scanner (31 сценарий против стаб-API, порты 3251/3252)"
    expected: "31 из 31: переполнение 320/375/768/1440 и 200% zoom, навигация 768-1023, длинные строки, axe в обеих темах, клавиатура"
    why_human: "Четыре backstop-истины плана 15-05; верификатор не запускал серверы и Playwright, а заявление SUMMARY доказательством не является"
  - test: "Открыть /scanner при 320 px в светлой и тёмной темах на посеянных данных (лучше на одноразовой БД) и сверить с 15-UI-SPEC.md; проверить состояния AVAILABLE и EMPTY"
    expected: "Соответствие контракту, нет горизонтальной прокрутки, квитанция (JSON) открывается и содержит те же edge и expectedValue"
    why_human: "Визуальная проверка (human-check плана 15-05 и 15-VALIDATION.md) не выполнялась"
  - test: "Решить: оставить боковые поля ссылок навигации --space-2 при 768-1023 px (сверх плана и UI-SPEC) или заменить другим способом"
    expected: "Решение владельца; при принятии обновить 15-UI-SPEC.md (U-09, подпись «Сканер»)"
    why_human: "Продуктовое и дизайнерское решение"
  - test: "Решить: должна ли ссылка в заголовке матча (около 24 px) быть целью 44 px"
    expected: "Либо min-height 44px и проверка в e2e, либо явное исключение в 15-UI-SPEC.md"
    why_human: "UI-SPEC требует 44 px для всех standalone-ссылок, но его же таблица CSS оставляет этой ссылке глобальный стиль; e2e её не измеряет"
  - test: "Исправить дефект фазы 14 (чип «Главная линия», /fixtures/{id}, 320 px, 200% zoom), затем выполнить pnpm verify:release целиком"
    expected: "Весь гейт зелёный, включая полный интеграционный прогон и verify:scanner"
    why_human: "Нужно решение о правке вне фазы 15; полный релизный гейт не запускался"
---

# Фаза 15: 7-Day Value Scanner. Отчёт верификации

**Цель фазы:** пользователь видит один сводный и честный список кандидатов value на ближайшие 7 суток: сохранённые edge из квитанций байт в байт, честное понижение по свежести, явные состояния «пусто» и «недоступно», без рейтинга по edge, с правилами ответственной игры и без N+1.

**Проверено:** 2026-11-28, HEAD `5ed66c5` (main)
**Статус:** gaps_found
**Повторная верификация:** нет, первичная

**Краткий вывод.** Все три критерия успеха ROADMAP и SCAN-01..SCAN-03 подтверждены кодом и тестами, запущенными верификатором. Единственный FAILED относится не к цели фазы, а к локальному решению D-11 о клиентском пакете: отклонение маленькое, но реальное. Четыре визуальные backstop-истины верификатор сам не перепроверял.

## Достижение цели

### Наблюдаемые истины

| # | Истина | Статус | Доказательство |
|---|--------|--------|----------------|
| 1 | SC1 / SCAN-01: сводный список на 7 суток по матчам и рынкам: матч, рынок, выбор, edge, EV, источник коэффициентов | VERIFIED | `GET /value/scanner` (`scanner.controller.ts`, `value.module.ts`, `ValueModule` в `app.module.ts`), страница `/scanner`, `scanner-rows.tsx`; интеграционный tracer проходит путь PostgreSQL -> HTTP -> HTML |
| 2 | D-01/D-02: последняя неперекрытая квитанция тройки, фильтр исхода после выбора последней, SCHEDULED, `[now, now+7d)`, ISSUED + PRODUCTION | VERIFIED | SQL в `scanner.service.ts` (CTE `latest`, затем `candidates`); 10 кейсов `selection:` пройдены |
| 3 | SC2: сохранённые edge, EV, вероятности и коэффициенты передаются без пересчёта | VERIFIED | `toItem` копирует строки; в вебе нет `Number`, `toFixed`, `parseFloat`; каждое значение единственный дочерний узел `dd`; тесты parity, tracer, UI с held-out строками |
| 4 | SC2: понижение по свежести (6 ч / 24 ч), блок устаревших, чип «стареют», раскрытый блок при all-stale, пометка «Прогноз обновлён» без скрытия строки | VERIFIED | `classifyOddsFreshness`, `ScannerAvailable` (стабильный фильтр); границы 21599/21600/86400/86401 в unit-тестах |
| 5 | SC2: EMPTY и UNAVAILABLE различимы, разбор ответа fail-closed, плашка POLICY-UNMET внутри EMPTY | VERIFIED | `scanner-view.tsx`, `scanner-types.ts`, `scanner-data.ts`; UI-тесты: 500, 308, не-JSON, лишний и пропущенный ключ, AVAILABLE без строк |
| 6 | SC2: список никогда не рейтинг по edge, нет сортировки и фильтров | VERIFIED | `ORDER BY` по kickoff, матчу, семейству рынка, выбору; интеграционный тест с убывающим и возрастающим edge; static guards |
| 7 | SC3: нет срочности, уверенности и рейтинга; `RiskDisclosure` и верхняя строка во всех трёх состояниях; 18+ в layout | VERIFIED | Прочитаны все тексты `scanner-labels.ts`; `PROHIBITED_RU` в `responsible-copy.test.ts`; независимый grep по поверхности сканера нашёл только одобренную строку |
| 8 | SC3: нет N+1 | VERIFIED | Один `$queryRaw`; тест `no N+1`: ровно 1 SQL-запрос при 1 и 60 кандидатах; страница делает один fetch |
| 9 | Доступ и раскрытие данных: 403 без eligibility, 400 на любой параметр, типизированные 503, нет JSON квитанции в DTO | VERIFIED | `EligibilityGuard`, тест `access`, unit-тесты `getScanner` |
| 10 | Усечение по границе матча, лимит 200, истинный `totalCandidates` | VERIFIED | Два теста `truncation` пройдены |
| 11 | Не-UTC сессия БД не сдвигает окно, моменты и возраст | VERIFIED | Тест `timezone` пройден |
| 12 | D-11 (маршрут): пункт навигации, карточка главной, предложение в методологии; новых клиентских файлов нет | VERIFIED | diff `page.tsx`, `methodology/page.tsx`, `release-navigation.tsx`; в `app/scanner` нет `use client` |
| 13 | CSS-блок `.scanner-*` только на токенах | VERIFIED | `globals.css`; web-тесты `design-tokens` зелёные |
| 14 | `verify:scanner` добавлен в `verify:release`, зависимости и схема БД не менялись | VERIFIED | diff `package.json` только `scripts`; `pnpm-lock.yaml` и `packages/database/prisma` без изменений с `b99004a` |
| 15 | Поправки к UI-SPEC перечислены явно и показаны пользователю | VERIFIED | 6 строк в разделе Amendments; подтверждение пользователя передано вызывающим агентом (выбрал исполнение после показа). Пометки «ожидает подтверждения» в файле не обновлены |
| 16 | Backstop: нет переполнения при 320/375/768/1440 и 200% zoom, light/dark/forced-colors, standalone-ссылки не ниже 44 px | UNCERTAIN (insufficient_spec) | Тесты есть в `value-scanner.spec.ts`, верификатором не запускались. Ссылка в `h3` около 24 px и из замера исключена (`smallTargets`) |
| 17 | Backstop: семь пунктов навигации в одну строку при 768-1023 px | UNCERTAIN (insufficient_spec) | Тест есть, не запускался; потребовалось изменение полей сверх U-09 |
| 18 | Backstop: источник из 80 символов и длинное название команды не обрезаются при 320 px | UNCERTAIN (insufficient_spec) | Тест есть, не запускался; исправление `.scanner-match-head` в коде присутствует |
| 19 | Backstop: axe без нарушений, клавиатурный обход, имена ссылок с суффиксами | UNCERTAIN (insufficient_spec) | Тесты есть, не запускались; суффиксы в разметке подтверждены unit-тестами |
| 20 | D-11 (пакет): клиентский пакет не растёт, `scriptTransferBytes` не выше 5 960 160 | FAILED | См. раздел «Разрывы» |

**Оценка:** 15/20 подтверждено, 4 требуют проверки человеком, 1 не выполнена.

### Артефакты и связи

| Артефакт | Статус | Замечание |
|----------|--------|-----------|
| `packages/domain/src/value/scanner.ts` | VERIFIED | Содержательный, используется сервисом |
| `apps/api/src/modules/value/scanner.service.ts`, `scanner.controller.ts` | VERIFIED | Подключены через `ValueModule` |
| `apps/web/app/scanner/` (page, data, types, labels, rows, view) | VERIFIED | page -> `readScanner` -> `parseScannerResponse` -> `ScannerView` -> `ScannerAvailable` |
| Навигация, главная, методология | VERIFIED | Импортируют константы и ведут на `/scanner` |
| Тесты, стаб, конфиг Playwright, `deferred-items.md` | VERIFIED (существуют и подключены) | Playwright-часть не исполнялась верификатором |

### Поток данных (уровень 4)

Производственные писатели совпадают с тем, что читает сканер (проверено по коду, отдельным тестом через эти писатели не прогонялось: фазовые тесты сеют строки хелпером той же формы):

- `value.service.ts` `insertReceipt` пишет `receipt: value` целиком, значит пути `receipt -> 'reasons'`, `{receipt,valuePolicyVersion}`, `{receipt,extended,edgeDefinition|evPolicyVersion}` верны;
- `extended-decision.ts` кладёт `edgeDefinition` и `evPolicyVersion` только в блок АГ;
- `odds.service.ts` пишет `source`, `submittedAt`, `receipt.capturedAt` и строки `ManualOddsSelection` (уникальны по снимку и выбору, соединение не множит строки).

Статус: FLOWING.

### Проверки, запущенные верификатором

| Команда | Результат |
|---------|-----------|
| `pnpm exec vitest run --project unit` | 94 файла, 1651 тест пройден, код выхода 0 |
| 7 файлов сканера, копирайта, CLV и главной (проект unit) | 149 пройдено |
| `pnpm --filter @bet-stats/web test` | 14 файлов, 304 пройдено |
| `tests/integration/scanner-api.test.ts` (одноразовый PostgreSQL) | 18 из 18; контейнер удалён, dev-контейнеры не затронуты |

Не запускались верификатором: Playwright (оба конфига и live-спек), `typecheck`, `lint`, `build`, `perf-audit`, полный интеграционный набор, `verify:release`. Результаты по ним есть только в 15-05-SUMMARY.md. Скриптовые probe-файлы фазой не объявлены.

### Покрытие требований

| Требование | Планы | Статус | Доказательство |
|------------|-------|--------|----------------|
| SCAN-01 | 15-01..15-05 | SATISFIED | Истины 1, 2, 10, 12 |
| SCAN-02 | 15-01..15-03, 15-05 | SATISFIED | Истины 3-6 |
| SCAN-03 | 15-01, 15-03..15-05 | SATISFIED | Истины 7, 8 |

Осиротевших требований нет. В `REQUIREMENTS.md` все три ещё помечены Pending (учётная запись, обновляется оркестратором).

Решения D-01..D-10, D-12, D-13 выполнены. D-11 выполнено по маршруту, навигации и отсутствию клиентского кода в `app/scanner`, не выполнено по размеру пакета.

## Разрывы

### D-11: рост клиентского пакета (FAILED)

D-11 дословно: «Клиентский JS новый не добавляется: ... страница не должна увеличивать клиентский пакет и не импортирует барель `@bet-stats/domain` на клиенте».

- Выполнено: в `apps/web/app/scanner` нет клиентских директив и не-type импортов бареля.
- Не выполнено: «не должна увеличивать клиентский пакет». В существующей сборке (`apps/web/.next`, BUILD_ID 2026-11-27 20:10) чанк `3px-fm_6vj7dw.js`, на который ссылаются клиентские манифесты `/fixtures/[fixtureId]`, `/internal/operations`, `/internal/reconciliation` и `/teams/[teamId]/evidence`, содержит `scanner-freshness-v1` и оба списка порядка: **237 байт**, которых без этой фазы не было.
- Измерение исполнителя: 5 960 540 против границы 5 960 160 (+380). Из них 237 байт объясняются константами; пункт навигации и более поздняя разметка фильтра вместе дают 75 (по данным исполнителя); остаток не атрибутирован.
- Предпосылка плана «сканер не добавляет клиентский JS» неточна. Пункт навигации в клиентском компоненте требуется самим D-11, поэтому его байты разрывом не считаются; константы доменного модуля не требовались.
- Бюджет 5 500 000 превышен ещё до фазы; это не вина фазы 15.

Влияние на пользователя пренебрежимо мало. **Похоже на приемлемое отклонение.** Чтобы принять его, добавьте во frontmatter:

```yaml
overrides:
  - must_have: "D-11: страница сканера не увеличивает клиентский пакет; scriptTransferBytes не выше 5 960 160 (фазовый гейт плана 15-05)"
    reason: "Несколько сотен байт констант доменного модуля на фоне бюджета, превышенного до фазы"
    accepted_by: "{имя}"
    accepted_at: "{ISO-время}"
```

Альтернатива: малая правка (аннотации `/*#__PURE__*/` или вывод значений из клиентского чанка) и повторный `perf-audit`. Эффект аннотаций не измерялся.

## Классификация пунктов, заявленных планом 15-05

| # | Пункт | Классификация |
|---|-------|---------------|
| 1 | `release-accessibility`, «200 percent text zoom», чип «Главная линия», +22 px | **Существующий дефект фазы 14, не разрыв фазы 15.** Чип появился в `3fe9636` (14-04), предке стартового коммита фазы `b99004a`. После `b99004a` не менялись `extended-markets-sections.tsx`, `responsive-evidence.tsx` и правила `.state-chip`; CSS фазы 15 это только классы `.scanner-*` и поля навигации для 768-1023 px, не действующие при 320 px. Оговорка: воспроизведения исполнителя на `b8eae11` и `41b83d0` оба уже содержат планы 15-01..15-04 и сами по себе давность не доказывают; вывод опирается на статический анализ, на `b99004a` тест не запускался. Следствие подтверждено по `package.json`: цепочка через `&&` останавливает `verify:release` до `verify:scanner`. Поздние фазы дефект явно не покрывают, поэтому он не отложен, а открыт |
| 2 | `scriptTransferBytes` +380 | **Нарушение D-11 (малое)**, см. «Разрывы» |
| 3 | Поля ссылок навигации `--space-2` и подпись «Сканер» | Подпись «Сканер» это предусмотренный запасной вариант U-09, не отклонение. Изменение полей **выходит за план и UI-SPEC** (общий стиль навигации вне блока `.scanner-*`); высота 44 px сохраняется. **Нужно решение пользователя** |
| 4 | Один интеграционный сбой первого прогона | **Окружение:** `replay-crash-recovery.test.ts` форкает `workers/data-sync/dist`, CI собирает его заранее, фаза код воркера не меняла. Повторно прогонялись только два файла; полного зелёного прогона после сборки нет. Верификатор перепрогнал только `scanner-api` |
| 5 | Ручная проверка `/scanner` при 320 px в обеих темах | **Не выполнена**, пункт для человека |
| 6 | Полный `pnpm verify:release` | **Не запускался**; из-за пункта 1 сейчас не может пройти до конца |

## Предупреждения и информация

| Файл | Наблюдение | Серьёзность |
|------|------------|-------------|
| `globals.css`, `value-scanner.spec.ts` | Ссылка в заголовке матча ниже 44 px и исключена из замера; WCAG 2.2 AA (24 px) при этом, вероятно, соблюдён | Предупреждение |
| `.github/workflows` | `verify:scanner` не входит в CI (план CI не менял) | Информация |
| `15-UI-SPEC.md`, `deferred-items.md` п. 9 | Пометки «ожидает подтверждения пользователя» устарели; U-09 всё ещё называет длинную подпись основной | Информация |
| `scanner.service.ts` | Линии АГ упорядочены лексикографически по идентификатору рынка (-0.25, -0.5, ..., -1): детерминированно и не по edge, но не по числу | Информация |
| `scanner.service.ts` | «Проверено квитанций» считает последние квитанции по тройкам, а не все строки окна | Информация |
| Политика value | Привязана к `forecast-config-v1`: на реальных данных страница может быть EMPTY; живой AVAILABLE проверяется на посеянных данных | Информация |

Маркеров TBD, FIXME, XXX, TODO, HACK, PLACEHOLDER в изменённых фазой файлах не найдено.

## Нужна проверка человеком

1. `pnpm verify:scanner`: ожидается 31 из 31 (закрывает истины 16-19, кроме вопроса о ссылке в заголовке).
2. Живой просмотр `/scanner` при 320 px в обеих темах на посеянных данных, сверка с UI-SPEC. Live-спек оставляет строки в БД из `DATABASE_URL`, используйте одноразовую.
3. Решение по полям навигации при 768-1023 px.
4. Решение по размеру ссылки в заголовке матча.
5. Исправление дефекта фазы 14, затем полный `pnpm verify:release`.

Поправки UI-SPEC повторного подтверждения не требуют (подтверждены, по сообщению вызывающего агента).

---

_Проверено: 2026-11-28T03:07:03Z_
_Verifier: Claude (gsd-verifier)_
