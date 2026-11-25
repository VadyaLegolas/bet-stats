---
phase: 14-asian-handicap-and-exact-score-markets
verified: 2026-11-25T21:10:00Z
status: passed
score: 3/3 roadmap success criteria verified (5/5 requirements MKT-01..MKT-05 satisfied in code); 0 FAILED truths; 0 human-verification items blocking completion
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
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-09-PLAN.md"
  - ".planning/phases/14-asian-handicap-and-exact-score-markets/14-09-SUMMARY.md"
  - "apps/api/src/modules/forecasts/forecasts.service.ts"
  - "apps/api/src/modules/value/value.service.ts"
  - "apps/web/app/fixtures/[fixtureId]/extended-markets-sections.tsx"
  - "apps/web/app/globals.css"
  - "apps/web/components/design-tokens.test.ts"
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
  - "tests/e2e/extended-markets.spec.ts"
  - "tests/unit/extended-markets-ui.test.tsx"
covered_digest: "v4:sha256:40744347a5905ff8e14a98b75c298ba048af9d844b2b739aa5b9b76d475918a8"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 3/3
  gaps_closed:
    - "UAT тест 7: сетка точного счёта на 320 px (подпись обрезана, «Голы хозяев» по букве, «Голы гостей» обрезан) — закрыто планом 14-09, повторно проверено на живом стеке"
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "Бюджет scriptTransferBytes (Phase 10): 5 960 160 > 5 500 000. Превышение возникло до фазы 14 (5 921 263 на конце фазы 13); фаза 14 добавила +38 897 байт (+0,66 %)"
    category: other
    reason: "Регрессионный гейт бюджета не входит в критерии успеха фазы 14 (ROADMAP). Решение (сократить клиентский пакет @bet-stats/domain в самом большом чанке ~518 KB или поднять бюджет с обоснованием) принадлежит владельцу фазы 10"
    evidence_status: "измерено в 14-08 (node scripts/perf-audit.mjs), зафиксировано в deferred-items.md"
  - finding: "A7: VALUE_POLICY.forecastConfigVersion = forecast-config-v1 даёт POLICY_CONFIG_MISMATCH / INSUFFICIENT_EVIDENCE для снимков forecast-config-v2 (dixon-coles)"
    category: other
    reason: "Pre-existing поведение ядра (decision.ts) до фазы 14; расширенные рынки его наследуют. Вне объёма фазы 14 (INFO)"
    evidence_status: "прочитано в коде в первичной верификации"
---

# Phase 14: Asian Handicap and Exact Score Markets — Verification Report

**Phase Goal:** A user can view, price, and settle Asian handicap and exact-score probabilities derived from the frozen score matrix — zero new data cost — with quarter-line push/half-bet semantics handled correctly end to end.
**Verified:** 2026-11-25
**Status:** passed
**Re-verification:** Да — после закрытия UAT-пробела планом 14-09 (предыдущий отчёт f9e2d45, `human_needed`, устарел)
**Code under verification:** HEAD ветки main `c8fcef2` (включает слияние 14-09, `10cc8ee`)

## Что изменилось с предыдущей верификации

