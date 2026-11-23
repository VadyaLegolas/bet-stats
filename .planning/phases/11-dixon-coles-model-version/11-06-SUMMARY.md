---
phase: 11-dixon-coles-model-version
plan: 06
subsystem: data-sync
tags: [model-comparison, cli, evidence, cohort, backtest, gap-closure, MODEL-03]
status: complete
requirements-completed: [MODEL-03]
requirements: [MODEL-03]
completed: 2026-11-23
duration: 15 min
commits: 2
plan_head_before: 321f897e488280015e61cf95410ba74d5eb2a95a
plan_head_after: 643c52f388cc986f9696a454dd95e1dfb5833204
actuals:
  tokens: 9900   # chars/4 over added+removed lines of the hand-written diff (39432 chars)
  tasks: 2
  commits: 2
requires:
  - phase: 11-05
    provides: settlement supports two forecasts per fixture, so V1 and DC plans can run side by side
provides:
  - "planComparisonCohort / ComparisonCohortReport: evidence-backed cohort with a deterministic tie-break and a skip report"
  - "PRE_MATCH_CUTOFF_LEAD_HOURS / PRE_MATCH_CUTOFF_LEAD_MS: single production lead constant"
  - "isCohortRunnable / cohortBlockReason: one runnability predicate for the CLI and buildComparisonPlanPair"
affects: [11-07]
key-files:
  created: []
  modified:
    - workers/data-sync/src/jobs/forecasts.ts
    - workers/data-sync/src/jobs/forecast-sweep.ts
    - workers/data-sync/src/jobs/model-comparison.ts
    - workers/data-sync/src/jobs/model-comparison-cli.ts
    - tests/unit/model-comparison-operator.test.ts
    - tests/integration/backtest-model-comparison.test.ts
key-decisions:
  - "Одновременные матчи: на каждый момент отсечки остаётся один матч с наименьшим id (по кодовым единицам); остальные пропущены с причиной sharedCutoffInstant. Сдвиг отсечки на 1 мс и ослабление validateRollingOriginWindow отвергнуты"
  - "allowSmallCohort не входит в хэш pairId: флаг решает, подавать ли, а не что содержат планы"
  - "Лид по умолчанию 6 ч берётся из экспортируемой константы PRE_MATCH_CUTOFF_LEAD_HOURS (planForecastPublication, computeDueKinds, CLI, справка)"
---

# Phase 11 Plan 06: Окна сравнения на доказательствах — Summary

CLI сравнения V1/DC строит окна только по матчам с опубликованными доказательствами обеих команд на точную отсечку `kickoff − 6 ч` (лид из единой production-константы), оставляет по одному матчу на момент отсечки (наименьший id) вместо сдвига на 1 мс и останавливает подачу без записи, если пригодных окон меньше минимума политики.

## Что сделано

### Задача 1 (tracer): когорта окон (`83e07ea`)

- `forecasts.ts` экспортирует `PRE_MATCH_CUTOFF_LEAD_HOURS = 6` и `PRE_MATCH_CUTOFF_LEAD_MS`. Константа используется в `planForecastPublication`, в `computeDueKinds` (`forecast-sweep.ts`, локальная константа удалена) и как значение `cutoffHoursBeforeKickoff` по умолчанию в `resolveComparisonParams`. Поведение production-пути не менялось (то же значение 6 ч).
- `listComparisonFixtures` (читатель `Pick<PrismaClient, "fixture" | "evidenceBuild">`) одним запросом `evidenceBuild.findMany` (`state: "PUBLISHED"`, множество команд, множество точных отсечек) вычисляет `hasEvidenceAtCutoff`: истина только если обе команды имеют билд с `cutoff` ровно `kickoff − лид`. Билд на мс раньше (источник `EVIDENCE_CUTOFF_MISMATCH`) не засчитывается. Без матчей запрос билдов не выполняется.
- Итоговая сигнатура: `planComparisonCohort(fixtures: readonly ComparisonFixture[], params: ResolvedComparisonParams): { eligible: readonly ComparisonFixture[]; report: ComparisonCohortReport }`.
  `ComparisonCohortReport = { considered, usable, skipped: { noResultByEvaluationAsOf, noPublishedEvidenceAtCutoff, sharedCutoffInstant }, leadHours, minimumRequired (= MODEL_COMPARISON_POLICY.minimumSampleSize), tieBreak: "smallest-fixture-id" }`. Инвариант `considered = usable + сумма skipped` проверяется тестом.
