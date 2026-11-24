---
phase: 11-dixon-coles-model-version
verified: 2026-11-24T08:10:00Z
status: human_needed
score: 9/10 must-haves verified
covered_files:
  - .planning/phases/11-dixon-coles-model-version/11-01-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-01-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-02-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-02-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-03-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-03-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-04-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-04-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-05-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-05-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-06-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-06-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-07-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-07-SUMMARY.md
  - apps/api/src/modules/evaluation/evaluation.controller.ts
  - apps/api/src/modules/evaluation/evaluation.service.ts
  - apps/api/src/modules/fixtures/fixtures.service.ts
  - apps/api/src/modules/forecasts/forecast-comparison.service.ts
  - apps/api/src/modules/forecasts/forecasts.service.ts
  - apps/api/src/modules/value/value.service.ts
  - apps/web/app/methodology/page.tsx
  - packages/config/src/index.test.ts
  - packages/config/src/index.ts
  - packages/database/prisma/migrations/20261123_phase11_settlement_chain_per_forecast/migration.sql
  - packages/database/prisma/migrations/20261124_phase11_forecast_snapshot_origin/migration.sql
  - packages/database/prisma/schema.prisma
  - packages/database/src/dixon-coles-repository.ts
  - packages/database/src/evaluation/backtest-repository.ts
  - packages/database/src/evaluation/settlement-pipeline.ts
  - packages/database/src/forecast-repository.ts
  - packages/database/src/index.ts
  - packages/domain/src/evaluation/forecast-orchestrator.ts
  - packages/domain/src/evaluation/model-comparison.ts
  - packages/domain/src/forecast/canonical-json.ts
  - packages/domain/src/forecast/config.ts
  - packages/domain/src/forecast/contract.ts
  - packages/domain/src/forecast/dixon-coles.ts
  - packages/domain/src/forecast/model-version.ts
  - packages/domain/src/forecast/model.ts
  - packages/domain/src/index.ts
  - packages/domain/src/methodology/model-card.ts
  - scripts/model-comparison.mjs
  - tests/e2e/methodology.spec.ts
  - tests/integration/backtest-model-comparison-e2e.test.ts
  - tests/integration/backtest-model-comparison.test.ts
  - tests/integration/backtest-origin.test.ts
  - tests/integration/backtest-production.test.ts
  - tests/integration/dixon-coles-rho.test.ts
  - tests/integration/evaluation-api.test.ts
  - tests/integration/forecast-api.test.ts
  - tests/integration/forecast-origin.test.ts
  - tests/integration/forecast-publication.test.ts
  - tests/integration/migration-empty.test.ts
  - tests/integration/model-comparison-api.test.ts
  - tests/integration/phase-03-security.test.ts
  - tests/integration/settlement-chain-upgrade.test.ts
  - tests/integration/settlement-multi-forecast.test.ts
  - tests/unit/canonical-json.test.ts
  - tests/unit/dixon-coles.test.ts
  - tests/unit/forecast-model-version.test.ts
  - tests/unit/forecast-origin.test.ts
  - tests/unit/forecast-sweep.test.ts
  - tests/unit/forecast-v1-regression.test.ts
  - tests/unit/model-card.test.ts
  - tests/unit/model-comparison-operator.test.ts
  - tests/unit/model-comparison.test.ts
  - workers/data-sync/src/jobs/backtests.ts
  - workers/data-sync/src/jobs/forecast-sweep.ts
  - workers/data-sync/src/jobs/forecasts.ts
  - workers/data-sync/src/jobs/model-comparison-cli.ts
  - workers/data-sync/src/jobs/model-comparison.ts
  - workers/data-sync/src/main.ts
  - workers/data-sync/src/queues/index.ts
covered_digest: "v4:sha256:1f84ba0811e050c02759f3f96c6519cd94d2ebb6fa82a172274d418736e67ad5"
behavior_unverified: 1
overrides_applied: 1
overrides:
  - must_have: "сравнение доказывается до того, как модель станет production-дефолтом"
    reason: "D-01 (прямое указание оператора): дефолт включён сразу; D-13: сравнение является доказательством для оператора, а не гейтом; откат одним FORECAST_MODEL_VERSION=poisson-ensemble-v1"
    accepted_by: "владелец проекта (решение в чате сессии)"
    accepted_at: "2026-11-23T19:56:16.000Z"
