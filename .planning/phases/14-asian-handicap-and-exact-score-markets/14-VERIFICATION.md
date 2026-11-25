---
phase: 14-asian-handicap-and-exact-score-markets
verified: 2026-11-25T12:30:00Z
status: human_needed
score: 3/3 roadmap success criteria verified (5/5 requirements MKT-01..MKT-05 satisfied in code); 0 FAILED truths
covered_files:
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-01-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-01-SUMMARY.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-02-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-02-SUMMARY.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-03-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-03-SUMMARY.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-04-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-04-SUMMARY.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-05-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-05-SUMMARY.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-06-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-06-SUMMARY.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-07-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-07-SUMMARY.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-08-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-08-SUMMARY.md"
  - "apps/api/src/modules/forecasts/forecasts.service.ts"
  - "apps/api/src/modules/value/value.service.ts"
  - "apps/web/app/fixtures/[fixtureId]/extended-markets-sections.tsx"
  - "packages/database/prisma/migrations/20261126_phase14_extended_markets/migration.sql"
  - "packages/database/src/evaluation/settlement-pipeline.ts"
  - "packages/database/src/forecast-repository.ts"
  - "packages/domain/src/markets/asian-handicap.ts"
  - "packages/domain/src/markets/exact-score.ts"
  - "packages/domain/src/markets/extended-view.ts"
  - "packages/domain/src/markets/registry.ts"
  - "packages/domain/src/markets/score-matrix.ts"
  - "packages/domain/src/markets/settlement.ts"
  - "packages/domain/src/value/extended-decision.ts"
covered_digest: "v4:sha256:b44441eaf580ff5559374f964ffc36ac3b206561a3b44abbbc22d87e5d9410e5"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Подтвердить правку формулировки про хвост матрицы в 14-UI-SPEC.md (план 14-04 заменил «входит в строку «Любой другой счёт»» на «уже учтён нормировкой на сохранённую массу и распределён по всем счетам»; то же в методологии и карточке модели)"
    expected: "Пользователь принимает новую формулировку (она соответствует математике retained-mass-v1) либо указывает другую; при отказе правится одна строка в extended-markets-model.ts / методологии / model-card"
    why_human: "Изменение утверждённого UI-SPEC, ожидающее подтверждения пользователя; это решение владельца продукта, а не проверка кода"
  - test: "Принять решение по бюджету scriptTransferBytes (Phase 10): 5 960 160 > 5 500 000"
    expected: "Владелец фазы 10 либо сокращает клиентский пакет (баррель @bet-stats/domain в самом большом чанке ~518 KB), либо поднимает бюджет с обоснованием. Превышение возникло до фазы 14 (5 921 263 на конце фазы 13); фаза 14 добавила +38 897 байт (+0,66 %). LCP, TBT, CLS в бюджете"
    why_human: "Продуктовое решение (бюджет vs. оптимизация), вне объёма фазы 14"
  - test: "Живой визуальный просмотр страницы матча с разделами «Азиатская фора» и «Точный счёт», формами ввода (линия АФ, 17 полей) и страницей методологии"
    expected: "Раскладка соответствует 14-UI-SPEC.md; нет визуальных дефектов на мобильной и десктопной ширине"
    why_human: "Автоматика проверила вычисляемые стили, ARIA и axe (15 сценариев Playwright, по отчёту 14-08), но глазомерный просмотр не выполнялся (14-VALIDATION.md, Manual-Only)"
---

# Phase 14: Asian Handicap and Exact Score Markets — Verification Report