`git diff e540ce9 HEAD -- apps packages scripts tests` затрагивает ровно пять файлов, все из плана 14-09 (`extended-markets-sections.tsx` +1 класс `market-grid-scroll`, `globals.css` +14 строк CSS, `design-tokens.test.ts`, `extended-markets-ui.test.tsx`, `tests/e2e/extended-markets.spec.ts`). Домен, API, БД, миграция и расчётный конвейер после проверенного `e540ce9` не менялись, поэтому выводы по ним (чтение кода + 45/45 интеграционных тестов в одноразовых контейнерах) остаются в силе; здесь выполнена регрессионная проверка (существование, размер, разводка, отсутствие долговых маркеров) и полный повторный прогон unit и web.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Пользователь видит вероятности и справедливые коэффициенты АФ с четвертными линиями (push / половинные ставки) и точные счета по настроенному списку корзин с явным OTHER, всё из замороженной матрицы счёта | VERIFIED | `markets/asian-handicap.ts` (191 стр., `settleAsianHandicap`, `ahBreakdown`, `ahFairOdds` с типизированным UNAVAILABLE, `buildAhView` по 21 линии), `exact-score.ts` (16 счетов + `OTHER = max(0, 1 − Σ16)`), `extended-view.ts` (строгий парсер). Цепочка API → `extended-markets-loader.ts` → `page.tsx` → `forecast-workbench.tsx` → `extended-markets-sections.tsx`. UAT 2 (раздел АФ: окно из 5 линий, переключатель стороны, «развернуть» до 21; сетка 4×4 и «Любой другой счёт») — pass пользователем на живом стеке. UAT 7: после 14-09 подпись/оси сетки читаемы на 320 px, страница не ползёт по горизонтали (повторный тест на живом стеке, зафиксирован в 14-UAT.md) |
| 2 | Оператор вводит полные книги коэффициентов для новых рынков с существующей валидацией и no-vig нормализацией и получает value-квитанции с push-aware EV | VERIFIED | Единый реестр `registry.ts` (25 id, `selectionsFor`) подключён во всех слоях (odds contract/draft/normalize, value contract, closing-odds, no-vig-clv). `value/extended-decision.ts` (`decideExtendedValue`, 254 стр.): EV = ΣP(исход)·доход(исход) по пяти исходам, те же гейты и пороги `VALUE_POLICY`. `value.service.ts` сначала доказывает подлинность матрицы (`loadVerifiedMatrix`, 409 `SCORE_MATRIX_UNAVAILABLE`). SQL `guard_value_pair()` пересчитывает вероятности из матрицы по `cellsHash`. UAT 3 (форма АГ: линия не выбрана по умолчанию, 17 полей точного счёта, счётчик пустых полей, фокус) и UAT 4 (итог value с таблицей по пяти исходам, `push-aware-ev-v1`, пояснение про возврат) — pass пользователем |
| 3 | Расчёт определяет push / half-win / half-loss АФ и исходы точного счёта по явным версионным правилам внутри конвейера оценки; матрица счёта сохранена при выпуске либо детерминированно перевыводится fail-closed для старых снимков | VERIFIED | Подтверждено повторно: `settlement-pipeline.ts` содержит ветвление `case "ASIAN_HANDICAP": case "EXACT_SCORE":` → `persist_value_settlement_v2` (стр. 308–317), TS-производитель результата и независимый SQL-пересчёт (`guard_value_settlement`, миграция 417 стр.). `SETTLEMENT_RULES` исчерпывающий по `MarketFamily`. Матрица: `score-matrix.ts` (241 стр.) `buildScoreMatrix`/`resolveScoreMatrix`/`splitStoredForecast`; ключ в `receipt` Json без DDL; невалидный ключ → UNAVAILABLE, отсутствующий → re-derive с проверкой воспроизведения семи вероятностей в 1e-9. UAT 5 (реестр кандидатов: колонка «Рынок», политика под исходом, итоги v1/v2 раздельно) — pass |