re_verification:
  previous_status: human_needed
  previous_score: 6/8 must-haves verified
  gaps_closed:
    - "UAT тест 2 blocker: settlement не поддерживал два прогноза на один матч (закрыто 11-05, проверено интеграционными тестами на реальном PostgreSQL)"
    - "UAT тест 2: CLI строил окна без доказательств на точную отсечку и со сдвигом +1 мс (закрыто 11-06)"
    - "Отсутствие сквозного доказательства пути оператора (закрыто 11-07, e2e на PostgreSQL и Redis)"
    - "Утечка ретро-прогнозов бэктеста в публичную scorecard и фит ρ (WR-13, колонка origin)"
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "Оператор прогоняет сравнение V1 и DC на РЕАЛЬНЫХ данных окружения и получает сохранённую квитанцию model-comparison-v2 на когорте не меньше 30 исходов (UAT тест 2, остаётся открытым по решению пользователя)"
    test: "Пересобрать проект (pnpm build: dist воркера и database устарел относительно HEAD), при запущенном воркере data-sync и заданных DATABASE_URL/REDIS_URL выполнить node scripts/model-comparison.mjs run --from <ISO UTC> --to <ISO UTC> --json на копии dev-данных и сохранить вывод"
    expected: "Оба плана SUCCEEDED, available: true, квитанция с planHash обеих сторон и windowsDigest, usable >= 30. Пока у DC ρ = 0 (insufficient-sample-zero) дельты Brier и logLoss равны нулю, вердикт INCONCLUSIVE читается как «нет доказательства», а не как «DC не хуже»"
    why_human: "Каждое звено и вся цепочка пройдены на синтетической когорте на настоящих PostgreSQL/Redis, но на реальных данных ни одного успешного сравнения нет: прежняя попытка упала на settlement (исправлено), повторной не было. Достаточность реальной когорты (доказательства на точную отсечку 6 ч, результат к evaluationAsOf) и фактический ρ видны только на живых данных"
human_verification:
  - test: "UAT тест 2: прогнать реальное сравнение V1 и DC на копии данных окружения и записать результат, в том числе отрицательный"
    expected: "Сохранённая квитанция model-comparison-v2, usable >= 30; при ρ = 0 вердикт INCONCLUSIVE записан как «нет доказательства»"
    why_human: "Нужны живые данные и воркер; тест не отмечается пройденным, решение за пользователем"
  - test: "UAT тест 3: SQL SELECT receipt->'receipt'->'dixonColes'->>'method', count(*) FROM \"ForecastSnapshot\" WHERE \"modelVersion\"='dixon-coles-ensemble-v1' GROUP BY 1 в рабочей БД"
    expected: "Видна доля mle-low-score-v1 / pooled-fallback-v1 / insufficient-sample-zero / out-of-band-zero. Замер из 11-UAT.md на 2026-11-23: insufficient-sample-zero 3 из 3, то есть дефолтная модель пока численно совпадает с V1"
    why_human: "Замер зависит от текущего состояния БД и интерпретации значимости дефолта; тест остаётся открытым по решению пользователя"
  - test: "Решения из deferred-items.md: п.1 (менять ли valueReceiptId в публичных событиях), п.2 (нужна ли явная опция «разогнать ρ из строк бэктеста»), п.4 (падать ли явно при коллизии production-публикации с BACKTEST-снимком), п.5 (приемлемы ли пропуски публичных номеров ревизий)"
    expected: "Явное решение по каждому пункту; код сейчас реализует поведение по умолчанию, описанное в deferred-items.md"
    why_human: "Продуктовые решения, не проверяются кодом"
---

# Фаза 11: Отчёт верификации (Dixon-Coles model version)

