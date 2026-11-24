---
phase: 13-clv-price-diary
plan: 02
subsystem: database/api/operator-cli
tags: [clv, closing-odds, append-only, idempotency, operator-guard, nestjs, prisma, cli]

requires:
  - phase: 13-01
    provides: validateClosingOddsBook и closingObservationId (чистая доменная валидация набора закрывающих коэффициентов)
provides:
  - createPrismaClosingOddsRepository.recordClosingOddsBook (CLV-01, append-only запись набора одной транзакцией)
  - POST internal/closing-odds за OperatorGuard (201/200/409/422/400/404)
  - scripts/closing-odds.mjs record (операторский CLI на том же репозитории)
affects: [13-03 read-time CLV in candidates, 13-04 methodology]

plan_head_before: 18403b01be3b0b88d97410d700e7c15c2952d5cb
plan_head_after: 8ba69ee1ef92ebbcf7b81f6074534935e9608613

actuals:
  tokens: 13500
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Допуск решает чистая доменная функция по фактам, прочитанным репозиторием (начало матча, наличие расчётной квитанции) и серверным часам; клиент времени и состояния не задаёт"
    - "Запись набора: транзакция + pg_advisory_xact_lock по матчу, детерминированные id, повтор сравнивается построчно"
    - "Репозиторий бросает типизированную ошибку с code; сервис маппит конфликт в 409, отказы в 422, остальное не трогает"
    - "CLI: экспортируемые parseRecordArguments и runClosingOddsCommand, DB-зависимый импорт только внутри main()"

key-files:
  created:
    - packages/database/src/closing-odds-repository.ts
    - apps/api/src/modules/closing-odds/closing-odds.module.ts
    - apps/api/src/modules/closing-odds/closing-odds.controller.ts
    - apps/api/src/modules/closing-odds/closing-odds.service.ts
    - scripts/closing-odds.mjs
    - tests/integration/closing-odds-repository.test.ts
    - tests/integration/closing-odds-api.test.ts
  modified:
    - packages/database/src/index.ts
    - apps/api/src/app.module.ts

key-decisions:
  - "Повтор после начала матча отклоняется (RECORDED_AFTER_KICKOFF), даже если набор уже записан: допуск проверяется до сравнения с существующими строками, путь записи закрыт целиком"
  - "Коды: 201 создано, 200 повтор, 409 конфликт, 422 отказ сервера с кодом в теле (включая FIXTURE_NOT_FOUND, чтобы 404 оставался только ответом охраны), 400 структурные ошибки тела (INVALID_CLOSING_ODDS_BODY/KEYS/SELECTIONS), 503 без базы"
  - "Частично существующий набор (строки вставлены вне этого пути) достраивается недостающими строками, если коэффициенты совпадают; при расхождении любой строки конфликт и откат"
  - "sourceConvention проверяется по D-02: должен совпадать с source хотя бы одного ManualOddsSnapshot (глобально, не по матчу)"

requirements-completed: [CLV-01, CLV-03]

duration: 21min
completed: 2026-11-24
status: complete

coverage:
  - id: D1
    description: "recordClosingOddsBook записывает полный набор одного рынка одной транзакцией с детерминированными id, observationKind MARKET_CLOSE, oddsFormat DECIMAL; откат при сбое посередине, ничего не пишется при неполном наборе"
    requirement: CLV-01
    verification:
      - kind: integration
        ref: "tests/integration/closing-odds-repository.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Запись отклоняется после начала матча, при observedAt не раньше начала матча или в будущем, по рассчитанному матчу, по неизвестному матчу и источнику; решение принимает сервер по данным базы и своим часам"
    requirement: CLV-03
    verification:
      - kind: integration
        ref: "tests/integration/closing-odds-repository.test.ts#rejects with %s on a server-side decision and writes nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "Идемпотентность и исправления: повтор возвращает существующие строки, тот же ключ с другим коэффициентом даёт CLOSING_OBSERVATION_CONFLICT без записи, исправление с более поздним observedAt добавляется и побеждает; UPDATE и DELETE отклоняет триггер; параллельные одинаковые запросы дают одну запись"
    requirement: CLV-03
    verification:
      - kind: integration
        ref: "tests/integration/closing-odds-repository.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Запись не меняет ManualOdds*, ValueReceipt, ValueSettlement, ForecastSnapshot, ForecastMarket, SettlementReceipt, ResultVersion (счётчики строк до и после)"
    requirement: CLV-03
    verification:
      - kind: integration
        ref: "tests/integration/closing-odds-repository.test.ts#never touches manual odds, value receipts, value settlements, forecasts or settlement tables"
        status: pass
    human_judgment: false
  - id: D5
    description: "POST internal/closing-odds закрыт OperatorGuard (404 без учётных данных), строгий разбор тела, коды 201/200/409/422/400, Cache-Control private no-store, observationKind от клиента не принимается"
    requirement: CLV-01
    verification:
      - kind: integration
        ref: "tests/integration/closing-odds-api.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "CLI scripts/closing-odds.mjs record: разбор аргументов, сообщения и отказы по-русски, запись набора, «Уже записано» на повторе, конфликт с кодом выхода 1, работа как отдельный процесс"
    requirement: CLV-01
    verification:
      - kind: integration
        ref: "tests/integration/closing-odds-api.test.ts#closing odds CLI"
        status: pass
    human_judgment: false
