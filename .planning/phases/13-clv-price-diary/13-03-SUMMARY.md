---
phase: 13-clv-price-diary
plan: 03
subsystem: database/api/evaluation
tags: [clv, no-vig, read-time, evaluation-only, import-graph, invariance, prisma, postgres]

requires:
  - phase: 13-01
    provides: calculateNoVigClv, политика no-vig-clv-v1 (чистый расчёт и закрытый набор причин)
  - phase: 13-02
    provides: ClosingOddsObservation append-only запись (репозиторий, маршрут, CLI)
provides:
  - readNoVigClvForCandidates (CLV-02, чтение no-vig CLV по странице кандидатов двумя запросами, ничего не пишет)
  - listValueCandidates отдаёт clvNoVig рядом с замороженным clv, обе политики с метками версии
  - tests/unit/clv-evaluation-only.test.ts (D-05a, граф импортов на уровне символов)
  - tests/integration/clv-ranking-invariance.test.ts (D-05b, список и порядок кандидатов не зависят от наблюдений закрытия)
affects: [13-04 UI/methodology/operator docs]

plan_head_before: ab68c738c4263ba7cbe65e1a703e12b26ded05ea
plan_head_after: dc069bbbe60546d5dd3a1dfac6b794e66a2efef6

actuals:
  tokens: 14400
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Чтение на лету: кандидатный набор из ManualOddsSnapshot, набор закрытия того же источника на последнем observedAt до начала матча; пригодность решает чистый calculateNoVigClv, а не фильтры запроса"
    - "Два findMany на страницу независимо от числа кандидатов; запрос закрытий ограничен парами (матч, рынок) страницы"
    - "Структурная граница: обход импортов на уровне символов (barrel и re-export проходятся по определяющему модулю), красное доказательство на синтетических графах"
    - "Сеялка тестов tests/helpers/clv-read-seed.ts: расчётные кандидаты и закрытия вставляются сырым SQL в обход операторского пути"

key-files:
  created:
    - packages/database/src/evaluation/no-vig-clv-reader.ts
    - tests/helpers/clv-read-seed.ts
    - tests/integration/no-vig-clv-reader.test.ts
    - tests/unit/clv-evaluation-only.test.ts
    - tests/integration/clv-ranking-invariance.test.ts
  modified:
    - packages/database/src/index.ts
    - apps/api/src/modules/evaluation/evaluation.service.ts
    - tests/integration/evaluation-api.test.ts

key-decisions:
  - "Закрытие берётся как набор строк одного источника на последнем observedAt до начала матча; поздние строки (после начала матча) и строки другого рынка в выборку не попадают. Если у источника кандидата закрытий нет, а у другого источника есть, последний чужой набор передаётся только в calculateNoVigClv, чтобы тот вернул SOURCE_CONVENTION_MISMATCH; значение из него никогда не считается"
  - "Нижняя граница по времени подачи кандидата не стоит в запросе: самый поздний набор старше подачи даёт CLOSING_BEFORE_CANDIDATE вместо безликого CLOSING_SET_MISSING; доступность совпадает с замороженным правилом конвейера"
  - "К замороженному clv добавлено только поле policyVersion (значение из clvPolicyVersion квитанции); status, reason, value не менялись"
  - "Граф импортов проверяется на уровне символов: barrel-пакеты грузят все модули при выполнении, поэтому значима только цепочка имён до определяющего модуля; namespace, side-effect, dynamic import и require считаются пессимистично целиком"

requirements-completed: [CLV-03]

duration: 22min
completed: 2026-11-24
status: complete

coverage:
  - id: D1
    description: "readNoVigClvForCandidates: AVAILABLE на полном наборе, побеждает последний набор до начала матча того же источника (после начала матча, чужой источник и соседний рынок игнорируются); значение не достраивается"
    requirement: CLV-02
    verification:
      - kind: integration
        ref: "tests/integration/no-vig-clv-reader.test.ts#is AVAILABLE on a complete set and uses the latest pre-kickoff closing set of the same source"
        status: pass
    human_judgment: false
  - id: D2
    description: "Типизированные причины UNAVAILABLE: CLOSING_SET_MISSING, CLOSING_SET_INCOMPLETE, SOURCE_CONVENTION_MISMATCH, CLOSING_BEFORE_CANDIDATE, CANDIDATE_SET_INCOMPLETE; без поля value"
    requirement: CLV-02
    verification:
      - kind: integration
        ref: "tests/integration/no-vig-clv-reader.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Страница кандидатов несёт clv (odds-ratio-clv-v1, смысл прежний) и clvNoVig (no-vig-clv-v1); число операций Prisma на страницу не растёт с числом кандидатов; чтение не пишет"
    requirement: CLV-02
    verification:
      - kind: integration
        ref: "tests/integration/no-vig-clv-reader.test.ts#extends listValueCandidates with clvNoVig while the frozen clv field keeps its meaning"
        status: pass
      - kind: integration
        ref: "tests/integration/no-vig-clv-reader.test.ts#issues a constant number of queries regardless of the number of candidates"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ранжирование value, генерация кандидатов и любые модули scanner/journal не достигают clv.ts, no-vig-clv.ts, closing-odds.ts, closing-odds-repository.ts, no-vig-clv-reader.ts и не читают ClosingOddsObservation напрямую; красное доказательство на синтетических графах"
    requirement: CLV-03
    verification:
      - kind: unit
        ref: "tests/unit/clv-evaluation-only.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Список кандидатов, порядок, итоги страниц, замороженный clv и все защищённые таблицы побайтно одинаковы до и после записи сильно двигающегося закрытия; аннотация clvNoVig при этом меняется; тест чувствителен к утечке аннотации в порядок (проверено мутацией)"
    requirement: CLV-03
    verification:
      - kind: integration
        ref: "tests/integration/clv-ranking-invariance.test.ts"
        status: pass
    human_judgment: false
