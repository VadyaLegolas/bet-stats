---
phase: 10-performance-audit-and-budgets
verified: 2026-11-19T07:30:00Z
status: passed
score: 8/8 must-haves verified
covered_files:
  - .github/workflows/ci.yml
  - .planning/phases/10-performance-audit-and-budgets/10-01-PLAN.md
  - .planning/phases/10-performance-audit-and-budgets/10-01-SUMMARY.md
  - .planning/phases/10-performance-audit-and-budgets/10-02-PLAN.md
  - .planning/phases/10-performance-audit-and-budgets/10-02-SUMMARY.md
  - .planning/phases/10-performance-audit-and-budgets/10-03-PLAN.md
  - .planning/phases/10-performance-audit-and-budgets/10-03-SUMMARY.md
  - .planning/phases/10-performance-audit-and-budgets/10-04-PLAN.md
  - .planning/phases/10-performance-audit-and-budgets/10-04-SUMMARY.md
  - apps/web/app/fixtures/[fixtureId]/forecast-comparison-panel.tsx
  - apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx
  - apps/web/app/fixtures/[fixtureId]/page.tsx
  - apps/web/app/fixtures/[fixtureId]/value-outcome-section.tsx
  - apps/web/app/fixtures/[fixtureId]/workbench-format.ts
  - package.json
  - scripts/perf-audit.mjs
  - scripts/perf/perf-budget.json
  - scripts/perf/perf-receipts/perf-baseline-after.json
  - scripts/perf/perf-receipts/perf-baseline-before.json
  - tests/unit/ci-workflow-contract.test.ts
  - tests/unit/perf-audit.test.ts
covered_digest: "v4:sha256:b021450ce74df822a000d782404f84840065762821964e5cc248e8f0c26f02de"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/6
  gaps_closed:
    - "performance-budget CI job runs the pinned audit script and fails the build on budget regression (PERF-02)"
  gaps_remaining: []
  regressions: []
gaps: []
human_verification: []
---

# Phase 10: Performance Audit and Budgets — Verification Report

**Phase Goal:** Пользователь получает страницу матча, отвечающую заявленным Lighthouse-бюджетам производительности — измеренным честно как медиана-из-3 до/после — и бюджетные регрессии валят CI, а не уезжают в прод.
**Verified:** 2026-11-19T07:30:00Z
**Status:** passed
**Re-verification:** Yes — после закрытия гэпа планом 10-04, двух CI-фиксов и продуктового решения по калибровке бюджета (D-03 amendment)

## Goal Achievement

### Observable Truths