---

# Phase 13 Plan 02: Closing odds write path Summary

**Операторская запись закрывающих коэффициентов: репозиторий с транзакционной append-only вставкой полного набора, маршрут `POST internal/closing-odds` за `OperatorGuard` и CLI `scripts/closing-odds.mjs`, все три над одним репозиторием; допуск решает сервер по данным базы, повтор идемпотентен, конфликт цены откатывается.**

## Performance

- **Duration:** 21 min (2026-11-24T20:58:02Z - 2026-11-24T21:19:05Z)
- **Tasks:** 3 (2 TDD, 1 auto)
- **Files:** 7 created, 2 modified, миграций нет, схема не менялась

## Accomplishments

- `createPrismaClosingOddsRepository({ database, clock? }).recordClosingOddsBook(input)`: в одной транзакции берёт `pg_advisory_xact_lock` по матчу, читает `kickoffUtc` и наличие `SettlementReceipt`, вызывает `validateClosingOddsBook` с серверными часами, проверяет источник (D-02), сравнивает существующие строки по детерминированным id и вставляет недостающие. Возвращает `{ created, observations }` в порядке рынка либо бросает типизированную ошибку (`code`).
- Маршрут `POST internal/closing-odds`: `@UseGuards(OperatorGuard)` на контроллере, структурный разбор тела (только `fixtureId, market, sourceConvention, observedAt, selections`; `observationKind`, `oddsFormat` и любые другие ключи дают 400), 201/200/409/422, `Cache-Control: private, no-store, max-age=0`. Контроллер в базу не пишет.
- CLI `node scripts/closing-odds.mjs record --fixture ... --market ... --source ... --observed-at ... --odds HOME=2.10,DRAW=3.40,AWAY=3.60`: печатает «Записано» или «Уже записано», отказы по-русски с кодом, коды выхода 0/1/2; `DATABASE_URL` читается только из окружения, `.env` не читается; справка и ошибки параметров работают без базы.
- Тесты: 17 на настоящем PostgreSQL 18 в контейнере (репозиторий) и 44 в `closing-odds-api.test.ts` (маршрут, парсер CLI, CLI на одноразовой БД, включая запуск отдельным процессом). Контейнеры удаляются через `docker rm --force --volumes`, после прогона не осталось.

## Task Commits

| Задача | Фаза | Коммит |
|--------|------|--------|
| 1 recordClosingOddsBook | RED | `4eace09` test(13-02) |
| 1 | GREEN | `6c553a2` feat(13-02) |
| 2 POST internal/closing-odds | RED | `6434c9d` test(13-02) |
| 2 | GREEN | `449d1f4` feat(13-02) |
| 3 CLI | auto | `8ba69ee` feat(13-02) |

## TDD Gate Compliance

