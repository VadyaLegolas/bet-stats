---
phase: 11-dixon-coles-model-version
reviewed: 2026-11-24T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - packages/database/prisma/migrations/20261123_phase11_settlement_chain_per_forecast/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/database/src/evaluation/settlement-pipeline.ts
  - scripts/model-comparison.mjs
  - workers/data-sync/src/jobs/forecast-sweep.ts
  - workers/data-sync/src/jobs/forecasts.ts
  - workers/data-sync/src/jobs/model-comparison.ts
  - workers/data-sync/src/jobs/model-comparison-cli.ts
  - tests/integration/backtest-model-comparison-e2e.test.ts
  - tests/integration/backtest-model-comparison.test.ts
  - tests/integration/phase-03-security.test.ts
  - tests/integration/settlement-chain-upgrade.test.ts
  - tests/integration/settlement-multi-forecast.test.ts
  - tests/unit/model-comparison-operator.test.ts
findings:
  critical: 1
  warning: 7
  info: 5
  total: 13
status: issues_found
---

# Phase 11: Code Review Report (gap-closure plans 11-05..11-07)

**Reviewed:** 2026-11-24
**Depth:** standard
**Range:** `219998b..HEAD`
**Files Reviewed:** 14 (generated Prisma client skipped)
**Status:** issues_found

## Summary

Предыдущее ревью (CR-01..IN-04) закрыто, см. таблицу Disposition в конце файла. Здесь только новые находки по правкам 11-05..11-07; они нумеруются дальше: CR-03, WR-07..WR-13, IN-05..IN-09.

Проверено и признано корректным:

- Миграция `20261123_phase11_settlement_chain_per_forecast`:
  - `DROP CONSTRAINT "SettlementReceipt_fixtureId_revision_key"` валиден, потому что исходная миграция `20260908` создавала его как табличный `UNIQUE (...)`, то есть настоящий constraint, а не индекс.
  - Имя нового уникального индекса совпадает с именем, которое Prisma выводит из `@@unique([fixtureId, forecastSnapshotId, revision])`.
  - Блок `DO` проверяет непрерывность цепочки `min=1 AND max=count` по `(fixtureId, forecastSnapshotId)`. Под старым уникальным ключом у фикстуры не могло быть больше одной цепочки, так что проверка полна.
  - Из старых данных ничего не обновляется и не удаляется. Guard-функция не менялась и уже требовала предшественника того же прогноза.
  - `persist_settlement_receipt` теперь нумерует через `MAX(revision)` по `(fixtureId, forecastSnapshotId)`. Advisory lock по фикстуре остаётся строго шире цепочки, поэтому гонок внутри фикстуры нет.
- Ключи advisory lock `"<id>:settlement"` и `"<id>:settlement-intake"` не пересекаются: одна строка не может заканчиваться обоими суффиксами. Цикл holder/worker невозможен, потому что внутренний ключ берётся строго после внешнего и никто не берёт их в обратном порядке.
- Semaphore: `acquire` стоит вне `try`, `release` в `finally`, передача слота ожидающему корректна. Утечки слота при ошибке `work()` нет.
- Отбор когорты: точная отсечка проверяется равенством `cutoff IN (...)`, tie-break детерминирован по `(kickoff, id)` кодовыми единицами, пропуски считаются в порядке проверок, `allowSmallCohort` исключён из хеша `pairId` через `undefined` в `JSON.stringify`.

Основная проблема новой работы: когорта выбирается по `effectiveAt` результата, а бэктест требует `observedAt`, поэтому «пригодное» окно может гарантированно упасть и утащить за собой весь план (CR-03). Остальное касается блокировки намерения (таймаут без отмены), ожидания воркера в CLI, идентичности пары планов и тестов, которые не проверяют заявленное.

Necessity-review не выполнялся (`necessity-review.md` не загружался), поэтому счётчик `necessity:` не выдаётся.

## Critical Issues

### CR-03: Когорта отбирает матчи по `effectiveAt` результата, а окно бэктеста требует `observedAt <= evaluationAsOf`, поэтому «пригодный» матч детерминированно роняет весь план

