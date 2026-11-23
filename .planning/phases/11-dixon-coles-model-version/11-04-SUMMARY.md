---
phase: 11-dixon-coles-model-version
plan: "04"
status: complete
completed: "2026-11-23"
commits:
  - sha: 52dee4a
    message: "docs(model-card): publish hybrid dixon-coles integration and rollback path"
  - sha: d4528bc
    message: "docs(web): render dixon-coles methodology section from the model card"
tests_added: 1
---

# Plan 11-04 Summary — Methodology Card and Page for the Hybrid Dixon-Coles Model

## What Was Done

Документационная часть MODEL-03 закрыта: карточка модели и страница `/methodology` честно описывают гибридную DC-коррекцию (низкие счета поверх Elo/form-Poisson сетки), её конвенцию, политику ρ, ограничения и доступность V1 для отката и сравнения. Все числа берутся из `DIXON_COLES_CONFIG` / `DIXON_COLES_CONVENTION`, второй раз не хардкодятся.

### Task 1 — Карточка модели (коммит `52dee4a`)

- `packages/domain/src/methodology/model-card.ts`
  - `version: "model-card-v1.1.0"`, `effectiveDate: "2026-11-21"`; в `MODEL_CARD_SECTION_IDS` добавлен `"dixon-coles"` сразу после `"inputs"`, существующие id не тронуты.
  - `currentModel` теперь вычисляется из `DEFAULT_FORECAST_MODEL_VERSION` (`FORECAST_CONFIG_VERSION_BY_MODEL`, `forecastConfigHashFor`), а не из литералов.
  - `alternatives`: V1 (`poisson-ensemble-v1` / `forecast-config-v1`) с ролью `ROLLBACK_AND_COMPARISON`.
  - `forecast.dixonColes`: `integration: "hybrid-elo-form-poisson-with-tau"`, конвенция, формулы τ, границы ρ, `rhoPolicy` (метод, окно, минимумы выборок, fallback), `effects`, `limitations` — включая нейтральность тотала 2.5 при фиксированных λ, μ и явное «не полный DC-refit».
  - `changeHistory[0]` — запись `model-card-v1.1.0`; прежние записи сохранены. `policies`, `evaluation`, `scoreGrid`, `minimumSamples`, `valueFormulas`, `valueThresholds` не менялись.
- `tests/unit/model-card.test.ts` (новый, 103 строки) покрывает behavior-блок плана, запрет обещаний (`гарантир|точно выигра|прибыль гарант`) и отсутствие секретов в сериализованной карточке.

### Task 2 — Страница `/methodology` и e2e (коммит `d4528bc`)

- `apps/web/app/methodology/page.tsx`: строка «Доступная альтернативная модель» в метаданных; секция `#dixon-coles` («Поправка на низкие счета») между `inputs` и `what-is-excluded` с `TechnicalDetails id="dixon-coles-technical"` (конвенция, формулы, границы ρ, политика ρ, эффекты, ограничения, фраза про нейтральность тотала 2.5, ссылка на `/scorecards#formula-policy-receipts`). Числовых литералов ρ/τ в странице нет.
- `tests/e2e/methodology.spec.ts`: пин версии теперь считается из `MODEL_CARD`, а не из строки; добавлены проверки секции `#dixon-coles`, V1-альтернативы и числа записей истории (3). Кейс V1-когорты на `/scorecards` оставлен.

## Verification

| Проверка | Результат |
|---|---|
| `vitest --project unit` (model-card, forecast-model-version, responsible-copy) | 61/61 passed |
| `pnpm --filter @bet-stats/web exec tsc --noEmit` | без ошибок |
| `playwright methodology.spec.ts` — тест карточки (включая axe wcag2a/aa/21/22aa) | passed |
| `playwright methodology.spec.ts` — «contextual warnings…» | **failed, не связан с планом** |

## Known Issue (вне объёма плана)

Тест `contextual warnings repeat exact limitations with clean stable links` падает на первом `goto(/fixtures/${LIVE_FIXTURES.comparison})`: страница отвечает «Матч не найден», то есть в локальном окружении нет сидового матча живого стека. Этот участок теста 11-04 не менял, а до проверок карточки он не доходит. Против базового коммита падение не перепроверялось. Нужно перепрогнать e2e с поднятым live provider stack.

## Deviations

- Работа по обеим задачам была уже написана в рабочем дереве до запуска исполнителя (прерванная сессия). Исполнитель не запускался заново: код сверен с `<action>`/`<acceptance_criteria>` плана, прогнаны проверки, затем зафиксирован двумя коммитами по задачам.
- `apps/web/next-env.d.ts` изменён dev-сервером Next (`.next/dev/types`); в коммиты не включён.
