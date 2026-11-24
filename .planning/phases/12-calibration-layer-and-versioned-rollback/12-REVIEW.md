---
phase: 12-calibration-layer-and-versioned-rollback
reviewed: 2026-11-24T00:00:00Z
depth: standard
files_reviewed: 52
files_reviewed_list:
  - packages/domain/src/calibration/calibrator.ts
  - packages/domain/src/calibration/config.ts
  - packages/domain/src/calibration/errors.ts
  - packages/domain/src/calibration/index.ts
  - packages/domain/src/calibration/isotonic.ts
  - packages/domain/src/calibration/lifecycle.ts
  - packages/domain/src/calibration/metrics.ts
  - packages/domain/src/calibration/outcome.ts
  - packages/domain/src/calibration/platt.ts
  - packages/domain/src/calibration/view.ts
  - packages/domain/src/index.ts
  - packages/domain/src/methodology/model-card.ts
  - packages/database/prisma/migrations/20261125_phase12_calibrator_tables/migration.sql
  - packages/database/prisma/migrations/20261125_phase12_calibrator_transitions/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/database/src/calibration-repository.ts
  - packages/database/src/calibration-fit-data.ts
  - packages/database/src/index.ts
  - workers/data-sync/src/jobs/calibration.ts
  - workers/data-sync/src/main.ts
  - apps/api/src/modules/forecasts/forecast-calibration.ts
  - apps/api/src/modules/forecasts/forecasts.service.ts
  - apps/api/src/modules/forecasts/forecasts.controller.ts
  - apps/web/app/fixtures/[fixtureId]/calibration-copy.ts
  - apps/web/app/fixtures/[fixtureId]/calibration-panel.tsx
  - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
  - apps/web/app/fixtures/[fixtureId]/page.tsx
  - apps/web/app/methodology/page.tsx
  - tests/unit/calibration-calibrator.test.ts
  - tests/unit/calibration-job.test.ts
  - tests/unit/calibration-lifecycle.test.ts
  - tests/unit/calibration-panel-ui.test.tsx
  - tests/unit/calibration-platt.test.ts
  - tests/unit/calibration-view.test.ts
  - tests/unit/forecast-calibration.test.ts
  - tests/integration/calibration-fit-data-parity.test.ts
  - tests/integration/calibration-fit-data.test.ts
  - tests/integration/calibration-full-loop.test.ts
  - tests/integration/calibration-job.test.ts
  - tests/integration/calibration-queue.test.ts
  - tests/integration/calibration-schema.test.ts
  - tests/integration/calibration-transitions.test.ts
  - tests/integration/calibration-upgrade.test.ts
  - tests/integration/forecast-calibration-api.test.ts
  - tests/e2e/calibration.spec.ts
  - tests/helpers/calibration-db.ts
  - tests/helpers/calibration-fit-seed.ts
  - tests/helpers/calibration-job-seed.ts
  - tests/helpers/calibration-samples.ts
  - tests/helpers/forecast-dto.ts
  - tests/unit/model-card.test.ts
  - tests/e2e/methodology.spec.ts
findings:
  critical: 0
  warning: 9
  info: 8
  total: 17
  necessity: 1
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-11-24
**Depth:** standard (кросс-файловая трассировка там, где этого требовал поток данных)
**Files Reviewed:** 52 (сгенерированный клиент Prisma пропущен)
**Status:** issues_found

## Summary

Просмотрены доменный слой калибровки, миграции и триггеры, репозиторий и чтение данных подбора, ежедневное задание, API-обогащение, UI и тесты. Структурный блок fallow не передавался, поэтому раздела Structural Findings нет. Файл `necessity-review.md` прочитан.

Что проверено и признано корректным (в отчёт как дефекты не включено):

