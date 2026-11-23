# Операторское сравнение V1 и Dixon-Coles

Команда `scripts/model-comparison.mjs` (npm-скрипт `pnpm model:compare`) подаёт два rolling-origin плана — `poisson-ensemble-v1` и `dixon-coles-ensemble-v1` — на **одних и тех же окнах**, ждёт воркер и печатает квитанцию `model-comparison-v2`. Закрывает UAT-пункт 2 фазы 11.

Квитанция информационная: модель **не продвигается автоматически**, дефолт `dixon-coles-ensemble-v1` не меняется, результаты прошлых матчей не гарантируют будущих.

## Почему CLI-скрипт, а не эндпоинт

- Подача планов — запись плюс постановка в очередь; оператору нужен контроль диапазона и параметров, а не публичный HTTP-вход. Скрипт не расширяет поверхность API и не требует eligibility-заголовков.
- Образец в репозитории: `scripts/seed-configured-leagues.mjs` (операторский скрипт над БД). Логика вынесена в `workers/data-sync/src/jobs/model-comparison.ts` и `model-comparison-cli.ts`, поэтому покрыта тестами; `.mjs` только подключает зависимости.
- Квитанция строится тем же кодом, что и `GET /evaluation/model-comparison` (`compareBacktestPlans` + `toModelComparisonResult`), а эндпоинт остаётся рабочим (см. ниже).

## Предусловия

1. Собранный проект: `pnpm build` (скрипт использует `dist`).
2. Запущен воркер `data-sync` (он исполняет планы из очереди; для DC ρ фитится на `trainingEndsAt` каждого окна).
3. Переменные окружения: `DATABASE_URL`, `REDIS_URL`, при нестандартном префиксе очереди — `QUEUE_PREFIX` (как у воркера).
4. Node 24.

## Одна команда

```powershell
node scripts/model-comparison.mjs run --from 2026-08-01T00:00:00Z --to 2026-11-01T00:00:00Z --league league-pl,league-pd
```

Что происходит:

1. Из завершённых матчей (`FINISHED`, с известным результатом к `evaluationAsOf`) диапазона строятся окна: прогноз за 1 ч до матча, граница обучения (там фитится ρ) на 24 ч раньше прогноза, знание результата через 48 ч после матча. Окна строго возрастают по `forecastCutoff`; одновременные матчи различаются сдвигом на 1 мс.
2. Подаются два плана с `configHash = forecastConfigHashFor(modelVersion)` через `admitPersistEnqueueBacktest` и BullMQ.
3. Скрипт ждёт `SUCCEEDED` у обоих (по умолчанию до 30 минут) и печатает квитанцию.

Параметры: `--market ONE_X_TWO|OVER_UNDER_2_5|BTTS`, `--concurrency 1..4`, `--cutoff-hours`, `--training-lag-hours`, `--evaluation-lag-hours`, `--timeout-minutes`, `--json`. Не более 500 окон и 365 суток (лимиты `BACKTEST_LIMITS`); при превышении сузьте диапазон или лиги. `--dry-run` печатает пару планов и число окон, ничего не записывая.

Коды выхода: `0` — квитанция получена, `1` — недоступна или план упал, `2` — вышло время ожидания.

## Идемпотентность

Идентификаторы планов (`cmp-<хэш>-poisson`, `cmp-<хэш>-dixon-coles`) выводятся из параметров и набора окон. Повтор с теми же параметрами и тем же набором завершённых матчей не создаёт дубликатов: `createPlan` возвращает существующий план, а идентификатор задания в очереди детерминирован (`planId` + `planHash`). Если за время между запусками завершились новые матчи, набор окон меняется и подаётся новая пара.

## По шагам

```powershell
node scripts/model-comparison.mjs submit --from 2026-08-01T00:00:00Z --to 2026-11-01T00:00:00Z
node scripts/model-comparison.mjs status --left cmp-<хэш>-poisson --right cmp-<хэш>-dixon-coles
node scripts/model-comparison.mjs compare --left cmp-<хэш>-poisson --right cmp-<хэш>-dixon-coles --from 2026-08-01T00:00:00Z --to 2026-11-01T00:00:00Z
```

В `compare` значения `--from`, `--to` и `--market` должны совпадать с подачей: по ним отбираются оценки.

## Как читать вердикт

- Минимум выборки — `MODEL_COMPARISON_POLICY.minimumSampleSize` (30 исходов), порог существенности по Brier — 0.002.
- Выборка меньше 30 → всегда `INCONCLUSIVE`: это «нет доказательства», а не «DC не хуже V1». При ρ = 0 из-за нехватки истории DC и V1 почти совпадают, и `INCONCLUSIVE` трактуется так же.
- `WORSE` — валидный результат; он публикуется как есть и не скрывается.
- `available: false` с причиной (`PLAN_NOT_COMPLETE`, `COHORT_MISMATCH`, ...) — тоже честный ответ, а не вердикт.

## Через HTTP (по готовым планам)

```powershell
curl.exe -sS -G "$env:API/evaluation/model-comparison" `
  --data-urlencode "leftPlanId=cmp-<хэш>-poisson" --data-urlencode "rightPlanId=cmp-<хэш>-dixon-coles" `
  --data-urlencode "market=ONE_X_TWO" --data-urlencode "from=2026-08-01T00:00:00.000Z" --data-urlencode "to=2026-11-01T00:00:00.000Z" `
  -H "x-operator-credential: $env:OPERATOR_CREDENTIAL" -H "x-eligibility-region: <разрешённый регион>" `
  -H "x-age-acknowledged: true" -H "x-eligibility-checked-at: <текущий ISO-момент>"
```

Без `x-operator-credential` ответ — 404.

## Тесты

- `tests/unit/model-comparison-operator.test.ts` — окна, лимиты, идемпотентная подача, ожидание, честный текст при малой выборке.
- `tests/integration/backtest-model-comparison.test.ts` — реальные PostgreSQL и Redis: пара планов на идентичных окнах, повтор без дубликатов, `PLAN_NOT_COMPLETE` до работы воркера.
