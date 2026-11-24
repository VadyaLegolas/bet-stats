---
phase: 11-dixon-coles-model-version
plan: 07
subsystem: data-sync
tags: [model-comparison, e2e, backtest, settlement, operator-docs, gap-closure, MODEL-03]
status: complete
requirements-completed: [MODEL-03]
requirements: [MODEL-03]
completed: 2026-11-24
duration: 25 min
commits: 3
plan_head_before: c04dce0a223bb0d6736b4680f9c93a236eabeaa9
plan_head_after: a78d5a317e556b13d743976a192f037c27580d5b
actuals:
  tokens: 8700   # chars/4 over the final added files (test 18625 + operator doc 16216 = 34841 chars)
  tasks: 3
  commits: 3
requires:
  - phase: 11-05
    provides: цепочки ревизий оценки принадлежат прогнозу, V1 и DC на одном матче оцениваются независимо
  - phase: 11-06
    provides: когорта с доказательствами на точную отсечку, лид 6 ч, тай-брейк, отчёт пропусков
provides:
  - "tests/integration/backtest-model-comparison-e2e.test.ts: сквозной тест пути оператора (run -> BullMQ -> backtest-воркер в production-обвязке -> PostgreSQL/Redis -> квитанция model-comparison-v2)"
  - "11-OPERATOR-COMPARISON.md: фактические правила когорты, параллельности, предусловий и ограничения rho = 0"
affects: [11-VERIFICATION, 11-UAT]
key-files:
  created:
    - tests/integration/backtest-model-comparison-e2e.test.ts
  modified:
    - .planning/phases/11-dixon-coles-model-version/11-OPERATOR-COMPARISON.md
key-decisions:
  - "run продолжает подавать оба плана сразу; последовательная подача не вводится: корректность обеспечена БД (цепочки по прогнозу, advisory-lock матча), backtest-воркер имеет concurrency 1, конкуренция только у settlement-воркера (concurrency 2)"
  - "Лид 6 ч в тесте задан независимым литералом, а не импортом production-константы: тест ловит расхождение дефолта CLI с production"
  - "Полное сообщение отказа воркера берётся из события failed (failureCode окна обрезан до 64 символов и теряет причину)"
---

# Phase 11 Plan 07: сквозное доказательство MODEL-03 Summary

Один автоматический тест проводит пару планов V1 и Dixon-Coles над одними матчами тем же путём, что и оператор (`runModelComparisonCommand run` с флагами по умолчанию, настоящий воркер, настоящие PostgreSQL и Redis) до квитанции `model-comparison-v2`; он подтверждённо красный на коде до 11-05 и до 11-06.

## Что сделано

**Task 1 (tracer), коммиты `2e30b87`, `279c5f1`.** Сквозной тест `tests/integration/backtest-model-comparison-e2e.test.ts`. Подменён только транспорт: одноразовые контейнеры `postgres:18-alpine` и `redis:8-alpine`. Настоящие: `ForecastOrchestrator`, `createPrismaForecastRepository`, `createPrismaBacktestReceiptRepository`, `createSettlementPipelineService`, `ensureTeamEvidence` (билды доказательств на `kickoff - 6 ч`), BullMQ, `createBacktestWorker` с исполнителем как в `workers/data-sync/src/main.ts` (включая `resolveDixonColes` через `fitLeagueDixonColesParameters`). Без моков (`vi.fn`/`vi.mock`/`vi.spyOn` отсутствуют).

Второй коммит `279c5f1` добавил в диагностику теста полное сообщение отказа воркера (`worker.on("failed")`): `failureCode` окна режется до 64 символов, и первый красный прогон A не показывал текст о предшественнике ревизии. Это только тест.

**Task 2 (прогоны, файлов не меняла).** Два красных прогона и зелёный после восстановления, см. ниже.

**Task 3, коммит `a78d5a3`.** `11-OPERATOR-COMPARISON.md` приведён к фактическому поведению: лид 6 ч и фильтр доказательств на точную отсечку, тай-брейк по наименьшему `id`, отчёт когорты (`considered`, `usable`, три счётчика пропусков), минимум и `--allow-small-cohort`, раздел «Параллельность и порядок подачи», ограничение rho = 0 (порог 300 / 150 на лигу), предупреждение об append-only записи, предусловия `pnpm build` и `prisma migrate deploy`, обновлённый список тестов. Удалены утверждения про лид 1 ч и сдвиг на 1 мс. Числовых результатов сравнения в документе нет.