- **Математика Platt.** Шаг Ньютона для матрицы 2x2 выведен верно, регуляризация делает гессиан положительно определённым, поэтому степенной случай (все логиты равны, разделимые данные) даёт конечное решение. Armijo-откат и обрезка вероятностей на `1e-6` согласованы между подбором и применением.
- **PAVA.** Абсциссы узлов строго возрастают, потому что блоки образуются из групп с равным `x`, а слияние соседних блоков сохраняет порядок. Значения неубывающие. Интерполяция зажата в сегмент.
- **Пересчёт 1X2.** Три значения при обрезке на epsilon не меньше `3e-6`, деление на сумму безопасно.
- **Сравнение по Brier.** Единицы (несмасштабированная сумма по классам, диапазон 0-2) совпадают с `materiality = 0.002` из `model-comparison-v2`.
- **Утечка.** Подбор берёт только PRODUCTION, ISSUED, PRE_MATCH, точную пару `modelVersion/configHash`. Результат читается из истории версий на `asOf`. Отложенная выборка берётся из хвоста хронологии и не пересекается с обучением. Окна оценки активного калибратора не пересекаются: граница сдвигается только после eligible-оценки.
- **БД.** Составные внешние ключи фиксируют идентичность. Триггер переходов берёт advisory-блокировку с тем же ключом, что и репозиторий, и перевыпускает `seq` уже под блокировкой. Правило `ROLLED_BACK -> predecessor из PROMOTED` и вид `current_calibrators` согласованы, включая откат до «только сырые» (строка с `NULL` не присоединяется к `Calibrator`). Сырой SQL параметризован, конкатенаций с внешними значениями нет. Секретов нет.
- **API.** Идентичность берётся из самого прогноза и передаётся в `applyCalibrator`. Путей записи нет. Существующие поля не меняются: ключ `marketCalibration` добавляется отдельно, а `compareForecastPair` и `value.service` читают снимки из БД по id и расширенный ответ не парсят.

Критических дефектов не найдено. Основные предупреждения: оговорка в методологии про запрет повторного продвижения откатанного калибратора выполняется только для точного совпадения содержимого (WR-01); откат (единственный защитный механизм) связан с подбором кандидата в одном потоке исключений (WR-02); оценка и откат записываются разными транзакциями (WR-03); выбор метода и решение о продвижении используют одну отложенную выборку (WR-04); на каждый запрос списка прогнозов выполняется полная повторная выборка (WR-06).

## Warnings

### WR-01: Запрет повторного продвижения откатанного калибратора обходится одним новым исходом, а методология утверждает обратное

**File:** `packages/domain/src/calibration/calibrator.ts:182-191`, `packages/domain/src/calibration/lifecycle.ts:206-210`, `workers/data-sync/src/jobs/calibration.ts:167`, `packages/domain/src/methodology/model-card.ts:129`
**Issue:** `everRolledBack` проверяется по точному `calibratorId`, а `calibratorContentId` включает `samplesDigest` всей выборки. Любой новый завершённый исход меняет digest, и на следующий день подбор даёт «нового» кандидата с практически теми же параметрами, у которого нет откатов. После отката до «только сырые» `active === null`, поэтому `decideCandidate` доходит до `FIRST_PROMOTION` при единственном условии `isPromotable` (дельта холдаута меньше `+0.002`). Карточка модели при этом пишет пользователю: «откатанный калибратор повторно не продвигается».
**Failure scenario:** `S = 1000`, холдаут `200` (20%). Калибратор B получил три подряд eligible-оценки WORSE на новых окнах по 30-60 исходов и откатан до raw. Новые плохие исходы составляют лишь часть из 200 новейших, остальные 110 старые и хорошие. На следующий день подбор даёт `B'`, его средняя дельта на холдауте остаётся ниже `+0.002`, он проходит `isPromotable` и продвигается без гистерезиса. Откат отменён за сутки, хотя три плохих окна уже были записаны. Пользователь видит «Калибровка v2», а методология обещает обратное.
**Fix:** привязать запрет к «семейству» а не к хэшу содержимого: хранить в событии `ROLLED_BACK` время `asOf` и запрещать продвижение любого кандидата того же `(identity, market, method)` в течение окна охлаждения (например, пока не накопится `rollback.consecutiveWorse * rollback.minimumEvaluationSample` новых исходов после отката). Критерий вынести в `calibration-config-v2`. Пока это не сделано, формулировку в `model-card.ts:129` исправить: «тот же самый калибратор (по составу выборки) повторно не продвигается».

