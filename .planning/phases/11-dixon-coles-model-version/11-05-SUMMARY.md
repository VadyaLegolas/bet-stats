---
phase: 11-dixon-coles-model-version
plan: 05
subsystem: database
tags: [settlement, postgres, migration, prisma, advisory-lock, gap-closure, MODEL-03]
status: complete
requirements: [MODEL-03]
completed: 2026-11-23
commits: 5
plan_head_before: 8631b0515d535b97d6b164beee30daa5bfa6f801
plan_head_after: b7bbcd2bc3081eac3156e1846224bd357d12b48a
actuals:
  tokens: 9100   # chars/4 over the hand-written diff (generated Prisma client excluded: its inline schema line dominates)
  tasks: 3
  commits: 5
key-files:
  created:
    - packages/database/prisma/migrations/20261123_phase11_settlement_chain_per_forecast/migration.sql
    - tests/integration/settlement-multi-forecast.test.ts
    - tests/integration/settlement-chain-upgrade.test.ts
  modified:
    - packages/database/prisma/schema.prisma
    - packages/database/src/evaluation/settlement-pipeline.ts
    - packages/database/src/generated/prisma/models/SettlementReceipt.ts
    - packages/database/src/generated/prisma/internal/class.ts
key-decisions:
  - "SettlementReceipt revision chain belongs to (fixtureId, forecastSnapshotId), enforced by a new forward-only migration; guard_settlement_receipt untouched"
  - "Settlement intake lock is held by a short outer transaction on its own connection, taken before the Serializable snapshot; retry policy (withSerializableRetry) deliberately unchanged"
---

# Phase 11 Plan 05: Settlement chain per forecast — Summary

Цепочка ревизий `SettlementReceipt` принадлежит прогнозу, а не матчу: DC-прогноз на матче, где уже оценён V1, получает собственную цепочку revision 1 и свои `ForecastScore` (блокер UAT тест 2 закрыт на уровне БД), а параллельная дубль-доставка больше не падает с SQLSTATE 40001.

## Что сделано

### Задача 1: миграция и схема (`af79228`)

Красное доказательство до миграции: `pnpm vitest run --project integration tests/integration/settlement-multi-forecast.test.ts`, первая строка ошибки `Raw query failed. Code: P0001. Message: settlement revision must link predecessor` (второй прогноз A→B, `persist_settlement_receipt`).

Миграция `20261123_phase11_settlement_chain_per_forecast`, порядок объектов:

1. DO-блок: `RAISE EXCEPTION 'SettlementReceipt chains are not contiguous per forecast'`, если для пары (`fixtureId`, `forecastSnapshotId`) min(revision) <> 1 или max(revision) <> count(*) (fail closed).
2. `DROP CONSTRAINT "SettlementReceipt_fixtureId_revision_key"`.
3. `CREATE UNIQUE INDEX "SettlementReceipt_fixtureId_forecastSnapshotId_revision_key"` по (`fixtureId`, `forecastSnapshotId`, `revision`); имя совпадает с дефолтным именем Prisma, дрейфа схемы нет.
4. `CREATE OR REPLACE FUNCTION persist_settlement_receipt` с прежней сигнатурой (15 параметров): MAX(revision) считается по `fixtureId` и `forecastSnapshotId`, строго после `pg_advisory_xact_lock(fixtureId:settlement)`.

`guard_settlement_receipt` не переопределялся; применённая `20260908_phase04_settlement_receipts` не менялась (`git diff --stat 575d187..HEAD -- ...phase04_settlement_receipts` пуст). Существующие строки не трогались (D-04). Откат описан в заголовке миграции: только новой forward-миграцией, пока нет матча с двумя цепочками. Схема: `@@unique([fixtureId, forecastSnapshotId, revision])`, клиент перегенерирован.

### Аудит объектов «ревизия на матч»