**Score:** 3/3 критерия VERIFIED; `behavior_unverified: 0` — поведенческие инварианты (расчёт, fail-closed, SQL-guards, TS↔SQL паритет 21 линия × 2 стороны × 0..10 × 0..10) подтверждены исполнявшимися тестами при первичной верификации, а не наличием символов.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/domain/src/markets/{registry,asian-handicap,ah-lines,exact-score,score-matrix,extended-view,settlement}.ts` | VERIFIED | существуют, содержательны (40–241 стр.), нет TBD/FIXME/XXX |
| `packages/domain/src/value/extended-decision.ts` | VERIFIED | push-aware решение |
| `packages/database/prisma/migrations/20261126_phase14_extended_markets/migration.sql` | VERIFIED | одна forward-миграция, 417 стр.; применена пользователем к dev-БД и проверена (UAT 1: pass); мной миграции не применялись |
| `packages/database/src/evaluation/settlement-pipeline.ts` | VERIFIED | ветвление по семье рынка, `persist_value_settlement_v2` |
| `apps/api/.../forecasts.service.ts`, `value.service.ts` | VERIFIED | маршрут extended-markets и сравнение для новых рынков |
| `apps/web/app/fixtures/[fixtureId]/extended-markets-sections.tsx` + `globals.css` (.market-grid*) | VERIFIED | включая правки 14-09: `market-grid-scroll` (container-type: inline-size), `.market-grid caption {width: 100cqw}`, сброс `overflow-wrap` на `th`, sticky/z-index закреплённых подписей; общее правило `.evidence-table-scroll` не тронуто (охраняется тестом) |
| `packages/domain/src/methodology/model-card.ts` | VERIFIED | `model-card-v1.4.0` с блоком `extendedMarkets` |

### Key Link Verification

Все ссылки WIRED (см. предыдущий отчёт; код не менялся): orchestrator → `receipt.scoreMatrix`; `splitStoredForecast` на всех читателях `receipt`; route → `resolveScoreMatrix` → `buildExtendedMarketsView`; `compareValue` → `decideExtendedValue`; value receipt → SQL guard; pipeline → `persist_value_settlement_v2` → `guard_value_settlement`; страница матча → API через `loadExtendedMarkets`. Для 14-09: класс `market-grid-scroll` в TSX ↔ правило `.market-grid-scroll` в CSS, оба закреплены тестами (`extended-markets-ui.test.tsx`, `design-tokens.test.ts`).

### Behavioral Spot-Checks (выполнено в этой верификации)

| Проверка | Команда | Результат | Status |
|----------|---------|-----------|--------|
| Весь unit-проект | `pnpm exec vitest run --project unit` | 89 файлов passed, 1 skipped; 1532 passed, 2 skipped (1534). Пропущены 2 теста `worker-entry-guard.test.ts` (требуют собранный `dist/main.js`, не относятся к фазе) | PASS |
| Web-тесты | `pnpm --filter @bet-stats/web test` | 14 файлов, 276/276 (было 271; +5 охранных тестов раскладки 14-09) | PASS |
| Установка | `pnpm install --frozen-lockfile` | успешно | PASS |
| Долговые маркеры TBD/FIXME/XXX | grep по markets/, extended-decision.ts, sections.tsx, settlement-pipeline.ts | не найдены | PASS |

Интеграционные (45/45 по 5 файлам фазы в одноразовых контейнерах) и Playwright E2E в этом прогоне не запускались: код, который они покрывают, не менялся после `e540ce9`, кроме CSS/класса 14-09, для которого E2E-сценарий (измерение боксов подписи, осей и hit-test закреплённых ячеек, 3 ширины × 3 режима) прогонялся в 14-09, а результат подтверждён живой проверкой пользователя/оркестратора на 320 px. Dev-БД и порты 3000/3001 не затрагивались.

### Probe Execution

SKIPPED — фаза не объявляет probe-скриптов.

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| MKT-01 | SATISFIED | Критерий 1; UAT 2 |
| MKT-02 | SATISFIED | Критерий 1; UAT 2, UAT 7 (после 14-09) |
| MKT-03 | SATISFIED | Критерий 2; UAT 3, 4 |
| MKT-04 | SATISFIED | Критерий 3; UAT 5; parity и pipeline-интеграция |
| MKT-05 | SATISFIED | Критерий 3; `score-matrix-persistence` |

Orphaned requirements: нет.

### Классификация известных пунктов

| # | Пункт | Классификация | Обоснование |
|---|-------|---------------|-------------|
| 1 | Бюджет `scriptTransferBytes` 5 960 160 > 5 500 000 | ADVISORY, решение владельца фазы 10 | Превышение до фазы 14; вклад фазы 14 +38 897 байт (+0,66 %). Гейт бюджета не входит в критерии успеха фазы 14, LCP/TBT/CLS в бюджете. Не считается невыполненным критерием фазы 14 и не блокирует её |
| 2 | Правка формулировки хвоста в UI-SPEC | CONFIRMED пользователем | UAT 6 pass (2026-11-25): «уже учтён нормировкой на сохранённую массу и распределён по всем счетам». Формулировка присутствует в `extended-markets-model.ts` и `model-card.ts` и закреплена тестом `extended-markets-ui.test.tsx` |
| 3 | A7: `POLICY_CONFIG_MISMATCH` для `forecast-config-v2` | INFO, pre-existing, вне объёма | см. advisory |
| 4 | Расчёт по `score.fullTime` (ET/пенальти) | INFO, задокументированное ограничение | Указано в методологии и model card; follow-up в deferred-items.md |
| 5 | Миграция `20261126_phase14_extended_markets` на dev-БД | Применена пользователем и проверена (UAT 1) | — |
| 6 | Живой визуальный просмотр | Выполнен пользователем (UAT 1–7) | Тест 7 нашёл дефект, закрыт 14-09 и перепроверен на 320 px |

### Anti-Patterns Found

Блокеров нет. Долговых маркеров нет. Заглушек в проверенных путях нет.

### Human Verification Required

Нет пунктов, блокирующих завершение фазы. Все ранее запрошенные проверки (формулировка хвоста, визуальный просмотр) выполнены пользователем в UAT; бюджет и A7 — решения по другим фазам/политикам (advisory).

### Замечания по бухгалтерии планирования (не влияют на достижение цели, действия для оркестратора при закрытии фазы)

- `.planning/ROADMAP.md`: Фаза 14 всё ещё `[ ]`, «Plans: 1/8 plans executed», планы 14-02..14-09 не отмечены; 14-09 в списке отсутствует.
- `.planning/REQUIREMENTS.md`: MKT-01..MKT-04 `[ ]` / Pending (отмечен только MKT-05).

### Gaps Summary

Недостающей реализации нет. Три критерия успеха подтверждены кодом, тестами (unit 1532, web 276, ранее интеграция 45/45) и живой проверкой пользователя (UAT: 6 pass + тест 7 закрыт 14-09 с повторной проверкой на 320 px). Пункты бюджета и A7 вынесены как advisory для владельцев других фаз/политик.

---

_Verified: 2026-11-25_
_Verifier: Claude (gsd-verifier)_