**File:** `workers/data-sync/src/jobs/model-comparison.ts:160, 248-270` (исполнитель: `packages/database/src/evaluation/backtest-repository.ts:26-30, 88`)
**Issue:** `listComparisonFixtures` берёт `resultVersions` с `orderBy effectiveAt asc, take 1` и кладёт в `firstResultEffectiveAt` только `effectiveAt`. `planComparisonCohort` проверяет `firstResultEffectiveAt <= kickoff + evaluationLagHours`. Но `evaluateWindow` читает версии результата с `"observedAt" <= asOf AND "effectiveAt" <= asOf`, и `resolveHistoricalResultGraph` при пустом наборе бросает `RESULT_NOT_AVAILABLE`. Достаточно, чтобы результат был залит позже `kickoff + 48h` (бэкфилл, сбой провайдера, free-tier бюджет), и матч:

1. считается пригодным и входит в `report.usable`;
2. получает прогноз, а затем окно падает в `evaluateWindow`;
3. помечает окно `FAILED`, а `waitForPlans` возвращает `FAILED`, и квитанция не строится.

Один такой матч из 30 срывает весь запуск. Так как `planId` и `jobId` детерминированы, повтор с теми же параметрами не помогает (см. WR-09). Дополнительно: берётся первая версия по `effectiveAt`, а не «первая известная на момент `asOf`», а статус версии не проверяется. Если результат на `asOf` был `VOID`, `POSTPONED` или `ABANDONED`, а позже стал `FINISHED`, то `fixture.status = FINISHED` пройдёт фильтр, настройка даст `scoreability != SCOREABLE`, и окно упадёт с `BACKTEST_SCORE_IDS_EMPTY`.
Тесты этого не ловят: во всех сидах `observedAt` совпадает с `effectiveAt` или идёт раньше `asOf`.
**Fix:** отбирать по тому же предикату, который исполняет бэктест. Либо вернуть из запроса все версии `{id, observedAt, effectiveAt, supersedesResultVersionId, status}` и вызвать `resolveHistoricalResultGraph(rows, id, evaluationAsOf)`, пропуская матч при исключении `RESULT_NOT_AVAILABLE` и при `status !== "FINISHED"` у листа. Либо как минимум считать момент известности как `GREATEST(observedAt, effectiveAt)` по самой ранней версии:

```ts
const knownAt = (v: { observedAt: Date; effectiveAt: Date }) => Math.max(v.observedAt.getTime(), v.effectiveAt.getTime());
// firstResultKnownAt = min over versions of knownAt(v)
```

Добавить тест, где `observedAt = kickoff + 72h`, `effectiveAt = kickoff + 2h`, и матч попадает в `noResultByEvaluationAsOf`.

## Warnings

### WR-07: Таймаут holder-транзакции не отменяет работу: замок отпускается, пока worker ещё пишет, а слот семафора освобождается раньше соединения

**File:** `packages/database/src/evaluation/settlement-pipeline.ts:81-124` (`withIntakeLock`)
**Issue:** Holder это интерактивная транзакция Prisma с `timeout: 75_000`. Если она истекает, Prisma откатывает holder (advisory lock снимается) и бросает `P2028`, но `work()` никто не прерывает: Serializable-транзакция worker продолжает выполняться и может закоммитить. Последствия:

- Взаимное исключение по фикстуре нарушено ровно тогда, когда работа затянулась. Следующий дубль берёт замок и стартует Serializable-транзакцию, пока предыдущая ещё идёт, то есть возвращается исходная проблема SQLSTATE 40001, ради решения которой замок и введён.
- Вызывающий видит `P2028`, хотя квитанции записаны. BullMQ повторяет задачу, и результат приходит как `duplicate`. Данные целы благодаря уникальному ключу и идемпотентной ветке, но ошибка вводит в заблуждение.
- Слот семафора освобождается в `finally` сразу после отказа. Если в этот момент holder ещё ждёт `pg_advisory_xact_lock` (запрос в полёте нельзя отменить `ROLLBACK`-ом на том же соединении), то соединение пула остаётся занятым, а слот уже выдан другому. Допущение «не больше 3 холдеров на клиент» нарушается.
- У `Semaphore.acquire` нет таймаута. Три зависших дубля одной фикстуры на 75 с блокируют все остальные фикстуры.

Запас прочности невелик: худший случай `withSerializableRetry` это 3 × (5 с maxWait + 15 с timeout) = 60 с, а 75 с оставляет 15 с на `afterSettlement` и очереди к пулу.
**Fix:** передать в `work` `AbortSignal`/дедлайн и проверять его между шагами цепочки (перед каждым `processRevision`); задавать таймаут holder как `ATTEMPTS * (maxWait + timeout) + запас`, вычисляемый из тех же констант, а не отдельным литералом; добавить таймаут ожидания семафора с кодом ошибки. Не освобождать слот, пока holder не завершился (`await` на завершение `$transaction` в `finally`, а не на возврат ошибки таймаута). Покрыть тестом (см. WR-10).