- Task 1 RED: целевой тест `records a complete 1X2 set in one transaction ...` упал на `expect(result.created).toBe(true)` (заглушка репозитория ничего не пишет); `check tdd-red-evidence` вернул `RED_EVIDENCE_OK`. Семантическая оценка: контейнер поднялся, миграции применены, фикстуры и расчётная квитанция заведены (`beforeAll` прошёл), цель выполнилась и упала на запланированном утверждении, не на импорте или фикстуре. Запись: `evidence/13-02-t1-red.json`.
- Task 2 RED: целевой тест `answers 201 with the stored rows ...` упал на `expect(reply.status).toBe(201)` (заглушка сервиса не вызывает репозиторий, ответ 200). `RED_EVIDENCE_OK`. Запись: `evidence/13-02-t2-red.json`. Первая попытка RED упала на `Cannot find package '@nestjs/common'` из `tests/` (ошибка загрузки, то есть недействительный RED); тест исправлен (исключения HTTP проверяются по утиной типизации), RED записан заново и только затем принят классификатором.
- REFACTOR не потребовался.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Проверка источника по D-02**
- **Found during:** Task 1
- **Issue:** Решение D-02 требует, чтобы `sourceConvention` был существующим именем источника ручных коэффициентов, но ни доменная валидация 13-01, ни задачи плана этого не покрывают. Закрывающая цена с опечаткой в источнике никогда не сопоставится с кандидатом и тихо испортит CLV.
- **Fix:** репозиторий отклоняет запись кодом `UNKNOWN_SOURCE_CONVENTION`, если нет ни одного `ManualOddsSnapshot` с таким `source`; проверка идёт после доменной валидации, чтобы порядок кодов 13-01 не менялся. Код добавлен в 422-набор сервиса и в русские пояснения CLI.
- **Files modified:** packages/database/src/closing-odds-repository.ts, apps/api/src/modules/closing-odds/closing-odds.service.ts, scripts/closing-odds.mjs
- **Commit:** `6c553a2`, `449d1f4`, `8ba69ee`

**2. [Rule 2 - Missing critical] Код FIXTURE_NOT_FOUND и защита от пустого fixtureId**
- **Issue:** валидатор 13-01 не знает, существует ли матч; а 404 в маршруте должен означать только отказ охраны.
- **Fix:** `FIXTURE_NOT_FOUND` отдаётся как 422 с кодом в теле; пустой или слишком длинный `fixtureId` отклоняется тем же кодом до обращения к базе.
- **Commit:** `6c553a2`, `449d1f4`

### Решения по неоднозначностям плана (не отклонения от контракта)

- Повтор после начала матча отклоняется (см. key-decisions): путь записи закрыт целиком, идемпотентность действует только в окне приёма.
- Структурные ошибки тела дают 400 (по образцу `odds.service.ts`), отказы по смыслу (время, состояние, полнота) дают 422 с кодом.
- Тест маршрута вызывает контроллер напрямую с поддельным ответом (как `model-comparison-api.test.ts`): `@nestjs/testing` и `supertest` в репозитории не установлены, новых зависимостей не добавлено.
- CLI-тест перед запуском отдельного процесса пересобирает `packages/domain` и `packages/database` через `tsc` (иначе скрипт загрузил бы устаревший `dist`); `dist` игнорируется git.

**Total deviations:** 2 auto-fixed (Rule 2). **Impact:** закрытый набор кодов отказа расширен на два значения, остальной контракт плана соблюдён полностью.

## Authentication Gates

None.

## Known Stubs

None. Заглушки RED-фаз заменены реализацией в GREEN-коммитах.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-network-endpoint | apps/api/src/modules/closing-odds/closing-odds.controller.ts | Новый операторский POST `internal/closing-odds` с телом; закрыт OperatorGuard (fail-closed 404), без подписанного прокси оператора (прокси `internal/operations/*` без тела), не добавлен в шлюз `apps/web` |

## Issues Encountered

- Предсуществующие предупреждения eslint в `apps/web` (9 warnings, 0 errors) относятся к другим файлам и не тронуты.

## Next Phase Readiness

Готово к 13-03: наблюдения доступны в таблице `ClosingOddsObservation`; `packages/database/src/index.ts` уже экспортирует репозиторий записи, 13-03 добавляет рядом чтение для расчёта CLV на лету. Запись не трогает таблицы ранжирования и квитанций (проверено счётчиками), что нужно для структурной границы D-05.

## Self-Check: PASSED

- Файлы созданы: closing-odds-repository.ts, closing-odds.module.ts, closing-odds.controller.ts, closing-odds.service.ts, closing-odds.mjs, оба интеграционных теста: FOUND.
- Коммиты 4eace09, 6c553a2, 6434c9d, 449d1f4, 8ba69ee: FOUND (предки HEAD).
- `pnpm vitest run --project integration tests/integration/closing-odds-repository.test.ts` 17 passed; `tests/integration/closing-odds-api.test.ts` 44 passed.
- `pnpm typecheck`: 7 задач успешно. `pnpm lint`: 0 errors (9 предсуществующих warnings в apps/web).
- Миграций и изменений схемы нет (`git diff 18403b0..HEAD --name-only` без prisma).
