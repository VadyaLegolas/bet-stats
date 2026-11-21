# Phase 11: Dixon-Coles Model Version - Context

**Gathered:** 2026-11-20
**Status:** Ready for planning
**Mode:** Auto (`--auto`) — оператор делегировал решения и дал два прямых указания: новая модель становится дефолтом сразу, текущая модель сохраняется и остаётся выбираемой.

<domain>
## Phase Boundary

Фаза добавляет коррекцию Диксона-Коулза для низких счетов как **новую версию модели** (`dixon-coles-ensemble-v1`), делает её **дефолтом для новых прогнозов** и проводит единое расширение идентичности версии по всему стеку (снапшоты, бэктесты, сравнения, валидаторы), сохраняя `poisson-ensemble-v1` как полноценную выбираемую версию для отката и сравнения. Оператор может прогнать бэктест по одним и тем же rolling-origin окнам для обеих версий и сравнить метрики с замороженным Poisson-базисом до/после, а карточка методологии честно называет гибридную интеграцию и её ограничения.

Вне фазы: калибровка (фаза 12), новые рынки (фаза 14), расширение лиг, полный refit атаки/защиты DC, изменение value-квитанций, автоматическое продвижение модели по метрикам.

Requirements: MODEL-01, MODEL-02, MODEL-03.

</domain>

<decisions>
## Implementation Decisions

### Выбор версии и сохранение текущей модели (прямое указание оператора)
- **D-01:** Новая версия `dixon-coles-ensemble-v1` становится **дефолтом сразу**: все новые прогнозы production-путей (API `generateForecast`, forecast-sweep, LINEUP_CONFIRMED enrichment) выпускаются под ней без дополнительного ручного переключения после выката. — **Reversibility:** reversible — откат делается одним переключением `FORECAST_MODEL_VERSION` обратно на `poisson-ensemble-v1`; старые строки остаются валидными.
- **D-02:** `poisson-ensemble-v1` **сохраняется как first-class версия** и остаётся выбираемой в любой момент (конфиг/окружение). Она не удаляется, не переинтерпретируется и не переписывается: уже выданные V1-снапшоты неизменяемы, V1-путь расчёта сохраняется (при `ρ`-обходе — байт-в-байт прежние вероятности и хэши). — **Reversibility:** one-way — удаление или переопределение V1 позже сломает откат, сравнимость когорт и воспроизводимость уже выданных квитанций.
- **D-03:** Селектор версии — версионируемая конфигурация (`FORECAST_MODEL_VERSION` в `packages/config`, допустимые значения из общего union), а не литерал в каждом вызывающем месте. Значение по умолчанию — `dixon-coles-ensemble-v1`. Backtest-путь **не** читает production-дефолт: план бэктеста явно пинит `modelVersion` и может выпускать V1-снапшоты даже при DC-дефолте, иначе замороженный базис нельзя пересчитать. — **Reversibility:** reversible — добавление/смена значения в конфиге.
- **D-04:** Переключение дефолта не переписывает историю: никакого backfill, никаких UPDATE существующих `ForecastSnapshot`/`ForecastScore`; смена модели для конкретного матча — только новая revision/supersession. — **Reversibility:** one-way — переписывание истории нарушит append-only контракт фаз 03/04 и обесценит сохранённые оценки.

