---
phase: 11-dixon-coles-model-version
verified: 2026-11-23T20:40:00Z
status: human_needed
score: 6/8 must-haves verified
covered_files:
  - .planning/phases/11-dixon-coles-model-version/11-01-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-01-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-02-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-02-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-03-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-03-SUMMARY.md
  - .planning/phases/11-dixon-coles-model-version/11-04-PLAN.md
  - .planning/phases/11-dixon-coles-model-version/11-04-SUMMARY.md
  - apps/api/src/modules/evaluation/evaluation.controller.ts
  - apps/api/src/modules/evaluation/evaluation.service.ts
  - apps/api/src/modules/forecasts/forecasts.service.ts
  - apps/web/app/methodology/page.tsx
  - packages/config/src/index.ts
  - packages/database/src/dixon-coles-repository.ts
  - packages/database/src/evaluation/backtest-repository.ts
  - packages/database/src/forecast-repository.ts
  - packages/domain/src/evaluation/forecast-orchestrator.ts
  - packages/domain/src/evaluation/model-comparison.ts
  - packages/domain/src/forecast/canonical-json.ts
  - packages/domain/src/forecast/config.ts
  - packages/domain/src/forecast/contract.ts
  - packages/domain/src/forecast/dixon-coles.ts
  - packages/domain/src/forecast/model-version.ts
  - packages/domain/src/forecast/model.ts
  - packages/domain/src/methodology/model-card.ts
  - tests/integration/dixon-coles-rho.test.ts
  - tests/integration/model-comparison-api.test.ts
  - tests/unit/dixon-coles.test.ts
  - tests/unit/model-comparison.test.ts
  - workers/data-sync/src/jobs/backtests.ts
  - workers/data-sync/src/jobs/forecast-sweep.ts
  - workers/data-sync/src/jobs/forecasts.ts
  - workers/data-sync/src/main.ts
covered_digest: "v4:sha256:cbe6fae5a856c45b11247d57b8ac773844b62ae78a02d17289d885a3572703c6"
behavior_unverified: 1
overrides_applied: 0
gaps: []
behavior_unverified_items:
  - truth: "Оператор может от начала до конца провести сравнение rolling-origin бэктестов DC и V1 на реальных данных (подать два плана, дождаться воркера с фитом ρ на trainingEndsAt, получить квитанцию) и получить честный вердикт"
    test: "Подать два плана с идентичными окнами (poisson-ensemble-v1 и dixon-coles-ensemble-v1, configHash = forecastConfigHashFor(версия)), дождаться state SUCCEEDED у обоих, вызвать GET /evaluation/model-comparison с заголовком x-operator-credential"
    expected: "available: true, квитанция с planHash обеих сторон и windowsDigest; вердикт BETTER/WORSE/INCONCLUSIVE по правилам model-comparison-v2; у DC-снапшотов в receipt.dixonColes.method стоит mle-low-score-v1 или pooled-fallback-v1, а не insufficient-sample-zero"
    why_human: "Каждый узел цепочки покрыт тестами по отдельности (юнит, backtest-origin, backtest-production, model-comparison-api), но цепочку целиком на реальных данных никто не гонял. В репозитории нет эксплуатационной точки входа для подачи плана (admitPersistEnqueueBacktest вызывается только из тестов), а фит ρ строго по снапшотам, выпущенным до trainingEndsAt, может на исторических окнах дать ρ = 0"
