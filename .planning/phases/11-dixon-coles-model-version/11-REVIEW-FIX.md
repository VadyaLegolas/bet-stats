---
phase: 11-dixon-coles-model-version
fixed_at: 2026-11-24T00:00:00Z
review_path: .planning/phases/11-dixon-coles-model-version/11-REVIEW.md
iteration: 1
followup: "WR-13 закрыт отдельным quick-таском 261124-88x по решению пользователя (D-01..D-07)"
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-11-24
**Source review:** `.planning/phases/11-dixon-coles-model-version/11-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (CR-03, WR-07..WR-13); IN-05..IN-09 вне области
- Fixed: 8 (WR-13 закрыт follow-up таском `261124-88x` после решения пользователя)
- Skipped: 0

Работа велась в основном checkout (`workflow.use_worktrees = false`), без временного worktree. Проверки выполнялись в основном checkout на Node 24.22.0 из `.tools/node24`, поэтому результаты воспроизводимы из этого дерева.

## Сводная таблица

| Finding | Статус | Коммит | Тест, который падает без исправления |
|---------|--------|--------|--------------------------------------|
| CR-03 | fixed: requires human verification | `023b5e5` | unit `replays the backtest result predicate...`, `skips a fixture whose result at evaluationAsOf is not a scored FINISHED leaf...`; integration e2e `takes a V1 and a Dixon-Coles plan...` (добавлен матч с `observedAt = kickoff + 72h`) |
| WR-07 | fixed: requires human verification | `eee1f38` | integration `WR-07: a call whose lock-holding transaction expires commits nothing...`, `WR-07: waiting for a holder slot is bounded and fails with SETTLEMENT_INTAKE_BUSY...` |
| WR-08 | fixed: requires human verification | `36658e4` | unit `WR-08: a failed window is not final...`, `WR-08: only a live BullMQ state...`; integration `WR-08: a transient window failure is retried by BullMQ...`, `WR-08: the wait reports FAILED only after the job used all of its attempts` |
| WR-09 | fixed | `d428b22` | unit `WR-09: a plan whose job failed for good is queued again...`; integration `WR-09: after the job failed for good, running the same parameters again retries the plan...` |
| WR-10 | fixed | `eb142e0` | integration `caps concurrent settlement work across different fixtures...`, `12 simultaneous fixtures never starve the default pool...`, `releases the per-fixture lock and the holder slot when the work throws`; тест holder timeout находится в WR-07 |
| WR-11 | fixed | `1cd0fef` | unit `WR-11: the verdict names the models of the receipt...` |
| WR-12 | fixed: requires human verification | `c00db87`, `38afdb6` (lint, тот же хеш) | unit `WR-12: the pair identity ignores the market, and follows the model configuration` |
| WR-13 | fixed: requires human verification | `d596308`, `69a921c`, `5926661` (quick `261124-88x`) | e2e `takes a V1 and a Dixon-Coles plan...` шаг 7 (без фильтра в `load`: 32 / 64 / 192); integration `forecast-origin` тесты 1-3 (без фильтра в `listIssued` падает тест 2, с `origin` в идентичности `publish` падают все три); integration `dixon-coles-rho` `ignores BACKTEST snapshots...` (без фильтра в `collectRows` выборка 200 вместо 0); unit `forecast-model-version` (origin из initiator), `forecast-origin`, `forecast-sweep` |

Все новые тесты проверены мутацией: исправление временно отключалось, и тест падал (CR-03: подмена `observedAt` на `effectiveAt`; WR-07: старая версия `settlement-pipeline.ts`; WR-08: `canStillRun` игнорируется; WR-09: пропуск `removeFailed`; WR-10: размер семафора 1000 и удалённый `release`). Для WR-11 и WR-12 тест падает на прежнем тексте и прежней функции идентичности очевидным образом, мутационный прогон не делался. WR-13: пять мутаций (M1-M5, см. запись WR-13 ниже) выполнены на закоммиченных тестах, каждая дала красный тест и была откатана `git restore`.

## Fixed Issues

### CR-03: Когорта отбирает матчи по `effectiveAt`, а окно бэктеста требует `observedAt <= evaluationAsOf`

**Воспроизведено:** да. В e2e добавлен матч с результатом, действующим с `kickoff + 2h`, но внесённым в `kickoff + 72h`. Со старой проверкой он считался пригодным; при мутации исправления e2e падает.
**Files modified:** `workers/data-sync/src/jobs/model-comparison.ts`, `tests/unit/model-comparison-operator.test.ts`, `tests/integration/backtest-model-comparison-e2e.test.ts`
**Commit:** `023b5e5`
**Applied fix:** `ComparisonFixture.firstResultEffectiveAt` заменён на список всех версий результата (`resultVersions`). `planComparisonCohort` вызывает `resolveHistoricalResultGraph` на `kickoff + evaluationLagHours` (тот же предикат `observedAt <= asOf AND effectiveAt <= asOf`, что в `evaluateWindow`) и требует лист со статусом `FINISHED` и обоими счётами. Иначе матч попадает в `skipped.noResultByEvaluationAsOf`, а план строится только из остальных, то есть не падает из-за такого матча. Только `RESULT_*` ошибки трактуются как «нет результата», прочие пробрасываются. Текст `describeCohort` уточнён. Публичный формат отчёта не менялся.

### WR-07: Таймаут holder-транзакции не отменяет работу

**Воспроизведено:** да, по коду (`work()` не получал сигнала, слот освобождался сразу после ошибки, ожидание слота без лимита) и тестом.
**Files modified:** `packages/database/src/evaluation/settlement-pipeline.ts`, `packages/database/src/index.ts`, `tests/integration/settlement-multi-forecast.test.ts`
**Commit:** `eee1f38`
**Applied fix:** работа получает `IntakeGuard` с дедлайном раньше истечения holder (минус `min(5 с, 20%)`); проверка перед каждой попыткой Serializable, перед каждой ревизией и перед коммитом. Слот освобождается только после завершения holder-колбэка. `Semaphore.acquire` имеет таймаут и бросает `SETTLEMENT_INTAKE_BUSY` (BullMQ повторяет). Таймаут holder вычисляется из констант Serializable (`3 × (5 с + 15 с) + 15 с = 75 с`, значение прежнее). Параметры вынесены в необязательную опцию `intake` сервиса, значения по умолчанию экспортируются как `SETTLEMENT_INTAKE_DEFAULTS`.
**Остаётся:** уже выполняющийся шаг (один `processRevision`) прервать нельзя; если он длится дольше запаса до истечения holder, замок может быть снят во время этого шага, но коммит после дедлайна не происходит.

### WR-08: `waitForPlans` объявляет `FAILED` при первом упавшем окне

**Воспроизведено:** да. Со старой логикой интеграционный тест получает `FAILED` после первой попытки (1 вызов вместо 3).
**Files modified:** `workers/data-sync/src/queues/index.ts`, `workers/data-sync/src/jobs/model-comparison.ts`, `workers/data-sync/src/jobs/model-comparison-cli.ts`, `tests/unit/model-comparison-operator.test.ts`, `tests/integration/backtest-model-comparison.test.ts`
**Commit:** `36658e4`
**Applied fix:** `createBacktestQueue` получил `inspect` (состояние задачи, `attemptsMade`, `attempts`). `waitForPlans` принимает `canStillRun`; упавшее окно финально, только если задача не `active/delayed/waiting/prioritized/waiting-children`. Не найденный план и `plan.state === "FAILED"` по-прежнему финальны сразу. Без `canStillRun` поведение прежнее. Политика повторов очереди (3 попытки, экспоненциальная пауза) не менялась. Общий таймаут ожидания по-прежнему ограничивает ожидание.

### WR-09: Повторный `run` не перезапускает окончательно упавшую задачу

**Воспроизведено:** да, на реальной очереди и воркере: после окончательного сбоя повторная подача оставляла задачу `failed` (BullMQ игнорирует `add` с существующим `jobId`).
**Files modified:** `workers/data-sync/src/queues/index.ts`, `workers/data-sync/src/jobs/model-comparison.ts`, `workers/data-sync/src/jobs/model-comparison-cli.ts`, `tests/unit/model-comparison-operator.test.ts`, `tests/integration/backtest-model-comparison.test.ts`
**Commit:** `d428b22`
**Applied fix:** `createBacktestQueue().removeFailed` удаляет задачу только в терминальном состоянии `failed`. `submitComparisonPair` вызывает его перед постановкой и возвращает `restartedPlanIds`; CLI сообщает о перезапуске и добавляет поле в JSON. Готовые окна не пересчитываются, `FAILED` окна заново захватываются `claimWindow`. Отдельная команда `retry` не добавлялась: повторный `run`/`submit` с теми же параметрами делает это (описано в usage и в `11-OPERATOR-COMPARISON.md`). Политика очереди не менялась.

### WR-10: Тест «шесть одновременных доставок выше порога» не может упасть

**Воспроизведено:** да, по коду: шесть вызовов одной фикстуры ждут один advisory lock и не требуют соединений worker.
**Files modified:** `tests/integration/settlement-multi-forecast.test.ts`
**Commit:** `eb142e0` (тест holder timeout находится в `eee1f38`)
**Applied fix:** тест шести дублей переименован и больше не заявляет проверку лимита. Добавлены: ограничение числа одновременно выполняющихся расчётов разных фикстур лимитом holder (зонд в `afterSettlement`, контроль без лимита показывает превышение); 12 фикстур не истощают пул по умолчанию при лимите и истощают его без лимита (негативный контроль); освобождение замка и слота при исключении в `afterSettlement`. Параллельная обработка РАЗНЫХ фикстур может давать SQLSTATE 40001 (известный дефект вне области), поэтому эти тесты не требуют успеха всех вызовов, а различают ошибки сериализации и ошибки пула. Тесты три раза подряд прошли стабильно.

### WR-11: `describeComparison` жёстко подписывает стороны как V1/DC

**Воспроизведено:** да, текст собирался из констант «V1», «DC лучше», «DC хуже».
**Files modified:** `workers/data-sync/src/jobs/model-comparison.ts`, `tests/unit/model-comparison-operator.test.ts`
**Commit:** `1cd0fef`
**Applied fix:** подписи берутся из `receipt.left.modelVersion` и `receipt.right.modelVersion`, вердикт читается как «правая модель X лучше/хуже левой Y», добавлена строка про знак дельты и предупреждение, если обе стороны одной модели. Отказ `COMPARISON_MODELS_UNEXPECTED` в `compare` не вводился: сравнение произвольных планов оставлено допустимым, но больше не вводит в заблуждение.

### WR-12: Идентичность пары планов не включает конфигурацию моделей и включает рынок

**Воспроизведено:** да, по коду (`market` в хеше, хешей конфигурации нет).
**Files modified:** `workers/data-sync/src/jobs/model-comparison.ts`, `tests/unit/model-comparison-operator.test.ts`, `.planning/phases/11-dixon-coles-model-version/11-OPERATOR-COMPARISON.md`
**Commit:** `c00db87`, `38afdb6`
**Applied fix:** новая экспортируемая `comparisonPairId`: хеш от диапазона, лиг, `concurrency`, лагов и лида отсечки, окон и `forecastConfigHashFor` обеих моделей; `market` и `allowSmallCohort` не входят. **Отклонение от рекомендации ревью:** `concurrency` оставлен в идентичности, потому что он входит в `planHash`, и при общем `planId` другое значение дало бы `BACKTEST_PLAN_ID_CONFLICT`.
**Изменение идентификаторов:** `pairId`, а значит и `planId`, у любой пары, поданной раньше, изменились. Старые планы остаются в БД и читаются `status`/`compare` по их идентификаторам; повторный `run` создаёт новую пару. Политика `model-comparison-v2` и `planHash` существующих планов не менялись.

### WR-13: Операторское сравнение пишет ретро-прогнозы и скоры в тот же пул, из которого публичная scorecard считает метрики

**Воспроизведено:** да. На e2e-базе без единого production-прогноза публичная когорта `loadCohort(all, all, ONE_X_TWO)` после `run` давала `fixtureCount 32, forecastCount 64, eventCount 192`; мутация M1 (убрать фильтр из `load`) воспроизводит именно эти числа в шаге 7 e2e.
**Files modified:** `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/20261124_phase11_forecast_snapshot_origin/migration.sql`, `packages/database/src/generated/prisma/**`, `packages/domain/src/evaluation/forecast-orchestrator.ts`, `packages/database/src/forecast-repository.ts`, `packages/database/src/dixon-coles-repository.ts`, `apps/api/src/modules/evaluation/evaluation.service.ts`, `apps/api/src/modules/fixtures/fixtures.service.ts`, `apps/api/src/modules/forecasts/forecast-comparison.service.ts`, `apps/api/src/modules/value/value.service.ts`, `workers/data-sync/src/jobs/forecast-sweep.ts`, тесты (`tests/unit/forecast-model-version.test.ts`, `forecast-origin.test.ts`, `forecast-sweep.test.ts`; `tests/integration/forecast-api.test.ts`, `dixon-coles-rho.test.ts`, `migration-empty.test.ts`, `backtest-model-comparison-e2e.test.ts`, `forecast-origin.test.ts`), `11-REVIEW.md`, `11-OPERATOR-COMPARISON.md`, `deferred-items.md`
**Commits:** `d596308` (миграция, схема, клиент, путь записи), `69a921c` (публичные читатели и фит ρ), `5926661` (регрессионные тесты на реальном PostgreSQL), далее docs-коммит этого закрытия (quick task `261124-88x`)
**Applied fix (решения пользователя D-01..D-07):**
- D-01: enum `ForecastOrigin` (`PRODUCTION`/`BACKTEST`) и колонка `ForecastSnapshot.origin NOT NULL DEFAULT PRODUCTION`, миграция только вперёд; существующие строки не обновляются (константный default в PostgreSQL 18 не переписывает таблицу), поэтому все прежние снимки читаются как `PRODUCTION`. `guard_forecast_snapshot()` включает `origin` в оба списка `ROW(...)`: при переходе BUILDING в ISSUED origin изменить нельзя, любые другие UPDATE и так отклонялись. Клиент Prisma перегенерирован, изменились только файлы по `ForecastSnapshot`/`ForecastOrigin`.
- D-02: `ForecastOrchestrator` выводит origin из `initiator.type` (`forecastOriginOf`) и передаёт `publish(draft, { origin })`; origin не опция конструктора репозитория, потому что один экземпляр обслуживает и production, и воркер бэктеста. Идентичность снимка origin не включает: при коллизии `publish` возвращает существующий снимок без изменений, любого origin; ничто не обновляется и не переразмечается. Цепочка ревизий `(fixtureId, kind)` остаётся общей для всех origin (её требуют триггер и уникальные ключи).
- D-03: только `PRODUCTION` читают `findIssued`, `listIssued`, `load`, `enumerateAvailableCohorts`, `listValueCandidates`, обогащение списка матчей, `findExact` сравнения, `findForecast` value и проверка «уже выпущено» в production-sweep. Внутренние читатели бэктеста не менялись.
- D-04: фит ρ (`collectRows`) исключает `BACKTEST`. Доказательства: каждый фит бэктеста идёт на `asOf = window.trainingEndsAt`, и `issuedAt <= asOf` (WR-04) уже отсекает позже записанные снимки бэктеста, поэтому для бэктестов и квитанции сравнения фильтр ничего не меняет; production-прогноз фитится на `asOf` около «сейчас» и раньше читал снимки бэктеста, то есть оператор мог незаметно менять ρ живых прогнозов. Контраргумент (бэктест мог бы «разогнать» ρ на молодой базе) не принят: это должна быть явная опция с пометкой (в `deferred-items.md`), а не побочный эффект команды оператора. Остаточный случай: снимки бэктестов до миграции размечены `PRODUCTION` и остаются в фите.
- D-05: тесты (a) e2e шаг 7: после сравнения на базе без production-прогнозов публичные `loadCohort` (all/all/ONE_X_TWO, market all, обе модели) дают 0 / 0 / 0 / 0, `enumerateAvailableCohorts` и кандидаты value пусты, в БД `2 * 32` снимков `BACKTEST`, ноль `PRODUCTION` и `192` скора бэктеста сохранены; (b) `forecast-origin` тест 1: V1-бэктест на идентичности production-снимка оставляет его `PRODUCTION`, публичным и посчитанным в scorecard (1 / 1 / 3).
- D-06: этот документ и `11-REVIEW.md` обновлены; `valueByFixture` записан в `deferred-items.md`.
- D-07: SQLSTATE 40001 при параллельном расчёте разных фикстур не затрагивался; в этом прогоне не проявился.
**Мутационные проверки (тесты закоммичены до мутаций, каждая мутация откатана `git restore`):**
- M1 (убран фильтр origin в `load`): e2e красный, шаг 7: `fixtureCount 32, forecastCount 64, eventCount 192`.
- M2 (`forecastOriginOf` всегда `PRODUCTION`): e2e красный на более раннем утверждении шага 7 (публичная когорта непуста, 32 фикстуры), до проверки числа `BACKTEST`-снимков; три unit-теста origin тоже красные.
- M3 (убран фильтр в `listIssued`): `forecast-origin` тест 2 красный (`listIssued` возвращает снимок бэктеста).
- M4 (убран фильтр в `collectRows`): `dixon-coles-rho` тест про BACKTEST красный (`sampleSize` 200 вместо 0).
- M5 (`origin` добавлен в идентичность `publish`): `forecast-origin` красный, все три теста; тест 1 падает на `Unique constraint failed on the constraint: ForecastSnapshot_pkey` (идентификатор снимка равен хешу содержимого и не зависит от origin), а не на индексе идентичности, как ожидалось в плане; тесты 2 и 3 падают каскадом.
**Остаётся:**
- Снимки бэктестов, записанные до миграции, размечены `PRODUCTION` и остаются видимыми публично и в фите ρ: отделить их от production-снимков с той же идентичностью безопасно нельзя.
- Production-публикация, попавшая на идентичность существующего `BACKTEST`-снимка, возвращает этот невидимый снимок (тест 3), и такой production-прогноз не станет публичным; вопрос продукта, должна ли она вместо этого падать явно.
- Физические номера ревизий общие для всех origin, поэтому публичные номера ревизий одной фикстуры могут иметь пропуски.
- `results-sync` и settlement-enqueue по-прежнему рассчитывают каждый `ISSUED` снимок завершённой фикстуры, в том числе `BACKTEST`; их скоры не попадают в публичный пул из-за фильтров выше.
- `valueByFixture` и остальное: см. `deferred-items.md`.

## Skipped Issues

Нет. WR-13 числился здесь как `needs-decision`; после решения пользователя он исправлен (запись выше), а исходный анализ ниже сохранён как история находки.

### История WR-13 (прежний статус skipped: needs-decision)

**File:** `apps/api/src/modules/evaluation/evaluation.service.ts:143-160`, `workers/data-sync/src/jobs/model-comparison.ts`
**Reason:** needs-decision. Утечка подтверждена, но исправление выходит за рамки «исключить прогнозы и скоры бэктеста» и требует решения пользователя.

**Что подтверждено.** На e2e-базе, где нет ни одного production-прогноза, `createPrismaEvaluationRepository(...).loadCohort({ modelVersion: "all", competitionId: "all", market: "ONE_X_TWO", ... })` после `run` возвращает `fixtureCount 32, forecastCount 64, eventCount 192`: оценки обоих бэктестов попали в публичный пул. Для `poisson-ensemble-v1` отдельно: 32 фикстуры и 32 прогноза. Снимки при этом получили `issuedAt` = «сейчас» (после матча), а DC-снимок стал ревизией 2 с `supersedesForecastId` на V1-снимок той же фикстуры. Одноразовая проба удалена, код тестов не менялся.

**Почему не исправлено без решения.**
1. В БД нет признака происхождения. `initiator` проверяется оркестратором (`correlationId`), но не сохраняется в `ForecastSnapshot`. Единственная связь это `BacktestWindow.forecastSnapshotId`.
2. Фильтр по `BacktestWindow` небезопасен: `publish` идемпотентен по идентичности (`fixtureId, kind, cutoff, modelHash, configHash, inputHash, evidenceFingerprint`). V1-бэктест на точной отсечке `kickoff - 6 ч` с теми же доказательствами возвращает уже существующий production-снимок. Исключение по ссылке окна удалило бы настоящие production-оценки из публичной scorecard.
3. Корректное исправление требует схемы: признака происхождения снимка (миграция таблицы с триггерами неизменяемости) и правила для коллизии идентичности (кто владеет снимком, если production и бэктест дают одно и то же), либо отдельной сущности для ретро-прогнозов. Это меняет публичную семантику `findIssued`/`listIssued`/scorecard и модель неизменяемых снимков. Это решение продукта и данных, а не точечная правка.
4. Эвристика `issuedAt < kickoffUtc` («прогноз выпущен до матча») не требует схемы и отсекает ретро-прогнозы, но задаёт новый критерий публикации для всей scorecard. Её тоже нельзя вводить без согласия.

**Нужно решить пользователю:** (а) хранить происхождение снимка в схеме и как разрешать коллизию идентичности; (б) принять критерий `issuedAt < kickoffUtc` как публичное правило; (в) писать ли бэктест вообще в `ForecastSnapshot` или в отдельное хранилище. Отдельно, независимо от выбора: `valueByFixture` ключуется по фикстуре и теряет значения при нескольких квитанциях одной фикстуры; исправление (ключ по `settlementReceiptId` и рынку) меняет `valueReceiptId` в опубликованных событиях для `market=all`, поэтому тоже вынесено на решение. Стоит также учесть, что `findIssued`/`listIssued` (production) читают все `ISSUED` снимки без фильтра происхождения.

**Original issue:** `load()` scorecard читает все `forecastScore` с `supersededBy: null` без фильтра по инициатору; выборка искусственно умножается, ретро-прогнозы смешиваются с реальными.

## Проверки

Выполнено в основном checkout (Node v24.22.0, `.tools/node24`):

| Команда | Результат |
|---------|-----------|
| `pnpm vitest run --project unit` | 60 файлов, 695 тестов, все прошли |
| `vitest run --project integration tests/integration/settlement-multi-forecast.test.ts` | 15 из 15 |
| `... settlement-chain-upgrade.test.ts` | 3 из 3 |
| `... backtest-model-comparison.test.ts` | 4 из 4 (повторно после последнего коммита) |
| `... backtest-model-comparison-e2e.test.ts` | 1 из 1 (повторно после последнего коммита) |
| `... backtest-production.test.ts` | 3 из 3 |
| `... model-comparison-api.test.ts` | 6 из 6 |
| `... evaluation-api.test.ts` | 5 из 5 |
| `pnpm typecheck` (turbo, 7 задач) | успешно |
| `pnpm lint` в `packages/database` и `workers/data-sync` | без ошибок (после коммита `38afdb6`; первая версия WR-12 давала 2 ошибки `no-unused-vars`) |

Прогон после исправления WR-13 (quick task `261124-88x`, Node v24.22.0, `.tools/node24`, после коммитов `d596308`, `69a921c`, `5926661`):

| Команда | Результат |
|---------|-----------|
| `pnpm vitest run --project unit` | 61 файл, 708 тестов, все прошли |
| `vitest run --project integration tests/integration/<файл>.test.ts`: `evaluation-api` | 5 из 5 |
| `forecast-api` | 8 из 8 |
| `forecast-publication` | 5 из 5 |
| `backtest-model-comparison` | 4 из 4 |
| `backtest-model-comparison-e2e` | 1 из 1 (с новым шагом 7) |
| `backtest-production` | 3 из 3 |
| `settlement-multi-forecast` | 15 из 15 (SQLSTATE 40001 не проявился) |
| `migration-empty` | 6 из 6 (2 новых: колонка/enum и populated-upgrade с guard) |
| `settlement-chain-upgrade` | 3 из 3 |
| `dixon-coles-rho` | 8 из 8 (1 новый) |
| `forecast-origin` (новый) | 3 из 3 |
| `backtest-origin` | 9 из 9 |
| `forecast-comparison-api` | 12 из 12 |
| `model-comparison-api` | 6 из 6 |
| `phase-04-security` | 4 из 4 |
| `forecast-snapshots`, `phase-03-security` | 4 из 4 и 13 из 13; эти два файла требуют `DATABASE_URL`, прогнаны на отдельной одноразовой БД PostgreSQL 18 с применёнными миграциями (контейнер удалён `docker rm --force --volumes`), dev-БД не использовалась |
| `pnpm typecheck` (turbo, 7 задач) | успешно |
| `pnpm --filter @bet-stats/{database,domain,api,data-sync} lint` | без ошибок |
| `prisma migrate diff --from-config-datasource --to-schema` на одноразовой БД после `migrate deploy` | код 2: дрейф есть, но он прежний и не касается `origin`/`ForecastOrigin` (переименования индексов и внешних ключей из рукописных миграций); колонка и enum совпадают со схемой |

Контейнеры тестов создавались и удалялись самими тестами (`docker rm --force --volumes`); после прогонов остались только `football-prediction-platform-postgres-1` и `football-prediction-platform-redis-1`, которые не трогались.

## Не проверено

- Файлы в `tests/` не входят в `pnpm typecheck` (vitest только транспилирует); их типы отдельно не проверялись.
- WR-07: поведение при реальной перегрузке пула и очень долгом одиночном шаге не воспроизводилось; тест покрывает истечение holder на `afterSettlement`.
- WR-08: ожидание завершения проверено на реальной очереди и воркере со скриптованным `execute` (не с реальным `runBacktestPlan` и не на реальном сбое провайдера).
- Dev-БД и реальные данные оператора не использовались; пример когорты на данных UAT не пересчитывался.
- WR-13: миграция на dev-БД не применялась (только на одноразовых базах в тестах); перед использованием оператором нужны `prisma migrate deploy` и `pnpm build`. Типы новых и изменённых файлов в `tests/` не проверялись `tsc`. Реальный пул публичной scorecard dev-БД не просматривался: прежние снимки бэктестов там размечены `PRODUCTION`.

---

_Fixed: 2026-11-24_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