### Интеграция модели
- **D-05:** Интеграция — **гибридная**: сохраняем существующие Elo/form/venue-выведенные `λ_home`, `λ_away` и применяем DC-множитель `τ` ровно к четырём клеткам счёта (0-0, 1-0, 0-1, 1-1). Полный refit атаки/защиты DC в этой фазе не делается (риск двойного учёта домашнего преимущества). В карточке методологии это называется «Elo/form-Poisson с поправкой Диксона-Коулза», **не** «модель Диксона-Коулза». — **Reversibility:** costly — переход на полный DC- refit позже потребует новой версии модели и пере-бэктеста; молчаливая подмена запрещена.
- **D-06:** Закрепляется одна конвенция `τ` (современная): `τ(0,0)=1−λ_h·λ_a·ρ`, `τ(1,0)=1+λ_a·ρ`, `τ(0,1)=1+λ_h·ρ`, `τ(1,1)=1−ρ`; при `ρ<0` вероятности 0-0 и 1-1 растут, 1-0/0-1 падают. Конвенция фиксируется в коде, карточке модели и тестах; внешние значения `ρ` либо конвертируются в неё явно, либо отвергаются. — **Reversibility:** costly — смена знака/конвенции инвертирует поправку и сделает несравнимыми уже записанные `ρ` и оценки.
- **D-07:** `ρ` ограничен допустимой полосой, выведенной из строгой положительности всех четырёх `τ`: `max(−1/(λ_h·λ_a), −1/λ_h, −1/λ_a) < ρ < min(1/(λ_h·λ_a), 1)` с ε-запасом; каждый множитель `τ` обязан быть строго положительным для конкретного матча; при нарушении — fail-closed, а не clamp в невалидную вероятность. (Amended at planning: нижняя граница расширена третьим членом `−1/(λ_h·λ_a)`, который при `λ>1` строже, чем `−1/λ`.) — **Reversibility:** reversible — границы локализованы в одной функции.
- **D-08:** `ρ` оценивается **по лигам** из settled-истории в пределах evidence-окна; при нехватке выборки лиги — явно документированный pooled-fallback по top-5 с указанием метода и N. Одно глобальное «футбольное ρ» не хардкодится. `ρ=0` остаётся воспроизводимым baseline-тогглом. — **Reversibility:** costly — метод и окно оценки попадают в квитанции и определяют сравнимость будущих версий.

### Идентичность версии и единый проход (MODEL-02)
- **D-09:** `MODEL_VERSIONS = ["poisson-ensemble-v1", "dixon-coles-ensemble-v1"] as const` в домене; все проверки-литералы (`!== "poisson-ensemble-v1"`) расширяются до членства в union **одним когерентным коммитом**: оркестратор, парсер контракта, API-сервис, worker-jobs (forecasts, forecast-sweep, backtests, main), model-card, тесты. Частичный compile/частичный выкат запрещён. — **Reversibility:** costly — разъехавшиеся проверки допускают смешение версий под одной идентичностью.
- **D-10:** `modelHash` продолжает выводиться из версии (`sha({ version })`): DC-строка автоматически получает другой `modelHash`, уникальный ключ `ForecastSnapshot` уже включает `modelHash`+`configHash`, поэтому DDL не нужен (`modelVersion` — `String`, не enum). **Amended at planning:** `FORECAST_CONFIG` (`forecast-config-v1`) остаётся **побайтно неизменным** — это единственный способ сохранить V1-хэши и вероятности точно такими же (D-02). DC получает отдельный `DIXON_COLES_CONFIG` с идентичностью `forecast-config-v2`, который включает снимок базовых параметров плюс политику `ρ` (конвенция, метод, окно, минимальные выборки, ε). `configHash` DC-снапшота = хэш `DIXON_COLES_CONFIG`; `forecastConfigHashFor(version)` выбирает нужный. Сам `ρ` — не константа конфига: он попадает в `inputHash` вместе с провенансом, иначе два разных `ρ` при тех же доказательствах столкнулись бы на уникальном ключе. — **Reversibility:** one-way — менять смысл `forecast-config-v2` после выдачи снапшотов нельзя, иначе две разные модели окажутся под одной идентичностью.

### Прозрачность квитанции
- **D-11:** Квитанция DC-снапшота получает блок провенанса `dixonColes` (`rho`, `convention`, `method`, `windowFrom`, `windowTo`, `sampleSize`, `tauMin`) — закрытый набор полей, без секретов. Парсер расширяется так, чтобы **legacy V1-квитанции без блока оставались валидными** (поле optional-with-derivation), а DC-квитанция без провенанса отвергалась. — **Reversibility:** costly — после выдачи квитанций схема блока становится частью контракта.

