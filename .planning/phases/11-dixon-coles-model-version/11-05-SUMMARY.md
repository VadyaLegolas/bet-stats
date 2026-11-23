---
phase: 11-dixon-coles-model-version
plan: 05
subsystem: database
tags: [settlement, postgres, migration, prisma, gap-closure, MODEL-03]
status: blocked
requirements: [MODEL-03]
commits: 2
plan_head_before: 8631b0515d535b97d6b164beee30daa5bfa6f801
plan_head_after: 2e95f77951e3940f30ded4c7908a9aa01d1484dd
actuals:
  tasks: 1 of 3 complete, task 2 partial, task 3 not started
  commits: 2
key-files:
  created:
    - packages/database/prisma/migrations/20261123_phase11_settlement_chain_per_forecast/migration.sql
    - tests/integration/settlement-multi-forecast.test.ts
  modified:
    - packages/database/prisma/schema.prisma
    - packages/database/src/generated/prisma/models/SettlementReceipt.ts
    - packages/database/src/generated/prisma/internal/class.ts
---

# Phase 11 Plan 05: Settlement chain per forecast — Summary (ЧАСТИЧНО, ОСТАНОВЛЕН)

**Статус: план НЕ завершён.** Задача 1 выполнена и закоммичена. Задача 2 выполнена частично: 8 из 9 сценариев зелёные, сценарий «дубль-доставка» красный по SQLSTATE 40001 (находка по политике ретраев, стоп-условие плана). Задача 3 не начиналась: Docker Desktop остановился из-за переполненного диска C:. STATE.md и ROADMAP.md не обновлялись (план не закрыт).

## Что сделано

Цепочка ревизий `SettlementReceipt` теперь принадлежит прогнозу, а не матчу. DC-прогноз на матче, где уже оценён V1, получает собственную цепочку revision 1 и свои `ForecastScore` (блокер UAT тест 2 закрыт на уровне БД).

### Красное доказательство (до миграции)

Команда: `pnpm vitest run --project integration tests/integration/settlement-multi-forecast.test.ts` (Node 24 из `.tools/node24`).
Первая строка ошибки: `Raw query failed. Code: P0001. Message: settlement revision must link predecessor` (в `processRevision`, вызов `persist_settlement_receipt` для второго прогноза A→B).

### Миграция `20261123_phase11_settlement_chain_per_forecast` (порядок объектов)

1. DO-блок: `RAISE EXCEPTION 'SettlementReceipt chains are not contiguous per forecast'`, если для пары (`fixtureId`, `forecastSnapshotId`) min(revision) <> 1 или max(revision) <> count(*) (fail closed).
2. `ALTER TABLE "SettlementReceipt" DROP CONSTRAINT "SettlementReceipt_fixtureId_revision_key"`.
3. `CREATE UNIQUE INDEX "SettlementReceipt_fixtureId_forecastSnapshotId_revision_key"` по (`fixtureId`, `forecastSnapshotId`, `revision`) — имя совпадает с дефолтным именем Prisma, дрейфа схемы нет.
4. `CREATE OR REPLACE FUNCTION persist_settlement_receipt` с прежней сигнатурой (15 параметров); единственное изменение: `MAX(revision)` считается по `fixtureId` И `forecastSnapshotId`, строго после `pg_advisory_xact_lock(fixtureId:settlement)`.

`guard_settlement_receipt` не переопределялся; применённая миграция `20260908_phase04_settlement_receipts` не менялась (`git diff --stat 575d187..HEAD -- ...phase04_settlement_receipts` пуст). Существующие строки не трогались (D-04). Откат описан в заголовке миграции (только новой forward-миграцией, пока нет матча с двумя цепочками).

Схема: `@@unique([fixtureId, forecastSnapshotId, revision])`; клиент перегенерирован (`models/SettlementReceipt.ts`, `internal/class.ts`): `fixtureId_forecastSnapshotId_revision` встречается 2 раза, `SettlementReceiptFixtureIdRevisionCompoundUniqueInput` — 0.

### Аудит объектов «ревизия на матч»

Подтверждён планом по исходникам: единственное закрепление нумерации по матчу — `UNIQUE (fixtureId, revision)` и MAX-предикат `persist_settlement_receipt`; оба заменены. Остальные объекты (`persist_forecast_score`, `guard_forecast_score`, `persist_value_settlement`, `guard_value_settlement`, виды `current_*`, `evaluation.service.ts`, `backup-drill.ts`) привязаны к `settlementReceiptId`/цепочке `supersedes*`, не менялись; код приложения составной ключ `fixtureId_revision` не использует.

## Результаты проверок