- Порядок проверок: результат к `evaluationAsOf` → доказательства на точной отсечке → тай-брейк на общем моменте. Матч без доказательств не занимает слот тай-брейка. Сортировка (kickoff, id по кодовым единицам, не `localeCompare`).
- `buildComparisonWindows` строит окна по `eligible` с `forecastCutoff = kickoff − лид` без сдвигов; `buildComparisonPlanPair` несёт `cohort`; CLI-сводка содержит поле `cohort`.

Тай-брейк и обоснование: выбран отбор по наименьшему `id`, потому что он не зависит от исхода и метрик (нет смещения отбора, T-11-18), не требует правки `validateRollingOriginWindow`/`rolling-origin-v1` (запрещена владельцем) и не выдумывает отсечку без билда. Цена: когорта уменьшается там, где много одновременных матчей (по данным UAT 110 → 57), и это явно показано оператору.

Окна на синтетическом наборе из трёх матчей (`f1`, `f2`, `f3`, где `f2` и `f3` с одним kickoff): было 3 (отсечка `f3` сдвинута на +1 мс), стало 2 (`f1`, `f2`; `sharedCutoffInstant = 1`). В интеграционном сиде: 3 рассмотренных FINISHED-матча, 2 пригодных окна, 1 пропущен по `noPublishedEvidenceAtCutoff` (было бы 2 окна без доказательств и без отчёта о пропуске).

### Задача 2: честная остановка и информативный dry-run (`643c52f`)

- `isCohortRunnable(report, allowSmallCohort)` и `cohortBlockReason` — один предикат для CLI и `buildComparisonPlanPair`: 0 пригодных → `COMPARISON_NO_ELIGIBLE_FIXTURES` всегда; 0 < usable < 30 → `COMPARISON_COHORT_BELOW_MINIMUM` без флага; порядок проверок: диапазон и лимиты → когорта → `BACKTEST_LIMIT_EXCEEDED`.
- `allowSmallCohort` — параметр `ComparisonParams`/`ResolvedComparisonParams`, исключён из хэша `pairId` (проверено тестом: те же `pairId`, id и `planHash` с флагом и без него).
- CLI: `--allow-small-cohort`. `submit`/`run` ниже минимума ничего не пишут (`createPlan`/`enqueue` не вызываются), печатают отчёт по-русски с числами и подсказкой, JSON `{ submitted: false, runnable: false, reason, cohort }`, код 1. `--dry-run` печатает отчёт всегда (в т.ч. при нуле и ниже минимума), код 0 при запускаемой когорте, иначе 1. С флагом и малой когортой выводится предупреждение «вердикт будет INCONCLUSIVE по построению». Отчёт когорты печатается до ожидания воркера.
- Справка: `--cutoff-hours` по умолчанию 6 (строится из константы), флаг `--allow-small-cohort`, строка про пропуски и тай-брейк.
- Интеграционный тест: сид получил `SyncRun`, 4 PUBLISHED `EvidenceBuild` (обе команды на отсечки `cmp-f1` и `cmp-f2`) и FINISHED-матч `cmp-f4` без билдов; добавлена проверка остановки без флага (план не записан) и утверждения `windows === 2`, `cohort.usable === 2`, `cohort.skipped.noPublishedEvidenceAtCutoff === 1`; идемпотентность, идентичные окна и `PLAN_NOT_COMPLETE` сохранены. Контейнеры теста теперь удаляются `docker rm --force --volumes`.

