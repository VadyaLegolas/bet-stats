---
phase: 11-dixon-coles-model-version
plan: "02"
status: complete
completed: "2026-11-23"
commits:
  - sha: 20098f0
    message: "feat(database): fit dixon-coles rho from leakage-safe league history"
  - sha: 05887e1
    message: "feat(config): select forecast model version with dixon-coles default"
  - sha: befe571
    message: "feat(forecast): issue dixon-coles forecasts by default across api and workers"
tests_added: 16
tests_total_after: 631
---

# Plan 11-02 Summary — Production ρ, Version Selector, dixon-coles as Default

## What Was Done

Доменная математика соединена с данными, production-дефолт переключён на `dixon-coles-ensemble-v1`, а `poisson-ensemble-v1` остался выбираемой версией одной переменной окружения. Все три пути выпуска прогнозов (API, sweep INITIAL/PRE_MATCH, LINEUP_CONFIRMED enrichment) получают версию и config hash из одного резолвера; литералов версии в них больше нет.

### Task 1 — ρ из данных (коммит `20098f0`)

- **`packages/database/src/dixon-coles-repository.ts`** (новый): `fitLeagueDixonColesParameters(client, { leagueId, asOf })` возвращает `{ rho, provenance }` **всегда** (только невалидный `asOf` → `INVALID_FORECAST_CUTOFF`); `createDixonColesParameterProvider(client)`.
  - Выборка: `forecastSnapshot` со `state: "ISSUED"`, `kind: "PRE_MATCH"`, `cutoff < asOf`, `fixture.kickoffUtc ∈ [asOf − 730d, asOf]`; дедупликация по `fixtureId` (первая = наибольшая `revision`); строки с `cutoff >= kickoffUtc` отбрасываются; λ читаются из `receipt.expectedGoals.home/away` и валидируются как конечные положительные (неполные квитанции `{}` пропускаются без исключения).
  - Результаты: один запрос `ResultVersion` с `observedAt <= asOf` и `effectiveAt <= asOf`, группировка по fixture, выбор версии через `resolveHistoricalResultGraph` (историческая линия на `asOf`); `RESULT_NOT_AVAILABLE`/`RESULT_VERSION_AMBIGUOUS` → строка пропускается.
  - Порядок оценки (D-08): лига ≥ `minLeagueMatches` (150) → `mle-low-score-v1`; иначе объединённая выборка всех лиг за то же окно ≥ `minPooledMatches` (300) → `pooled-fallback-v1` (ρ из объединённых строк, `sampleSize` = фактические строки лиги); иначе `rho: 0`, `insufficient-sample-zero`, `tauMin: 1`.
  - `provenance` всегда содержит `convention: "tau-1x2-v1"`, `windowFrom`, `windowTo = asOf`, `sampleSize`, `tauMin = min(dixonColesTauMin)` по использованным строкам.
- **`forecast-repository.ts`**: `findDixonColesParameters` подключён к возвращаемому объекту (`findFixture` с `leagueId` появился ещё в 11-01).
- **`packages/database/src/index.ts`**: экспорт `fitLeagueDixonColesParameters`, `createDixonColesParameterProvider`, типа `DixonColesParameters`.
- **`tests/integration/dixon-coles-rho.test.ts`**: 6 сценариев на реальном PostgreSQL (docker, миграции `migrate deploy`), см. «Отклонения» про генератор выборки.

### Task 2 — Селектор версии (коммит `05887e1`)

- **`packages/config/src/index.ts`**: `FORECAST_MODEL_VERSION: z.enum(MODEL_VERSIONS).default(DEFAULT_FORECAST_MODEL_VERSION)` в `environmentSchema` (значение автоматически попало в `ServerConfig`); `resolveForecastModelSelection(env) → { modelVersion, configHash }` — единственная точка соединения env и домена, неизвестное значение → `ConfigValidationError` с путём `FORECAST_MODEL_VERSION`.
- **`packages/config`** теперь зависит от `@bet-stats/domain` (`workspace:*`) и от `@types/node`; `tsconfig.json` получил `types: ["vitest/globals", "node"]`, потому что типы домена тянут `node:crypto`. `pnpm-lock.yaml` обновлён.
- **`workers/data-sync/src/jobs/forecasts.ts`**: `modelVersion: ForecastModelVersion` вместо литерала в `ForecastPublicationJobData`/`ForecastPublicationPlanInput`; `createForecastPublicationJobId` по-прежнему хэширует версию, поэтому jobId V1 и DC различаются.
- **`packages/config/src/index.test.ts`**: дефолт DC, V1-опт-ин с V1-хэшем, fail-closed на неизвестных значениях, `configHash === forecastConfigHashFor(version)`.

### Task 3 — Селектор на всех production-путях (коммит `befe571`)

