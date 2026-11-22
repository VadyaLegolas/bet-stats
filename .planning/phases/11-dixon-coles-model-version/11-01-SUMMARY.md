---
phase: 11-dixon-coles-model-version
plan: "01"
status: complete
completed: "2026-11-22"
commits:
  - sha: 77718d3
    message: "feat(forecast): widen model identity and split dixon-coles config"
  - sha: d11b106
    message: "feat(forecast): apply pinned dixon-coles low-score correction"
  - sha: a0ec682
    message: "feat(forecast): orchestrate both model versions with dixon-coles provenance"
tests_added: 3
tests_total_after: 624
---

# Plan 11-01 Summary — Domain Foundation: Version Union, Config Split, τ Math, ρ Estimator

## What Was Done

Заложен доменный фундамент фазы 11: единый union версий модели, раздельные конфиги (V1 не тронут), чистая τ-математика с закреплённой конвенцией и границами, детерминированный оценщик ρ, расширенный контракт и оркестратор, принимающий обе версии по явным параметрам. Production-пути пока не переключены — это план 11-02.

### Task 1 — Union версий + split-конфиги + V1 freeze-пин (коммит `77718d3`)

- **model-version.ts**: `MODEL_VERSIONS = ["poisson-ensemble-v1", "dixon-coles-ensemble-v1"]`, `ForecastModelVersion`, `DEFAULT_FORECAST_MODEL_VERSION = "dixon-coles-ensemble-v1"`, fail-closed `isForecastModelVersion`.
- **config.ts**: `FORECAST_CONFIG` не изменён ни на байт; добавлены `ForecastConfigVersion`, `FORECAST_CONFIG_VERSION_BY_MODEL`, `DIXON_COLES_CONFIG`, `FORECAST_CONFIGS`, `forecastConfigHashFor(version)`.
- **model.ts**: `ForecastDraft.modelVersion: ForecastModelVersion`, `configVersion: ForecastConfigVersion`; `ForecastInput.modelVersion?`/`dixonColes?`; дефолт без версии — V1.
- **contract.ts**: проверка версии через `isForecastModelVersion`, `configVersion` сверяется по карте `FORECAST_CONFIG_VERSION_BY_MODEL`.
- **index.ts**: экспорты новых символов.
- **tests/unit/forecast-model-version.test.ts**, **tests/unit/forecast-v1-regression.test.ts**: Wave 0 RED→GREEN и freeze-вектор.

### Task 2 — τ-математика и провенанс (коммит `d11b106`)

- **dixon-coles.ts**: `DIXON_COLES_CONVENTION = "tau-1x2-v1"`, `dixonColesTau` (четыре формулы D-06), `dixonColesRhoBounds` (три нижних + два верхних ограничения, D-07 amended), fail-closed `assertDixonColesRho` → `INVALID_DIXON_COLES_RHO`, `applyDixonColesCorrection` (новый массив, без мутации), `dixonColesTauMin`, `estimateDixonColesRho` (детерминированная бисекция по score-функции, сортировка входа, без I/O и случайности).
- **model.ts**: коррекция применяется строго между построением `raw` и `retainedMass`; `retainedMass`/`scoreMatrix`/маргиналы считаются только из corrected-сетки. DC без `dixonColes` → `DIXON_COLES_RHO_REQUIRED`. В `canonicalInput` ключ `dixonColes` добавляется только для DC — V1 `inputHash` бит-в-бит прежний. В `assumptions` DC добавлена строка о low-score correction.
- **contract.ts**: условный набор ключей `receipt` (`dixonColes` обязателен для DC, запрещён для V1), закрытая валидация блока провенанса.
- **tests/unit/dixon-coles.test.ts**: знаки τ, границы, ρ=0-эквивалентность, восстановление ρ* на синтетике LCG (+0.02), детерминизм, fallback `insufficient-sample-zero`.

### Task 3 — Оркестратор обеих версий (коммит `a0ec682`)