## Проверка (фактически выполнено)

- `pnpm vitest run --project unit tests/unit/model-comparison-operator.test.ts tests/unit/forecast-sweep.test.ts tests/unit/model-comparison.test.ts` — 41/41 (после задачи 1).
- `pnpm vitest run --project unit tests/unit/model-comparison-operator.test.ts` — 29/29 (после задачи 2).
- `pnpm vitest run --project unit` целиком — 60 файлов, 688 тестов, зелёно.
- `pnpm vitest run --project integration tests/integration/backtest-model-comparison.test.ts tests/integration/forecast-publication.test.ts tests/integration/backtest-origin.test.ts tests/integration/backtest-production.test.ts` — 4 файла, 18 тестов, зелёно (реальные PostgreSQL 18 и Redis 8 в Docker).
- `pnpm --filter @bet-stats/data-sync typecheck`, `pnpm --filter @bet-stats/data-sync lint`, `pnpm typecheck` — чисто.
- Acceptance greps задачи 1: `previousCutoff + 1`=0, `6 * 60 * 60 * 1_000` в forecasts.ts=0, `const PRE_MATCH_OFFSET_MS`=0, `cutoffHoursBeforeKickoff, 1,`=0, `PRE_MATCH_CUTOFF_LEAD_HOURS` в model-comparison.ts=2. Задачи 2: `allow-small-cohort` в CLI=5, `COMPARISON_COHORT_BELOW_MINIMUM`=2.
- `git diff --stat 575d187..HEAD` по `backtest.ts`, `backtests.ts`, `scripts/model-comparison.mjs`, `packages/domain/src/evaluation/model-comparison.ts` пуст.

Красная проверка до правки не выполнялась отдельным прогоном (план не требовал); для плана 11-07 база — `plan_head_before: 321f897e488280015e61cf95410ba74d5eb2a95a`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Lint: неиспользуемая переменная при исключении флага из хэша**
- **Found during:** Task 2 (lint)
- **Issue:** деструктуризация `{ allowSmallCohort: _admission, ...identity }` давала `no-unused-vars`
- **Fix:** `{ ...resolved, allowSmallCohort: undefined }` (JSON.stringify отбрасывает undefined, хэш не зависит от флага)
- **Files modified:** workers/data-sync/src/jobs/model-comparison.ts
- **Commit:** 643c52f

**2. [Rule 2 - Missing critical] Очистка Docker-томов тестового контейнера**
- **Found during:** Task 2 (ограничение исполнителя: на C: мало места)
- **Fix:** `afterAll` интеграционного теста использует `docker rm --force --volumes`
- **Files modified:** tests/integration/backtest-model-comparison.test.ts
- **Commit:** 643c52f

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical). **Impact:** без влияния на поведение; план выполнен по существу как написан.

Дополнительно: между коммитами задач 1 и 2 интеграционный тест `backtest-model-comparison.test.ts` был красным (его сид без доказательств обновляется в задаче 2, как и предписывает план); после коммита 643c52f он зелёный.

## Known Stubs

Нет.

## Threat Flags

Новых поверхностей нет (новых зависимостей и эндпоинтов нет). Митигации T-11-18, T-11-19, T-11-20 реализованы и покрыты тестами: детерминизм при перестановке входа, инвариант отчёта, остановка без записи.

## Issues Encountered

- Не проверено на реальных данных UAT (130 матчей / 110 с доказательствами / ожидаемо 57 окон): запуск на dev-БД запрещён условиями исполнения; ожидание 57 окон основано на анализе из плана, а не на прогоне.
- Pre-existing: 531 висячий Docker-том на машине (не созданы этим планом, не удалялись).

## Self-Check: PASSED

- Файлы существуют (все 6 изменённых файлов), коммиты `83e07ea` и `643c52f` являются предками HEAD.