| Команда | Результат |
|---|---|
| `settlement-multi-forecast.test.ts` после миграции (2 теста Задачи 1) | зелёный |
| `settlement-pipeline`, `settlement`, `value-settlement`, `forecast-scoring` (integration) | 4 файла, 14 тестов зелёные |
| `pnpm typecheck` | 7/7 задач успешно |
| `prisma validate` | валидна |
| `settlement-multi-forecast.test.ts` (9 тестов, один прогон) | 8 зелёных, 1 красный (дубль-доставка) |

Зелёные сценарии Задачи 2: исправление результата (цепочки [1,2], скоры ссылаются на предшественников, `current_forecast_scores` = 6 строк с исходом по r2); два прогноза одного матча параллельно на 5 матчах (по 2 вызова, одна квитанция revision 1 на пару, по 3 скора); параллельное исправление A и B (цепочки [1,2] без перепутанных ссылок); append-only (UPDATE/DELETE → `SettlementReceipt is immutable`); предшественник из чужой цепочки отвергается (`settlement predecessor does not match result correction and revision`); форма ключа из `pg_index`/`pg_constraint`; единственность `persist_settlement_receipt` в `pg_proc`. Для параллельных сценариев ошибок P2034 не было.

## НАХОДКА (стоп-условие плана): дубль-доставка падает с SQLSTATE 40001 без ретрая

Сценарий: два одновременных `process` для одного (матч, результат, прогноз) — для A на свежем матче (`mf-dup`, revision 1, без исправлений).

Воспроизведение (детерминированно, 3 из 3 прогонов в изоляции, `-t "duplicate delivery"`):

```ts
const match = await seedMatch(prisma, "mf-dup", 18);
await Promise.all([
  service.process({ fixtureId: match.fixtureId, resultVersionId: match.result1, forecastSnapshotId: match.forecastA, policyVersion: "settlement-policy-v1", correlationId: "c1" }),
  service.process({ fixtureId: match.fixtureId, resultVersionId: match.result1, forecastSnapshotId: match.forecastA, policyVersion: "settlement-policy-v1", correlationId: "c2" }),
]);
// -> Raw query failed. Code: `40001`. Message: `could not serialize access due to read/write dependencies among transactions`
//    at processRevision -> persist_settlement_receipt (settlement-pipeline.ts:151)
```

Причина (по коду, без изменения политики): `withSerializableRetry` повторяет только `error.code === "P2034"`, а raw-запрос возвращает 40001 как ошибку raw query, поэтому ретрая нет вообще (а не «исчерпаны три попытки»). Тест с дубль-доставкой остаётся красным. Скорее всего это дефект существующего пайплайна, не вызванный миграцией (идемпотентная проверка и advisory-lock в функции не менялись), но сравнение с исходной функцией (запуск на старом теле `persist_settlement_receipt`) не завершено из-за остановки Docker. Политику ретраев по указанию плана НЕ менял. Решение нужно принять отдельно: ретрай SQLSTATE 40001 (и/или P2010 с `meta.code = 40001`) в `withSerializableRetry`, либо брать advisory-lock до начала Serializable-снимка. Тест дубль-доставки удалён из коммита, чтобы не коммитить красный тест; код сценария выше.

## Блокер окружения

После нескольких запусков интеграционных тестов Docker Desktop остановился (`dockerDesktopLinuxEngine` pipe не найден): на C: свободно ~0.22 ГБ, в Docker накопилось 520 висящих анонимных томов (~32 ГБ) от тестовых контейнеров (`docker rm --force` без `--volumes`). Dev-контейнер `football-prediction-platform-postgres-1` тоже недоступен (мной не изменялся). Очистку томов и перезапуск Docker я не выполнял (вне плана, деструктивно). Остаётся невыполненным:

- Задача 2: сценарий дубль-доставки (ждёт решения по ретраю), три подряд зелёных прогона файла, прогон после удаления сценария дубль-доставки (после правки файл не запускался повторно).
- Задача 3: `tests/integration/settlement-chain-upgrade.test.ts` целиком (миграция на заполненной БД, повреждённые цепочки), `migration-empty.test.ts`.
- План-уровень: `tests/unit/backup-drill.test.ts`, итоговый прогон `<verification>`.

## Deviations from Plan

**[Rule 3 - Blocker] Docker остановлен переполнением диска C:** найден во время Задачи 2; Задача 3 и часть проверок Задачи 2 не выполнены. Файлы: нет. Коммит: нет.

**[Stop condition] Дубль-доставка красная по 40001** (см. выше), политика ретраев не менялась по требованию плана.

Прочих отклонений нет. Секреты и `.env*` не читались; `apps/web/next-env.d.ts` не тронут.

## Self-Check

Коммиты `af79228` (Задача 1) и `2e95f77` (Задача 2, частично) в истории `main`. Файлы миграции, теста и сгенерированного клиента существуют. Self-Check плана: **PARTIAL** (Задача 3 и часть Задачи 2 не выполнены, см. выше).