**Phase Goal:** A user can view, price, and settle Asian handicap and exact-score probabilities derived from the frozen score matrix — zero new data cost — with quarter-line push/half-bet semantics handled correctly end to end.
**Verified:** 2026-11-25
**Status:** human_needed (все автоматически проверяемые критерии выполнены; остаются три решения/проверки для человека, ни одна не является недостающей реализацией)
**Re-verification:** No — initial verification
**Code under verification:** main @ e540ce9

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Пользователь видит вероятности и справедливые коэффициенты АФ с четвертными линиями (push / половинные ставки) и точные счета по настроенному списку корзин с явным «OTHER», всё из замороженной матрицы счёта | VERIFIED | `packages/domain/src/markets/asian-handicap.ts`: `settleAsianHandicap` (четвертная линия делит ставку на две соседние, WIN/HALF_WIN/PUSH/HALF_LOSS/LOSS), `ahBreakdown`, `ahFairOdds = 1 + (LOSS+HALF_LOSS/2)/(WIN+HALF_WIN/2)` с типизированным UNAVAILABLE вместо Infinity/NaN, `buildAhView` по 21 линии, `mainAhLine`. `exact-score.ts`: 16 явных счетов 0-0..3-3 + `OTHER = max(0, 1 − Σ16)`. `extended-view.ts`: строгий `parseExtendedMarketsView` (закрытые наборы ключей, суммы = 1). API: `ForecastsService.extendedMarkets` + маршрут `GET fixtures/:fixtureId/forecasts/:forecastId/extended-markets`. Web: `extended-markets-loader.ts` → `page.tsx` → `forecast-workbench.tsx` → `extended-markets-sections.tsx` (5 исходов АФ, четвертные линии и пояснение, состояния unavailable / read-failed). Тесты: unit `asian-handicap`, `exact-score`, `extended-view`, `markets-registry` — зелёные; web `extended-markets-model.test.ts` — зелёные |
| 2 | Оператор вводит полные книги коэффициентов для новых рынков с существующей валидацией и no-vig нормализацией и получает value-квитанции с push-aware EV | VERIFIED | Единый реестр `registry.ts` (`selectionsFor`, 25 канонических id) подключён в `odds/contract.ts`, `odds/draft.ts`, `odds/normalize.ts`, `value/contract.ts`, `evaluation/closing-odds.ts`, `evaluation/no-vig-clv.ts` — никаких расхождающихся таблиц. `value/extended-decision.ts` (`decideExtendedValue`): EV = ΣP(исход)·доход(исход) по пяти исходам (WIN: o−1, HALF_WIN: (o−1)/2, PUSH: 0, HALF_LOSS: −0,5, LOSS: −1), edge = условная вероятность выигрыша − no-vig, те же гейты и пороги `VALUE_POLICY`. `value.service.ts`: ветвление `isCoreMarket` / расширенные; расширенный путь сначала доказывает подлинность матрицы (`loadVerifiedMatrix`, 409 `SCORE_MATRIX_UNAVAILABLE`, ничего не пишется). SQL `guard_value_pair()` (миграция) пересчитывает вероятности из сохранённой матрицы по `cellsHash` и проверяет EV/fair/edge арифметически. Web: форма для линии АФ и 17-вариантного точного счёта, `extended-comparison-model.ts`, `value-outcome-section.tsx`. Интеграция: `extended-markets-api.test.ts`, `extended-markets-guards.test.ts` — прошли |
| 3 | Расчёт определяет push / half-win / half-loss АФ и исходы точного счёта по явным версионным правилам внутри конвейера оценки; матрица счёта сохранена при выпуске либо детерминированно перевыводится fail-closed для старых снимков | VERIFIED | Версии: `ah-lines-v1`, `ah-settlement-v1`, `exact-score-buckets-v1`, `exact-score-settlement-v1`, `score-matrix-v1`, `flat-one-unit-v2`, `push-aware-ev-v1`. `markets/settlement.ts`: `SETTLEMENT_RULES` — `Record<MarketFamily,…>` + исчерпывающие `switch`/`assertNever` (новая семья без правила не компилируется). `settlement-pipeline.ts` (строки 285–330): ветвление по `parseMarketId().family` — ONE_X_TWO/OVER_UNDER_2_5/BTTS → `persist_value_settlement` (v1), ASIAN_HANDICAP/EXACT_SCORE → `settleExtendedMarket` + `persist_value_settlement_v2`, `default: never` (трёхрыночный жёсткий guard снят, ForecastScore намеренно остаётся на трёх рынках). Миграция `20261126_phase14_extended_markets`: расширены `guard_value_pair`, `guard_value_settlement` (независимо пересчитывает результат в SQL — `phase14_ah_result`, `phase14_exact_score_result`), `ValueSettlement_result_check` (пять исходов), новая `persist_value_settlement_v2`; только CREATE OR REPLACE и один DROP/ADD CONSTRAINT, триггеры append-only не тронуты, опубликованные миграции не редактировались (`git diff c6a702c..HEAD` по `prisma/` = одна добавленная миграция, `schema.prisma` без изменений). Арифметика v2 только умножением (точные доли, без округления деления). Матрица: `forecast-orchestrator.ts` строит `ScoreMatrixV1` (64 ячейки + `cellsHash`), `assertCoreMarketsReproduced` (три рынка воспроизводятся `===`) до `repository.publish`; `forecast-repository.ts` пишет `scoreMatrix` как top-level ключ `receipt` Json (без DDL); `splitStoredForecast` — единственная точка снятия ключа на всех читателях `ForecastSnapshot.receipt` (repository, forecast-comparison, value.service); `parseForecastResponse` на старых строках не ломается. `resolveScoreMatrix`: ключ присутствует, но невалиден → UNAVAILABLE (без маскировки re-derive); ключ отсутствует → `buildScoreMatrix` по `expectedGoals` (+ rho для dixon-coles) и принимается только если все семь вероятностей воспроизводят сохранённые в пределах 1e-9, иначе UNAVAILABLE; неизвестная модель не угадывается. Агрегаты `aggregateFlatOneUnit` / `pageTotalsByPolicy` ведут v1 и v2 раздельно, неизвестная политика — жёсткая ошибка; когорта (`loadCohort`) читает только `COHORT_POLICY_VERSION` (v1) |