- **`workers/data-sync/src/jobs/forecast-sweep.ts`**: `ForecastSweepDeps.modelVersion`/`configHash` (обязательные), оба литерала и `currentForecastConfigHash()` заменены входными значениями — jobId и снапшот всегда описывают одну версию.
- **`workers/data-sync/src/main.ts`**: `resolveForecastModelSelection(process.env)` вызывается один раз; значения идут и в `issueLineupForecastBase` (LINEUP_CONFIRMED), и в `sweepDeps`.
- **`apps/api/src/modules/forecasts/forecasts.service.ts`**: `selection` вычисляется в конструкторе; `generateForecast` принимает `selection` параметром с дефолтом из `process.env` (тесты передают V1 явно). Публичный контракт эндпоинта не изменился.
- **Тесты**: `tests/unit/forecast-sweep.test.ts` (+1 кейс: разные jobId для V1/DC при прочих равных, deps с версией), `tests/integration/forecast-api.test.ts` (+1 кейс: DC по умолчанию — `forecast-config-v2`, `receipt.dixonColes` с `rho: 0`/`insufficient-sample-zero`, вероятности совпадают с V1 в пределах `1e-12`), `tests/integration/forecast-publication.test.ts` (+1 кейс: обе идентичности через один публикатор, `receipt.dixonColes` только у DC).

## Фактические пороги и окно ρ

```
windowDays        730  (окно asOf − 730d … asOf)
minLeagueMatches  150  → mle-low-score-v1 по лиге
minPooledMatches  300  → pooled-fallback-v1 по всем лигам
otherwise              → rho = 0, insufficient-sample-zero, tauMin = 1
```

## Verification

- `pnpm vitest run --project unit` — **631/631** зелёные (56 файлов; было 624).
- `pnpm vitest run --project integration tests/integration/dixon-coles-rho.test.ts` — 6/6 (реальный PostgreSQL 18 в docker).
- `pnpm vitest run --project integration tests/integration/forecast-api.test.ts tests/integration/forecast-publication.test.ts` — 12/12.
- `tests/integration/forecast-snapshots.test.ts` — 4/4 против отдельного docker PostgreSQL (файл требует внешний `DATABASE_URL`, поэтому в общем прогоне без БД падает на импорте — это его прежнее поведение, не регрессия).
- `pnpm typecheck` — 7/7 задач зелёные.
- `git grep '"poisson-ensemble-v1"' -- apps/api/src workers/data-sync/src` — остались только `workers/data-sync/src/jobs/backtests.ts` (идентичность backtest-плана; переводится на версии в 11-03).
- `git diff --stat packages/database/prisma` — пусто: миграций и backfill нет, `ForecastSnapshot`/`ForecastScore` не переписываются.

## Как переключить V1

```
FORECAST_MODEL_VERSION=poisson-ensemble-v1   # затем перезапустить api и worker
```

Без переменной действует `dixon-coles-ensemble-v1`. Откат не мигрирует данные: новые прогнозы просто получают другую версию.

## Deviations

1. **Тест конфига лежит в `packages/config/src/index.test.ts`**, а не в `tests/unit/config-server.test.ts` — файла из плана не существует; unit-проект включает `packages/**/*.test.ts`.
2. **`packages/config` пришлось расширить зависимостями**: `@bet-stats/domain` (`workspace:*`), `@types/node`, `types: ["vitest/globals", "node"]`. Без `node` типы домена (`node:crypto`) не компилируются, и `pnpm typecheck` падал на `TS2307`.
3. **Генератор выборки в интеграционном тесте — детерминированное квотное распределение, а не случайные пропорции.** План требовал `|ρ − (−0.07)| < 0.03` при 200 матчах, но обычный Монте-Карло при таком N даёт разброс ρ порядка ±0.13 (эмпирически: −0.34 при N=200, −0.24 при N=400), то есть тест измерял бы шум выборки. Квоты по точной сетке `Poisson·Poisson·τ` держат четыре низкие клетки в пределах одного матча от модели; кроме того, вместо 35 профилей λ (по 5–6 матчей на профиль) используются 2 профиля с большими группами — иначе округление квот само смещало ρ к +0.04.
4. **Добавлена лига `dc-league-c` (400 матчей)**: сценарий 1 плана требует 200 матчей в лиге A, сценарий 2 — пул ≥ 300; чтобы не завышать лигу A, объём пула набирается отдельной лигой. Порог `minLeagueMatches` по-прежнему проверяется на 200.
5. **Сценарий «совсем нет истории» выполняется на `asOf = 2024-01-01`** (до всех матчей). При позднем `asOf` лига без своей истории корректно получает pooled-оценку — это и есть документированный порядок fallback-ов, поэтому «zero» проверяется в окне, где пуст и пул.
6. **Сценарии lookahead и неполной квитанции усилены**: проверяется не только `sampleSize === 0`, но и точное равенство ρ оценке по одному пулу (любая утёкшая строка сдвинула бы ρ). Дополнительно проверяется `method: "pooled-fallback-v1"` для лиги без собственных строк при непустом пуле.
7. **`tests/integration/forecast-snapshots.test.ts` менять не потребовалось**: он публикует снапшоты напрямую через репозиторий и никогда не использует дефолт `generateForecast`. Новый кейс на DC-идентичность и уникальность `modelHash` добавлен в `forecast-publication.test.ts`.
8. **`workers/data-sync/src/jobs/backtests.ts` сохраняет литералы V1** — это идентичность backtest-плана, её перевод на версии входит в 11-03 (MODEL-03).

## Осталось на 11-03 / 11-04

- 11-03: версии в backtest-планах, фит ρ строго на `window.trainingEndsAt`, comparison-квитанция (`planHash`, `windowsDigest`, Brier/log-loss, `BETTER`/`WORSE`/`INCONCLUSIVE`), `GET /evaluation/model-comparison`.
- 11-04: `model-card-v1.1.0` (гибрид назван гибридом), `/methodology`, e2e-пин из карточки.