Консолидированные must-haves: roadmap success criteria + frontmatter must_haves планов 01/02/03 (дедуплицированы) + must_haves плана 10-04 (гэп-клозур PERF-02).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Честное измерение: медиана-из-3 LCP/TBT/CLS/байтов по продакшн-сборке, закрытые поля, desktop recorded-only, без секретов (PERF-01, D-02/D-04/D-05/D-07) | ✓ VERIFIED | `scripts/perf-audit.mjs:446-495` — owned-стек: `next build` + `next start` с `NEXT_DIST_DIR=.next-e2e`, `NODE_ENV=production`, API :3231 / web :3230; `metricBlock` (`:154-163`) берёт **срединный элемент отсортированного ряда из трёх** прогонов по каждой метрике, а не среднее и не лучший/худший прогон (в квитанции before LCP 22051.317 — медиана [14420.09, 22051.32, 24138.08]; after TBT 641 — медиана [626.5, 641, 753.05]); закрытый набор полей квитанции `schemaVersion/date/gitSha/lighthouseVersion/profile/pages/desktop` проверен в обеих квитанциях; `validateReceipt` отвергает неизвестные ключи и secret-shaped значения (`tests/unit/perf-audit.test.ts:173-199`); `desktop.recordedOnly:true`, desktop вне `GATED_METRICS` (`:41`) и не читается `assertMetricsWithinBudgets` (`:165-175`); тест «ignores the desktop block entirely» (`perf-audit.test.ts:251`). Замечание о калибровке абсолютных чисел — см. «Anti-Patterns Found» (принято решением владельца, D-03 amendment) |
| 2 | Бюджеты трассируются к committed before-квитанции с умеренным запасом; профиль mobile дословно совпадает с профилем квитанций; desktop без бюджетов (D-03/D-04/D-06) | ✓ VERIFIED | `scripts/perf/perf-budget.json`: lcp 26500 > 22051.3 (×1.20), tbt 950 > 755.5 (×1.26), cls 0.09 > 0.08711 (+0.0029), scriptTransferBytes 5500000 > 5203434 (+5.7%); блок `profile` в точности равен `profile` обеих квитанций; `desktopProfile` есть, desktop-бюджетов в файле нет; `assertProfileMatch` валит `PROFILE_DRIFT` (round-trip `--assert-only` по after-квитанции прошёл, exit 0) |
| 3 | D-09 сплит: панели ленивые через `next/dynamic` на верхнем уровне клиентского компонента, жадное ядро нетронуто, статический импорт в `page.tsx` сохранён, обратных импортов нет | ✓ VERIFIED | `forecast-workbench.tsx:19-26` — две привязки `dynamic(() => import('./…').then(m => m.X), { loading: () => <p role="status">…</p> })` на верхнем уровне модуля; `page.tsx:7` — статический `import { ForecastWorkbench } from "./forecast-workbench"` не изменён; grep по каталогу `[fixtureId]` не находит ссылок на `forecast-workbench` из `forecast-comparison-panel.tsx` / `value-outcome-section.tsx`; оба модуля существуют (5211 B / 3917 B) |
| 4 | After-квитанция: scriptTransferBytes медиана строго ниже before (T-10-04) | ✓ VERIFIED | before 5 203 434 B → after 5 200 986 B (−2 448 B; по три идентичных значения в каждой квитанции). Оговорка: дельта 0,05 % ниже межсессионного разброса самой метрики (свежий локальный прогон 2026-11-18 дал 2 818 955 B) — сплит доказан структурно (truth 3) и размером бандла, который реально грузит CI; см. Anti-Patterns |
| 5 | performance-budget джоба в CI запускает тот же скрипт+конфиг, разбирается собственным флаг-контрактом скрипта, зелёная на комплаенсе и exit 1 на регрессе; контрактный тест пинует полный вызов; skip-конструкций нет (PERF-02, D-06/D-08) | ✓ VERIFIED | `ci.yml:78-106`: job `performance-budget`, `timeout-minutes: 25`, `--frozen-lockfile`, `corepack enable`, `playwright install chromium --with-deps`, шаг `node scripts/perf-audit.mjs --receipt "$RUNNER_TEMP/perf-receipt.json"` (строка 106; голого вызова больше нет). Первый зелёный прогон: **GitHub Actions run 44469419394 на head 0a08ad2 — quality ✅, performance-budget ✅ (4m15s), e2e-portable ✅, integration ✅** (`gh run view 44469419394 --json conclusion,jobs`). Лог перф-джобы (job 135374972532): `RECEIPT_WRITTEN: /home/runner/work/_temp/perf-receipt.json`, медианы `lcp 609.8809 / tbt 120 / cls 0.08710918036748198 / scriptTransferBytes 303422`, desktop recorded-only, `BUDGETS_OK: all gated medians within budget` — джоба завершилась, не повиснув. Красный путь проверен мной тем же кодом: doctored-бюджет (cls → 0.000001) → `cls: 0.08710918036748198 > budget 0.000001`, exit 1. Cross-parse пин: `tests/unit/ci-workflow-contract.test.ts:251-293` разбирает фактическую run-строку из `ci.yml` экспортированным `parseFlags` (удаление `--receipt` → `RECEIPT_PATH_REQUIRED`, переименование флага → `UNKNOWN_ARGUMENT`) |
| 6 | Fail-closed контракт квитанции цел и усилен: явный путь во всех режимах, отсутствующее/пустое значение `--receipt` бросает `RECEIPT_PATH_REQUIRED`; CI пишет квитанцию только в RUNNER_TEMP, никогда в коммитнутое дерево `scripts/perf` (D-07) | ✓ VERIFIED | `scripts/perf-audit.mjs:601-622`: `export function parseFlags`, перехват сырого токена до `resolve()`, `if (raw === undefined \|\| raw === "") throw new Error("RECEIPT_PATH_REQUIRED")`, финальный `if (!flags.receipt) throw …` и комментарий «no silent default receipt path, in any mode» сохранены. Прямые прогоны: `node scripts/perf-audit.mjs` → `RECEIPT_PATH_REQUIRED`, exit 1 (документированный контракт, CI его соблюдает); `--assert-only --receipt …after.json` → `BUDGETS_OK`, exit 0. CI-приёмник — `/home/runner/work/_temp/perf-receipt.json` (вне checkout). Отрицательный ассерт `--receipt scripts/` отсутствует в перф-блоке (`ci-workflow-contract.test.ts:241-244`); в git отслеживаются только `perf-budget.json` и две baseline-квитанции |
| 7 | Unit-тесты фазы зелёные, включая «CI process-exit contract»; disabled-тестов нет | ✓ VERIFIED | Мой прогон: `pnpm vitest run --project unit tests/unit/perf-audit.test.ts tests/unit/ci-workflow-contract.test.ts` → **2 files, 45/45 passed** (в т.ч. `describe("CI process-exit contract")` — `perf-audit.test.ts:275-288`, проверяющий `detached` на POSIX и `process.exit(exitCode)` после cleanup). Скан `it.skip|describe.skip|test.skip|.todo|xit(` — совпадений нет (единственное вхождение — слово `exit(` в message-строке) |
| 8 | Поведение измерений PERF-01 не регрессировало после гэп-клозура: схема/бюджеты/медиана/ассерты без изменений, after-квитанция по-прежнему даёт BUDGETS_OK exit 0; web-тесты зелёные | ✓ VERIFIED | Round-trip: `node scripts/perf-audit.mjs --assert-only --receipt scripts/perf/perf-receipts/perf-baseline-after.json` → `BUDGETS_OK: all gated medians within budget`, exit 0. Web: `pnpm --filter @bet-stats/web test` → **10 files, 121/121 passed**. `package.json` держит точные пины `lighthouse@13.6.0`, `chrome-launcher@1.2.3` |