Единственное закрепление нумерации по матчу — `UNIQUE (fixtureId, revision)` и MAX-предикат `persist_settlement_receipt`; оба заменены. `persist_forecast_score`, `guard_forecast_score`, `persist_value_settlement`, `guard_value_settlement`, виды `current_*`, `evaluation.service.ts`, `backup-drill.ts` привязаны к `settlementReceiptId` и цепочке `supersedes*`, не менялись; код приложения составной ключ `fixtureId_revision` не использует.

### Задача 2: сценарии параллельности и исправлений (`2e95f77`, `a2f739e`)

`tests/integration/settlement-multi-forecast.test.ts`, 10 тестов: единственность функции в `pg_proc`; A→B и B→A как независимые цепочки revision 1; исправление результата (цепочки [1,2], скоры ссылаются на предшественников, `current_forecast_scores` = 6 строк с исходом по r2); два прогноза одного матча параллельно на 5 матчах (обрабатываются последовательно по матчам); параллельное исправление A и B; append-only (UPDATE/DELETE → `SettlementReceipt is immutable`); предшественник из чужой цепочки отвергается; форма ключа из `pg_index`/`pg_constraint`; дубль-доставка; шесть одновременных доставок выше лимита держателей.

Три прогона файла подряд после правки: 10/10, 10/10, 10/10. `P2034` ни разу не встретился.

### Дубль-доставка (стоп-условие плана) и её решение (`a2f739e`)

Симптом (3 из 3 прогонов до правки): два одновременных `process` одного (матч, результат, прогноз) → `Raw query failed. Code: 40001 ... could not serialize access due to read/write dependencies among transactions` в `persist_settlement_receipt`.

Причина: `pg_advisory_xact_lock` был первым запросом Serializable-транзакции, а первый запрос фиксирует снимок. Ждущий вызов получал снимок до коммита первого, не видел его квитанцию и падал по SSI. Ретрай не срабатывал: `withSerializableRetry` ловит только `P2034`.

Решение по указанию пользователя: взять замок до снимка, политику ретраев не менять. Эмпирически проверено на `postgres:18-alpine`:

- Вариант 1 (READ COMMITTED + DO/PERFORM, затем `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`) не работает: и `DO ... PERFORM pg_advisory_xact_lock`, и обычный `SELECT pg_advisory_xact_lock` берут снимок, `SET TRANSACTION` после них падает с `25001 must be called before any query`. Снимок не берёт только `LOCK TABLE`, но он табличный (глобальный мьютекс на все расчёты), не по ключу матча.
- Вариант 2 работает: короткая внешняя транзакция (`database.$transaction`, на своём соединении) держит `pg_advisory_xact_lock(hashtextextended('<fixtureId>:settlement-intake', 0))`, пока Serializable-работа идёт на другом соединении. Ключ намеренно отличается от `<fixtureId>:settlement` внутри `persist_settlement_receipt`: общий ключ дал бы взаимную блокировку держателя и рабочего. Параметризованный запрос, DO с подстановкой ключа не нужен.
- Риск исчерпания пула: каждый вызов занимает два соединения, поэтому число одновременных держателей на клиент ограничено семафором (`INTAKE_MAX_HOLDERS = 3` при пуле `pg` по умолчанию 10); таймаут держателя 75 с, `maxWait` 5 с. Сценарий «шесть доставок выше лимита» зелёный.

Результат: сценарий дубль-доставки красный до правки (40001) и зелёный после; ждущий вызов стартует после коммита первого, видит его квитанцию, возвращает её с `duplicate=true`.

### Задача 3: обновление заполненной БД (`b7bbcd2`)