### WR-08: `waitForPlans` объявляет `FAILED` при первом упавшем окне, хотя BullMQ ещё повторит задачу

**File:** `workers/data-sync/src/jobs/model-comparison.ts:316` (политика повторов: `workers/data-sync/src/queues/index.ts:15, 65`; переход `FAILED -> RUNNING`: `packages/database/src/evaluation/backtest-repository.ts:82`)
**Issue:** `runBacktestPlan` при исключении ставит окно в `FAILED` и пробрасывает ошибку; задача имеет `attempts: 3` с экспоненциальной задержкой, и `claimWindow` намеренно разрешает `FAILED -> RUNNING`. `waitForPlans` читает каждые 5 с и при `windows.FAILED > 0` сразу возвращает `FAILED` и печатает «Один из планов завершился ошибкой. Квитанция не строится.» и код 1. Любой транзитный сбой (сериализация, соединение, rate limit) превращается в ложный отказ оператору, хотя повтор через секунды завершил бы план. Состояние «попытка упала» и «задача окончательно упала» не различаются.
**Fix:** считать отказ окончательным только по признаку плана или задачи, а не окна. Например, читать `BacktestPlan.state === "FAILED"` (если воркер выставляет его после исчерпания попыток), либо `Queue.getJob(...).attemptsMade >= attempts`. Иначе подождать ещё `attempts × max backoff`, прежде чем объявлять `FAILED`.

### WR-09: После окончательного сбоя повторный `run` с теми же параметрами не перезапустит плановую задачу

**File:** `workers/data-sync/src/jobs/model-comparison.ts:226-243, 275-280` (jobId: `workers/data-sync/src/queues/index.ts:65`)
**Issue:** `submitComparisonPair` идемпотентен по построению: `planId = cmp-<pairId>-…`, `jobId = backtest-<planId>-<planHash>`, `removeOnFail: { age: 604_800 }`. Вывод основан на семантике BullMQ, не на запуске: `queue.add` с уже существующим `jobId` игнорируется, пока упавшая задача хранится (7 суток). Тогда `admitPersistEnqueueBacktest` отмечает доставку `DELIVERED`, а воркер ничего не делает. `waitForPlans` сразу видит окно `FAILED` и снова возвращает 1. Оператор не может исправить причину (например, добавить недостающие доказательства) и перезапустить без ручного удаления задачи из Redis или смены параметров. Сочетание с CR-03 и WR-08 делает ложный сбой почти необратимым.
**Fix:** перед повторной подачей проверять состояние плана; для планов с `FAILED` окнами удалять/переставлять задачу (`job.retry()` или `queue.remove(jobId)` перед `add`) и добавить CLI-команду `retry`. Покрыть тестом на реальной очереди (e2e сейчас проверяет только повтор после успеха).

### WR-10: Тест «шесть одновременных доставок выше порога» не может упасть при удалении семафора

**File:** `tests/integration/settlement-multi-forecast.test.ts:180-188`
**Issue:** Семафор нужен, чтобы холдеры РАЗНЫХ фикстур не заняли весь пул (по умолчанию `pg.Pool` max 10) и не оставили worker-ам соединений. Тест запускает 6 вызовов для ОДНОЙ фикстуры: пять холдеров стоят на одном advisory lock и не требуют worker-соединений, работает только первый. Требуется ~7 соединений из 10, поэтому тест проходит и без `INTAKE_MAX_HOLDERS`. Заявленное в заголовке «above the intake cap» ничего не проверяет. Не проверены ни вытеснение фикстур друг другом, ни таймаут holder, ни освобождение замка и слота при ошибке `work`.
**Fix:** добавить тест с N > 5 разными фикстурами одновременно (например, 12, пул 10): без семафора он падает с `P2024`/таймаутом, с семафором проходит. Добавить тест, в котором `afterSettlement` бросает исключение: следующий `process` для той же фикстуры должен пройти сразу (замок и слот освобождены). Добавить тест таймаута holder (малое `INTAKE_HOLDER_TIMEOUT_MS`, вынесенное в параметр сервиса).

### WR-11: `describeComparison` жёстко подписывает стороны как V1/DC, хотя `compare` принимает произвольные `--left`/`--right`