**Score:** 8/8 must-haves verified (0 present, behavior-unverified)

### Behavioral Spot-Checks (выполнены верификатором)

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Слой утверждений пропускает валидную after-квитанцию | `node scripts/perf-audit.mjs --assert-only --receipt scripts/perf/perf-receipts/perf-baseline-after.json` | `BUDGETS_OK: all gated medians within budget`, exit 0 | ✓ PASS |
| Индуцированный регресс валит гейт (doctored-копия бюджета в TEMP, cls → 0.000001) | `node scripts/perf-audit.mjs --assert-only --receipt …after.json --budget $env:TEMP/perf-budget-doctored.json` | `cls: 0.08710918036748198 > budget 0.000001`, exit 1; temp-файл удалён | ✓ PASS |
| Голый вызов остаётся fail-closed (документированный контракт; CI передаёт флаг) | `node scripts/perf-audit.mjs` | `RECEIPT_PATH_REQUIRED`, exit 1 | ✓ PASS (контракт) |
| Первый зелёный прогон перф-джобы в реальном CI | `gh run view 44469419394 --json conclusion,jobs` | conclusion `success`; performance-budget `success` 06:03:44→06:07:59Z | ✓ PASS |
| Лог перф-джобы: квитанция и медианы | `gh run view --log --job=135374972532` | `RECEIPT_WRITTEN /home/runner/work/_temp/…`; `lcp 609.8809`, `tbt 120`, `cls 0.0871`, `bytes 303422`; `BUDGETS_OK` | ✓ PASS |
| Unit-тесты фазы | `pnpm vitest run --project unit tests/unit/perf-audit.test.ts tests/unit/ci-workflow-contract.test.ts` | 2 files, 45/45 passed | ✓ PASS |
| Web-тесты | `pnpm --filter @bet-stats/web test` | 10 files, 121/121 passed | ✓ PASS |
| Размер клиентского бандла прод-сборки (контекст для калибровки) | `node`-обход `apps/web/.next-e2e/static/**/*.js` (raw + gzip) | 23 файла, 1 238 771 B raw, 384 973 B gzip | ℹ️ INFO |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `scripts/perf-audit.mjs` | Харнес: owned-стек, 3+3 прогона, медиана-из-3, fail-closed, exported `parseFlags`, main-entry guard, явный exit | ✓ VERIFIED | 647 строк; POSIX `detached:true` (`:77`), `stop()` по группе процессов (`:87-95`), `process.exit(exitCode)` после `cleanup()` (`:641-646`); Chrome-флаги `--no-sandbox --disable-dev-shm-usage …` (`:290-296`) |
| `scripts/perf/perf-budget.json` | perf-budget-v1: профиль, страницы, бюджеты, desktopProfile | ✓ VERIFIED | См. truth 2 |
| `scripts/perf/perf-receipts/perf-baseline-before.json` | Committed before-квитанция | ✓ VERIFIED | gitSha 2f4102b, Lighthouse 13.6.0, дата 2026-11-17T05:58Z, честные 3 прогона |
| `scripts/perf/perf-receipts/perf-baseline-after.json` | Committed after-квитанция | ✓ VERIFIED | gitSha 3b83b3a, дата 2026-11-17T06:15Z, bytes строго ниже before |
| `tests/unit/perf-audit.test.ts` | Медиана, ассерты, схема квитанции, desktop-recorded-only, флаг-контракт `parseFlags`, process-exit контракт | ✓ VERIFIED | 28 it-кейсов, зелёные |
| `tests/unit/ci-workflow-contract.test.ts` | Политика на четыре джобы + пин полного вызова + cross-parse | ✓ VERIFIED | 17 it-кейсов, зелёные; `--receipt "$RUNNER_TEMP/perf-receipt.json` и запрет `--receipt scripts/` (`:235-244`); cross-parse (`:251-293`) |
| `package.json` devDeps | `lighthouse@13.6.0` + `chrome-launcher@1.2.3` точно | ✓ VERIFIED | Точные пины |
| `apps/web/.../forecast-comparison-panel.tsx` | Ленивый модуль панели | ✓ VERIFIED | 5211 B, импортирует `workbench-format`, без back-import |
| `apps/web/.../value-outcome-section.tsx` | Ленивый модуль value-секции | ✓ VERIFIED | 3917 B, без back-import |
| `apps/web/.../workbench-format.ts` | Общие чистые хелперы | ✓ VERIFIED | percent/labelReason/signedPercent/directionText + `ValueResult`, без React |
| `.github/workflows/ci.yml` performance-budget | Джоба после e2e-portable, вызывающая скрипт с явным `--receipt` | ✓ VERIFIED | Строки 78-106; вызов исправлен планом 10-04, первый зелёный прогон — run 44469419394 |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| ci.yml performance-budget | `scripts/perf-audit.mjs` | `node scripts/perf-audit.mjs --receipt "$RUNNER_TEMP/perf-receipt.json"` (строка 106) | ✓ WIRED | Cross-parse тест разбирает именно этот вектор через экспортированный `parseFlags`; удаление флага валит тест |
| `perf-audit.mjs` | `perf-budget.json` | `--budget` (default `scripts/perf/perf-budget.json`) + `assertProfileMatch` | ✓ WIRED | `PROFILE_DRIFT` при расхождении профиля |
| `perf-budget.json` | before/after квитанции | Значения бюджетов трассируются к медианам before | ✓ WIRED | См. truth 2 |
| `perf-audit.mjs` | RUNNER_TEMP (CI) | Явный путь квитанции из env-расширения в run-body | ✓ WIRED | Лог: `/home/runner/work/_temp/perf-receipt.json`; в `scripts/perf/` CI ничего не пишет |
| `forecast-workbench.tsx` | ленивые модули | `next/dynamic` named-export на верхнем уровне | ✓ WIRED | Next 16, клиентский компонент, без `ssr:false` |
| ленивые модули | `forecast-workbench.tsx` | — (запрещённые back-import) | ✓ WIRED (отсутствуют) | Grep: ни одной ссылки |
| `page.tsx` | `forecast-workbench.tsx` | Статический импорт | ✓ WIRED | Строка 7 не изменена |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| PERF-01 | 10-01, 10-02 | Страница матча отвечает Lighthouse-бюджетам, измерение медианой-из-3 по прод-сборке, до/после записаны | ✓ SATISFIED | Truths 1-4, 8: обе квитанции, бюджеты с запасом, сплит структурно доказан; CI подтверждает соответствие бюджетам на прод-сборке (609.9/120/0.0871/303422) |
| PERF-02 | 10-03, 10-04 | Lighthouse-ассерты в CI на ключевых страницах валят сборку на регрессии | ✓ SATISFIED | Truths 5-7: вызов исправлен и запинен исполняемо; живой CI-прогон 44469419394 зелёный; красный путь доказан doctored-бюджетом (exit 1) |

