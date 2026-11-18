---
phase: 10-performance-audit-and-budgets
verified: 2026-11-18T06:55:00Z
status: gaps_found
score: 5/6 must-haves verified
covered_files:
  - scripts/perf-audit.mjs
  - scripts/perf/perf-budget.json
  - scripts/perf/perf-receipts/perf-baseline-before.json
  - scripts/perf/perf-receipts/perf-baseline-after.json
  - tests/unit/perf-audit.test.ts
  - tests/unit/ci-workflow-contract.test.ts
  - tests/unit/forecast-comparison-ui.test.tsx
  - tests/unit/responsible-copy.test.ts
  - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
  - apps/web/app/fixtures/[fixtureId]/forecast-comparison-panel.tsx
  - apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx
  - apps/web/app/fixtures/[fixtureId]/workbench-format.ts
  - apps/web/app/fixtures/[fixtureId]/page.tsx
  - .github/workflows/ci.yml
  - package.json
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "performance-budget CI job runs the pinned audit script and fails the build on budget regression (PERF-02)"
    status: failed
    reason: "ci.yml invokes bare `node scripts/perf-audit.mjs` (line 104), but parseFlags in scripts/perf-audit.mjs requires --receipt in EVERY mode (`if (!flags.receipt) throw new Error(\"RECEIPT_PATH_REQUIRED\")`). Verified empirically: `node scripts/perf-audit.mjs` exits 1 with RECEIPT_PATH_REQUIRED without touching Docker (parseFlags throws before any stack boot). The job is therefore permanently red on every commit and cannot distinguish a budget regression from a compliant run — the discriminating gate PERF-02 requires is not achieved as wired. The contract test asserts only the substring `node scripts/perf-audit.mjs` and cannot catch the missing flag. The 10-03 SUMMARY claim 'Receipt goes to its default path' is false: the script has no default receipt path in any mode."
    artifacts:
      - path: ".github/workflows/ci.yml"
        issue: "Line 104: `- run: node scripts/perf-audit.mjs` — no --receipt argument; script throws RECEIPT_PATH_REQUIRED and exits 1 unconditionally"
      - path: "scripts/perf-audit.mjs"
        issue: "parseFlags (lines 561-575) requires --receipt in all modes, contradicting the CI step and the 10-03 SUMMARY's 'default path' claim"
      - path: "tests/unit/ci-workflow-contract.test.ts"
        issue: "Job-body test (lines 217-234) asserts substring `node scripts/perf-audit.mjs` presence only — does not pin the full working invocation"
    missing:
      - "Either give default mode a writable receipt output path (plan 03 text assumed one exists), or pass an explicit `--receipt` (e.g. to the workspace temp / default receipt path) in the CI step"
      - "Extend tests/unit/ci-workflow-contract.test.ts to pin the exact working invocation (e.g. assert the receipt flag/output contract) so a bare-broken invocation fails the contract test in the same commit"
      - "After the fix, complete the recorded manual check: first green performance-budget job run on GitHub Actions (10-VALIDATION Manual-Only item, currently impossible to satisfy)"
---

# Phase 10: Performance Audit and Budgets — Verification Report