### WR-02: Откат невозможен, если подбор кандидата или применение сохранённого калибратора бросает исключение

**File:** `workers/data-sync/src/jobs/calibration.ts:141-157, 180, 282-284`
**Issue:** `runMarket` сначала вычисляет `evaluateCalibrator` (строка 148), затем `fitMarketCalibrator` (156) и только потом вызывает `decideCalibrationLifecycle` (180). Любое исключение раньше строки 180 отменяет решение об откате. Исключения не перехватываются: ни в `runMarket`, ни в цикле по рынкам (282-284). `evaluateCalibrator` вызывает `applyCalibrator`, который бросает `CALIBRATOR_INVALID` для структурно битых параметров. Репозиторий проверяет только «parameters это JSON-объект» (`fittedFromRow`, `calibration-repository.ts:197`). `fitMarketCalibrator` бросает `CALIBRATION_FIT_FAILED` и `INVALID_CALIBRATION_SAMPLE`.
**Failure scenario:** у активного калибратора ONE_X_TWO битые параметры (ручная правка при восстановлении, старая версия сериализации). API правильно показывает UNAVAILABLE, но задание падает каждый день: три попытки, затем рынок заблокирован. Откат в эту же секунду единственный способ вернуть служебное состояние, а он недоступен. Дополнительно последовательный цикл по рынкам означает, что постоянная ошибка в ONE_X_TWO не даёт отработать OVER_UNDER_2_5 и BTTS: их гистерезис и откат тоже не выполняются.
**Fix:** изолировать рынки (`try/catch` вокруг `runMarket` с записью причины в квитанцию и повторным выбросом после обработки всех рынков). Внутри рынка вычисление оценки активного калибратора обернуть так, чтобы `CALIBRATOR_INVALID` давал синтетическую eligible-оценку WORSE или прямой `ROLL_BACK` с кодом `CALIBRATOR_INVALID`, а ошибка подбора не мешала решению об откате.

### WR-03: Запись оценки и откат выполняются разными транзакциями, сбой между ними теряет откат

**File:** `workers/data-sync/src/jobs/calibration.ts:182-193, 223-253`, `packages/database/src/calibration-repository.ts:479-495`
**Issue:** `RECORD_EVALUATION` и `ROLL_BACK` это два отдельных вызова репозитория, каждый в своей транзакции. После фиксации события `EVALUATED` граница окна (`boundaryMs`) сдвигается на `asOf` этого запуска. Повтор того же задания (BullMQ attempt 2 после падения процесса или после `CALIBRATOR_TRANSITION_REJECTED` параллельного запуска) видит пустое окно (`knownAt > boundary` ничего не даёт), `evaluation === null` и не вызывает правило отката.
**Failure scenario:** третья eligible-оценка WORSE записана, процесс убит до `ROLL_BACK`. Повтор не откатывает. Следующая eligible-оценка (когда накопится 30 новых исходов, возможно через недели) считается с `trailingWorseRun([...prior, current])`: если она NEUTRAL или BETTER, серия обрывается и положенный откат теряется навсегда. Если же текущая WORSE, откат срабатывает на четвёртой, то есть с задержкой.
**Fix:** писать оценку и откат одной транзакцией (метод репозитория `rollbackWithEvaluation`, внутри под одной блокировкой `EVALUATED` затем `ROLLED_BACK`), либо при построении `lifecycleActive` проверять, не лежит ли в журнале уже `consecutiveWorse` подряд eligible-оценок WORSE у активного калибратора, и тогда формировать откат без нового окна.

### WR-04: Выбор метода (Platt против изотонической регрессии) и решение о продвижении используют одну и ту же отложенную выборку