human_verification:
  - test: "Принять или отклонить отклонение по порядку: DC стал production-дефолтом (11-02, D-01) до появления сравнения (11-03), хотя цель фазы и MODEL-03 говорят «до того, как станет дефолтом»"
    expected: "Явное решение владельца: принять как осознанное отклонение (D-01 прямое указание оператора, D-13 сравнение не гейт, откат одним FORECAST_MODEL_VERSION) либо перевести дефолт обратно на poisson-ensemble-v1 до первого сравнения. Если принято, добавить override в frontmatter (шаблон в разделе «Отклонение по порядку»)"
    why_human: "Это продуктовое решение, а не проверяемый кодом факт. Код ведёт себя в точности по D-01/D-13, но формулировка цели и требования буквально нарушена"
  - test: "Прогнать реальное сравнение V1 и DC на данных окружения и записать результат (в том числе отрицательный)"
    expected: "Сохранённая квитанция model-comparison-v2 на реальной когорте не меньше 30 исходов; при ρ = 0 из-за нехватки истории вердикт INCONCLUSIVE интерпретируется как «нет доказательства», а не как «DC не хуже»"
    why_human: "MODEL-03 по формулировке «оператор может сравнить» механизмом выполнен, но на реальных данных ни одного сравнения не выполнялось. Нужны живая БД с достаточной историей снапшотов и участие оператора"
  - test: "Проверить в рабочей БД, какой метод ρ реально выпускается: SELECT receipt->'receipt'->'dixonColes'->>'method', count(*) FROM \"ForecastSnapshot\" WHERE \"modelVersion\"='dixon-coles-ensemble-v1' GROUP BY 1"
    expected: "Видно долю mle-low-score-v1 / pooled-fallback-v1 / insufficient-sample-zero / out-of-band-zero"
    why_human: "Пока в окне 730 дней меньше 150 завершённых матчей лиги (300 в пуле), дефолтная модель численно совпадает с Poisson под другой меткой. Это честно отражено в provenance и карточке, но продуктовую значимость дефолта оценивает человек"
---

# Фаза 11: Отчёт верификации (Dixon-Coles model version)

**Цель фазы:** Вероятности прогнозов выпускаются под новой версионированной моделью с коррекцией Диксона-Коулза и закреплённой конвенцией τ, а оператор может доказать rolling-origin бэктестами, что она лучше замороженного Poisson-базиса (или честно не лучше), до того как она станет production-дефолтом.
**Проверено:** 2026-11-23T20:40:00Z
**Статус:** human_needed
**Повторная верификация:** Нет, первичная (предыдущего VERIFICATION.md нет)

## Итог одной фразой

Код достигает цели в части MODEL-01 и MODEL-02, механизм MODEL-03 реализован, подключён и покрыт тестами, все 12 замечаний ревью исправлены в коде без регрессий. Блокирующих разрывов нет. Статус `human_needed` из-за двух вещей, которые код решить не может: (1) порядок «дефолт раньше сравнения» противоречит буквальной формулировке цели и требует явного принятия, (2) ни одного реального сравнения на данных не выполнено, а эксплуатационной точки входа для подачи плана нет.

## Достижение цели

### Наблюдаемые истины

