---
phase: 10-performance-audit-and-budgets
plan: 02
subsystem: forecast-workbench-perf
tags: [perf, next-dynamic, code-split, budgets, receipts, honest-measurement]
requires:
  - "10-01 (scripts/perf-audit.mjs harness, perf-baseline-before.json, pinned perf-budget.json)"
  - "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx (the split source)"
  - "Next 16 lazy-loading guide (apps/web/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md)"
provides:
  - "apps/web/app/fixtures/[fixtureId]/forecast-comparison-panel.tsx (lazy module: ForecastComparisonPanel + SourceRefItem + sourceRefList + revisionColumns + exported formatUtc/shortFingerprint/shortFixtureId)"
  - "apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx (lazy module: ValueOutcomeSection + OUTCOME_COPY)"
  - "apps/web/app/fixtures/[fixtureId]/workbench-format.ts (shared pure helpers percent/labelReason/signedPercent/directionText + ValueResult type — keeps the chunk graph acyclic, T-10-06)"
  - "scripts/perf/perf-receipts/perf-baseline-after.json (committed «after» median-of-3 receipt)"
affects:
  - "10-03 (CI performance-budget job runs the harness against the tightened budgets)"
  - "future UI phases (scanner, journal, new markets) inherit the tightened gate"
tech-stack:
  added: []
  patterns: ["next/dynamic named-export lazy loading at module top level (D-09)", "shared pure-helper module to keep lazy chunks acyclic", "deterministic-metric-only budget tightening (bytes/CLS) with noise-metric headroom preserved (Pitfall 2)"]
key-files:
  created:
    - apps/web/app/fixtures/[fixtureId]/forecast-comparison-panel.tsx
    - apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx
    - apps/web/app/fixtures/[fixtureId]/workbench-format.ts
    - scripts/perf/perf-receipts/perf-baseline-after.json
  modified:
    - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
    - tests/unit/forecast-comparison-ui.test.tsx
    - tests/unit/responsible-copy.test.ts
    - scripts/perf/perf-budget.json
decisions:
  - "D-09 split covers BOTH post-interaction panels; dynamic() bindings live at forecast-workbench.tsx module top level (client component) — the Server Component's static import in page.tsx is untouched (a Server Component dynamic import would not code-split, Next 16 verified constraint)"
  - "No second «use client» in the new modules: the guide's 'use client' examples are for modules reachable from Server Components; ours are only imported through the client-component graph (workbench + tests), so the directive would be redundant"
  - "ValueResult type moved to workbench-format.ts and re-exported from forecast-workbench.tsx — keeps the lazy module free of back-imports (T-10-06) while test imports stay unchanged"
  - "Budgets tightened ONLY on deterministic metrics: scriptTransferBytes 6 300 000→5 500 000 (+5.7% over the 5 200 986 median, identical ×3 in both receipts), CLS 0.11→0.09 (+0.0029 over the median, identical across all 6 runs); LCP 26 500 and TBT 950 kept — run-to-run spreads (14.4–24.2 s; 626–905 ms) would make medians-plus-modest-headroom flaky (Pitfall 2)"
metrics:
  duration: 10min
  tasks: 3
  files: 8
  completed: 2026-11-17
status: complete
actuals:
  tokens: 8595
  tasks: 3
  commits: 3
  plan_head_before: da614721e508c7bae13bdf2305024acab6e98d66
  plan_head_after: 48f531f237ad2de1c35399666eb04cc629533d08
commits: 3
estimate:
  tokens: 42000
  tasks: 3
---

# Phase 10 Plan 02: D-09 Workbench Split + After-Receipt Summary

**One-liner:** Обе пост-интерактивные панели прогнозного верстака вынесены в ленивые модули через `next/dynamic` (жадное ядро ввода коэффициентов не тронуто), после-квитанция честно фиксирует scriptTransferBytes 5 203 434 → 5 200 986 B (−2 448 B, ×3 идентично, чанки панелей подтверждены в сборке), детерминированные бюджеты ужесточены до байтов 5 500 000 / CLS 0.09.

## What Was Built

### Task 1 — Split за next/dynamic (commit 949dd4b)