**File:** `packages/domain/src/calibration/calibrator.ts:247-263, 274`, `packages/domain/src/calibration/lifecycle.ts:51`
**Issue:** при `S >= 1500` метод выбирается по лучшему Brier на отложенной выборке (строки 258-262), и тот же `holdoutBrierCalibrated` затем попадает в `isPromotable`, в таблицу `Calibrator` и в UI как «Brier на отложенной выборке». Это минимум по двум моделям на той же выборке: оценка оптимистично смещена. D-05 требует, чтобы отложенная выборка не участвовала в обучении, и она формально не участвует, но участвует в отборе. Изотоническая регрессия (много степеней свободы) выбирается именно потому, что ей повезло на этих 20%.
**Failure scenario:** на границе материальности изотоническая модель выигрывает у Platt на `0.0021` по шуму выборки, показанное на странице значение «калиброванные 0.xxx» улучшено на величину победы, а реальное качество ниже. Следующие оценки (rollback) используют свежие данные, поэтому ошибка исправляется только после трёх плохих окон.
**Fix:** разбить данные на три части (fit / selection / holdout) либо оценить выбранную модель на последних N исходах, не участвовавших в сравнении. Минимум: хранить в `Calibrator` оба Brier-а (уже есть `plattHoldoutBrier`, `isotonicHoldoutBrier`) и в UI подписывать значение как «лучшее из двух методов на отложенной выборке».

### WR-05: Идентификатор калибратора не покрывает параметры и метрики, а `skipDuplicates` скрывает расхождение

**File:** `packages/domain/src/calibration/calibrator.ts:182-191`, `packages/database/src/calibration-repository.ts:413-443`, `workers/data-sync/src/jobs/calibration.ts:158-176`
**Issue:** `calibratorContentId` строится из `identity`, `market`, `method`, `calibrationConfigHash` и `samplesDigest`. Параметры подгонки и метрики холдаута в id не входят. `createMany({ skipDuplicates: true })` молча оставляет старую строку при совпадении id. Задание же использует из свежей подгонки `holdoutBrierCandidate` и `isPromotable(fitted.calibrator)` (строки 166-168), а обслуживается позже строка из БД со старыми параметрами.
**Failure scenario:** в коде `fitPlatt` исправляют численную ошибку (конфиг `calibration-config-v1` не меняется, значит и его хэш). Данные те же, id тот же. БД хранит старые параметры, а решение о продвижении принято по метрикам новых. Пользователь получает калибратор, чьи параметры не соответствуют показанному Brier. Для аудируемого артефакта это нарушение D-09.
**Fix:** включить в id хэш канонической сериализации `parameters` и `holdoutBrier*`, либо после `createMany` при `created === false` читать сохранённую строку и сравнивать с подгонкой: при расхождении бросать `CALIBRATOR_ROW_INVALID` и не продвигать. Ту же проверку делать перед `promoteCalibrator`.

### WR-06: Каждый запрос списка/одного прогноза выполняет полную повторную выборку подбора для каждой идентичности

**File:** `apps/api/src/modules/forecasts/forecast-calibration.ts:46-59`, `packages/database/src/calibration-fit-data.ts:98-201, 207-218`, `apps/api/src/modules/forecasts/forecasts.service.ts:76-86`
**Issue:** `attachMarketCalibration` вызывает `readCalibrationState`, а тот выполняет `readCalibrationFitData`: `findMany` по всем ISSUED PRODUCTION PRE_MATCH снимкам идентичности с вложенными рынками (три JSON-блока на снимок), затем батчи `resultVersion.findMany` по всем фикстурам и разбор графа результатов в памяти. Кеша нет (комментарий в файле это подтверждает), `Cache-Control: no-store`. При этом выборка нужна полностью только для INSUFFICIENT_DATA и NO_PROMOTED: когда у рынка есть активный калибратор, число исходов не используется, но всё равно считается. Страница матча вызывает этот путь на каждый рендер (`cache: "no-store"` в `page.tsx`).
**Failure scenario:** сегодня около 110-460 снимков, стоимость небольшая. Работа растёт линейно с историей, а эндпоинт общедоступен (`EligibilityGuard` проверяет регион и возраст, не личность). Серия запросов `GET /fixtures/:id/forecasts` по разным матчам умножает полное сканирование на число запросов и занимает пул соединений, общий с публикацией прогнозов. Реальный риск средний: не авария сегодня, а предсказуемая деградация с ростом.
**Fix:** считать счётчик исходов запросом `count(*)` с теми же фильтрами (без JSON и графа), читать полный набор только при необходимости. Добавить кеш на 60-300 секунд на ключ `(modelVersion, configHash)`, допустимый, так как read-time `asOf` уже раскрыт как ограничение. Для списка читать состояние один раз на идентичность (уже сделано) и параллельно (сейчас `await` внутри цикла делает чтение идентичностей последовательным).