| # | Истина | Статус | Доказательство |
|---|--------|--------|----------------|
| 1 | SC1/MODEL-01: коррекция DC с закреплённой τ и ограниченным ρ; ρ=0 воспроизводит Poisson, матрица суммируется в 1, при отрицательном ρ вероятность ничьей растёт | ✓ VERIFIED | `packages/domain/src/forecast/dixon-coles.ts`: `dixonColesTau` (τ(0,0)=1−λhλaρ, τ(1,0)=1+λaρ, τ(0,1)=1+λhρ, τ(1,1)=1−ρ), `dixonColesRhoBounds` = max(−1/λh,−1/λa) < ρ < min(1/(λhλa),1), `assertDixonColesRho` кодированный fail-closed. Тесты в `tests/unit/dixon-coles.test.ts`: «reproduces the independent Poisson grid bit-for-bit at rho = 0», «keeps every market summing to one…», «raises the draw probability relative to the poisson-ensemble-v1 baseline», «grows draws and shrinks 1-0 / 0-1 when rho is negative». Юнит-прогон 659/659 пройден мной в этой сессии |
| 2 | SC2/MODEL-02: новая идентичность версии во всём стеке за один когерентный проход | ✓ VERIFIED | `MODEL_VERSIONS` + `isForecastModelVersion` в `model-version.ts`; членство в union проверяют: `contract.ts:153`, `forecast-orchestrator.ts:93`, `model-comparison.ts:104`, `workers/data-sync/src/jobs/backtests.ts:41`, селектор `packages/config/src/index.ts:19,54` (`z.enum(MODEL_VERSIONS)`). Все production-пути (`forecasts.service.ts`, `forecast-sweep.ts`, `main.ts` LINEUP_CONFIRMED) берут версию и configHash из `resolveForecastModelSelection`. Оставшиеся литералы `"poisson-ensemble-v1"` объяснимы: вспомогательный V1-хэш, дефолт `createForecast` при отсутствии версии, карточка (роль отката), фикстура perf-аудита. Колонки `modelVersion` в Prisma — `String`, DDL не нужен. `pnpm typecheck` 7/7 |
| 3 | SC3/MODEL-03 (механизм): оператор может сравнить метрики rolling-origin бэктестов новой версии с базисом | ✓ VERIFIED | План пинит версию (`backtests.ts:44,115-117`), ρ фитится на `trainingEndsAt` (`main.ts:78` → `fitLeagueDixonColesParameters(... asOf: window.trainingEndsAt)`), `compareBacktestPlans` проверяет идентичность когорты по наборам fixtureId и `[from,to)`, `buildModelComparisonReceipt` даёт закрытую квитанцию с planHash, windowsDigest, вердиктом `model-comparison-v2` (materiality 0.002, минимум выборки 30), `GET /evaluation/model-comparison` под `OperatorGuard`. Интеграционные тесты `model-comparison-api` 5/5, `backtest-origin` 9/9, `backtest-production` 3/3, мой прогон. Оговорка про целостность цепочки вынесена в истину 6 |
| 4 | SC3: карточка методологии называет точную интеграцию и ограничения (в том числе нейтральность O/U 2.5) | ✓ VERIFIED | `model-card.ts` v1.1.0: `integration: "hybrid-elo-form-poisson-with-tau"`, τ, `rhoBounds` исправлено, политика ρ с фолбэками и `out-of-band-zero`, нейтральность тотала 2.5 при фиксированных λ (суммарное изменение массы четырёх клеток равно нулю, проверено аналитически), ограничения: гибрид, нет публичного сравнения, малая выборка даёт INCONCLUSIVE. Страница `apps/web/app/methodology/page.tsx` рендерит `MODEL_CARD` (без «μ», без обещания публичного вида сравнения). E2E-тест карточки по словам заказчика проходит, сам я его не запускал |
| 5 | Цель: сравнение доказывается ДО того, как модель станет production-дефолтом | ? UNCERTAIN | В коде дефолт — `DEFAULT_FORECAST_MODEL_VERSION = "dixon-coles-ensemble-v1"` (`model-version.ts:13`, `config/src/index.ts:19`), включён в 11-02, а сравнение появилось в 11-03. Это прямое следствие D-01 («дефолтом сразу», прямое указание оператора) и D-13 («автоматического продвижения нет, сравнение — доказательство, а не гейт»; откат одним `FORECAST_MODEL_VERSION`). Буквальная формулировка цели и MODEL-03 нарушена; решение принято до фазы и записано в CONTEXT, но override в VERIFICATION не оформлен. Нужно решение человека (см. ниже) |
| 6 | Цель: оператор реально может провести сравнение целиком на данных и получить честный вердикт | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Все звенья есть и подключены, но цепочка «подать планы → воркер → фит ρ → квитанция» на реальных данных не выполнялась. Эксплуатационной точки входа для подачи плана нет: `admitPersistEnqueueBacktest` вызывается только из `tests/integration/backtest-production.test.ts`, в `scripts/`, API и CLI подачи нет (унаследовано от фазы 4). Фит ρ берёт лишь снапшоты с `issuedAt <= trainingEndsAt`, поэтому на исторических окнах без ранее выпущенных прогнозов DC-сторона получит ρ = 0 и сравнение будет формально честным, но малоинформативным |
| 7 | Исправления ревью (2 critical, 6 warning, 4 info) действительно в коде и нет регрессий | ✓ VERIFIED | Подробно ниже. Рабочее дерево чистое (в `git status` только нерелевантные `.planning/…`, `bet-stats-main.zip`), все правки в HEAD, юнит 659/659, typecheck 7/7, `dixon-coles-rho` и `model-comparison-api` 13/13 |
| 8 | Дефолтная модель в production действительно фитит ρ (а не молча выдаёт ρ = 0 из-за рассинхрона форм receipt) | ✓ VERIFIED | Писатель `forecast-repository.ts:81` сохраняет `receipt: response` (весь DTO), оркестратор кладёт λ в `receipt.expectedGoals` DTO, читатель `dixon-coles-repository.ts:43-52` читает `receipt.receipt.expectedGoals`. Интеграционный тест сидит именно эту форму (`dixon-coles-rho.test.ts:134`), 13/13 с `model-comparison-api` проходят. Остаточный риск: сид собран вручную, а не через `publish` (см. предупреждения) |