**Цель фазы:** Вероятности прогнозов выпускаются под новой версионированной моделью с коррекцией Диксона-Коулза и закреплённой конвенцией τ, а оператор может доказать rolling-origin бэктестами, что она лучше замороженного Poisson-базиса (или честно не лучше), до того как она станет production-дефолтом.
**Проверено:** 2026-11-24T08:10:00Z
**Статус:** human_needed
**Повторная верификация:** Да, после gap closure 11-05..11-07, review-fix прохода (CR-03, WR-07..WR-12) и quick-таска 261124-88x (WR-13)

## Итог одной фразой

Код достигает цели в части MODEL-01 и MODEL-02, механизм MODEL-03 теперь доказан сквозным тестом на реальных PostgreSQL и Redis, блокер UAT теста 2 (settlement двух прогнозов одного матча) устранён и проверен, утечка ретро-прогнозов в публичную scorecard закрыта. Гэпов нет. Статус `human_needed`, потому что реальное сравнение на реальных данных (UAT тест 2) и замер распределения методов ρ (UAT тест 3) по решению пользователя остаются открытыми, а часть продуктовых решений перечислена в `deferred-items.md`.

## Достижение цели

### Наблюдаемые истины

| # | Истина | Статус | Доказательство |
|---|--------|--------|----------------|
| 1 | SC1/MODEL-01: коррекция DC с закреплённой τ и ограниченным ρ; ρ=0 воспроизводит Poisson, матрица суммируется в 1, при отрицательном ρ ничьи растут | ✓ VERIFIED | `packages/domain/src/forecast/dixon-coles.ts`: `dixonColesTau` (τ(0,0)=1−λhλaρ, τ(1,0)=1+λaρ, τ(0,1)=1+λhρ, τ(1,1)=1−ρ), `dixonColesRhoBounds` = max(−1/λh,−1/λa) < ρ < min(1/(λhλa),1), `assertDixonColesRho` без обрезки (кодированная ошибка). `tests/unit/dixon-coles.test.ts`: «reproduces the independent Poisson grid bit-for-bit at rho = 0», «keeps every market summing to one…», «raises the draw probability relative to the poisson-ensemble-v1 baseline», «grows draws and shrinks 1-0 / 0-1 when rho is negative». Юнит-набор целиком 61 файл, 708/708 (мой прогон) |
| 2 | SC2/MODEL-02: новая идентичность версии во всём стеке за один когерентный проход | ✓ VERIFIED | `MODEL_VERSIONS`/`isForecastModelVersion` в `model-version.ts`, членство проверяют `contract.ts`, `forecast-orchestrator.ts`, `model-comparison.ts` (`assertSide`), `workers/data-sync/src/jobs/backtests.ts` (плюс `BACKTEST_CONFIG_HASH_MISMATCH` при допуске), селектор `packages/config` (`z.enum(MODEL_VERSIONS)`, дефолт `dixon-coles-ensemble-v1`). Колонки `modelVersion` в Prisma — `String`. `turbo run typecheck` 7/7 (результат из кэша turbo по неизменным входам). V1-вектор заморожен (`forecast-v1-regression`) и проходит в юнит-прогоне |
| 3 | SC3/MODEL-03 (механизм): оператор сравнивает rolling-origin метрики новой версии с базисом через настоящий путь оператора | ✓ VERIFIED | `runModelComparisonCommand run` → BullMQ → backtest-воркер в production-обвязке → реальные PostgreSQL 18 / Redis 8 → `computeModelComparison` с квитанцией `model-comparison-v2`. `tests/integration/backtest-model-comparison-e2e.test.ts` проходит (мой прогон на собственных одноразовых контейнерах): оба плана SUCCEEDED на 32 окнах, одни и те же fixtureId, квитанция `available: true`, повторный `run` не создаёт новых планов, `compare` воспроизводит тот же `windowsDigest`. Вместе с `backtest-model-comparison`, `backtest-origin`, `backtest-production`, `model-comparison-api`: 8 файлов интеграции, 48/48 |
| 4 | SC3: карточка методологии называет точную интеграцию и ограничения (нейтральность O/U 2.5) | ✓ VERIFIED | `model-card.ts` v1.1.0: `integration: "hybrid-elo-form-poisson-with-tau"`, τ, `rhoBounds`, политика ρ с фолбэками и `out-of-band-zero`, строка о нейтральности тотала 2.5 при фиксированных λ, ограничения (гибрид, нет публичного сравнения, малая выборка даёт INCONCLUSIVE). `apps/web/app/methodology/page.tsx` рендерит `MODEL_CARD`; `tests/unit/model-card.test.ts` в юнит-прогоне зелёный. Playwright-тест карточки я не запускал |
| 5 | Цель: сравнение доказывается ДО того, как модель станет production-дефолтом | ✓ PASSED (override) | Override: D-01 (прямое указание оператора): дефолт включён сразу; D-13: сравнение является доказательством для оператора, а не гейтом; откат одним FORECAST_MODEL_VERSION=poisson-ensemble-v1 — accepted by владелец проекта on 2026-11-23T19:56:16.000Z. Код соответствует: `DEFAULT_FORECAST_MODEL_VERSION = "dixon-coles-ensemble-v1"` (`model-version.ts:13`), V1 остаётся выбираемым |
| 6 | Оператор прогоняет сравнение V1 и DC на реальных данных окружения и получает честный вердикт | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Путь доказан только на синтетической когорте (истина 3). Реальная попытка 2026-11-23 упала на settlement (теперь исправлено), повторного реального прогона нет. Дополнительно: на реальных данных ρ пока 0 (замер UAT 3: `insufficient-sample-zero` 3/3, порог пула 300, лиги 150), поэтому ожидаемый результат — нулевые дельты и INCONCLUSIVE. Оформлено в `behavior_unverified_items` |
| 7 | Два прогноза одного матча (V1 и DC) рассчитываются независимо: у каждого своя цепочка `SettlementReceipt` | ✓ VERIFIED | Миграция `20261123_phase11_settlement_chain_per_forecast`: проверка непрерывности цепочек с `RAISE EXCEPTION` (fail closed), `DROP CONSTRAINT SettlementReceipt_fixtureId_revision_key`, новый `UNIQUE (fixtureId, forecastSnapshotId, revision)`, `persist_settlement_receipt` считает `MAX(revision)` по паре после `pg_advisory_xact_lock`; guard-триггер не переопределялся; UPDATE/DELETE/backfill в миграции нет. `settlement-multi-forecast` (включая параллельность и коррекцию результата) и `settlement-chain-upgrade` (применение к заполненной БД) проходят: 6 файлов, 41/41 в моём первом прогоне. В e2e: у каждого матча когорты две `SettlementReceipt` revision 1 с разными `forecastSnapshotId` и по три `ForecastScore` |
| 8 | Когорта сравнения строится только из окон, которые могут завершиться (доказательства на точной отсечке, production-лид, детерминированный тай-брейк, честный отчёт пропусков, минимум когорты) | ✓ VERIFIED | `forecasts.ts` экспортирует единую `PRE_MATCH_CUTOFF_LEAD_HOURS = 6` / `_MS`, на неё ссылаются `planForecastPublication`, `forecast-sweep.ts` и `model-comparison.ts`/CLI. `planComparisonCohort` отбрасывает матчи без результата к `evaluationAsOf` (предикат `resolveHistoricalResultGraph`, тот же что в окне бэктеста, CR-03), без доказательств на отсечку, и с общим моментом отсечки (остаётся наименьший id); `cohortBlockReason` останавливает подачу при `usable < 30` без `--allow-small-cohort`. e2e утверждает `skipped = {noResultByEvaluationAsOf:1, noPublishedEvidenceAtCutoff:1, sharedCutoffInstant:1}` и что ни один из этих матчей не попал в планы. Юнит `model-comparison-operator` в зелёном прогоне |
| 9 | Исправления review-fix прохода (CR-03, WR-07..WR-12) реально в коде и подтверждены падающими без них тестами | ✓ VERIFIED | Коммиты 023b5e5..38afdb6 в истории; файлы-носители на месте (`settlement-pipeline.ts` — `IntakeGuard`, `SETTLEMENT_INTAKE_DEFAULTS`, ограниченный `Semaphore.acquire`; `queues/index.ts` — `inspect`, `removeFailed`; `model-comparison.ts` — `jobCanStillRun`, `comparisonPairId`, подписи сторон из квитанции). Тесты на эти пути проходят в юнит-наборе и интеграции (`settlement-multi-forecast`, `backtest-model-comparison`). Мутационные прогоны, которые описывает `11-REVIEW-FIX.md`, я не воспроизводил, опираюсь на зелёный набор. Остатки, названные в отчёте (один выполняющийся шаг `processRevision` не прерывается) — известное ограничение, не гэп |
| 10 | WR-13: ретро-прогнозы и скоры бэктеста не попадают в публичную scorecard, value-кандидаты, виды матчей, sweep и фит ρ | ✓ VERIFIED | Миграция `20261124_phase11_forecast_snapshot_origin`: enum `ForecastOrigin`, `origin NOT NULL DEFAULT 'PRODUCTION'`, `guard_forecast_snapshot()` включает `origin` в оба `ROW(...)`, строки не переписываются. `forecastOriginOf(initiator)` выводит origin только из валидированного инициатора. Фильтр `origin: "PRODUCTION"` присутствует во всех публичных читателях: `forecast-repository` (`findIssued`, `listIssued`), `evaluation.service` (`load`, `enumerateAvailableCohorts`, `listValueCandidates`), `fixtures.service`, `forecast-comparison.service`, `value.service`, `forecast-sweep`, `dixon-coles-repository.collectRows`; прочие чтения `forecastSnapshot`/`forecastScore` — внутренние пути бэктеста или идентификация по id. Шаг 7 e2e: публичные когорты 0/0/0/0, 64 снимка `BACKTEST`, 0 `PRODUCTION`. `forecast-origin`, `dixon-coles-rho`, `migration-empty` проходят в моём прогоне |