Orphaned requirements: нет — оба ID фазы 10 покрыты планами (10-01/02 → PERF-01, 10-03/04 → PERF-02).

Примечание по трассировке: `.planning/REQUIREMENTS.md:31-32` и таблица `:109-110` всё ещё помечают PERF-01/PERF-02 как `Pending (gaps_found - reverted)` и содержат устаревшую приписку про «gap closure pending». Это bookkeeping-рассинхрон (не код): после приёмки этого отчёта требования следует отметить выполненными.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER в файлах фазы | — | Не обнаружены (grep чист) |
| — | — | `it.skip`/`describe.skip`/`test.skip`/`xit(`/`.todo` в perf-тестах | — | Не обнаружены |
| — | — | Recharts/чарт-библиотеки | — | Отсутствуют (запрет D-09 соблюдён) |
| `scripts/perf/perf-receipts/` | — | Лишние артефакты в tracked-каталоге | — | Только две коммитнутые baseline-квитанции + `perf-budget.json` |
| `scripts/perf/perf-receipts/*.json` + `.next-e2e/static` | — | Калибровка метрик: committed `scriptTransferBytes` 5 203 434 / 5 200 986 B превышает **весь** клиентский JS прод-сборки (23 файла, 1 238 771 B raw / 384 973 B gzip), тогда как тот же харнес в CI измерил 303 422 B (лог run 44469419394); локальные прогоны расходятся между собой (2 818 955 B 18.11 против 5 200 986 B 17.11/19.11), LCP 12.2-24.2 s локально против 0.6099 s в CI | ℹ️ Accepted (D-03 amendment) | **Решение владельца проекта 2026-11-19: запас принимается и документируется** (`.planning/phases/10-performance-audit-and-budgets/10-VALIDATION.md`, раздел «Budget Calibration Disposition»). Бюджеты остаются привязанными к committed локальным квитанциям; в CI запас 8× (TBT), 18× (байты), 43× (LCP), CLS тугой (0.09 vs 0.0871). Пере-базирование на CI-медианы — отдельный будущий план (CI-профиль бюджета), подмена committed-квитанций задним числом запрещена (D-02). Гейт остаётся механически различающим (doctored-бюджет → exit 1). |