**Счёт:** 6/8 истин подтверждено; 1 present, behavior-unverified (истина 6); 1 uncertain (истина 5).

### Проверка исправлений ревью (11-REVIEW.md, таблица Disposition)

| Замечание | Заявлено | Что в коде фактически |
|-----------|----------|------------------------|
| CR-01 чтение λ не с того уровня receipt | fixed | ✓ `dixon-coles-repository.ts:43-52` читает `receipt.receipt.expectedGoals`; сид интеграционного теста в реальной форме |
| CR-02 нет OperatorGuard | fixed | ✓ `evaluation.controller.ts:37-38` `@UseGuards(OperatorGuard)` на `modelComparison`, остальные маршруты без него; тест проверяет метаданные `__guards__` и 404 без учётных данных. Модуль не регистрирует `OperatorGuard` в `providers`, но зависимость `@Optional()`, Nest создаёт guard как injectable модуля; тот же приём использован в других контроллерах |
| WR-01 лишняя нижняя граница ρ | fixed | ✓ `dixon-coles.ts:74` `Math.max(-1/λh, -1/λa)`; тест λ=(2,2); строка в карточке исправлена |
| WR-02 оценка score на концах интервала | fixed | ✓ `dixon-coles.ts:192-200` скобка `min+ε / max−ε`, нефинитные score уходят в fallback; тест floating-point |
| WR-03 ρ вне полосы даёт 500 | fixed | ✓ `model.ts:152-154` деградация в `rho: 0`, `method: "out-of-band-zero"`, ограничение в `limitations`; `assertDixonColesRho` бросает кодированную ошибку |
| WR-04 невоспроизводимый фит | fixed (partly) | ✓ `dixon-coles-repository.ts:74` `issuedAt: { lte: asOf }`, берётся новейшая пригодная ревизия на fixture. Остаток признан: снапшоты бэктеста неотличимы от production при `asOf = now` (см. предупреждения) |
| WR-05 когорта и вердикт | fixed | ✓ `backtest-repository.ts`: окна только из реально оценённых fixture, сравнение множеств fixtureId, `lt: to`; `model-comparison.ts`: `minimumSampleSize = 30`, политика `model-comparison-v2` |
| WR-06 лишние утверждения в карточке | fixed | ✓ страница больше не обещает публичный вид сравнения, карточка описывает фолбэки и границы верно |
| IN-01 `localeCompare` в канонизации | fixed (partly) | ✓ единый `canonical-json.ts` с порядком по кодовым единицам; V1-хэши не изменились (regression 3/3). Остался `localeCompare` при сортировке `sources` в `model.ts:188` (сознательно, чтобы не сдвигать сохранённые V1 `inputHash`) |
| IN-02 admission не проверял configHash | fixed | ✓ `backtests.ts:44` `BACKTEST_CONFIG_HASH_MISMATCH` до сохранения |
| IN-03 ошибки конфигурации как 400 | fixed | ✓ `forecasts.service.ts:11,17-19` четыре кода → `ServiceUnavailableException` |
| IN-04 символ «μ» | fixed | ✓ в `page.tsx` и карточке нет |