**Счёт:** 9/10 истин подтверждено (включая 1 PASSED override); 1 present, behavior-unverified (истина 6).

### Соответствие требованиям

| Требование | Планы | Описание | Статус | Доказательство |
|------------|-------|----------|--------|----------------|
| MODEL-01 | 11-01, 11-02 | DC-коррекция, закреплённая τ, ограниченный ρ, тесты ρ=0 / сумма 1 / рост ничьей | ✓ SATISFIED | истина 1 |
| MODEL-02 | 11-01, 11-02 | Новая идентичность версии по всему стеку за один проход | ✓ SATISFIED | истина 2 |
| MODEL-03 | 11-03, 11-04, 11-05, 11-06, 11-07 | Оператор сравнивает rolling-origin метрики нового и замороженного базиса до дефолта | ? NEEDS HUMAN | механизм ✓ (истины 3, 7, 8), порядок «до дефолта» принят override (истина 5), реальный прогон на данных не выполнен (истина 6) |

Все три ID (MODEL-01, MODEL-02, MODEL-03) есть в `requirements:` frontmatter планов (11-01, 11-02: MODEL-01 и MODEL-02; 11-03..11-07: MODEL-03) и в `.planning/REQUIREMENTS.md` (строки 36-38, таблица 111-113). Других ID, привязанных к фазе 11 в REQUIREMENTS.md, нет, осиротевших требований нет.