### Сравнение с замороженным базисом (MODEL-03)
- **D-12:** MODEL-03 реализуется как **воспроизводимая операторская процедура сравнения**: один и тот же набор rolling-origin окон прогоняется для V1 и DC (план бэктеста пинит версию), результат — сравнение метрик по рынкам (Brier, log loss; отдельный акцент на DRAW и низких тоталах) плюс когорты скоркардов по `modelVersion`. Сравнение сохраняется как артефакт-квитанция (JSON) с хэшем плана/окон, чтобы его можно было повторить. Честный отрицательный результат («DC не лучше на рынке X») публикуется, а не скрывается. — **Reversibility:** reversible — процедура поверх существующих бэктестов/скоркардов.
- **D-13:** Автоматического продвижения по метрикам нет: дефолт задан D-01, а сравнение — доказательство для оператора, а не автоматический гейт. Откат — явное переключение версии (D-01/D-03). — **Reversibility:** reversible.

### Карточка методологии
- **D-14:** `MODEL_CARD` и страница `/methodology` обновляются: честная гибридная формулировка, конвенция `τ`, провенанс `ρ`, ожидаемые эффекты (draw ↑, O/U 2.5 нейтрален при фиксированных λ,μ, O/U 0.5/1.5 и BTTS двигаются), ограничения и явное указание, что `poisson-ensemble-v1` остаётся доступной для отката и сравнения. — **Reversibility:** reversible — текст и версия карточки.

### Тесты
- **D-15:** Обязательные пины: (i) `ρ=0` воспроизводит независимый Poisson (и V1-значения не меняются), (ii) матрица после `τ` суммируется в 1 на усечённой сетке, (iii) при закреплённом знаке 0-0 и 1-1 растут, 1-0/0-1 падают, (iv) все `τ>0` для тестовых λ,μ, (v) границы `ρ` отвергают невалидные значения, (vi) обе версии принимаются оркестратором/парсером/бэктестом, (vii) V1-квитанции без блока `dixonColes` парсятся. — **Reversibility:** reversible.

### the agent's Discretion
- Точный метод оценки `ρ` (MLE по низким счетам vs moment-based), веса pooled-fallback и минимальный размер выборки лиги — при условии версионирования, провенанса и покрытия тестами.
- Точная форма артефакта сравнения (JSON-квитанция + CLI-скрипт vs страница `/internal` vs расширение скоркардов) — при условии воспроизводимости и честных unavailable-состояний.
- Имя env-переменной селектора и её размещение в `packages/config` (предпочтительно `FORECAST_MODEL_VERSION`).
- Точная раскладка секции DC в карточке методологии в рамках существующих паттернов и русского UI-текста.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Требования и роадмап
- `.planning/ROADMAP.md` §Phase 11 — цель, критерии успеха, research flags (гибрид рекомендован; `modelVersion` захардкожен в ≥10 файлах).
- `.planning/REQUIREMENTS.md` §MODEL-01, §MODEL-02, §MODEL-03 — три приёмочных требования.

### Research
- `.planning/research/FEATURES.md` §6 «Dixon-Coles low-score correction» — формулы `τ`, границы `ρ`, честные состояния, порядок «DC → калибровка».
- `.planning/research/PITFALLS.md` §Pitfall 6 — конвенции знака, устойчивость оценки, двойной домашний фактор, обязательные тесты.
- `.planning/research/ARCHITECTURE.md` §Pattern 1 (versioned identity), §Anti-Patterns 1–2, §Integration Points row 6 — `MODEL_VERSIONS`, отсутствие DDL, список модифицируемых файлов.
- `.planning/research/SUMMARY.md` — заметка о неперсистируемой score-матрице и производных рынках.

