---
phase: 10-performance-audit-and-budgets
plan: "04"
status: complete
gap_closure: true
completed: "2026-11-18"
commits:
  - sha: 2a91d11
    message: "fix(10-04): add explicit --receipt to performance-budget CI step and tighten contract test"
  - sha: c6d2c83
    message: "fix(10-04): export parseFlags, harden empty --receipt, add flag-contract and cross-parse tests"
tests_added: 8
tests_total_after: 43
human_verification:
  local_run: done
  ci_run: deferred
---

# Plan 10-04 Summary — Gap Closure: CI Invocation Contract Fix

## What Was Done

Закрыт единственный блокирующий гэп верификации фазы 10 (PERF-02): шаг `node scripts/perf-audit.mjs` в `.github/workflows/ci.yml` (строка 104) вызывал скрипт без обязательного флага `--receipt` — джоба детерминированно падала с `RECEIPT_PATH_REQUIRED` на каждом прогоне и не могла служить различающим бюджетным гейтом.

### Task 1 — ci.yml + контрактный тест (коммит `2a91d11`)

- **ci.yml**: строка 104 заменена с `node scripts/perf-audit.mjs` на `node scripts/perf-audit.mjs --receipt "$RUNNER_TEMP/perf-receipt.json"`. Комментарий переписан: скрипт не имеет пути квитанции по умолчанию ни в одном режиме (fail-closed RECEIPT_PATH_REQUIRED — D-06/D-08); CI называет приёмник явно — RUNNER_TEMP, предоставляемый GitHub на каждый раннер и стираемый между джобами, вне checkout (D-07).
- **tests/unit/ci-workflow-contract.test.ts**: в существующий it-кейс «gates performance...» добавлены два новых ассерта (б) и (в):
  - Положительный пин: perf-блок содержит `--receipt "$RUNNER_TEMP/perf-receipt.json` (без закрывающей кавычки, нечувствительно к стилю цитирования).
  - Отрицательный гард: perf-блок не содержит `--receipt scripts/` — baseline-квитанции неизменяемы (D-07).
- 16/16 тестов зелёные (счётчик не изменился).

### Task 2 — экспорт parseFlags + hardening + unit-пин + cross-parse (коммит `c6d2c83`)

- **scripts/perf-audit.mjs**: добавлен `export` к `parseFlags` (чистая функция, main-entry guard делает импорт безопасным). Hardening: сырой токен значения `--receipt` захватывается до `resolve()`; если `undefined` или `""` — немедленно бросается `RECEIPT_PATH_REQUIRED` (до этого `path.resolve("")` молча возвращал cwd, обходя финальный guard). Финальная проверка `if (!flags.receipt)` и комментарий «Fail-closed: no silent default receipt path, in any mode.» сохранены дословно.
- **tests/unit/perf-audit.test.ts**: 7 новых кейсов флаг-контракта через экспортированный `parseFlags`:
  - `[]` → `RECEIPT_PATH_REQUIRED`
  - `['--receipt']` → `RECEIPT_PATH_REQUIRED`
  - `['--receipt', '']` → `RECEIPT_PATH_REQUIRED` (hardening пустого значения)
  - `['--receipt', 'C:/tmp/r.json']` → валидный объект флагов
  - `['--assert-only', '--receipt', '...']` → `assertOnly: true`
  - `['--unknown', ...]` → `UNKNOWN_ARGUMENT: --unknown`
  - export existence assertion
- **tests/unit/ci-workflow-contract.test.ts**: cross-parse тест (T-10-10) — извлекает run-строку из perf-джобы ci.yml, разбирает вектор аргументов через экспортированный `parseFlags`, ассертит: разбор без исключения; резолвнутый приёмник не лежит в `scripts/perf/`; флаг `--receipt` присутствует в векторе. Импорт `import * as perfAudit from "../../scripts/perf-audit.mjs"` добавлен в заголовок файла.
- Итого: 43/43 тестов зелёные (+8 к прежним 35).
- Round-trip: `node scripts/perf-audit.mjs --assert-only --receipt scripts/perf/perf-receipts/perf-baseline-after.json` → exit 0, `BUDGETS_OK`.