---

# Phase 13 Plan 03: Read-time no-vig CLV and evaluation-only guarantee Summary

**CLV без маржи (`no-vig-clv-v1`) считается на чтении по каждому кандидату value двумя запросами на страницу и отдаётся рядом с замороженным `odds-ratio-clv-v1`; граница evaluation-only закреплена тестом на графе импортов по символам и поведенческим тестом побайтовой неизменности списка кандидатов.**

## Performance

- **Duration:** ~22 min (2026-11-24, оценка по меткам прогонов)
- **Tasks:** 3 (3 TDD)
- **Files:** 5 created, 3 modified, миграций нет, схема не менялась

## Accomplishments

- `readNoVigClvForCandidates(client, candidates)`: один `findMany` по `ManualOddsSnapshot` страницы и один по `ClosingOddsObservation` для пар (матч, рынок) страницы. Набор кандидата берётся из его снимка (`observedAt = submittedAt`), набор закрытия: строки источника кандидата на последнем `observedAt` до начала матча. Годность набора решает `calculateNoVigClv`; в ответе `AVAILABLE` с `value`, обеими справедливыми вероятностями, `closingObservedAt`, `source`, либо `UNAVAILABLE` с типизированной причиной.
- `listValueCandidates` добавляет `clvNoVig` и `clv.policyVersion`; существующие поля `clv.status/reason/value` не менялись, замороженные строки `ValueSettlement` и триггеры не тронуты, схема не менялась.
- Тест D-05a: обход импортов от корней (домен `value/`, API `value/` и `odds/`, любой путь с `scanner` или `journal`) по символам: barrel и `export { } from`/`export *` проходятся до определяющего модуля, namespace/side-effect/dynamic/`require` считаются целиком. Проверка не вакуумная: тест требует найти пять запрещённых модулей и обязательные корни. Дополнительно: ни один корень не упоминает `closingOddsObservation`.
- Тест D-05b: на реальном PostgreSQL 18 четыре расчётных кандидата (два с общим `settledAt`, чтобы работал tie-break по id) и один открытый; после записи сильно двигающегося закрытия (через операторский репозиторий для открытого матча, сырой вставкой для расчётных) список, порядок, итоги страниц, замороженный `clv` и полные дампы семи таблиц побайтно те же, `clvNoVig` меняется, счётчики девяти таблиц те же.
- Мутационные проверки: (1) сортировка страницы по `clvNoVig` в `listValueCandidates` делает D-05b красным; (2) импорт `calculateNoVigClv` в `value.service.ts` делает D-05a красным на реальном коде. Обе мутации откатены `git checkout --`.

## Task Commits

| Задача | Фаза | Коммит |
|--------|------|--------|
| 1 читатель no-vig CLV | RED | `9e2d2a1` test(13-03) |
| 1 | GREEN | `06f3a96` feat(13-03) |
| 2 структурная защита | RED | `40c3bdf` test(13-03) |
| 2 | GREEN | `5a83415` feat(13-03) |
| 3 инвариантность ранжирования | behavior lock | `dc069bb` test(13-03) |

## TDD Gate Compliance

- Task 1 RED: цель `is AVAILABLE on a complete set ...` упала на `expect(ok.status).toBe("AVAILABLE")` (заглушка читателя возвращает `CLOSING_SET_MISSING`); `check tdd-red-evidence` вернул `RED_EVIDENCE_OK`. Семантическая оценка: контейнер поднялся, миграции применены, шесть кандидатов засеяны и рассчитаны (`beforeAll` прошёл), цель выполнилась и упала на запланированном утверждении. Две более ранние попытки падали в `beforeAll` на защитах базы (форма `receipt` снимка, производные поля `ValueReceipt`), а одна на многострочном diff, который разбор TAP отвергает; сеялка исправлена, утверждение сделано скалярным, RED записан заново и принят. Запись: `evidence/13-03-t1-red.json`.
- Task 2 RED: цель `flags a root that imports a CLV function through the package barrel` упала на `expected [] to have a length of 1 but got +0` (анализатор-заглушка не находит нарушений); `RED_EVIDENCE_OK`. Запись: `evidence/13-03-t2-red.json`.
- Task 3: тест фиксирует свойство, которое уже верно по построению (нет пути от CLV к ранжированию), поэтому честный RED («функции нет») невозможен: тест зелёный сразу. Чувствительность доказана мутацией (см. выше): первая версия теста с одинаковой аннотацией у всех кандидатов мутацию не ловила, поэтому доказательство добавлено только для c1 и c3, и аннотация стала смешанной по списку; затем мутация дала красный результат. Это отклонение от формулы RED/GREEN, а не нарушение: коммит один (`test`), без production-кода.
- REFACTOR не потребовался.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Метка версии на замороженном `clv`**
- **Found during:** Task 1
- **Issue:** Истина плана требует, чтобы обе политики несли метку версии, но поле `clv` строки кандидата метки не имело (`clvPolicyVersion` хранится в `ValueSettlement`, но не отдавалась).
- **Fix:** в `clv` добавлено `policyVersion` из `clvPolicyVersion`; смысл `status/reason/value` не изменён. Макетные строки `tests/integration/evaluation-api.test.ts` дополнены новыми полями ради типов.
- **Files modified:** apps/api/src/modules/evaluation/evaluation.service.ts, tests/integration/evaluation-api.test.ts
- **Commit:** `06f3a96`