**File:** `workers/data-sync/src/jobs/model-comparison.ts:333-346`; `workers/data-sync/src/jobs/model-comparison-cli.ts:117-122`
**Issue:** Текст вердикта собран из констант («V1», «DC лучше», «DC хуже»), а вердикт в домене означает «правая сторона лучше/хуже левой». При `compare --left <DC plan> --right <V1 plan>` или двух планах одной модели оператор получит «DC лучше» о V1: заключение противоположно фактическому. Для продукта с правилом «никаких overclaim-ов» это содержательная ошибка, а не стиль. Ни одна проверка не требует, чтобы левый план был `poisson-ensemble-v1`, а правый `dixon-coles-ensemble-v1`.
**Fix:** формировать подписи из `receipt.left.modelVersion` и `receipt.right.modelVersion` («правая модель X лучше левой Y»). В `compare` отказывать (`COMPARISON_MODELS_UNEXPECTED`), если модели сторон не равны `COMPARISON_MODELS`, либо явно печатать обе версии в первой строке.

### WR-12: Идентичность пары планов не включает конфигурацию моделей и включает рынок

**File:** `workers/data-sync/src/jobs/model-comparison.ts:226-227`
**Issue:** `pairId` = хеш от `{resolved, windows}`. Две стороны:

- В хеш не входят `configHash`/`modelVersion` сторон. После смены конфигурации DC при тех же параметрах и том же наборе окон `planId` не меняется, а `planHash` меняется, и `createPlan` бросает `BACKTEST_PLAN_ID_CONFLICT`. Оператор не может повторить сравнение за тот же период без искусственного изменения параметров.
- В хеш входит `market`, хотя окна и обе модели от рынка не зависят (каждая расчётная квитанция даёт скоры по всем трём рынкам, а `compare` выбирает рынок отдельно). `run --market BTTS` после `run --market ONE_X_TWO` создаёт новую пару планов и повторяет всю работу, дублируя прогнозы и расчёты.

**Fix:** убрать `market` (и `concurrency`, не влияющий на результат) из хеша идентичности; добавить в него `forecastConfigHashFor(COMPARISON_MODELS.left|right)`. Тест: смена рынка даёт тот же `pairId`; смена конфигурации модели даёт новый.

### WR-13: Операторское сравнение пишет ретро-прогнозы и скоры в тот же пул, из которого публичная scorecard считает метрики

**File:** `workers/data-sync/src/jobs/model-comparison.ts:275-280` (запись), `apps/api/src/modules/evaluation/evaluation.service.ts:143-160` (чтение; вне списка файлов, проверено только это место)
**Issue:** Бэктест публикует PRE_MATCH-снимки через тот же `publish`, то есть новую ревизию в цепочке реальной фикстуры (`supersedesForecastId` = продакшен-прогноз), а после этой миграции каждый такой снимок получает собственную цепочку квитанций и скоры. `load()` scorecard читает все `forecastScore` с `supersededBy: null` без фильтра по инициатору. Для когорты `modelVersion: "all"` одна фикстура вносит скоры продакшен-прогноза, V1-бэктеста и DC-бэктеста, то есть выборка искусственно умножается; в когортах по модели ретро-прогнозы (с `issuedAt` = «сейчас», а не момент отсечки) смешиваются с реальными. Кроме того, `valueByFixture = new Map(values.map(r => [r.fixtureId, ...]))` ключуется по фикстуре и теряет значения, когда у фикстуры теперь возможно несколько расчётных квитанций. Миграция делает это состояние штатным, а команда оператора его массово создаёт.
**Fix:** пометить снимки бэктеста (`initiator` уже передаётся в оркестратор; сохранять в `ForecastSnapshot`/`ForecastScore` источник `BACKTEST`) и исключить их из `load()` и из `findIssued`/`listIssued` продакшена, либо изолировать отдельным представлением `current_forecast_scores_production`. Ключевать `valueByFixture` по `(fixtureId, settlementReceiptId)`. Добавить интеграционный тест: после `run` публичная scorecard не меняется.

## Info

### IN-05: «Запас в одни сутки» для окна диапазона неверен при `--cutoff-hours` больше 24

**File:** `workers/data-sync/src/jobs/model-comparison.ts:30-31, 115, 237`; usage в `model-comparison-cli.ts:33`
**Issue:** `COMPARISON_MAX_SPAN_DAYS = maxSpanDays - 1` рассчитан на сдвиг `rangeFrom` назад на 6 ч. Но `positiveHours` допускает `cutoffHoursBeforeKickoff` до 1440 ч, и `rangeFrom = min(from, windows[0].forecastCutoff)` сдвигается ровно настолько. При диапазоне 365 суток и `--cutoff-hours 48` span = 367 суток, и `admitBacktestPlan` бросает `BACKTEST_LIMIT_EXCEEDED` уже после печати отчёта о когорте. Usage обещает «не больше 365 суток». Отказ безопасный, но сообщение вводит в заблуждение.
**Fix:** проверять `span + cutoffHours <= maxSpanDays * DAY_MS` в `resolveComparisonParams` с понятным кодом и поправить комментарий и usage.