### Отклонение по порядку (дефолт раньше сравнения)

Оценка: **осознанное принятое отклонение, но формально не закрытое**.

- Это не ошибка исполнения. CONTEXT.md фиксирует: D-01 (дефолт `dixon-coles-ensemble-v1` сразу, раздел помечен как «прямое указание оператора»), D-02 (V1 остаётся first-class), D-03 (селектор версии в конфиге), D-12/D-13 (сравнение — воспроизводимая операторская процедура, а не автоматический гейт; откат — переключение версии). Реализация совпадает с этими решениями: V1 селектируем, не переписан, исторические V1-хэши заморожены тестом.
- Но ROADMAP-цель («до того как станет production-дефолтом») и MODEL-03 («до того как станет дефолтом») прочитаны буквально в этой последовательности не выполняются: дефолт включён в 11-02, механизм сравнения — в 11-03, а фактического сравнения нет вообще.
- Смягчающее: честность не нарушена. Provenance в каждой квитанции показывает метод ρ, при нехватке истории выпускается явный ρ = 0, карточка прямо говорит, что публичного сравнения нет и что DC не гарантирует выигрыша. Откат — одна переменная окружения.
- Решение требует владельца. Если порядок принят, рекомендуемый override (заполнить `accepted_by`, `accepted_at`; я не подставляю чужое имя):

```yaml
overrides:
  - must_have: "сравнение доказывается до того, как модель станет production-дефолтом"
    reason: "D-01 (прямое указание оператора): дефолт включён сразу; D-13: сравнение является доказательством для оператора, а не гейтом; откат одним FORECAST_MODEL_VERSION=poisson-ensemble-v1"
    accepted_by: "<имя владельца>"
    accepted_at: "<ISO-время>"
```

### Покрытие требований

| Требование | План | Описание | Статус | Доказательство |
|------------|------|----------|--------|----------------|
| MODEL-01 | 11-01, 11-02 | DC-коррекция, закреплённая τ, ограниченный ρ, тесты ρ=0 / сумма 1 / рост ничьей | ✓ SATISFIED | истина 1, юнит-тесты `dixon-coles.test.ts`, `forecast-v1-regression.test.ts` |
| MODEL-02 | 11-01, 11-02 | Новая идентичность версии по всему стеку за один проход | ✓ SATISFIED | истина 2, `MODEL_VERSIONS` повсюду, typecheck 7/7, `forecast-model-version.test.ts` |
| MODEL-03 | 11-03, 11-04 | Оператор сравнивает rolling-origin метрики нового и замороженного базиса до дефолта | ? NEEDS HUMAN | механизм ✓ (истина 3), порядок «до дефолта» не соблюдён по D-01/D-13 (истина 5), реальный прогон не выполнен (истина 6) |

Все три ID присутствуют в `requirements:` frontmatter планов (11-01: MODEL-01, MODEL-02; 11-02: MODEL-01, MODEL-02; 11-03: MODEL-03; 11-04: MODEL-03) и в `.planning/REQUIREMENTS.md` (строки 36-38, 111-113). Осиротевших требований нет: другие ID к фазе 11 в REQUIREMENTS.md не привязаны. В REQUIREMENTS.md чекбоксы и трассируемость всё ещё `[ ]` / `Pending`; обновление за оркестратором.

### Требуемые артефакты и ключевые связи

Автоматическая проверка `verify.artifacts` вернула 0/0 (в frontmatter планов нет блока `artifacts`), `verify.key-links` вернула 0/11 из-за того, что инструмент ищет путь-цель буквально, а связи идут через алиасы пакетов `@bet-stats/*`. Это ложноотрицательный результат эвристики, я проверил связи вручную:

