---
phase: 13-clv-price-diary
plan: 01
subsystem: domain/evaluation
tags: [clv, no-vig, closing-odds, decimal.js, tdd, pure-functions]

requires:
  - phase: 12
    provides: frozen odds-ratio-clv-v1, normalizeOddsBook, canonical odds contract
provides:
  - validateClosingOddsBook и closingObservationId (CLV-01, чистая доменная валидация одного набора закрывающих коэффициентов)
  - calculateNoVigClv, политика no-vig-clv-v1 (CLV-02, CLV без маржи на чтение)
affects: [13-02 closing-odds repository/endpoint, 13-03 read-time CLV in candidates, 13-04 methodology]

plan_head_before: 917f2d6643c11d116ace40df9260ae7864ae2cdb
plan_head_after: 627f6c12e111c78c40cb220530d3a2f681cf4b25

actuals:
  tokens: 8850
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Чистые функции: время (kickoffUtc, nowUtc) и состояние расчёта приходят аргументами"
    - "Закрытый набор типизированных кодов отказа с фиксированным и покрытым тестом порядком проверок"
    - "Де-вигинг только через frozen normalizeOddsBook; clv.ts и odds/normalize.ts не изменены"

key-files:
  created:
    - packages/domain/src/evaluation/closing-odds.ts
    - packages/domain/src/evaluation/no-vig-clv.ts
    - tests/unit/closing-odds.test.ts
    - tests/unit/no-vig-clv.test.ts
  modified:
    - packages/domain/src/index.ts

key-decisions:
  - "Идентификатор наблюдения: closing_ + sha256 от JSON-массива пяти ключевых полей (JSON исключает неоднозначность границ полей); коэффициент в ключ не входит, поэтому повтор с другим коэффициентом даёт тот же id (конфликт решает сервис в 13-02)"
  - "Порядок проверок validateClosingOddsBook: рынок, sourceConvention, формат observedAt, observedAt < kickoff, observedAt не в будущем, запись до kickoff, матч не рассчитан, дубликат выбора, полнота набора, коэффициенты"
  - "Порядок проверок calculateNoVigClv: нет закрытия, неполный кандидат, неполное закрытие, чужой источник, неверный момент времени, закрытие не до kickoff, закрытие раньше кандидата, неверные коэффициенты"
  - "Закрытие в тот же момент, что и кандидат, допустимо (как в замороженной odds-ratio-clv-v1)"

requirements-completed: [CLV-01, CLV-02]

duration: 10min
completed: 2026-11-24
status: complete

coverage:
  - id: D1
    description: "validateClosingOddsBook принимает только полный набор рынка с каноничным UTC-моментом, коэффициентами строго больше 1 и непустым sourceConvention; отклоняет не-предматчевые, будущие, поздние записи и записи по рассчитанному матчу типизированными кодами"
    requirement: CLV-01
    verification:
      - kind: unit
        ref: "tests/unit/closing-odds.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "closingObservationId детерминирован от (fixtureId, market, selection, sourceConvention, observedAt) и не зависит от коэффициента"
    requirement: CLV-01
    verification:
      - kind: unit
        ref: "tests/unit/closing-odds.test.ts#closingObservationId"
        status: pass
    human_judgment: false
  - id: D3
    description: "calculateNoVigClv: clv = pClose_fair / pCandidate_fair - 1 по полным наборам одного рынка и одного источника; любая несопоставимость даёт UNAVAILABLE с типизированной причиной, значение не достраивается"
    requirement: CLV-02
    verification:
      - kind: unit
        ref: "tests/unit/no-vig-clv.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Замороженный odds-ratio-clv-v1 в clv.ts не изменён, домен собирается, монорепозиторий проходит typecheck"
    verification:
      - kind: other
        ref: "pnpm --filter @bet-stats/domain build && pnpm typecheck; git diff plan_head_before..HEAD -- packages/domain/src/evaluation/clv.ts пуст"
        status: pass
    human_judgment: false
---

# Phase 13 Plan 01: Closing odds validation and no-vig CLV Summary

**Чистые доменные функции: строгая валидация полного набора закрывающих коэффициентов с детерминированным id наблюдения и CLV без маржи (`no-vig-clv-v1`) с закрытым набором причин недоступности, поверх замороженного нормализатора.**

## Performance

- **Duration:** 10 min (2026-11-24T20:42:34Z - 2026-11-24T20:52:41Z)
- **Tasks:** 3 (2 TDD, 1 auto)
- **Files:** 4 created, 1 modified

## Accomplishments

- `validateClosingOddsBook(input, context)` возвращает `{ ok: true, rows }` с каноничными коэффициентами в порядке рынка и детерминированными id либо `{ ok: false, code }`. Десять кодов отказа, порядок проверок закреплён тестами (47 тестов).
- `closingObservationId(key)` даёт `closing_<sha256>` от пяти ключевых полей; смена `observedAt`, рынка, выбора, источника или матча меняет id, смена коэффициента не меняет.
- `calculateNoVigClv(input)` де-вигает оба набора через `normalizeOddsBook` и считает `clv`. Проверено ручными рациональными примерами (1X2: HOME 183/1267, DRAW -143/1448; BTTS 13/82) и симметрией: для наборов без маржи значение побитово равно замороженному `calculateComparableClv` (0.25) (25 тестов).
- Экспорт из индекса домена; сборка домена и `pnpm typecheck` по всему монорепозиторию зелёные.