### Human Verification Required

Нет. Единственный человеко-проверяемый пункт — калибровка бюджета — **закрыт решением владельца проекта 2026-11-19**: принят существующий запас с явной фиксацией в `10-VALIDATION.md` (раздел «Budget Calibration Disposition», D-03 amendment). Код, бюджет и committed-квитанции не менялись; пере-базирование на CI-медианы отложено как отдельный будущий план (CI-профиль бюджета).

Предыдущие human-пункты закрыты: (1) первый зелёный прогон performance-budget в GitHub Actions — **выполнен** (run 44469419394, job 4m15s, BUDGETS_OK); (2) свежий полный локальный прогон харнеса — **выполнен** 2026-11-18 (запись в `10-VALIDATION.md`: exit 0, BUDGETS_OK, LCP 12156 / TBT 702 / CLS 0.0871 / bytes 2818955, temp-квитанция удалена) и повторён 2026-11-19 (exit 0, BUDGETS_OK).

### Gaps Summary

Блокирующих гэпов нет — фаза принята. Прошлый блокер — вызов `node scripts/perf-audit.mjs` без обязательного `--receipt` в `ci.yml` — **закрыт** планом 10-04 и подтверждён живым CI:

- `ci.yml:106` теперь `node scripts/perf-audit.mjs --receipt "$RUNNER_TEMP/perf-receipt.json"`; комментарий (101-105) фиксирует fail-closed контракт скрипта и приёмник вне checkout;
- `parseFlags` экспортирована и усилена (отсутствующее/пустое значение → `RECEIPT_PATH_REQUIRED`), `scripts/perf-audit.mjs:601-622`;
- контрактный тест пинует полный вызов и разбирает его собственным парсером (`ci-workflow-contract.test.ts:219-293`) — голый вызов или переименованный флаг валят тест до мерджа;
- вторая, независимая причина вечной красноты (Chrome под root без `--no-sandbox` и незавершающийся процесс после `BUDGETS_OK`) исправлена: флаги `:290-296`, POSIX-группа `:77`, явный `process.exit(exitCode)` после cleanup `:641-646`, пин в `describe("CI process-exit contract")`;
- **первый зелёный прогон**: run 44469419394 (head 0a08ad2) — все четыре джобы ✅, перф-джоба 4m15s, `BUDGETS_OK`; гейт различающий: тот же код на doctored-бюджете даёт exit 1.

Остаточное (принято, не гэп): committed before/after-квитанции содержат `scriptTransferBytes` 5,2 МБ, что больше всего клиентского JS прод-сборки (1,24 МБ raw), а CI на той же прод-сборке измеряет 303 КБ. Методология честна (медиана-из-3, закрытые поля, без черри-пикинга), сплит D-09 структурно доказан, страница бюджеты проходит. Запас принят решением владельца и задокументирован; будущее ужесточение — через отдельный CI-профиль бюджета, не через правку committed-квитанций.

---

_Verified: 2026-11-19T07:30:00Z_
_Verifier: the agent (gsd-verifier)_