### Унаследованные контракты фаз
- `.planning/phases/03-forecast-and-manual-value-workbench/03-CONTEXT.md` — D-01…D-08: Poisson-ансамбль, нормализация, append-only снапшоты, fail-closed gates.
- `.planning/phases/04-settlement-and-evidence-scorecard/04-CONTEXT.md` — D-04/D-10: метрики по modelVersion-когортам, rolling-origin без утечки.
- `.planning/phases/07-ci-pipeline-quality-gates/07-CONTEXT.md` — CI-дисциплина, на которую ложатся изменения модели (mutation gates, Linux-интеграция).

### Живые контракты кода
- `packages/domain/src/forecast/model.ts` — `createForecast`, генерация матрицы 0..7, `modelVersion: "poisson-ensemble-v1"`, `configHash`, `inputHash`.
- `packages/domain/src/forecast/config.ts` — `FORECAST_CONFIG` (`forecast-config-v1`), веса, bounds, `lambdaBounds`, `fairOddsForProbability`.
- `packages/domain/src/forecast/contract.ts` — `parseForecastResponse` с `exactKeys` и проверкой `modelVersion`/`configVersion`.
- `packages/domain/src/evaluation/forecast-orchestrator.ts` — `MODEL_VERSION_MISMATCH` (строка 71), `modelHash: sha({ version })`, сборка `ForecastResponseDto`.
- `packages/domain/src/evaluation/backtest.ts` — `BACKTEST_POLICY_VERSION = "rolling-origin-v1"`, валидация окон.
- `packages/domain/src/evaluation/scoring.ts` — Brier/log loss формулы (`SCORE_FORMULA_VERSION`, `SCORE_FORMULA_HASH`).
- `packages/domain/src/methodology/model-card.ts` — `MODEL_CARD`, `currentModel`, `changeHistory`.
- `workers/data-sync/src/jobs/forecasts.ts` — типы production-джоб с литералом версии.
- `workers/data-sync/src/jobs/forecast-sweep.ts` — выдача INITIAL/PRE_MATCH (строки 137, 154).
- `workers/data-sync/src/jobs/backtests.ts` — `admitBacktestPlan` (валидация версии), `runBacktestOrigin`.
- `workers/data-sync/src/main.ts` — LINEUP_CONFIRMED issuance (строка 66).
- `apps/api/src/modules/forecasts/forecasts.service.ts` — `generateForecast` (строка 25).
- `apps/api/src/modules/evaluation/evaluation.service.ts` — когорты по `modelVersion` (строки 137–143, 191–192).
- `apps/web/app/methodology/page.tsx` — отображение `MODEL_CARD`.
- `apps/web/app/scorecards/cohort-identity.ts` + `apps/web/components/cohort-filter.tsx` — выбор версии в UI скоркардов.
- `packages/database/prisma/schema.prisma` — `ForecastSnapshot` (строка 612, уникальный ключ 643), `ForecastScore` (905), `BacktestPlan` (217): `modelVersion String`, DDL не требуется.
- `packages/config/src/index.ts` — Zod-схема окружения, куда добавляется селектор версии.