| От | К | Через | Статус |
|----|---|-------|--------|
| `forecast/model.ts` | `forecast/dixon-coles.ts` | импорт `applyDixonColesCorrection`, `dixonColesRhoBounds`, `isDixonColesRhoWithinBounds` | ✓ WIRED |
| `forecast/contract.ts` | `forecast/model-version.ts` | `isForecastModelVersion` в `parseForecastResponse` | ✓ WIRED |
| `dixon-coles-repository.ts` | `evaluation/backtest-repository.ts` | `resolveHistoricalResultGraph` | ✓ WIRED |
| `forecast-repository.ts` | `dixon-coles-repository.ts` | `findDixonColesParameters: createDixonColesParameterProvider(client)…` | ✓ WIRED |
| `workers/data-sync/src/main.ts` | `dixon-coles-repository.ts` | `resolveDixonColes → fitLeagueDixonColesParameters(asOf: trainingEndsAt)` | ✓ WIRED |
| `packages/config/src/index.ts` | `forecast/model-version.ts` | `z.enum(MODEL_VERSIONS).default(DEFAULT_FORECAST_MODEL_VERSION)` | ✓ WIRED |
| `evaluation.service.ts` | `backtest-repository.ts` / `model-comparison.ts` | `comparePlans: compareBacktestPlans(client, …)`, `toModelComparisonResult` | ✓ WIRED |
| `apps/web/app/methodology/page.tsx` | `methodology/model-card.ts` | `MODEL_CARD` из `@bet-stats/domain` | ✓ WIRED |
| `tests/e2e/methodology.spec.ts` | `model-card.ts` | пин берётся из `MODEL_CARD` | ✓ WIRED |

### Трассировка потока данных (уровень 4)

| Артефакт | Данные | Источник | Реальные данные | Статус |
|----------|--------|----------|-----------------|--------|
| `dixon-coles-repository.collectRows` | λ и счёт | `ForecastSnapshot.receipt.receipt.expectedGoals` + `ResultVersion` через `resolveHistoricalResultGraph` | да (Prisma-запросы, интеграционный тест) | ✓ FLOWING |
| `ForecastOrchestrator.run` | ρ и provenance | `repository.findDixonColesParameters` либо явный `input.dixonColes` | да | ✓ FLOWING |
| `compareBacktestPlans` | Brier/logLoss | `forecastScore` по `scoreIds` оценённых окон | да (backtest-production 3/3 на реальном PostgreSQL) | ✓ FLOWING |
| `/methodology` | текст карточки | `MODEL_CARD` | да | ✓ FLOWING |

### Поведенческие проверки

| Поведение | Команда | Результат | Статус |
|-----------|---------|-----------|--------|
| Юнит-набор целиком | `pnpm vitest run --project unit` | 59 файлов, 659/659 | ✓ PASS |
| Типы по всему воркспейсу | `pnpm typecheck` | 7/7 задач | ✓ PASS |
| ρ-фит и граница API сравнения | `pnpm vitest run --project integration tests/integration/model-comparison-api.test.ts tests/integration/dixon-coles-rho.test.ts` | 13/13 | ✓ PASS |
| Бэктест pinned-версии и сравнение на реальной БД | `... backtest-origin.test.ts backtest-production.test.ts` | 12/12 | ✓ PASS |
| `forecast-snapshots.test.ts`, `phase-03-security.test.ts` | те же, без `DATABASE_URL` | не запустились (`DATABASE_URL is required`, это окружение, а не код) | ? SKIP: опираюсь на заявленные заказчиком 4/4 и 13/13 при запуске по отдельности (0b589a2) |
| Полный официальный интеграционный прогон | `pnpm test:integration:docker` | не перезапускал; заказчик: 533/535, 2 падения в `phase-03-security` (фикстура), исправлены в 0b589a2 | ? SKIP (по свидетельству заказчика) |
| E2E карточки методологии | Playwright | не запускал; заказчик: проходит. Тест «contextual warnings…» падает из-за отсутствия seeded live-fixture в окружении, к фазе 11 не относится | ? SKIP |

### Исполнение проб