### IN-06: `--league ""` и `--league ,` молча означают «все лиги»

**File:** `workers/data-sync/src/jobs/model-comparison-cli.ts:83`
**Issue:** `str("league")` с пустой строкой ложно, поэтому фильтр не применяется. Оператор с неопределённой переменной окружения (`--league "$LEAGUE"`) получит сравнение по всем лигам вместо отказа.
**Fix:** при наличии флага `--league` с пустым результатом после `split/trim/filter(Boolean)` бросать `INVALID_LEAGUE`. Валидность формата id можно ограничить шаблоном `^[A-Za-z0-9_-]{1,64}$`.

### IN-07: `process.exit(code)` сразу после записи в stdout

**File:** `scripts/model-comparison.mjs:24-29`
**Issue:** После `process.stdout.write` вызывается `process.exit(code)`. На платформах, где запись в pipe асинхронна (например, Windows, где этот репозиторий разрабатывается), длинный JSON квитанции при перенаправлении может быть обрезан. Вывод основан на документации Node по `process.stdout`, не на воспроизведении. Также `createBacktestQueue` вызывается вне `try`: ошибка конструктора пропустит `$disconnect` и даст необработанное исключение вместо кода 1.
**Fix:** использовать `process.exitCode = code` и дать event loop завершиться (после `queue.close()` и `$disconnect()`); перенести создание очереди внутрь `try`.

### IN-08: `INTAKE_MAX_HOLDERS = 3` привязан к неявному размеру пула

**File:** `packages/database/src/evaluation/settlement-pipeline.ts:93-94`
**Issue:** Комментарий выводит лимит из «двух соединений на вызов», но размер пула нигде не задан и не проверяется: `createPrismaClient` создаёт `PrismaPg({ connectionString })` с дефолтным `max = 10`. Тот же клиент использует вся воркерная часть (settlement-воркер с `concurrency: 2`, бэктесты, прогнозы, evidence), поэтому 3 холдера плюс 3 worker-транзакции плюс остальные задачи могут исчерпать пул; тогда срабатывает `maxWait` 5 с и задача уходит в повтор. Это магические числа без связи с конфигурацией.
**Fix:** вынести `max` пула и лимит холдеров в общую конфигурацию (`holders = floor((poolMax - reserved) / 2)`), логировать при ожидании семафора.

### IN-09: Тесты фиксируют слабые или тавтологичные проверки

**File:** `tests/integration/backtest-model-comparison-e2e.test.ts:233-236, 265-273`; `tests/unit/model-comparison-operator.test.ts:94-111, 148-151, 305-316`
**Issue:**
- e2e утверждает `|Δ Brier| < 1e-9` и `rho = 0` у всех DC-снимков: сравнивается V1 с самим собой под другой версией. Тест доказывает проводку, но не то, что DC-путь вообще отличается от V1; регресс, при котором коррекция никогда не применяется, этот тест не заметит. Ограничение документировано, но оно же закреплено ассертом, который упадёт, когда подстановка rho заработает.
- Unit-тест `listComparisonFixtures` подменяет `fixture.findMany` и не проверяет `where` (статус `FINISHED`, границы `[from, to)`, фильтр лиг). Фильтр лиг не покрыт нигде: e2e использует одну лигу.
- Первая половина «keeps the pair identity independent of the small-cohort flag» сравнивает два вызова с одним и тем же флагом (тавтология); реальную проверку делает только вторая половина.
- В «prints the cohort report before waiting» ожидание завершается `TypeError` от фейковой БД без `backtestPlan`, а `.catch(() => undefined)` гасит любую ошибку, включая сбой подачи; `--timeout-minutes 0` ничего не проверяет.

**Fix:** добавить интеграционный сценарий с историей, достаточной для ненулевого rho, и ассертом `Δ != 0`; проверять `where`, переданный в `findMany`; заменить `.catch` на явный `rejects.toThrow(/backtestPlan|…/)` либо на фейк с `backtestPlan.findUnique`.

---