### Тесты, которые нужно расширить, а не переписать
- `tests/unit/forecast-comparison.test.ts`, `tests/unit/forecast-value-tracer.test.ts`, `tests/unit/scorecard-cohort-identity.test.ts`
- `tests/integration/backtest-origin.test.ts`, `tests/integration/backtest-production.test.ts`, `tests/integration/forecast-snapshots.test.ts`, `tests/integration/forecast-publication.test.ts`, `tests/integration/forecast-api.test.ts`, `tests/integration/phase-03-security.test.ts`, `tests/integration/phase-04-security.test.ts`, `tests/integration/replay-boundary.test.ts`
- `tests/e2e/methodology.spec.ts` (пин `poisson-ensemble-v1 / forecast-config-v1`), `tests/e2e/live-provider-stack.ts`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createForecast` уже строит полную матрицу 0..7 и нормализует по retained mass — DC-множитель вставляется между построением `raw` и нормализацией, без нового пайплайна.
- `ForecastOrchestrator` инкапсулирует публикацию, хэши и `parseForecastResponse` — версия и провенанс `ρ` проходят через него, а не через отдельные копии логики.
- `EvaluationService`/`loadCohort` уже фильтруют `ForecastScore` по `modelVersion` и поддерживают `all` — сравнение V1 vs DC доступно без нового агрегатора.
- `admitBacktestPlan`/`runBacktestOrigin` уже пинят `modelVersion` в плане и прогоняют окна тем же контрактом, что production, — это готовая база для MODEL-03.
- `MODEL_CARD` — единый источник текста методологии; страница `/methodology` рендерит его без дублирования.
- `packages/config` Zod-схема — готовое место для селектора версии с fail-closed валидацией.

### Established Patterns
- Append-only версионирование: `(version, hash-of-inputs)`, supersession вместо UPDATE.
- Fail-closed: неизвестная версия/конфиг/провенанс — ошибка, не «последняя модель».
- Никаких ML-библиотек: чистые TypeScript-функции с детерминированными тестами.
- Закрытые схемы квитанций (`exactKeys`) — расширять осознанно, с legacy-совместимостью.
- UI-текст и копирайт — на русском, без гарантий и «модель лучше» без доказательств.

### Integration Points
- `packages/domain/src/forecast/dixon-coles.ts` — новая чистая функция `τ` + границы + провенанс.
- `packages/domain/src/forecast/model.ts` — параметризация версии/конфига и применение `τ`.
- `packages/domain/src/forecast/contract.ts` — union версий + опциональный блок `dixonColes` в квитанции.
- `packages/domain/src/evaluation/forecast-orchestrator.ts` — оркестрация по версии и `modelHash`.
- `workers/data-sync` — production-пути читают селектор, backtest-путь берёт версию из плана.
- `apps/api` — без изменения публичного контракта, кроме расширенного union в DTO.
- `apps/web/app/methodology` — новая секция карточки; `/scorecards` уже умеет когорты по версии.

</code_context>

<specifics>
## Specific Ideas

- Прямое указание оператора: «сделай чтобы теперешняя модель анализа тоже сохранилась» — `poisson-ensemble-v1` не выпиливается.
- Прямое указание оператора: «определи сразу новую модель дефолтом, а старую оставь чтобы можно было в случае чего ее выбрать» — DC выкатывается как дефолт, V1 остаётся точкой отката и сравнения.
- Главный принцип: честность важнее красивого результата — если DC не улучшает рынок, это публикуется (draw/low-score фокус; O/U 2.5 нейтрален по построению).
- Гибрид должен называться гибридом; слово «Dixon-Coles» без оговорки в UI запрещено.
- Сравнение должно быть воспроизводимым (тот же набор окон, хэши плана), а не «посмотрели в дашборд».

</specifics>

<deferred>
## Deferred Ideas

- Полный DC-refit атаки/защиты с собственной оценкой домашнего фактора — отдельная будущая версия модели, не эта фаза.
- Калибровка поверх DC (Platt/isotonic) — фаза 12; фитить её на V1-выходах запрещено.
- Новые рынки (O/U 0.5/1.5, Asian handicap, exact score) из DC-матрицы — фаза 14.
- Автоматическое продвижение/откат модели по метрикам — вне фазы 11 (дефолт задан явно, сравнение — доказательство).
- UI-страница живого A/B-сравнения — может быть добавлена позже поверх квитанции сравнения.

### Reviewed Todos
Нет — `todo.match-phase 11` вернул 0 совпадений.

</deferred>

---

*Phase: 11-dixon-coles-model-version*
*Context gathered: 2026-11-20*