**Расхождение для оркестратора (я файл не менял):** в REQUIREMENTS.md MODEL-03 уже отмечен `[x]`/`Complete`, хотя реальное сравнение (UAT тест 2) не выполнено и статус фазы `human_needed`; MODEL-01 и MODEL-02 остаются `[ ]`/`Pending`, хотя по коду и тестам выполнены. Отметку MODEL-03 стоит вернуть в Pending до закрытия UAT теста 2 либо принять её как «механизм выполнен» сознательно; MODEL-01/02 можно закрывать.

### Требуемые артефакты и ключевые связи

`verify.artifacts`/`verify.key-links` по планам 11-05..11-07 содержат артефакты и связи в виде произвольного текста, а не структурированных объектов, поэтому проверял вручную.

| Артефакт / связь | Статус | Детали |
|------------------|--------|--------|
| миграция settlement-цепочки по прогнозу | ✓ VERIFIED / WIRED | существует, `settlement-pipeline.processRevision` вызывает `persist_settlement_receipt`, `priorSettlement` по `(resultVersionId, forecastSnapshotId, policyHash)`; схема Prisma с составным ключом, сгенерированный клиент перегенерирован |
| миграция `origin` | ✓ VERIFIED / WIRED | колонка используется публичными читателями и `publish` (`origin: context?.origin ?? "PRODUCTION"`) |
| `model-comparison.ts` / `model-comparison-cli.ts` | ✓ VERIFIED / WIRED | CLI → `planComparisonCohort`, `isCohortRunnable`/`cohortBlockReason`, `submitComparisonPair`, `waitForPlans`, `computeModelComparison`; `scripts/model-comparison.mjs` подключает реальные `database`, `receipts`, `queue` |
| `tests/integration/backtest-model-comparison-e2e.test.ts` | ✓ VERIFIED | реальный CLI, реальный воркер, реальные контейнеры; фикстуры не подменяют оркестратор, репозиторий или settlement |
| `workers/data-sync/src/main.ts` → `dixon-coles-repository` | ✓ WIRED | фит ρ на `window.trainingEndsAt` |
| `evaluation.controller.ts` | ✓ WIRED | `OperatorGuard` на `GET /evaluation/model-comparison` |