### WR-07: Сбой чтения калибровки молча подавляется без записи в журнал

**File:** `apps/api/src/modules/forecasts/forecast-calibration.ts:53-56, 76-78`
**Issue:** `.catch(() => null)` и `catch { marketCalibration = unavailableAll(forecast) }` отбрасывают причину. Поведение «мягкого отказа» верное (D-11), но оператор нигде не получит сигнала: ни лога, ни счётчика, ни метрики. Пользователь видит «Калибровка временно недоступна», а причина (недоступность БД, `CALIBRATOR_ROW_INVALID` из репозитория, потеря вида `current_calibrators`) не наблюдаема.
**Failure scenario:** миграция вида не накатана на стенде, запрос падает с «relation does not exist». Все прогнозы навсегда показывают «временно недоступна», а в логах API тишина. Проблему обнаружат только по жалобам.
**Fix:** передать в `CalibrationEnrichmentDeps` необязательный `onError(error, identity)` и в сервисе логировать код ошибки структурно (без текста запроса и без параметров), как это сделано в worker (`calibration.tick_failed`).

### WR-08: Калибраторы идентичности, которую стек больше не выпускает, продолжают показываться, но не оцениваются и не откатываются

**File:** `workers/data-sync/src/jobs/calibration.ts:96-101, 337-339`, `apps/api/src/modules/forecasts/forecast-calibration.ts:46-59`
**Issue:** задание принимает только пары `(modelVersion, forecastConfigHashFor(modelVersion))` (текущий хэш конфигурации). API обслуживает калибратор по идентичности самого прогноза, не сверяя её с текущей. Если конфигурация модели меняется (новый `configHash` при той же `modelVersion`), старые прогнозы остаются в БД, их калибратор остаётся активным навсегда, а задание для старой пары не создаётся (`CALIBRATION_IDENTITY_INVALID` по `UnrecoverableError`). Журнал событий для неё больше не пишется, значит откат невозможен.
**Failure scenario:** релиз меняет конфигурацию DC, старый калибратор dixon-coles-ensemble-v1 / старый хэш остаётся «Калибровка v3» на всех прошлых матчах, без оценки и без отката. Это скрытый риск: пользователь видит версию калибратора, который никто не проверяет.
**Fix:** либо завести в конфиге список «обслуживаемых» идентичностей и в `resolveMarketCalibration` возвращать UNAVAILABLE для остальных (код `IDENTITY_RETIRED`), либо не отклонять в задании старые пары, пока для них есть активный калибратор (`findActiveCalibrator` не `null`).

### WR-09: Тест обёртки запуска не проверяет боевую ветку создания worker

**File:** `tests/unit/calibration-job.test.ts:208-232`, `workers/data-sync/src/main.ts` (`startCalibrationRuntime`, ветка `deps ? undefined : createCalibrationWorker(...)`)
**Issue:** единственный тест `startCalibrationRuntime` передаёт `dependencies`, поэтому `worker` в нём всегда `undefined`, а callback `execute: (data) => runCalibrationJob({ database, modelVersion: data.modelVersion, ... })` в тестах никогда не вызывается. Интеграционный `calibration-queue.test.ts` подставляет мок `execute`. Сквозная связка «очередь -> `runCalibrationJob` с правильными аргументами» не покрыта. Строковые проверки `main.ts` по регулярным выражениям (`calibration-job.test.ts:234-241`) проверяют текст, а не поведение. Цель проверки (в SUMMARY заявлено «проводка проверена») не достигнута.
**Failure scenario:** в `execute` перепутаны `configHash` и `modelVersion`: ни один тест не упадёт, а в проде каждое задание получит `CALIBRATION_IDENTITY_INVALID` и ежедневный подбор молча не заработает.
**Fix:** в интеграционном тесте очереди запустить `startCalibrationRuntime` без `dependencies` на реальном Redis с тестовой БД и дождаться квитанции, либо вынести фабрику `execute` в экспортируемую функцию и проверить её отдельно.