## Когорта зелёного прогона

Тест использует 8 команд, 24 исторических матча (июль 2026), 32 матча когорты с различными моментами начала, матч-близнец к `e2e-fx-10` (тот же `kickoffUtc`, `id` больше), матч без билда на точную отсечку (у его команд есть более ранние билды, воспроизведение `EVIDENCE_CUTOFF_MISMATCH`) и один SCHEDULED-матч.

| Показатель | Значение |
|------------|----------|
| `windows` / `cohort.usable` | 32 / 32 |
| `cohort.considered` | 34 |
| `cohort.leadHours` | 6 |
| `skipped.noResultByEvaluationAsOf` | 0 |
| `skipped.noPublishedEvidenceAtCutoff` | 1 |
| `skipped.sharedCutoffInstant` | 1 |
| `minimumRequired` | 30 (`MODEL_COMPARISON_POLICY.minimumSampleSize`) |
| квитанция | `available: true`, `version: model-comparison-v2`, V1 против DC, выборка 32 / 32, вердикт `INCONCLUSIVE`, дельты Brier и logLoss менее 1e-9 |
| БД | оба плана SUCCEEDED, по 32 окна SUCCEEDED, наборы `fixtureId` совпадают (близнеца, матча без доказательств и SCHEDULED нет); на каждый из 32 матчей две `SettlementReceipt` revision 1 без предшественника с разными `forecastSnapshotId`, по три `ForecastScore` у каждой; у близнеца, матча без доказательств и SCHEDULED-матча оценок нет |
| rho | у всех 32 DC-снимков `method: insufficient-sample-zero`, `rho: 0` |
| повторы | `compare` даёт тот же `windowsDigest`; повторный `run` не создаёт планов и снова `available: true` |

Время выполнения сквозного теста: 23.5-26.2 с по трём зелёным прогонам (длительность файла 25.5-30.3 с с учётом импорта и контейнеров).

## Красные прогоны

Команда во всех случаях: `pnpm vitest run --project integration tests/integration/backtest-model-comparison-e2e.test.ts` (Node из `.tools/node24`).

**A. Без миграции 11-05.** Каталог `packages/database/prisma/migrations/20261123_phase11_settlement_chain_per_forecast` временно вынесен во внешний каталог (scratchpad), затем возвращён.
- Код выхода vitest: 1.
- Причина: утверждение кода возврата красное (`code: 1`, `failedCount: 1`). Единственное упавшее окно — первое окно DC-плана (`cmp-<хэш>-dixon-coles`, `e2e-fx-01`).
- `failureCode` окна: `Invalid \`prisma.$queryRawUnsafe()\` invocation: ... Raw query fail` (обрезан до 64 символов).
- Полное сообщение воркера: ``Raw query failed. Code: `P0001`. Message: `settlement revision must link predecessor` ``.
- Первый красный прогон A (до добавления диагностики, коммит `2e30b87`) дал тот же код и тот же усечённый `failureCode`; полное сообщение тогда не было видно, поэтому диагностика добавлена и прогон A повторён с итоговым тестом (результат выше).

**B. Старый CLI сравнения.** `git checkout 575d187 -- workers/data-sync/src/jobs/model-comparison.ts workers/data-sync/src/jobs/model-comparison-cli.ts`; затем `git checkout HEAD -- ...` с теми же двумя файлами. Содержимое этих двух файлов в `575d187` и в `321f897` (HEAD перед первым исправлением 11-06) одинаково, `git diff --stat` между ними пуст.
- Код выхода vitest: 1.
- Причина: `code: 1`, `failedCount: 2`; окно `e2e-fx-01` упало в обоих планах (V1 и DC).
- `failureCode` обоих окон и обоих отказов воркера: `EVIDENCE_CUTOFF_MISMATCH` (лид 1 ч даёт отсечку без билда, билд на `kickoff - 6 ч` есть).