- **`workbench-format.ts` (новый):** чистые helpers `percent`, `labelReason`, `signedPercent`, `directionText` + тип `ValueResult` — перенесены дословно; без React, без «use client». Модуль импортируют и жадное ядро, и оба ленивых модуля — back-import ленивых модулей из `forecast-workbench.tsx` структурно исключён (T-10-06), чанк-граф ациклический.
- **`forecast-comparison-panel.tsx` (новый):** `ForecastComparisonPanel` + `SourceRefItem` + `sourceRefList` + `revisionColumns` + `ComparisonSourceRef` + экспортируемые `formatUtc`/`shortFingerprint`/`shortFixtureId` (grep подтвердил: используются только панелью и её тестами). Русская копия, дисклеймер и a11y-атрибуты перенесены дословно.
- **`value-outcome-section.tsx` (новый):** `ValueOutcomeSection` + `OUTCOME_COPY` дословно (закрытый рендер полей квитанции не изменился — T-10-05).
- **`forecast-workbench.tsx`:** переехавший код удалён; добавлены две привязки `dynamic(() => import("./…").then((module) => module.X), { loading: () => <p role="status">Загружаем результат …</p> })` на верхнем уровне модуля — именованный экспорт по гайду Next 16. Жадное ядро сохранено целиком: `availabilityReasonCopy`, `validateOddsFields`, `buildOddsSubmission`, `canonicalizeClientOdds`, `selectStableSnapshot`, `forecastOptionLabel`, `initializeComparisonPair`, `swapComparisonPair`, сам компонент и все mount-fetch'ы (Pitfall 10 не потрогнут). Статический импорт в `page.tsx` не изменён (D-09/Next 16).
- **Фиксация по гайду Next 16** (read_first выполнен): `dynamic()` только на верхнем уровне модуля; `ssr:false` не используется (не нужен — панели рендерятся и в SSR при готовых данных); note гайда «Server Component dynamic import does not code-split» соблюдена — сплит живёт внутри клиентского компонента. Вторая директива «use client» в новые модули НЕ добавлена: примеры гайда с `'use client'` показывают модули, достижимые из Server Components; наши модули импортируются только через граф клиентского компонента (и тесты), директива была бы избыточной.

### Task 2 — Тесты переведены на модули-владельцы (commit 3b83b3a)

- `tests/unit/forecast-comparison-ui.test.tsx`: `ForecastComparisonPanel` теперь из `forecast-comparison-panel.js`, `ValueOutcomeSection` — из `value-outcome-section.js`; `availabilityReasonCopy`, `ForecastWorkbench`, `initializeComparisonPair`, `swapComparisonPair`, `type ValueResult` остались в `forecast-workbench.js` (через type-re-export). Ни одно утверждение не ослаблено — проверки переехали вместе с кодом.
- `tests/unit/responsible-copy.test.ts`: строки квитанции разъехались по двум владельцам — жадное ядро держит `JSON.stringify(result, null, 2)` и `navigator.clipboard.writeText(canonicalReceipt)`, ленивая секция — `?download=true`, «ID и версии квитанции», «Результаты проверок и пороги»; тест сканирует оба исходника.
- `tests/unit/odds-draft-ui.test.tsx`: импортирует только символы жадного ядра — без изменений, подтверждено прогоном.
- Итог: 32/32 в трёх файлах зелёные.

### Task 3 — После-квитанция и ужесточение бюджетов (commit 48f531f)

Два полных прогонa харнеса (собственный контейнер Postgres, порты 3230/3231, `NEXT_DIST_DIR=.next-e2e`, сервер разработчика не тронут):

| Метрика | Before (median 3) | After (median 3) | Бюджет было | Бюджет стало |
|---|---|---|---|---|
| LCP | 22 051.3 мс | 23 346.2 мс (прогоны 14 395–24 249) | 26 500 | 26 500 (без изменений) |
| TBT | 755.5 мс | 641 мс (прогоны 626.5–753) | 950 | 950 (без изменений) |
| CLS | 0.08711 | 0.08711 (×3 идентично) | 0.11 | **0.09** |
| scriptTransferBytes | 5 203 434 B | **5 200 986 B** (×3 идентично, −2 448 B) | 6 300 000 | **5 500 000** |