## Info

### IN-01: Тесты-тавтологии в наборе переходов

**File:** `tests/integration/calibration-transitions.test.ts:233, 256, 281-282`
**Issue:** `SELECT count(*) FROM current_calibrators WHERE ...` возвращает не больше одной строки на ключ по определению вида (`DISTINCT ON`), поэтому `toEqual(["1"])` не может отличить одну промоцию от двух. Реальную проверку выполняет соседняя `fulfilled.toHaveLength(1)`. Строки 281-282 сортируют `seqs`, полученные из запроса `ORDER BY seq`, и сравнивают с самим собой: проверка всегда истинна. Настоящая проверка порядка это `sequence` (строка 280).
**Fix:** заменить на `SELECT count(*) FROM "CalibratorEvent" WHERE type='PROMOTED' AND ...` и убрать самоссылающуюся проверку сортировки.

### IN-02: Тесты параллельных вставок через `psql -c` могут проходить без блокировки

**File:** `tests/integration/calibration-transitions.test.ts:249-257`
**Issue:** два процесса `docker exec psql` стартуют с разбросом в десятки миллисекунд, а транзакция занимает миллисекунды. Конкуренция не гарантирована, и тест пройдёт и без `pg_advisory_xact_lock` в триггере: второй просто увидит уже зафиксированную строку. Тест на перевыпуск `seq` (259-266) проверяет пропуск номера, а не порядок при гонке.
**Fix:** удержать первую транзакцию открытой (`BEGIN; INSERT ...; SELECT pg_sleep(1); COMMIT`) в одном `psql`, пока второй вставляет, и убедиться, что второй ждёт и затем получает отказ.

### IN-03: `parseMarketCalibrationMap` не используется в боевом коде

**File:** `packages/domain/src/calibration/view.ts:192-274`
**Issue:** строгий разбор ответа экспортирован и покрыт тестами, но не вызывается ни API, ни веб-клиентом (`page.tsx` приводит ответ типом `as Promise<readonly CalibratedForecastResponseDto[]>`). Заявленная «строгость контракта ответа» (T-12-06) существует только в тестах. UI защищается собственными проверками (`isProbabilityList`, `Number.isInteger`), что приемлемо.
**Fix:** вызвать разбор в `loadForecasts` (с деградацией до UNAVAILABLE при ошибке) либо в сервисе API перед возвратом, либо отметить функцию как тестовую.

### IN-04: Тексты причин в UI вводят в заблуждение для двух случаев

**File:** `apps/web/app/fixtures/[fixtureId]/calibration-copy.ts:34-41`
**Issue:** `CALIBRATOR_INVALID` и `CALIBRATOR_MARKET_MISMATCH` показывают тот же текст, что и несоответствие версии модели, хотя причина другая (битые параметры, ошибка рынка). Для `NO_PROMOTED_CALIBRATOR` («ещё не утверждён») не различается ситуация «никогда не утверждали» и «автоматически откатили до сырых»: слово «ещё» подразумевает будущее утверждение, а откат уже произошёл.
**Fix:** отдельные тексты, например: «Калибратор для этой версии модели отключён или не утверждён» и «Калибратор не может быть применён: параметры повреждены». Различие отката можно передавать отдельным кодом `ROLLED_BACK_TO_RAW` (потребует расширить закрытый набор кодов).

### IN-05: Сходимость Platt не проверяется, знак наклона не ограничен

**File:** `packages/domain/src/calibration/platt.ts:93-163`, `packages/domain/src/calibration/calibrator.ts:243-246`
**Issue:** `converged` и `iterations` сохраняются в параметрах, но никакой код не отклоняет неcошедшуюся подгонку. Наклон может стать отрицательным (при выборке с обратной связью), и тогда «калибровка» инвертирует монотонность: калиброванная вероятность падает при росте сырой. Защитой служит только дельта холдаута. Практически маловероятно из-за prior `lambda = 1` и размера выборки, но тест «известной miscalibration» это не покрывает.
**Fix:** при `converged === false` или `slope <= 0` считать подгонку непригодной (`INSUFFICIENT_DATA` или кандидат не сохраняется), записав причину в квитанцию.