_Reviewed: 2026-11-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Disposition of the previous review (CR-01..IN-04), 2026-11-23

Все находки предыдущего ревью закрыты, ссылки на коммиты и решения сохранены без изменений.

| Finding | Status | Where |
|---------|--------|-------|
| CR-01 | fixed | `2f8cea6` |
| CR-02 | fixed | `2f8cea6` |
| WR-01 | fixed | rho bounds `max(-1/λh, -1/λa) < ρ < min(1/(λh·λa), 1)`; test λ=(2,2) |
| WR-02 | fixed | bisection bracketed at `min+ε` / `max-ε`; non-finite scores fall back |
| WR-03 | fixed | out-of-band fitted rho degrades to explicit `rho = 0`, method `out-of-band-zero` (recorded in receipt); `assertDixonColesRho` throws a coded error |
| WR-04 | fixed | fit uses only snapshots with `issuedAt <= asOf`, newest usable revision per fixture. Residual closed by the origin filter in the rho fit (`origin = PRODUCTION`, quick task `261124-88x`, commit `69a921c`): backtest snapshots no longer move the rho of live forecasts. Caveat: backtest rows written before the `20261124_phase11_forecast_snapshot_origin` migration are labelled PRODUCTION and stay in the fit at `asOf = now` (см. также WR-13 в этом ревью) |
| WR-05 | fixed | scored-cohort windows, fixture-set identity, `[from, to)`, `minimumSampleSize = 30`, policy `model-comparison-v2` |
| WR-06 | fixed | card bounds string, rho policy/fallbacks, page no longer claims a public comparison view |
| IN-04 | fixed | «μ» replaced with λh / λa |
| IN-01 | fixed (partly) | one shared `canonicalJson` (code-unit key order) replaces the 3 copies; V1 hashes unchanged (regression suite green). Not changed: the `sources` array sort in `model.ts` still uses `localeCompare` on canonical strings, because switching it could re-order sources and shift stored V1 `inputHash` values; `provider-routing.ts` keeps its own copy |
| IN-02 | fixed | `admitBacktestPlan` throws `BACKTEST_CONFIG_HASH_MISMATCH` before persist/enqueue |
| IN-03 | fixed | `DIXON_COLES_RHO_UNAVAILABLE`, `MODEL_VERSION_MISMATCH`, `CONFIG_HASH_MISMATCH`, `FORECAST_RUNTIME_IDENTITY_MISMATCH` → HTTP 503 |

## Disposition of this review (CR-03..IN-09), 2026-11-24

Исправления применены агентом gsd-code-fixer, подробности и тесты в `11-REVIEW-FIX.md`. Info-находки вне области этого прохода.

| Finding | Status | Where |
|---------|--------|-------|
| CR-03 | fixed | `023b5e5`; когорта проигрывает предикат бэктеста через `resolveHistoricalResultGraph` на `evaluationAsOf` |
| WR-07 | fixed (partly) | `eee1f38`; дедлайн работы раньше таймаута holder, слот освобождается после завершения holder, ожидание слота ограничено. Остаётся: один уже идущий шаг нельзя прервать |
| WR-08 | fixed | `36658e4`; FAILED окно финально только когда задача очереди не может больше выполняться |
| WR-09 | fixed | `d428b22`; повторная подача снимает окончательно упавшую задачу и ставит план заново |
| WR-10 | fixed | `eb142e0` (тесты); тест holder timeout вошёл в `eee1f38` |
| WR-11 | fixed | `1cd0fef`; подписи сторон берутся из квитанции |
| WR-12 | fixed | `c00db87`, `38afdb6`; `pairId` без `market`, с хешами конфигурации моделей; `concurrency` оставлен в идентичности, потому что он часть `planHash`. Идентификаторы прежних пар изменились |
| WR-13 | fixed | quick task `261124-88x`: `ForecastSnapshot.origin` (`PRODUCTION`/`BACKTEST`, миграция `20261124_phase11_forecast_snapshot_origin`) `d596308`; публичные читатели и фит ρ только по `PRODUCTION` `69a921c`; регрессионные тесты на реальном PostgreSQL `5926661`; закрытие и backlog `docs(11): WR-13`. Отдельно: `valueByFixture` вынесен в `deferred-items.md` (решение по `valueReceiptId`), см. `11-REVIEW-FIX.md` |
| WR-13 (backlog) | open | `valueByFixture` теряет значения при нескольких квитанциях одной фикстуры, см. `deferred-items.md` |
| IN-05..IN-09 | open | вне области прохода |