`tests/integration/settlement-chain-upgrade.test.ts` (3 теста): применены все миграции до `20261123`, «наследие» (L: A ревизии 1 и 2; M: A ревизия 1) создано СТАРОЙ функцией; снимок до и после сравнивается построчно и по `md5` полных строк (`s::text`) — побайтно идентичны; ограничение `..._fixtureId_revision_key` исчезло, новый индекс существует; старая функция на копии «до» действительно не оценивает второй прогноз L (`settlement revision must link predecessor`), а после миграции B на L получает [1,2] со ссылкой на свою ревизию 1, исправление A на M получает revision 2 к legacy-ревизии, повторная доставка идемпотентна; на копии с повреждённой цепочкой (revision 2 без revision 1, вставлено при `session_replication_role = replica`) миграция падает с `SettlementReceipt chains are not contiguous per forecast`, старое ограничение остаётся, нового индекса нет.

## Итоговая проверка (`<verification>` плана)

| Проверка | Результат |
|---|---|
| `settlement-multi-forecast`, `settlement-chain-upgrade`, `settlement-pipeline`, `settlement`, `value-settlement`, `forecast-scoring`, `migration-empty` (integration) | 7 файлов, 31 тест зелёные |
| `tests/unit/backup-drill.test.ts` | 35 тестов зелёные |
| `pnpm typecheck` | 7/7 задач |
| `git diff --stat 575d187..HEAD -- ...phase04_settlement_receipts` | пусто |
| Дополнительно: `backtest-model-comparison`, `backtest-production`, `evaluation-api`, `phase-04-security` (используют пайплайн) | зелёные |

## Deviations from Plan

**1. [Rule 1 - Bug] Дубль-доставка падала с 40001.** Найдено в Задаче 2. Исправлено в `settlement-pipeline.ts` (внешний держатель замка, см. выше) по решению пользователя; политика ретраев не менялась. Файлы: `packages/database/src/evaluation/settlement-pipeline.ts`, `tests/integration/settlement-multi-forecast.test.ts`. Коммит `a2f739e`.

**2. [Rule 3 - Blocker] Docker остановился из-за переполнения диска C:** в середине выполнения; после освобождения места пользователем работа продолжена. Контейнер теста `settlement-multi-forecast` теперь удаляется вместе с томом (`rm --force --volumes`), новый тест `settlement-chain-upgrade` тоже (`rm -f -v`).

**3. [Rule 3] Миграции в `settlement-chain-upgrade` применяются в `BEGIN; ...; COMMIT;`:** одна из ранних миграций использует `LOCK TABLE`, требующий транзакции (Prisma применяет миграцию в транзакции).

## Известные ограничения и находки вне объёма плана

- **Параллельный расчёт РАЗНЫХ матчей** в одном процессе падает с SQLSTATE 40001 (в т. ч. `DriverAdapterError: TransactionWriteConflict` при COMMIT) — ложные SSI-конфликты Serializable на малых таблицах; воспроизводится и на коде до этой правки (проверено на HEAD: 3 из 3 прогонов с 6 разными матчами, два вида ошибки). Не входит в план и не вызвано миграцией; затрагивает только одновременную обработку разных матчей. Решение (ретрай `40001`/`TransactionWriteConflict` либо сериализация на уровне процесса) требует отдельного решения; сейчас не закрыто, в тестах параллельность разных матчей не используется.
- Интеграционные тесты других файлов по-прежнему оставляют анонимные тома (`docker rm --force` без `--volumes`): мои прогоны добавили около 10 томов. Не чищено по указанию пользователя; исправление `docker rm` в остальных тестах отдельной задачей.

## Known Stubs

Нет.

## Threat Flags

Нет новых сетевых точек, путей аутентификации или доступа к файлам. Новая блокировка (`<fixtureId>:settlement-intake`) — внутренний координационный механизм БД; ключ передаётся параметром запроса.

## Self-Check: PASSED

Файлы миграции, обоих тестов, `settlement-pipeline.ts` и перегенерированного клиента существуют; коммиты `af79228`, `2e95f77`, `aadfc30`, `a2f739e`, `b7bbcd2` в истории `main`; `git rev-list --count 8631b05..HEAD` = 5 (до коммита этой сводки); итоговая проверка плана зелёная.