### Трассировка потока данных (уровень 4)

| Артефакт | Данные | Источник | Реальные данные | Статус |
|----------|--------|----------|-----------------|--------|
| `dixon-coles-repository.collectRows` | λ и счёт | `ForecastSnapshot.receipt.receipt.expectedGoals` + история результатов; `origin = PRODUCTION`, `issuedAt <= asOf` | да (`dixon-coles-rho` на PostgreSQL) | ✓ FLOWING |
| `compareBacktestPlans` | Brier/logLoss | `forecastScore` по `scoreIds` оценённых окон | да (e2e на реальной БД) | ✓ FLOWING |
| публичная scorecard | события | `forecastScore` с `forecastSnapshot.origin = PRODUCTION` | да; на базе без production-прогнозов пусто (e2e шаг 7) | ✓ FLOWING |
| `/methodology` | текст карточки | `MODEL_CARD` | да | ✓ FLOWING |

### Поведенческие проверки

| Поведение | Команда | Результат | Статус |
|-----------|---------|-----------|--------|
| Юнит-набор целиком (Node 24.22.0 из `.tools/node24`) | `vitest run --project unit` | 61 файл, 708/708 | ✓ PASS |
| Типы по воркспейсу | `turbo run typecheck` | 7/7, из кэша turbo | ✓ PASS |
| Settlement двух прогнозов, миграция на заполненной БД, origin, ρ, API сравнения, пустая миграция | `vitest run --project integration` (6 файлов) на моих одноразовых `postgres:18-alpine` / `redis:8-alpine` | 41/41 | ✓ PASS |
| e2e сравнение, backtest-origin/production, evaluation-api, forecast-api, phase-03-security, forecast-publication | то же (8 файлов) | 48/48 | ✓ PASS |
| Полный официальный интеграционный прогон (`pnpm test:integration:docker`) | не запускал | — | ? SKIP: выборка выше покрывает всё, что менялось в фазе |
| Playwright `methodology.spec.ts` | не запускал | — | ? SKIP |

Контейнеры созданы и удалены скриптом (`docker rm --force`), контейнер `football-prediction-platform-postgres-1` не затрагивался, `.env*` не читались; после прогонов в `docker ps -a` остались только два штатных dev-контейнера.

### Исполнение проб

Фаза не объявляет probe-скриптов (`probe-*.sh` в PLAN/SUMMARY нет). Шаг пропущен.

### Антипаттерны