**Score:** 3/3 критерия VERIFIED. `behavior_unverified: 0` — поведенческие инварианты (settlement, fail-closed, SQL guards, TS↔SQL parity) подтверждены исполнявшимися тестами (см. ниже), а не одним наличием символов.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/domain/src/markets/registry.ts` | Единый реестр рынков | VERIFIED | 80 строк; 25 id; используется во всех слоях |
| `packages/domain/src/markets/asian-handicap.ts`, `ah-lines.ts` | АФ: 21 линия, расчёт, разбивка, fair odds, главная линия | VERIFIED | Подлинная логика; ручная проверка: −0,25 при ничьей → HALF_LOSS, −0,5 при победе хозяев на 1 → WIN, −1 → PUSH |
| `packages/domain/src/markets/exact-score.ts` | 16 + OTHER | VERIFIED | OTHER = дополнение до 1, не отдельная строка |
| `packages/domain/src/markets/score-matrix.ts` | `buildScoreMatrix`, `ScoreMatrixV1`, `resolveScoreMatrix`, `splitStoredForecast` | VERIFIED | fail-closed подтверждён чтением и тестами |
| `packages/domain/src/markets/extended-view.ts` | Строгий DTO и парсер | VERIFIED | |
| `packages/domain/src/markets/settlement.ts` | Правила расчёта, исчерпывающие по типу | VERIFIED | |
| `packages/domain/src/value/extended-decision.ts` | push-aware решение | VERIFIED | |
| `packages/domain/src/evaluation/financial.ts` | `flat-one-unit-v2` + агрегаты без смешения политик | VERIFIED | |
| `packages/database/prisma/migrations/20261126_phase14_extended_markets/migration.sql` | Одна forward-миграция | VERIFIED | 417 строк; применялась только в одноразовых контейнерах тестов (не в dev-БД) |
| `packages/database/src/evaluation/settlement-pipeline.ts` | Ветвление по семье рынка | VERIFIED | |
| `apps/api/.../forecasts.service.ts`, `forecasts.controller.ts` | Маршрут extended-markets | VERIFIED | Клиент видит только `SCORE_MATRIX_UNAVAILABLE`, внутренняя причина — в лог |
| `apps/api/.../value.service.ts` | Сравнение для новых рынков | VERIFIED | |
| `docs/closing-odds-operator.md`, `scripts/closing-odds.mjs` | CLI и документация | VERIFIED | Содержат ASIAN_HANDICAP |
| `apps/web/app/fixtures/[fixtureId]/extended-*.ts(x)`, `value-outcome-section.tsx` | Разделы, формы, модели | VERIFIED | Подключены цепочкой loader → page → workbench → sections |
| `packages/domain/src/methodology/model-card.ts` | `model-card-v1.4.0` | VERIFIED | Версия и блок `extendedMarkets` присутствуют |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `createForecast`/orchestrator | `ForecastSnapshot.receipt.scoreMatrix` | `buildScoreMatrixV1` → `repository.publish(..., { scoreMatrix })` | WIRED |
| Читатели `receipt` | публичный DTO | `splitStoredForecast` (3 читателя API/БД) | WIRED |
| `extended-markets` route | `resolveScoreMatrix` → `buildExtendedMarketsView` | `ForecastsService.extendedMarkets` | WIRED |
| `compareValue` | `decideExtendedValue` | `loadVerifiedMatrix` | WIRED |
| Value-квитанция расширенного рынка | SQL guard | `guard_value_pair` пересчитывает из `cellsHash` матрицы | WIRED (интеграционный тест прошёл) |
| Settlement pipeline | `settleExtendedMarket` → `persist_value_settlement_v2` → `guard_value_settlement` | switch по `MarketFamily` | WIRED |
| Страница матча | API | `loadExtendedMarkets` (сбой чтения ≠ устаревший снимок ≠ нераспознанный ответ) | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Разделы АФ/точный счёт | `ExtendedMarketsView` | API → `resolveScoreMatrix` → сохранённая/перевыведенная матрица → чистые функции | Да (не статические значения) | FLOWING |
| Value-квитанция АФ | breakdown / EV | `ahBreakdown` над проверенной матрицей, пересчёт в SQL | Да | FLOWING |
| Расчёт | `ValueSettlement.result` | `ResultVersion.homeGoals/awayGoals` (`score.fullTime`) → TS producer + SQL verifier | Да | FLOWING |

### Behavioral Spot-Checks / выполненные команды

| Проверка | Команда | Результат | Status |
|----------|---------|-----------|--------|
| Целевые unit-файлы фазы (+ pins `SCORE_FORMULA_HASH`, bit-identity `createForecast`) | `pnpm exec vitest run --project unit` (12 файлов) | 342/342 | PASS |
| Весь unit-проект | `pnpm exec vitest run --project unit` | 90 файлов, 1533/1533 | PASS |
| Web-тесты | `pnpm --filter @bet-stats/web test` | 14 файлов, 271/271 | PASS |
| Typecheck domain, database, api | `pnpm --filter … typecheck` | без ошибок | PASS |
| Typecheck web | `tsc --noEmit` | ошибки только в сгенерированном `.next/dev/types/routes.d.ts` (в .gitignore, pre-existing, описано в deferred-items); в исходниках ошибок нет | PASS (с оговоркой) |
| Интеграция фазы (одноразовые контейнеры Postgres, dev-БД не затронута): `extended-markets-parity` (TS↔SQL: 21 линия × 2 стороны × 0..10 × 0..10 + все счета), `extended-markets-guards`, `extended-settlement-pipeline`, `score-matrix-persistence`, `extended-markets-api` | `vitest run --project integration …` | 5 файлов, 45/45 | PASS |
| Долговые маркеры TBD/FIXME/XXX в изменённых файлах | grep | нет | PASS |

### Probe Execution

SKIPPED — фаза не объявляет probe-скриптов (`scripts/*/tests/probe-*.sh`); поведение покрыто тестами выше.

### Requirements Coverage

| Requirement | Описание | Status | Evidence |
|-------------|----------|--------|----------|
| MKT-01 | Просмотр вероятностей АФ и справедливых коэффициентов с четвертными линиями push/half | SATISFIED | Критерий 1; unit + web + e2e-спека (15 сценариев) |
| MKT-02 | Точные счета по списку корзин с явным OTHER | SATISFIED | Критерий 1 |
| MKT-03 | Полные книги коэффициентов, no-vig, value-квитанции с push-aware EV | SATISFIED | Критерий 2; guards/API интеграция |
| MKT-04 | Расчёт push/half-win/half-loss и точного счёта под версионными правилами в конвейере | SATISFIED | Критерий 3; parity + pipeline интеграция |
| MKT-05 | Матрица сохраняется при выпуске или перевыводится fail-closed | SATISFIED | Критерий 3; `score-matrix-persistence` |

Orphaned requirements: нет (все MKT-01..05 заявлены в планах).

### Классификация известных пунктов

| # | Пункт | Классификация | Обоснование |
|---|-------|---------------|-------------|
| 1 | Бюджет `scriptTransferBytes` 5 960 160 > 5 500 000 | WARNING, вынесено человеку | Превышение существовало до фазы 14 (5 921 263 на конце фазы 13); фаза 14 вносит +38 897 байт (+0,66 %). LCP/TBT/CLS в бюджете. Не блокер цели фазы; решение за владельцем фазы 10 (в deferred-items.md и 14-VALIDATION.md) |
| 2 | Правка формулировки хвоста в UI-SPEC | WARNING, ожидает подтверждения пользователя | Новая формулировка математически точнее (при `retained-mass-v1` сетка нормирована на сохранённую массу, хвост размазан по всем ячейкам, `OTHER = 1 − Σ16` — не «сырой хвост»). Код, методология и карточка модели согласованы между собой; нужен только акцепт |
| 3 | A7: `POLICY_CONFIG_MISMATCH` для `forecast-config-v2` | INFO, pre-existing, вне объёма | `VALUE_POLICY.forecastConfigVersion = "forecast-config-v1"` — то же для ядра (`decision.ts`) до фазы 14. Расширенные рынки наследуют поведение: для снимков dixon-coles квитанция выдаётся, но исход `INSUFFICIENT_EVIDENCE` (кандидатом не становится). Для poisson-v1 всё работает. Цель фазы (просмотр, оценка, расчёт) не затронута |
| 4 | Расчёт по `score.fullTime` (доп. время/пенальти) | INFO, задокументированное ограничение | Правила применяются к сохранённому финальному счёту; для плей-офф он может включать ET/пенальти и расходиться с правилами букмекера. Указано в методологии и model card, follow-up в deferred-items.md. Для лиг top-5 (основной охват) не влияет |
| 5 | 10 интеграционных файлов падают | INFO, окружение | Пять файлов, относящихся к фазе, я прогнал самостоятельно в одноразовых контейнерах — 45/45. Остальные падают из-за отсутствия `DATABASE_URL`/`REDIS_URL`/`OPERATOR_PROXY_SIGNING_SECRET` (проходят под `verify-release-integration.mjs`, по 14-08 SUMMARY) и таймаута 5 с в `calibration-full-loop` (код калибровки фаза не трогала). Эти 10 файлов я не перезапускал |

### Anti-Patterns Found

Блокеров нет. Долговых маркеров (TBD/FIXME/XXX) в изменённых файлах нет. Заглушек и пустых реализаций в проверенных путях нет.

### Human Verification Required

1. **Акцепт формулировки про хвост (UI-SPEC)** — см. frontmatter.
2. **Решение по бюджету scriptTransferBytes** — см. frontmatter.
3. **Живой визуальный просмотр** страницы матча и методологии — см. frontmatter.

### Не проверено в этой верификации

- Playwright E2E (`tests/e2e/extended-markets.spec.ts`, 15 сценариев) не запускался — требует живого стека; опираюсь на отчёт 14-08 и наличие спецификации.
- Полный набор интеграционных тестов (около 17 мин) не запускался; прогнаны только 5 файлов фазы.
- Миграции к dev-БД не применялись (по условию).

### Замечания по бухгалтерии планирования (не влияют на достижение цели)

- `.planning/ROADMAP.md`: у Фазы 14 строка прогресса «1/8 plans executed», планы 14-02..14-08 не отмечены `[x]`, фаза не помечена завершённой.
- `.planning/REQUIREMENTS.md`: MKT-01..MKT-04 всё ещё `[ ]` / Pending (отмечен только MKT-05). Кодом они выполнены; чекбоксы и таблицу трассировки нужно обновить при закрытии фазы.

### Gaps Summary

Недостающей реализации нет: каждый из трёх критериев успеха подтверждён чтением кода, прогоном unit (1533), web (271) и интеграционных (45) тестов, включая TS↔SQL паритет расчёта и fail-closed повторный вывод матрицы. Статус `human_needed` обусловлен только решениями человека (акцепт правки UI-SPEC, бюджет клиентского пакета, визуальный просмотр), а не провалами проверок.

---

_Verified: 2026-11-25_
_Verifier: Claude (gsd-verifier)_