- **Доказательство сплита артефактами сборки:** клиентские чанки `2w1x93zur0o_0.js` (4 184 B raw — панель сравнения) и `2v-_1h9l5na1a.js` (4 375 B raw — value-секция) существуют отдельно; чанк workbench `2ovpzl79pghze.js` больше не содержит кода панелей; в HTML/манифестах сборки нет ссылок на ленивые чанки — они не передаются при начальной загрузке. Отсюда честная дельта −2 448 B ≈ сжатая масса вынесенного кода: собственный код верстака мал (~38 KB raw), доминирующую часть 5.2 MB передаваемых скриптов составляют фреймворковые/общие чанки, на которые D-09-сплит повлиять не может.
- **Ужесточение — только детерминированные метрики:** байты идентичны ×3 в обеих квитанциях и в контрольном прогоне → запас +5.7% (5 500 000) покрывает платформенный дрейф local/CI (Pitfall 2), но реальный регресс (например, чарт-библиотека) сразу проколет гейт. CLS идентичен во всех 6 мобильных прогонах → 0.09 (+0.0029). LCP сохранён: после-медиана 23 346 не материально ниже бюджета 26 500, а размах прогонов 14.4–24.2 с сделал бы перекалибровку по медиане нестабильным гейтом. TBT сохранён: медиана улучшилась (755.5→641), но межсессионный размах 626–905 мс (наблюдённые максимумы 904.5/861) не позволяет опуститься ниже 900 без флаков (Pitfall 2).
- Профиль `profile` и recorded-only `desktopProfile` не изменены (D-06, D-04).
- Контрольный прогон в default-режиме с квитанцией во временном пути: exit 0, BUDGETS_OK (медианы LCP 24 073.4 / TBT 658 / CLS 0.08711 / байты 5 200 986), временная квитанция удалена — в отслеживаемом каталоге только коммитнутые baseline-квитанции.

## Deviations from Plan

**1. [Rule 3 - Blocking] Тип `ValueResult` переехал в `workbench-format.ts` (план перечислял его среди артефактов только неявно)**
- **Found during:** Task 1
- **Issue:** тип нужен и жадному ядру (состояние `result`), и ленивой value-секции (пропс), и тестам (импорт из `forecast-workbench.js`). Оставить его в `forecast-workbench.tsx` — значит заставить ленивый модуль делать back-import, прямо запрещённый T-10-06; перевести тест — значит менять импорт типа без нужды.
- **Fix:** тип перенесён в общий чистый модуль и ре-экспортирован из `forecast-workbench.tsx` (`export type { ValueResult }`) — type-only ребро стирается компилятором, рантайм-цикл невозможен, тестовый импорт не изменился.
- **Files modified:** apps/web/app/fixtures/[fixtureId]/workbench-format.ts, forecast-workbench.tsx
- **Commit:** 949dd4b

**2. [Operating rule] `gsd_run`/`gsd-tools` недоступны** — STATE.md/ROADMAP.md обновляются ручными правками + обычными git-коммитами (прецедент 07-01..10-01).

**Первый вызов verify Task 3 с `--assert-only` на несуществующем файле завершился ENOENT (exit 1) — ошибка исполнителя, не кода: план предписывает default-режим; перезапущен корректно.**

## Known Stubs

None — все значения после-квитанции и бюджетного файла — реальные измерения реальных прогонов.

## Deferred Issues

- 7 предсуществующих отказов `tests/unit/fixtures-sync.test.ts` (PrismaClientKnownRequestError, домен provider-sync) — вне скоупа, перенесены из 10-01 (`.planning/phases/10-performance-audit-and-budgets/deferred-items.md`), этот план их не импортирует и не трогает.
- Абсолютный выигрыш по байтам от D-09 мал (−2 448 B из 5.2 MB): доминируют фреймворковые/общие чанки. Дальнейшее снижение потребует мер уровня фреймворка (вне скоупа фазы; гейт на 5 500 000 B всё равно кусается при реальных регрессиях).

## Threat Flags

None — новой доверенной поверхности нет: русская копия и a11y перенесены дословно (T-10-05 — responsible-copy сканирует владельцев), сплит доказан измерением (T-10-04), back-import исключены общей pure-модулем (T-10-06).

## Self-Check: PASSED

- Все 8 файлов существуют на диске (3 новых модуля + после-квитанция; изменённые workbench, 2 теста, бюджет).
- Коммиты 949dd4b, 3b83b3a, 48f531f — предки HEAD (48f531f = план_head_after).
- tsc --noEmit чист; 32/32 целевых теста; полный unit 530/537 (7 известных предсуществующих отказов fixtures-sync, см. Deferred Issues).
- Харнес: два default-прогона exit 0; scriptTransferBytes after-медиана 5 200 986 строго ниже before 5 203 434; временные артефакты удалены.
