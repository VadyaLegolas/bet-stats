---
phase: 13-clv-price-diary
plan: 04
subsystem: web/methodology/docs/e2e
tags: [clv, no-vig, ui, methodology, model-card, operator-docs, e2e, playwright]

requires:
  - phase: 13-02
    provides: POST /internal/closing-odds и CLI записи наблюдений закрытия (append-only)
  - phase: 13-03
    provides: clvNoVig и clv.policyVersion в строке кандидата; граница evaluation-only
provides:
  - Колонка «CLV без маржи» в реестре кандидатов (значение, версия политики, время и источник закрытия либо русская причина)
  - Русские тексты для всех типизированных причин no-vig-clv-v1 (исчерпывающая проверка типом)
  - model-card-v1.3.0 с блоком clv и записью в истории изменений; раздел #clv на странице методологии
  - docs/closing-odds-operator.md (инструкция оператору)
  - tests/e2e/clv.spec.ts (сквозной сценарий на изолированном стеке 3240/3241)
affects: []

plan_head_before: aa95f4d75275948205e73d17e71920a85a394231
plan_head_after: 1263240d0d8316e5c48c597060fa3899e443a0c3

actuals:
  tokens: 10900
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Тексты причин как Record<NoVigClvUnavailableReason, string>: новая причина в домене ломает компиляцию веба, а не показывается сырым кодом"
    - "Текст карточки модели производится из доменных констант (версии политик, размеры наборов рынков); раздел методологии рендерится из карточки без собственных литералов"
    - "e2e считает ожидаемое CLV независимой формулой в самом тесте, а не продуктовой функцией"

key-files:
  created:
    - docs/closing-odds-operator.md
    - tests/e2e/clv.spec.ts
  modified:
    - apps/web/app/scorecards/scorecard-dashboard.tsx
    - apps/web/app/methodology/page.tsx
    - packages/domain/src/methodology/model-card.ts
    - tests/unit/scorecard-ui.test.tsx
    - tests/unit/model-card.test.ts
    - tests/unit/inner-pages-design-ui.test.tsx
    - tests/e2e/methodology.spec.ts

key-decisions:
  - "Браузерная форма записи закрытия не добавлена: подписанный прокси веб-приложения не передаёт тело запроса (путь без JSON, как у операторских операций), менять прокси вне объёма фазы. Ввод через API и CLI, порядок описан в docs/closing-odds-operator.md"
  - "Замороженное значение odds-ratio-clv-v1 показывается отдельной колонкой с собственной подписью и версией политики; его смысл и формат отображения (сырая строка значения) не менялись"
  - "Значение CLV без маржи выводится как знаковый процент с двумя знаками (минус U+2212), версия политики, время закрытия в зоне отображения (по умолчанию UTC, с подписью зоны) и источник"
  - "Версия карточки поднята один раз до model-card-v1.3.0 (дата 2026-11-24, как у v1.2.0); новый раздел clv стоит между calibration и responsible-use"

requirements-completed: [CLV-02]

duration: ~23min
completed: 2026-11-24
status: complete

coverage:
  - id: D1
    description: "Реестр кандидатов показывает CLV без маржи со значением, версией политики, временем и источником закрытия; значение odds-ratio-clv-v1 остаётся отдельной колонкой с подписью"
    requirement: CLV-02
    verification:
      - kind: unit
        ref: "tests/unit/scorecard-ui.test.tsx#shows the de-vigged value with policy label, closing time and source, and keeps the odds-ratio value under its own label"
        status: pass
      - kind: e2e
        ref: "tests/e2e/clv.spec.ts (строка кандидата с закрытием: независимо вычисленный процент, no-vig-clv-v1, источник, время закрытия UTC, odds-ratio-clv-v1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Для каждой из восьми типизированных причин показан отдельный русский текст, сырой код в интерфейсе не появляется; при отсутствии поля API показано «нет данных»"
    requirement: CLV-02
    verification:
      - kind: unit
        ref: "tests/unit/scorecard-ui.test.tsx (восемь причин, различимые тексты, нет сырых кодов, «нет данных» без поля)"
        status: pass
      - kind: e2e
        ref: "tests/e2e/clv.spec.ts (матч без закрытия: русская причина, нет сырых кодов на странице)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Текст не обещает прибыль и не называет CLV прогнозом; постоянные предупреждения (карточка страницы и нижняя часть сайта) остаются"
    requirement: CLV-02
    verification:
      - kind: unit
        ref: "tests/unit/scorecard-ui.test.tsx#states that CLV is neither a forecast nor a profit promise and keeps the responsible-use warning"
        status: pass
      - kind: e2e
        ref: "tests/e2e/clv.spec.ts (запрещённые формулировки отсутствуют, предупреждение страницы и подвал видимы)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Карточка модели model-card-v1.3.0: определение, способ без маржи, evaluation-only, отказ в поздних записях, ограничения; одна запись в истории; страница методологии показывает раздел #clv"
    requirement: CLV-02
    verification:
      - kind: unit
        ref: "tests/unit/model-card.test.ts#model card CLV block (Phase 13, D-07)"
        status: pass
      - kind: unit
        ref: "tests/unit/inner-pages-design-ui.test.tsx#publishes the CLV section with definition, method, evaluation-only role, late-entry refusal and honest limits"
        status: pass
      - kind: e2e
        ref: "tests/e2e/methodology.spec.ts (раздел #clv, пять записей истории, axe без нарушений)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Сквозной сценарий: запись закрытия оператором через API (404 без ключа, 201, повтор 200, отказ после расчёта 422), расчёт через реальный конвейер, значение CLV на странице результатов, причина для матча без закрытия; на двух проектах браузера"
    requirement: CLV-01
    verification:
      - kind: e2e
        ref: "tests/e2e/clv.spec.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Решение о браузерной форме записано: не добавлена, причина (прокси не передаёт тело) зафиксирована в инструкции оператору и в решениях плана"
    requirement: CLV-01
    verification:
      - kind: unit
        ref: "docs/closing-odds-operator.md (раздел «Как записывать»); отсутствие формы и изменений прокси видно по списку изменённых файлов"
        status: pass
    human_judgment: false