**Зелёный после восстановления.** Код выхода 0, 1 тест пройден. `git status --porcelain -- packages/database/prisma/migrations workers/data-sync/src/jobs` пуст после каждого прогона.

## Проверки плана

| Проверка | Результат |
|----------|-----------|
| `pnpm vitest run --project integration` на шести файлах (e2e, backtest-model-comparison, backtest-production, model-comparison-api, settlement-multi-forecast, settlement-chain-upgrade) | 6 файлов, 24 теста, код 0, 98 с |
| `pnpm vitest run --project unit` | 60 файлов, 688 тестов, код 0 |
| `pnpm typecheck` | код 0 (7 из 7 задач, из кэша Turbo); отдельно `tsc --noEmit -p tsconfig.json` не показал ошибок в новом тесте |
| grep-критерии Task 1 (флаги лида и малой когорты в аргументах CLI; PRE_MATCH_CUTOFF_LEAD и моки без комментариев) | 0 и 0 |
| `git diff --stat c04dce0 HEAD -- workers packages apps` | пусто: production-код, схема БД, политика сравнения не менялись |
| grep-критерии Task 3 | «сдвигом на 1 мс» 0, «прогноз за 1 ч до матча» 0, `allow-small-cohort` 3, `prisma migrate deploy` 1, «Параллельность и порядок подачи» 1; ASCII-маркеры (`allow-small-cohort`, `noPublishedEvidenceAtCutoff`, `sharedCutoffInstant`, `prisma migrate deploy`, `300`) найдены |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] SyncAttempt без id в сиде**
- **Found during:** Task 1, первый запуск
- **Issue:** сырой `INSERT INTO "SyncAttempt"` падал на `null value in column "id"`: id генерируется клиентом Prisma, у столбца нет значения по умолчанию в БД.
- **Fix:** добавлен явный `id` в `INSERT`.
- **Files modified:** tests/integration/backtest-model-comparison-e2e.test.ts
- **Commit:** 2e30b87

**2. [Rule 1 - Bug, диагностика теста] failureCode обрезан до 64 символов**
- **Found during:** Task 2, красный прогон A
- **Issue:** диагностика теста показывала только усечённый `failureCode` без текста о предшественнике ревизии; критерий приёмки A требует этот текст.
- **Fix:** в тест добавлен сбор `error.message` из события `failed` воркера и включён в утверждение кода возврата; красные прогоны A и B повторены с итоговым тестом.
- **Files modified:** tests/integration/backtest-model-comparison-e2e.test.ts
- **Commit:** 279c5f1

Отклонение от формулировки плана: красный прогон B использует коммит `575d187`, как в плане. Инструкция оркестратора называла базой `321f897`; для двух файлов CLI они идентичны, поэтому результат тот же.

Расхождений production-кода 11-05/11-06 не найдено; стоп-условия не срабатывали.

## Known Stubs

Нет.

## Threat Flags

Нет новой поверхности: добавлены только тест (синтетические данные в одноразовых контейнерах, `.env` не читался, dev-БД не затрагивалась) и документация.

## Не проверено

- UAT тесты 2 и 3 остаются открытыми по решению владельца: реальный прогон `run` на копии dev-данных (130 матчей / 110 с доказательствами / ожидаемо 57 окон) не выполнялся. Пример в документации помечен как оценка, а не результат.
- Сквозной тест подтверждает механику и ограничение rho = 0, но не качество DC на реальной истории: вердикт `INCONCLUSIVE` с нулевыми дельтами здесь ожидаем по построению.
- Утверждение документа о том, что до миграции 11-05 цепочка ревизий «общая для матча», основано на тексте 11-05 и на красном прогоне A (ошибка `settlement revision must link predecessor`), а не на отдельном разборе старой схемы.

## Self-Check: PASSED

- Тест `tests/integration/backtest-model-comparison-e2e.test.ts`: найден.
- Документ `11-OPERATOR-COMPARISON.md`: найден.
- Коммиты `2e30b87`, `279c5f1`, `a78d5a3`: найдены в истории (`commits: 3` измерено `git rev-list --count c04dce0..HEAD`).