## Task Commits

| Задача | Фаза | Коммит |
|--------|------|--------|
| 1 validateClosingOddsBook / closingObservationId | RED | `990b659` test(13-01) |
| 1 | GREEN | `325c278` feat(13-01) |
| 2 calculateNoVigClv | RED | `87027be` test(13-01) |
| 2 | GREEN | `1cfc8df` feat(13-01) |
| 3 экспорт и проверка типов | auto | `627f6c1` feat(13-01) |

Ранее частичная попытка (`d864203`) была откачена в `917f2d6` по просьбе пользователя; план выполнен заново с нуля, без cherry-pick и un-revert.

## TDD Gate Compliance

- Task 1 RED: целевой тест `validateClosingOddsBook > accepts a complete 1X2 set and returns canonical rows in market order` упал на утверждении `expect(result.ok).toBe(true)` (заглушка возвращает UNSUPPORTED_MARKET); классификатор `check tdd-red-evidence` вернул `RED_EVIDENCE_OK`. Семантическая оценка: тест выполнился и упал по запланированной причине, не из-за импорта или синтаксиса. Запись: `evidence/13-01-t1-red.json`. В полном прогоне файла 41 из 47 тестов падали на утверждениях.
- Task 2 RED: целевой тест `calculateNoVigClv > computes clv ... hand-worked 1X2 example` упал на `expect(result.status).toBe("AVAILABLE")`; `RED_EVIDENCE_OK`. Запись: `evidence/13-01-t2-red.json`.
- Для классификатора целевой тест запускался отдельно (`-t`), потому что многострочные diff-ы vitest ломают разбор TAP при прогоне всего файла (`Malformed TAP`); полный отчёт сохранён нетронутым, ничего не правилось вручную.
- REFACTOR не потребовался.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Добавлена причина INVALID_TIMESTAMP в NoVigClvUnavailableReason**
- **Found during:** Task 2
- **Issue:** Список причин плана не имеет кода для не каноничной метки времени (кандидат, закрытие или начало матча). Без него пришлось бы либо выбросить исключение из чистого read-time расчёта, либо замаскировать ошибку неверным кодом.
- **Fix:** Добавлен восьмой код `INVALID_TIMESTAMP`, проверяется после источника и до порядка меток времени. Набор остаётся закрытым и типизированным.
- **Files modified:** packages/domain/src/evaluation/no-vig-clv.ts, tests/unit/no-vig-clv.test.ts
- **Commit:** `1cfc8df`

### Решения по неоднозначностям плана (не отклонения от контракта)

- Рынок или выбор вне поддерживаемых в `calculateNoVigClv` отдаёт `CANDIDATE_SET_INCOMPLETE`: набор кандидата не может обслужить такую пару. Пустой или отсутствующий набор кандидата тоже `CANDIDATE_SET_INCOMPLETE`, пустой или отсутствующий набор закрытия `CLOSING_SET_MISSING`.
- Пустой или нестроковый `sourceConvention` в `calculateNoVigClv` даёт `SOURCE_CONVENTION_MISMATCH` (нет пригодного общего источника).
- `validateClosingOddsBook` бросает исключение только при неканоничных `context.kickoffUtc` / `context.nowUtc`: это доверенные системные значения, а не пользовательский ввод; пользовательский ввод всегда отдаёт типизированный код.
- `fixtureId` в `calculateNoVigClv` не принимается: функция работает по ценам, отбор наборов по матчу остаётся за вызывающим кодом (13-03).

**Total deviations:** 1 auto-fixed (1 Rule 2). **Impact:** расширение закрытого набора причин на один код, контракт плана иначе соблюдён полностью.

## Authentication Gates

None.

## Known Stubs

None. Заглушки RED-фазы заменены реализацией в GREEN-коммитах.

## Threat Flags

None: новых сетевых точек, путей авторизации или обращений к файлам нет; только чистые функции.

## Issues Encountered

None.

## Next Phase Readiness

Готово к 13-02: репозиторий и endpoint вызывают `validateClosingOddsBook` с серверными часами и фактом расчёта матча, вставляют `rows` с `id` в одной транзакции и разрешают конфликт по тому же `id` при другом коэффициенте. 13-03 использует `calculateNoVigClv` с наборами кандидата и закрытия.

## Self-Check: PASSED

- Файлы созданы: closing-odds.ts, no-vig-clv.ts, closing-odds.test.ts, no-vig-clv.test.ts: FOUND.
- Коммиты 990b659, 325c278, 87027be, 1cfc8df, 627f6c1: FOUND (предки HEAD).
- `pnpm vitest run --project unit` по двум новым файлам и financial-evaluation: 86 passed.
- `pnpm --filter @bet-stats/domain build && pnpm typecheck`: exit 0.
- `git diff 917f2d6..HEAD -- packages/domain/src/evaluation/clv.ts packages/domain/src/odds/normalize.ts`: пусто.