### IN-06: Каждый новый исход порождает новую неизменяемую строку-кандидата

**File:** `workers/data-sync/src/jobs/calibration.ts:156-159`, `packages/database/prisma/migrations/20261125_phase12_calibrator_tables/migration.sql:127-132`
**Issue:** `persistCalibrator` вызывается до решения о продвижении, а `samplesDigest` меняется с каждым исходом. За день на каждую пару `(идентичность, рынок)` появляется новая строка `Calibrator`, включая непродвигаемые. Триггер запрещает DELETE, так что очистить это нельзя. При изотонике (`до 3 x 1500` узлов JSON на строку) рост заметен.
**Fix:** сохранять кандидата только если он `promotable` или является активным; для непродвигаемых писать в квитанцию, но не в таблицу.

### IN-07: `knownAt` берётся из времени захвата, а не фиксации результата

**File:** `packages/database/src/calibration-fit-data.ts:183-184`, `workers/data-sync/src/jobs/calibration.ts:147`
**Issue:** `knownAt = min(observedAt)` где `observedAt = result.capturedAt` (`results-persistence.ts`), а транзакция фиксируется позже. Исход, захваченный до `asOf` задания, но зафиксированный после его чтения, имеет `knownAt <= boundary` и никогда не попадёт ни в одно окно оценки (подбор подхватит его в следующий день, оценка нет). Окно очень узкое (секунды), эффект малый и смещения в одну сторону нет.
**Fix:** использовать `createdAt` ResultVersion для границы окон оценки либо брать границу как `min(asOf, момент старта чтения)`.

### IN-08: Избыточные предикаты в запросе выборки (necessity)

**File:** `packages/database/src/calibration-fit-data.ts:111, 114`
**Category:** necessity
**Issue:** `cutoff: { lt: asOf }` и `fixture: { kickoffUtc: { lte: asOf } }` запускаются, но ничего не защищают: далее код отбрасывает снимки с `cutoff >= kickoffUtc` (строка 132), а фикстура без видимого результата на `asOf` пропускается (строка 170), и `effectiveAt` результата равен `kickoffUtc` (`results-persistence.ts`), так что `kickoffUtc <= asOf` следует из видимости результата. SUMMARY 12-04 прямо признаёт: «subsumed by result visibility». Это суждение по обоснованию в репозитории; фильтры сокращают выборку из БД, поэтому удалять их не обязательно, но они не являются защитой от утечки и не заслуживают заявленных «guard» (мутационной проверки для них нет).
**Fix:** оставить как оптимизацию с комментарием «prefilter, not a leakage guard», или удалить.

## Disposition (исправления, итерация 1; подробности в 12-REVIEW-FIX.md)

| Находка | Решение | Коммит |
|---|---|---|
| WR-01 | fixed: правило доказательства после отката в чистом слое жизненного цикла | `e6cf68d` |
| WR-02 | fixed: изоляция рынков и подгонки; автооткат структурно повреждённого калибратора: needs-decision | `1324332` |
| WR-03 | fixed: оценка и откат одной транзакцией | `92f05d3` |
| WR-04 | fixed минимально (оговорка в карточке модели); разделение выбора и продвижения: needs-decision (нужен calibration-config-v2) | `da5a04e` |
| WR-05 | fixed: сравнение сохранённого и вычисленного содержимого, `CALIBRATOR_CONTENT_MISMATCH` | `fa4df06` |
| WR-06 | fixed: пропуск переписи, TTL-кеш, параллельные чтения | `6ae29fe` |
| WR-07 | fixed: warn-журнал без секретов | `e4f5dd7` |
| WR-08 | fixed только наблюдаемость (`retiredIdentities`); жизненный цикл ушедших идентичностей: needs-decision | `8d234e6` |
| WR-09 | fixed: интеграционный тест боевой ветки `startCalibrationRuntime` | `1c68f92` |

Info (IN-01..IN-08) не исправлялись: ни одно исправление Warning не затронуло их тесты и тексты.

---

_Reviewed: 2026-11-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