---

# Phase 13 Plan 04: CLV display, methodology and end-to-end check Summary

**Реестр кандидатов показывает CLV без маржи (`no-vig-clv-v1`) со значением, версией политики, временем и источником закрытия либо русской причиной недоступности; карточка модели v1.3.0, раздел методологии, инструкция оператору и сквозной браузерный сценарий закрывают CLV-01..03.**

## Performance

- **Duration:** ~23 min по меткам времени (22:09 - 22:32 UTC, включая сборку и три прогона Playwright)
- **Tasks:** 3 (2 TDD, 1 auto)
- **Files:** 2 created, 7 modified; миграций и изменений схемы нет, подписанный прокси не тронут, порядок и состав кандидатов не менялись

## Accomplishments

- `scorecard-dashboard.tsx`: колонка «CLV без маржи (no-vig-clv-v1)» рядом с колонкой «CLV по коэффициентам (odds-ratio-clv-v1, с маржой)». Значение показывается как знаковый процент, под ним версия политики, время закрытия и источник. Для недоступного значения выводится «CLV без маржи недоступен: <причина по-русски>». Тексты причин заданы как `Record<NoVigClvUnavailableReason, string>`: новая причина в домене не пройдёт компиляцию веба. Под блоком доказательств по закрытию добавлено пояснение: это не прогноз, не обещание прибыли и не рекомендация, значение только оценочное и не влияет на отбор; закрытие вводится вручную из одного источника, выборки малы.
- `model-card.ts`: `model-card-v1.3.0` с блоком `clv` (определение, формула, способ без маржи, evaluation-only, запись и отказ в поздних записях, ограничения), `policies.noVigClv`, раздел `clv` в `MODEL_CARD_SECTION_IDS`, запись в истории изменений. Версии политик и размеры наборов рынков берутся из доменных констант.
- `methodology/page.tsx`: раздел `#clv` рендерится из карточки; в разделе ответственного использования названы обе политики.
- `docs/closing-odds-operator.md`: когда записывать, формат запроса (API и CLI), таблица кодов ответа и отказов, исправление новым наблюдением, ограничения, причина отсутствия браузерной формы.
- `tests/e2e/clv.spec.ts` на изолированном стеке (порты 3240/3241, одноразовые Postgres и Redis): 404 без ключа оператора, 201 и повтор 200, три строки в базе, расчёт двух матчей через реальный `createSettlementPipelineService`, отказ 422 после расчёта, страница результатов точной когорты. Ожидаемое значение CLV считается в тесте независимой формулой. Зелёный на desktop и mobile.

## Task Commits

| Задача | Фаза | Коммит |
|--------|------|--------|
| 1 UI реестра | RED | `dd56b90` test(13-04) |
| 1 | GREEN | `016a79a` feat(13-04) |
| 2 карточка, методология, инструкция | RED | `f9f233f` test(13-04) |
| 2 | GREEN | `43bce7f` feat(13-04) |
| 3 сквозной сценарий | auto | `9485a55` test(13-04) |
| исправление e2e методологии | fix | `1263240` test(13-04) |

## TDD Gate Compliance