### Task 3 — Чекпойнт human-verify

**Проверка 1 (локальный полный прогон) — ВЫПОЛНЕНА агентом (2026-11-18, 08:19–08:23 UTC+1):**

```
node scripts/perf-audit.mjs --receipt "$env:TEMP\perf-receipt-gapfix.json"
```

Результат (exit 0, 3м 49с):
```
RECEIPT_WRITTEN: C:\Users\Vlad\AppData\Local\Temp\perf-receipt-gapfix.json
lcp:   median 12156.14  (12371.45, 12156.14, 12056.76)   budget 26500  ✅
tbt:   median 702       (702, 710.5, 661.5)               budget 950    ✅
cls:   median 0.08711   (0.08711, 0, 0.08711)             budget 0.09   ✅
bytes: median 2818955   (2818937, 2818959, 2818955)       budget 5500000 ✅
desktop (recorded only): lcp 12229.98, tbt 743, cls 0.0295, bytes 2818930
BUDGETS_OK: all gated medians within budget
```
Temp-квитанция удалена. Стек разработчика :3000 не затронут.

Дополнительно подтверждено: усиленный `parseFlags` принимает живой вызов с `--receipt` и не ломает существующий раунд-трип.

**Проверка 2 (первый зелёный CI-прогон) — ПЕРЕНЕСЕНА:**
Плагин GitHub недоступен — автоматический пуш/наблюдение невозможны. Два fix-коммита (`2a91d11`, `c6d2c83`) готовы. **Выполните `git push origin main`** и проверьте джобу `performance-budget` в GitHub Actions (ожидается: зелёная, ≤25 мин). Зафиксируйте результат в `10-VALIDATION.md`.

## Correctness Notes

**Claim «Receipt goes to its default path» из 10-03-SUMMARY — ОПРОВЕРГНУТ и ЗАМЕНЁН:**
Скрипт никогда не имел пути квитанции по умолчанию ни в одном режиме. Правильный контракт: «explicit `--receipt` everywhere, no default in any mode (fail-closed: RECEIPT_PATH_REQUIRED)». CI-сторона теперь соблюдает этот контракт явно через `$RUNNER_TEMP`.

## Deviations

Нет отклонений от плана. Оба коммита точно соответствуют Task 1 / Task 2. Cross-parse тест реализован как отдельный it-блок в `ci-workflow-contract.test.ts` (не внутри существующего it-кейса) — это допускается планом («новый тест» в `ci-workflow-contract.test.ts`), счётчик 17 (Task 2) достигнут.

## Must-Haves Verification

| Truth | Status |
|-------|--------|
| Аудит-вызов в performance-budget джобе разбирается собственным флаг-контрактом скрипта (cross-parse пин T-10-10) | ✅ — cross-parse тест добавлен |
| Контрактный тест валится на голый вызов: удаление `--receipt` из ci.yml → RECEIPT_PATH_REQUIRED | ✅ — cross-parse тест это гарантирует |
| Fail-closed контракт квитанции цел и усилен: пустое `--receipt` → RECEIPT_PATH_REQUIRED | ✅ — hardening пустого значения добавлен |
| CI пишет квитанцию только в RUNNER_TEMP, никогда в коммитнутое дерево scripts/perf | ✅ — ci.yml исправлен; отрицательный ассерт пинует |
| Поведение измерений PERF-01 не тронуто: 19 unit-тестов зелёные, after-квитанция → BUDGETS_OK exit 0 | ✅ — 19/19 + round-trip + полный локальный прогон |

## Requirements Closed

- **PERF-02** — джоба `performance-budget` теперь является различающим гейтом: зелёная на комплаенс-прогоне, красная на регрессе. Гэп верификации закрыт.