**Phase Goal:** Пользователь получает страницу матча, отвечающую заявленным Lighthouse-бюджетам производительности — измеренным честно как медиана-из-3 до/после — и бюджетные регрессии валят CI, а не уезжают в прод.
**Verified:** 2026-11-18T06:55:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Консолидированные must-haves: roadmap success criteria + frontmatter must_haves планов 01/02/03 (дедуплицированы).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Честное измерение: медиана-из-3 LCP/TBT/CLS/байтов по продакшн-сборке, закрытые поля, без секретов, desktop recorded-only (PERF-01, D-02/D-03/D-04/D-07) | ✓ VERIFIED | Обе квитанции проверены построчно: медианы = средний из трёх прогонов (before LCP 22051.317 — средний из [14420.09, 22051.32, 24138.08]; after TBT 641 — средний из [626.5, 641, 753.05]); набор полей точно `schemaVersion/date/gitSha/lighthouseVersion/profile/pages/desktop`; `validateReceipt` отвергает неизвестные ключи и secret-shaped значения; `desktop.recordedOnly: true`, desktop-метрики вне `GATED_METRICS` и никогда не читаются `assertMetricsWithinBudgets`; performanceScore записан (0.35/0.37), не ассертится. Поведенческое доказательство слоя утверждений — мой прогон `--assert-only` по after-квитанции: `BUDGETS_OK`, exit 0 |
| 2 | Бюджеты трассируются к committed before-квитанции с умеренным запасом; desktopProfile без бюджетов (D-03/D-04) | ✓ VERIFIED | perf-budget.json: lcp 26500 > 22051.3 (×1.20), tbt 950 > 755.5 (×1.26), cls 0.09 > 0.08711 (+0.0029 после ужесточения), bytes 5500000 > 5200986 (+5.7%); блок `profile` дословно совпадает с `lhr.configSettings` обеих квитанций (D-06); `desktopProfile` присутствует, бюджетов для desktop в файле нет |
| 3 | D-09 сплит: панели ленивые через next/dynamic на верхнем уровне клиентского компонента, жадное ядро нетронуто, статический импорт в page.tsx сохранён, обратных импортов нет | ✓ VERIFIED | forecast-workbench.tsx:19-26 — две привязки `dynamic(() => import('./…').then(m => m.X), { loading: () => <p role="status">…</p> })` на верхнем уровне модуля; жадное ядро (validateOddsFields, buildOddsSubmission, canonicalizeClientOdds, selectStableSnapshot, initializeComparisonPair, swapComparisonPair, mount-fetch'ы) на месте; page.tsx:7 — статический импорт `ForecastWorkbench` не изменён; ленивые модули импортируют только `@bet-stats/domain`, `components/*` и `./workbench-format` — ни одной ссылки на forecast-workbench (проверено grep по каталогу) |
| 4 | After-квитанция: scriptTransferBytes медиана строго ниже before — сплит доказан измерением (T-10-04) | ✓ VERIFIED | before 5 203 434 B → after 5 200 986 B (−2 448 B, ×3 идентично в обеих квитанциях); after-медианы проходят бюджеты (моя проверка exit 0) |
| 5 | performance-budget джоба в CI запускает тот же скрипт+конфиг и валит сборку на регрессе; контрактный тест охраняет; нет skip-конструкций (PERF-02, D-06/D-08) | ✗ FAILED | Джоба существует (ci.yml:78-104: checkout@v6, pnpm/action-setup@v6, setup-node@v7/node 24, `--frozen-lockfile`, corepack enable, playwright chromium, `node scripts/perf-audit.mjs`), контрактный тест охраняет все четыре джобы (16 тестов зелёные), skip-конструкций нет. НО: запуск без `--receipt` детерминированно падает с `RECEIPT_PATH_REQUIRED` (подтверждено прямым прогоном: EXIT=1) — джоба вечно красная, гейт не различает регресс и комплаенс. См. Gaps Summary |
| 6 | Unit-тесты фазы и web-тесты зелёные | ✓ VERIFIED | Мой прогон: 61/61 в четырёх файлах (perf-audit 19 + ci-workflow-contract 16 + forecast-comparison-ui + responsible-copy); web: 121/121 в 10 файлах. fixtures-sync починен отдельным коммитом 5875985 (deferred-items.md: RESOLVED) |

**Score:** 5/6 must-haves verified (0 present, behavior-unverified)

### Behavioral Spot-Checks (выполнены верификатором)

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Слой утверждений пропускает валидную after-квитанцию | `node scripts/perf-audit.mjs --assert-only --receipt scripts/perf/perf-receipts/perf-baseline-after.json` | `BUDGETS_OK: all gated medians within budget`, exit 0 | ✓ PASS |
| Индуцированный регресс валит гейт (мой независимый dry-run, doctored-копия в TEMP) | `--assert-only --receipt …after.json --budget $tmp` (cls → 0.000001) | `cls: 0.08710918036748198 > budget 0.000001`, exit 1 | ✓ PASS |
| Bare-запуск как в CI | `node scripts/perf-audit.mjs` (без флагов) | `RECEIPT_PATH_REQUIRED`, exit 1 | ✗ FAIL — это и есть найденный гэп |
| Unit-тесты фазы | `pnpm vitest run --project unit tests/unit/perf-audit.test.ts tests/unit/ci-workflow-contract.test.ts tests/unit/forecast-comparison-ui.test.tsx tests/unit/responsible-copy.test.ts` | 4 files, 61/61 passed | ✓ PASS |
| Web-тесты | `pnpm --filter @bet-stats/web test` | 10 files, 121/121 passed | ✓ PASS |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `scripts/perf-audit.mjs` | Харнес: owned-стек, 3+3 прогона, медиана-из-3, fail-closed, main-entry guard | ✓ VERIFIED | 593 строки; все чистые хелперы экспортированы, браузерный стек — lazy import, guard на строках 584-593 |
| `scripts/perf/perf-budget.json` | perf-budget-v1: профиль, страницы, бюджеты, desktopProfile | ✓ VERIFIED | См. truth 2 |
| `scripts/perf/perf-receipts/perf-baseline-before.json` | Committed before-квитанция | ✓ VERIFIED | gitSha 2f4102b, Lighthouse 13.6.0, честные прогоны |
| `scripts/perf/perf-receipts/perf-baseline-after.json` | Committed after-квитанция | ✓ VERIFIED | gitSha 3b83b3a, bytes строго ниже before |
| `tests/unit/perf-audit.test.ts` | Wave-0: медиана, ассерты, схема квитанции, desktop-recorded-only | ✓ VERIFIED | 19 тестов зелёные; тест «ignores the desktop block entirely» с Number.MAX_VALUE на строке 202 |
| `package.json` devDeps | lighthouse@13.6.0 + chrome-launcher@1.2.3 точно | ✓ VERIFIED | Строки 28, 32 — точные пины |
| `apps/web/.../forecast-comparison-panel.tsx` | Ленивый модуль панели | ✓ VERIFIED | Существует, импортирует workbench-format, без back-import |
| `apps/web/.../value-outcome-section.tsx` | Ленивый модуль value-секции | ✓ VERIFIED | Существует, импортирует workbench-format |
| `apps/web/.../workbench-format.ts` | Общие чистые хелперы | ✓ VERIFIED | percent/labelReason/signedPercent/directionText + ValueResult, без React |
| `.github/workflows/ci.yml` performance-budget | Джоба после e2e-portable | ⚠️ WIRED-BROKEN | Джоба объявлена корректно, но вызов скрипта не работает (гэп 1) |
| `tests/unit/ci-workflow-contract.test.ts` | Политика на четыре джобы | ✓ VERIFIED | 16/16; jobBlock ограничен PERF_JOB; тест «gates performance through the pinned audit script» — но не ловит сломанный вызов |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| perf-audit.mjs | perf-budget.json | `--budget` (default `scripts/perf/perf-budget.json`), profile-match check | ✓ WIRED | `assertProfileMatch` валит `PROFILE_DRIFT` при расхождении |
| perf-budget.json | before/after receipts | Значения бюджетов трассируются к медианам | ✓ WIRED | См. truth 2 |
| forecast-workbench.tsx | ленивые модули | `next/dynamic` named-export на верхнем уровне | ✓ WIRED | Next 16 гайд соблюдён (клиентский компонент, без ssr:false) |
| ленивые модули | forecast-workbench.tsx | — (запрещённые back-import) | ✓ WIRED (отсутствуют) | Grep: ни одной ссылки |
| page.tsx | forecast-workbench.tsx | Статический импорт | ✓ WIRED | Строка 7 не изменена |
| ci.yml performance-budget | scripts/perf-audit.mjs | `node scripts/perf-audit.mjs` | ✗ NOT WIRED (сломано) | Вызов без обязательного `--receipt` → RECEIPT_PATH_REQUIRED, exit 1 всегда |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| PERF-01 | 10-01, 10-02 | Страница матча отвечает Lighthouse-бюджетам, измерение медианой-из-3 по прод-сборке, до/после записаны | ✓ SATISFIED | Truths 1-4: обе квитанции, бюджеты с запасом, сплит доказан байтами |
| PERF-02 | 10-03 | Lighthouse-ассерты в CI на ключевых страницах валят сборку на регрессе | ✗ BLOCKED | Джоба и контрактный тест существуют, failure path доказан локально (мой dry-run exit 1) — но вызов в CI сломан (RECEIPT_PATH_REQUIRED), вечная красная джоба |

Orphaned requirements: нет — оба ID фазы 10 покрыты планами (10-01/02 → PERF-01, 10-03 → PERF-02).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER в файлах фазы | — | Не обнаружены (grep чист) |
| — | — | Recharts/чарт-библиотеки | — | Отсутствуют (запрет D-09 соблюдён) |
| scripts/perf/perf-receipts/ | — | Лишние артефакты в tracked-каталоге | — | Только две коммитнутые baseline-квитанции; `git status` чист |

### Human Verification Required

### 1. Первый зелёный прогон performance-budget на GitHub Actions

**Test:** После исправления гэпа (см. Gaps Summary) запушить в main и наблюдать джобу performance-budget в Actions.
**Expected:** Джоба зелёная: харнес сам собирает дисты и прод-сборку (`NEXT_DIST_DIR=.next-e2e`), поднимает owned-стек, делает 3+3 аудита и проходит бюджеты; таймаут 25 мин соблюдён (проверить Assumption A5 по фактическому времени).
**Why human:** Реальный раннер GitHub Actions недоступен верификатору; записанный manual-check из 10-VALIDATION.md сейчас невыполним из-за гэпа.

### 2. Свежий полный прогон харнеса локально (после фикса)

**Test:** `node scripts/perf-audit.mjs --receipt <tmp>` на машине с Docker; убедиться, что dev-стек на 3000 не тронут.
**Expected:** exit 0, `BUDGETS_OK`, свежие медианы в пределах 26500/950/0.09/5500000; временная квитанция удалена.
**Why human:** Полный прогон требует Docker и ~10 минут; верификатор проверил слой утверждений против коммитнутых квитанций и оба сухих направления, но не пере-измерял живую страницу.

### Gaps Summary

Фаза 10 построила добротный и честный измерительный инструмент: харнес `scripts/perf-audit.mjs` — полный, fail-closed, с закрытыми secret-free квитанциями и корректной медианой-из-3; обе коммитнутые квитанции содержат реальные измерения с правдоподобным разбросом прогонов; бюджеты трассируются к before-медианам с умеренным запасом; D-09-сплит реально код-сплитит (−2 448 B, ленивые чанки, ацикличный граф); тесты зелёные (61/61 + 121/121); failure path гейта доказан моим независимым dry-run.

**Один блокирующий гэп** — проводка PERF-02 в CI: шаг `node scripts/perf-audit.mjs` (ci.yml:104) запускает скрипт без обязательного флага `--receipt`, который `parseFlags` требует во всех режимах (комментарий «no silent default receipt path, in any mode» противоречит и тексту плана 03, и SUMMARY-утверждению «Receipt goes to its default path»). Прямой прогон подтверждает: exit 1, `RECEIPT_PATH_REQUIRED`. Джоба вечно красная — она не может служить различающим гейтом («зелёный = бюджеты соблюдены, красный = регресс»), а записанный manual-check «первый зелёный CI-прогон» принципиально недостижим. Контрактный тест этого не ловит, поскольку ассертит только наличие подстроки.

Это одноцентровой гэп (одна причина — расхождение контракта CLI скрипта и CI-вызова): исправление — либо default-путь квитанции в default-режиме скрипта, либо явный `--receipt` в шаге CI, плюс ужесточение контрактного теста до полного рабочего вызова. После фикса остаются два human-пункта (первый зелёный CI-прогон и свежий полный прогон).

---

_Verified: 2026-11-18T06:55:00Z_
_Verifier: the agent (gsd-verifier)_