- Task 1 RED: 12 из 18 тестов упали на утверждениях о новой колонке и причинах (в разметке нет «CLV без маржи», «нет данных», «не прогноз»); существующие 6 остались зелёными. Команда `check tdd-red-evidence` в этом плане не запускалась, оценка семантическая: тест выполнился и упал на запланированных утверждениях.
- Task 2 RED: 8 тестов упали; часть из-за запланированных утверждений о версии и истории (`expected 'model-card-v1.2.0' to be 'model-card-v1.3.0'`), часть `TypeError` на отсутствующем блоке `MODEL_CARD.clv` (признак отсутствия реализации, не ошибка окружения). `check tdd-red-evidence` не запускалась.
- Task 3: тип `auto`, TDD не требуется.
- REFACTOR не потребовался.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Тесты, привязанные к составу страницы методологии и истории карточки**
- **Found during:** Task 2 (unit) и после Task 3 (e2e методологии)
- **Issue:** `tests/unit/inner-pages-design-ui.test.tsx` фиксирует список заголовков h2, id разделов и «первые семь секций в сетке»; `tests/e2e/methodology.spec.ts` фиксирует список разделов и число записей истории (4). Добавление раздела CLV и записи v1.3.0 ломало их по построению.
- **Fix:** списки и счётчики обновлены (восемь секций в сетке, раздел «Сравнение с закрытием линии (CLV)», пять записей истории), в методологическом e2e добавлены утверждения про `#clv`; в unit-тесте добавлена проверка содержимого раздела.
- **Files modified:** tests/unit/inner-pages-design-ui.test.tsx, tests/e2e/methodology.spec.ts (вне списка плана)
- **Commits:** `43bce7f`, `9485a55`/`1263240`

**2. [Rule 1 - Bug] Регулярное выражение времени в e2e и источник предупреждения**
- **Found during:** Task 3
- **Issue:** формат даты в ru-RU `«24 ноября 2026 г. в 22:23»` (не с запятой), а полная фраза постоянного раскрытия рисков в странице результатов не рендерится (она живёт в подвале и в других страницах).
- **Fix:** регулярное выражение принимает оба разделителя; постоянные предупреждения проверяются по предупреждению страницы и подвалу сайта. Продуктовый код не менялся.
- **Commit:** `9485a55`

### Решения по неоднозначностям плана

- Поле `clvNoVig` в типе строки кандидата сделано необязательным: ответ старого API деградирует до «нет данных», а не ломает страницу. API 13-03 поле присылает всегда.
- Колонка прежнего CLV сохранила прежнее поведение показа значения (сырая строка, например `0.12195121951219512195`); форматирование прежнего значения вне объёма плана.
- В `tests/e2e/clv.spec.ts` кандидаты двух проектов браузера различаются коэффициентами (общий стек и когорта); сидеры `tests/helpers/clv-read-seed.ts` из 13-03 использованы повторно.
- Проверка «ответственное использование остаётся постоянным» в e2e опирается на предупреждение страницы результатов и подвал; фраза `RiskDisclosure` на этой странице исторически не выводится, плана это не меняло.

**Total deviations:** 2 auto-fixed (Rule 3, Rule 1). **Impact:** только тесты; продуктовый контракт плана соблюдён.

## Authentication Gates

None. Ключ оператора в e2e тестовый (`phase-06-operator-credential`, стек Phase 6).

## Known Stubs

None.

## Threat Flags

None: новых сетевых точек, путей авторизации и доступа к файлам нет; вывод только читает поля, уже отдаваемые API за `EligibilityGuard`.

## Issues Encountered

- Предсуществующие предупреждения eslint в `apps/web` (9 warnings, 0 errors) относятся к другим файлам и не тронуты.
- Корневой `tsc -p tsconfig.json` выдаёт TS5110 (module/moduleResolution); это предсуществующая конфигурация, `pnpm typecheck` по пакетам зелёный (7 задач).
- E2E добавляет в одноразовую базу стека два рассчитанных матча лиги `clv-read-league`; при запуске всего набора phase06 они остаются до удаления контейнеров стека. Остальные спецификации их не читают.

## Next Phase Readiness

Фаза 13 завершена: CLV-01..03 закрыты. Оператору нужны только API/CLI; отложены (см. `13-CONTEXT.md`): браузерная форма записи, импорт запоздавших закрытий с меткой, CLV для рынков Фазы 14.

## Self-Check: PASSED

- Файлы созданы: docs/closing-odds-operator.md, tests/e2e/clv.spec.ts: FOUND.
- Коммиты dd56b90, 016a79a, f9f233f, 43bce7f, 9485a55, 1263240: FOUND (предки HEAD).
- `pnpm vitest run --project unit`: 80 файлов, 1199 тестов passed. `pnpm --filter @bet-stats/web test`: 209 passed. `pnpm typecheck`: 7 задач успешно. `pnpm lint`: 0 errors (9 предсуществующих warnings).
- `playwright test tests/e2e/clv.spec.ts --config playwright.phase06.config.ts`: 2 passed (desktop и mobile); `tests/e2e/methodology.spec.ts`: 4 passed.
- Контейнеры стека удалены (`docker ps -a` содержит только dev-контейнеры `football-prediction-platform-*`, не тронутые); dev-БД не затронута.