- `ForecastOrchestratorInput.modelVersion: ForecastModelVersion`, `dixonColes?`; `ForecastFixture.leagueId`.
- Опциональный `findDixonColesParameters?` в репозитории; явные параметры имеют приоритет; `null`/рассинхрон `rho` с провенансом → `DIXON_COLES_RHO_UNAVAILABLE`.
- `forecastConfigHashFor(version)` в оркестраторе; `currentForecastConfigHash()` — алиас V1.
- `modelVersion`/`dixonColes` передаются в оба вызова `createForecast`; `receipt.dixonColes` присутствует ровно у DC.
- `packages/database/src/forecast-repository.ts`: `findFixture` теперь возвращает `leagueId`.
- **tests/unit/forecast-model-version.test.ts**: 7 кейсов оркестратора на in-memory репозитории (V1 не вызывает хук, DC с V1-хэшем → `CONFIG_HASH_MISMATCH`, DC без ρ → `DIXON_COLES_RHO_UNAVAILABLE`, публикация DC с независимым `modelHash` и провенансом, резолв из репозитория, разные ρ → разные `inputHash`/`id`, рассинхрон ρ/провенанса).

## V1 freeze-вектор (закоммичен литералами)

```
modelVersion        poisson-ensemble-v1
configVersion       forecast-config-v1
expectedGoals       { home: 1.9575, away: 0.7474999999999999 }
retainedMass        0.9990405464847887
HOME                0.6585269286216904
DRAW                0.20709279716164194
AWAY                0.13438027421666768
OVER_2_5            0.5071266454039375
UNDER_2_5           0.4928733545960625
YES                 0.4520385604653406
NO                  0.5479614395346595
configHash          sha256:a08ff17e4ec37822ccce0b68a7ed24ad33c21c5732e2ee812645cac4cc159581
inputHash           sha256:a64fcfc131e521f003391d5d89e481116ccfe8fbc8be99f8bfc68b3e418a7f56
```

Вектор снят на `HEAD=3a32373` (до изменений) временным тестом и затем перенесён в `tests/unit/forecast-v1-regression.test.ts`; `forecastConfigHashFor("poisson-ensemble-v1")` совпадает с `configHash`.

## Итоговые константы `DIXON_COLES_CONFIG`

```ts
{ ...FORECAST_CONFIG,
  version: "forecast-config-v2",
  dixonColes: {
    convention: "tau-1x2-v1",
    boundsEpsilon: 1e-9,
    estimation: {
      method: "mle-low-score-v1",
      windowDays: 730,
      minLeagueMatches: 150,
      minPooledMatches: 300,
      bisectionIterations: 80,
      fallback: "zero"
    }
  }
}
```

`ρ` не является константой конфига: он входит в `inputHash` вместе с провенансом.

## Поведение при недостатке данных

`estimateDixonColesRho` возвращает `{ rho: 0, method: "insufficient-sample-zero", tauMin: 1 }` без NaN/Infinity, если: выборка меньше `minSamples`; пересечение допустимых полос пусто; score-функция не меняет знак на полосе; бисекция/`tauMin` дали не-finite или неположительный множитель. Метод попадает в квитанцию, поэтому fallback нельзя выдать за MLE.

## Verification

- `pnpm vitest run --project unit` — **624/624** зелёные (56 файлов).
- `pnpm --filter @bet-stats/domain exec tsc --noEmit` — чисто.
- `git grep '"poisson-ensemble-v1"' packages/domain/src` — литералы остались только в `model-version.ts`, дефолте `model.ts`, картах `config.ts` и алиасе `currentForecastConfigHash()`; в `methodology/model-card.ts` — правится планом 11-04.

## Осталось на 11-02 (production-литералы)

- `apps/api/src/modules/forecasts/forecasts.service.ts:25`
- `workers/data-sync/src/jobs/backtests.ts:16,34,44,120`
- `workers/data-sync/src/jobs/forecast-sweep.ts:137,154`
- `workers/data-sync/src/jobs/forecasts.ts:8,33`
- `workers/data-sync/src/main.ts:66`
- `packages/config`: добавить `FORECAST_MODEL_VERSION` в `environmentSchema`/`readServerConfig`.

## Deviations

- Порядок коммитов Task 2 и Task 3 пришлось разделить вручную: предыдущий исполнитель оставил правки оркестратора незакоммиченными; тесты оркестратора дописаны инлайн.
- `ForecastFixture.leagueId` сделано обязательным (как в плане); реализация репозитория добавлена в этом же коммите, чтобы не оставлять `tsc` красным.