| Файл | Строка | Паттерн | Серьёзность | Влияние |
|------|--------|---------|-------------|---------|
| файлы фазы | — | `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` | — | не найдено |
| `apps/api/src/modules/evaluation/evaluation.service.ts` | `valueByFixture` в `load` | карта по `fixtureId` теряет значения при нескольких квитанциях фикстуры | ⚠️ Warning | уже в `deferred-items.md` п.1; дефект существовал до фазы для production-фикстур с несколькими видами; исправление меняет публичные `valueReceiptId`, нужно решение пользователя |
| `packages/database/src/dixon-coles-repository.ts` | `collectRows` | снимки бэктестов, записанные до миграции `origin`, остаются `PRODUCTION` и участвуют в фите ρ при `asOf` около «сейчас» | ℹ️ Info | `deferred-items.md` п.3, риск T-11-28 принят; на dev-БД `BacktestPlan` = 0, практический эффект отсутствует |
| `packages/database/src/forecast-repository.ts` | `publish` | production-публикация на идентичность существующего `BACKTEST`-снимка возвращает невидимый снимок | ⚠️ Warning | `deferred-items.md` п.4, нужно решение; на текущей БД бэктестов нет |
| `packages/database/src/forecast-repository.ts` | цепочка ревизий | общая по `(fixtureId, kind)` для всех origin, публичные номера ревизий могут иметь пропуски | ℹ️ Info | `deferred-items.md` п.5 |
| `workers/data-sync/dist`, `packages/database/dist` | — | собранный `dist` от 2026-11-23 21:07 старше HEAD (review-fix и WR-13 не собраны); `scripts/model-comparison.mjs` импортирует именно `dist` | ⚠️ Warning | перед реальным запуском UAT теста 2 нужен `pnpm build`, иначе оператор запустит код без CR-03/WR-07..WR-13. Скрипт в шапке требует «собранный проект», но не проверяет свежесть |
| `tests/integration/backtest-model-comparison-e2e.test.ts` | когорта | синтетическая когорта даёт ρ = 0 и нулевые дельты | ℹ️ Info | тест доказывает путь и изоляцию, а не качество DC; это записано в самом тесте и в SUMMARY 11-07 |

### Требуется проверка человеком

#### 1. UAT тест 2: реальное сравнение V1 и DC на данных окружения (остаётся открытым)

**Тест:** собрать проект (`pnpm build`), при запущенном воркере и заданных `DATABASE_URL`/`REDIS_URL` выполнить `node scripts/model-comparison.mjs run --from <ISO UTC> --to <ISO UTC> --json` на копии dev-данных (одноразовые Postgres/Redis, как при прошлой попытке), сохранить вывод.
**Ожидаемо:** оба плана SUCCEEDED, `available: true`, `usable >= 30`; при ρ = 0 вердикт INCONCLUSIVE читается как «нет доказательства».
**Почему человек:** нужны живые данные; решение за пользователем. Не отмечен как пройденный.

#### 2. UAT тест 3: распределение методов ρ (остаётся открытым)

**Тест:** SQL из frontmatter.
**Ожидаемо:** видна доля реально фитящихся ρ. Замер 2026-11-23 из `11-UAT.md`: `insufficient-sample-zero` 3 из 3.
**Почему человек:** значимость дефолта оценивает человек. Не отмечен как пройденный.

#### 3. Продуктовые решения из `deferred-items.md`

П.1, п.2, п.4, п.5 (формулировки в frontmatter). Остальные пункты (3, 6, 7) решений не требуют.

### Итог по разрывам

Гэпов нет: ни одна истина не провалена, заглушек и неподключённых звеньев нет, блокирующих антипаттернов нет. Блокер UAT теста 2 устранён в коде, подтверждён на реальном PostgreSQL и Redis; изоляция бэктеста от публичных читателей подтверждена и кодом, и тестами. Отложенных (`deferred`) по Step 9b пунктов нет: фазы 12-16 не покрывают ни один из перечисленных вопросов. Статус `human_needed` из-за незакрытых по решению пользователя UAT тестов 2 и 3 (истина 6) и продуктовых решений. Предупреждение: перед UAT тестом 2 нужен свежий `pnpm build`, а отметку MODEL-03 в REQUIREMENTS.md стоит согласовать с этим статусом.

---

_Проверено: 2026-11-24T08:10:00Z_
_Верификатор: Claude (gsd-verifier)_