### Решения по неоднозначностям плана (не отклонения от контракта)

- Нижняя граница «не раньше времени подачи» выражена не фильтром запроса, а выбором последнего набора до начала матча и проверкой порядка меток в `calculateNoVigClv`: доступность та же, что у замороженного правила конвейера, причина точнее (`CLOSING_BEFORE_CANDIDATE`).
- «Чужой источник» даёт `SOURCE_CONVENTION_MISMATCH` (не `CLOSING_SET_MISSING`): запрос берёт закрытия матча и рынка всех источников, чужой набор нужен только для выдачи причины.
- «Число SQL-запросов не растёт» измеряется на уровне операций Prisma (`$extends` с `$allOperations`): клиент создаётся без хука `query`-логов, подменять фабрику клиента ради теста не стали. Читатель делает ровно два `findMany` и при 3 и при 30 кандидатах.
- Созданы файлы вне списка плана: `tests/helpers/clv-read-seed.ts` (общая сеялка для двух интеграционных тестов).
- D-05b сравнивает сериализацию БЕЗ поля `clvNoVig`: это единственная часть ответа, которая по определению зависит от наблюдений; всё остальное, включая порядок, итоги и замороженный `clv`, сравнивается побайтно.
- CLV-02 в `REQUIREMENTS.md` не отмечен: требование говорит «пользователь видит», а видимый пользователю вывод (панель кандидатов, методология) относится к 13-04, где CLV-02 тоже в `requirements`. Этот план закрывает вычисление и контракт API. CLV-03 уже отмечен после 13-02; проверено: доказательства этого плана (D4, D5) подтверждают отметку, снимать её не нужно.

**Total deviations:** 1 auto-fixed (Rule 2). **Impact:** аддитивное поле в ответе, остальной контракт плана соблюдён полностью.

## Authentication Gates

None.

## Known Stubs

None. Заглушки RED-фаз заменены реализацией в GREEN-коммитах.

## Threat Flags

None: новых сетевых точек и путей авторизации нет; читатель только читает и доступен только evaluation-коду (структурно закреплено тестом). Ответ `GET`-списка кандидатов за существующим `EligibilityGuard` получил два аддитивных поля.

## Issues Encountered

- Ограничение проверки D-05a: анализ на уровне символов и статический; динамическое имя модуля в `import(variable)` не разрешается и в граф не попадает (на текущем коде таких нет). Алиасы путей `apps/web` отсутствуют, поэтому дополнительной карты не нужно.
- Предсуществующие предупреждения eslint в `apps/web` (9 warnings, 0 errors) относятся к другим файлам и не тронуты.

## Next Phase Readiness

Готово к 13-04: ответ кандидата содержит `clv` (с `policyVersion`) и `clvNoVig` (`status`, `policyVersion`, `value`, `pCandidateFair`, `pCloseFair`, `closingObservedAt`, `source`, `reason`); UI панели кандидатов (`scorecard-dashboard.tsx`) пока читает только `clv`. Методология и операторская документация должны описать две политики и причины недоступности, а UI показывать `clvNoVig` и причины по-русски.

## Self-Check: PASSED

- Файлы созданы: no-vig-clv-reader.ts, clv-read-seed.ts, no-vig-clv-reader.test.ts, clv-evaluation-only.test.ts, clv-ranking-invariance.test.ts: FOUND.
- Коммиты 9e2d2a1, 06f3a96, 40c3bdf, 5a83415, dc069bb: FOUND (предки HEAD).
- `pnpm vitest run --project integration` по `no-vig-clv-reader`, `clv-ranking-invariance`, `evaluation-api`: 17 passed; `--project unit` по `clv-evaluation-only`, `no-vig-clv`, `closing-odds`: 85 passed.
- `pnpm typecheck`: 7 задач успешно. `pnpm lint`: 0 errors (9 предсуществующих warnings в apps/web).
- Контейнеры тестов удалены (`docker ps -a` без `no-vig`, `invariance`, `closing`). Миграций и изменений схемы нет.