Фаза не объявляет и не подразумевает probe-скриптов (`probe-*.sh` в PLAN/SUMMARY нет). Шаг пропущен.

### Антипаттерны

| Файл | Строка | Паттерн | Серьёзность | Влияние |
|------|--------|---------|-------------|---------|
| (файлы фазы) | — | `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` | — | не найдено |
| `packages/database/src/dixon-coles-repository.ts` | 67-79 | снапшоты бэктеста неотличимы от production при фите на `asOf = now` | ⚠️ Warning | остаток WR-04; λ у гибрида от версии модели не зависят, поэтому искажение ρ мало, но воспроизводимость фита для `asOf = now` не абсолютна. Решение: поле `initiator` в строке снапшота или фильтр по плану |
| `packages/domain/src/forecast/model.ts` | 188 | `localeCompare` при сортировке `sources` | ℹ️ Info | оставлено сознательно, чтобы не менять V1 `inputHash`; зависимость от ICU остаётся только здесь и в `comparison.ts:83` |
| `tests/integration/model-comparison-api.test.ts` | 56-70 | тест guard проверяет метаданные `__guards__` и методы `OperatorGuard`, но не поднимает HTTP | ℹ️ Info | достаточно для fail-closed, но реальный 404 по HTTP не проверен |
| `tests/integration/dixon-coles-rho.test.ts` | 134 | сид receipt собран вручную, не через `publish` | ℹ️ Info | рассинхрон писателя и читателя, как в CR-01, мог бы повториться незамеченным. Лучше сидировать через `createPrismaForecastRepository.publish` |
| `.planning/phases/11-…/11-03-SUMMARY.md` | «Операторская процедура» | пример `curl` с `Cookie: <eligibility-session>` без `x-operator-credential` | ℹ️ Info | документ устарел после CR-02: без заголовка эндпоинт ответит 404 |

### Требуется проверка человеком

#### 1. Принять отклонение по порядку (дефолт до сравнения)

**Тест:** Решить, принимается ли D-01/D-13 как осознанное отклонение от буквальной цели.
**Ожидаемо:** Либо override в frontmatter (шаблон выше), либо возврат дефолта на `poisson-ensemble-v1` до первого сравнения.
**Почему человек:** продуктовое решение, код ведёт себя по записанным решениям.

#### 2. Выполнить реальное сравнение V1 и DC

**Тест:** Подать два плана с идентичными окнами, дождаться `SUCCEEDED`, вызвать `GET /evaluation/model-comparison` с `x-operator-credential`, сохранить квитанцию.
**Ожидаемо:** `available: true`, квитанция с planHash, windowsDigest, вердиктом по `model-comparison-v2`; отрицательный или неубедительный результат тоже публикуется (D-12).
**Почему человек:** нужны реальные данные и реальный воркер; эксплуатационной точки входа для подачи плана в репозитории нет.

#### 3. Посмотреть фактическое распределение методов ρ в production

**Тест:** SQL из frontmatter (`human_verification`).
**Ожидаемо:** понятна доля прогнозов, где ρ реально фитится, а не равен 0.
**Почему человек:** определяет, имеет ли дефолт практический эффект уже сейчас или только по накоплении истории (150 матчей на лигу или 300 в пуле за 730 дней).

### Итог по разрывам

Разрывов (`gaps`) нет: ни одна истина не провалена, артефактов-заглушек и неподключённых звеньев не обнаружено, блокирующих антипаттернов нет. Все 12 замечаний ревью реально исправлены. Две оставшиеся неопределённости (порядок дефолта и отсутствие реального прогона сравнения) по правилам относятся к `human_needed`, а не к `gaps_found`. Отдельно замечу как предупреждение: отсутствие эксплуатационного способа подать backtest-план мешает MODEL-03 на практике; это унаследованное ограничение фазы 4, но без него «оператор может сравнить» остаётся истиной на уровне функций и тестов, а не рабочего процесса.

---

_Проверено: 2026-11-23T20:40:00Z_
_Верификатор: Claude (gsd-verifier)_
