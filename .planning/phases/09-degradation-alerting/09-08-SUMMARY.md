---
phase: 09-degradation-alerting
plan: 08
subsystem: testing
tags: [playwright, e2e, hmac-signature, operations-center, regression-guard, typescript]

# Dependency graph
requires:
  - phase: 09-04
    provides: page.tsx alertPage fetch parameter (Cause B root) and the «Алерты» block (8th h2 section)
  - phase: 08
    provides: the «Резервные копии и проверка восстановления» block (7th h2 section, Cause A drift origin)
  - phase: 09-07
    provides: zoom-200% reflow CSS fix and the T-09-21 measured-offender discipline (not needed — zoom case green)
  - phase: 06
    provides: owned release stack (live-release-stack.ts, playwright.phase06.config.ts) used for all acceptance runs
provides:
  - overviewFetchSearch(query, alertPage) — one shared pure helper composing the operations overview fetch search for page and e2e (drift-proof T-09-22 mitigation)
  - A live, green permanent regression guard for the operations center: full unfiltered operator-overview.spec.ts run 6 passed / 0 failed
  - The previously unreachable 320px no-scroll assertion at zoom 100% (spec line 44) exercised and green inside both render cases
affects: [phase-10-performance-audit, future-operations-center-parameter-additions]

# Actuals (#2632) — same estimateTokens scale (chars/4 over the realized diff)
actuals:
  tokens: 370
  tasks: 3
  commits: 2
  plan_head_before: c037775a64d6a801bc302912e5fe702298947b14
  plan_head_after: 10b965348eab73c8920e89e3d12970480a064f73

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-tree e2e import of a pure apps/web module (.js extension over .ts source, mirroring privacy-retention.spec.ts) so page and test share one URL builder"

key-files:
  created:
    - apps/web/app/internal/operations/overview-request.ts
  modified:
    - apps/web/app/internal/operations/page.tsx
    - tests/e2e/operator-overview.spec.ts

key-decisions:
  - "One shared overviewFetchSearch helper (the plan's preferred cannot-drift option) instead of duplicating the search string in page and spec — closes the T-09-22 drift class at the root"
  - "Signed-search literal alertPage value 1 documented as coupled to the page's alertPage memo default for the default search (English comment in the spec)"
  - "No CSS work needed: the zoom-200% case passed with real data loaded on the first full run, so the T-09-21 measured-offender discipline was never triggered"

patterns-established:
  - "e2e signature parity via shared URL builder: any future overview fetch parameter addition updates one function (overviewFetchSearch), never two sites"

requirements-completed: [ALRT-01, ALRT-02, ALRT-03, ALRT-04]

coverage:
  - id: D1
    description: "Shared overviewFetchSearch helper: page.tsx fetch and the e2e signature derive the same search string from one pure function (Cause B closed, T-09-22 mitigation)"
    requirement: ALRT-03
    verification:
      - kind: unit
        ref: "node -e overviewFetchSearch('?page=1&pageSize=25&windowHours=24', 1) → ?page=1&pageSize=25&windowHours=24&alertPage=1 (exact trace-proven string)"
        status: pass
      - kind: unit
        ref: "pnpm --filter @bet-stats/web exec tsc --noEmit (exit 0)"
        status: pass
      - kind: unit
        ref: "apps/web vitest run alerts-block.test.ts + backup-status-block.test.ts → 60 passed"
        status: pass
  - id: D2
    description: "operator-overview.spec.ts asserts the live 8-section operations center and signs exactly the parameters the page fetches (Causes A and B closed at the test contract)"
    requirement: ALRT-03
    verification:
      - kind: e2e
        ref: "playwright.phase06.config.ts: tests/e2e/operator-overview.spec.ts FULL unfiltered run → 6 passed / 0 failed (3 tests × 2 projects, owned release stack)"
        status: pass
  - id: D3
    description: "Zoom-100% no-scroll assertion (spec line 44) reachable and green again inside both render cases; zoom-200% case green with real data loaded"
    requirement: ALRT-03
    verification:
      - kind: e2e
        ref: "playwright.phase06.config.ts: operator-overview.spec.ts full run, cases 'renders the ordered…' × 2 projects + 'html zoom 200%…' × 2 projects — all ok"
        status: pass
  - id: D4
    description: "Release-accessibility regression stays green: 20/20 on the full unfiltered run (zoom/reflow tests untouched)"
    requirement: ALRT-03
    verification:
      - kind: e2e
        ref: "playwright.phase06.config.ts: tests/e2e/release-accessibility.spec.ts FULL unfiltered run → 20 passed"
        status: pass

# Metrics
duration: 7min
completed: 2026-11-15
status: complete
---

# Phase 09 Plan 08: Operations-center e2e guard repair Summary

**Общий e2e-guard операций-центра восстановлен: подпись e2e и fetch страницы собраны из одного хелпера overviewFetchSearch (alertPage внутри подписи, 404 устранён), список h2 обновлён до живых 8 секций — полный нефильтрованный прогон 6 passed / 0 failed, release-accessibility 20/20.**

## Run-Scope Evidence (round-3 process observation — hard gate)

- **Полный приёмочный прогон (доказательство завершения):** `$env:PATH = "D:\Documents\Atom\bet-stats\.tools\node24;$env:PATH"; pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts` — **6 passed (1.2m), 0 failed, 0 skipped, 0 flaky** (3 теста × 2 проекта: desktop-chromium + mobile-chromium). **Флаги фильтрации НЕ использовались** — ни --grep, ни --grep-inverted, ни правок test.filter в конфиге.
- **Регрессионный прогон:** `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/release-accessibility.spec.ts` — **20 passed (1.6m)**, полный без фильтров.
- **Smoke-прогон (итерационное доказательство, НЕ завершение):** внутри Task 2 `--grep "renders the ordered"` → 4 passed (2 render-кейса × 2 проекта) — доказал, что 404 исчез, до полного прогона.
- **Урок round-3 соблюдён:** ранее «2 passed» UAT-прогона шли с фильтром по zoom-кейсу и маскировали 4 красных render-кейса в UAT и раундах 1–2; здесь финальным доказательством является только полный нефильтрованный прогон, точные команды и счётчики записаны выше.

## Performance

- **Duration:** 7 min
- **Started:** 2026-11-15T00:59:16Z
- **Completed:** 2026-11-15T01:06:17Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Причина B закрыта у корня: новый чистый модуль `overview-request.ts` экспортирует `overviewFetchSearch(query, alertPage)`, воспроизводя построчно байты прежней строки 60 page.tsx; и страница, и e2e-спека теперь собирают search из одной функции — дрифт подписи из трёх параметров против fetch из четырёх (404 от web-прокси) невозможен по конструкции (T-09-22 mitigate)
- Причина A закрыта: ожидание h2 в spec обновлено с замороженного списка из 6 секций (d44f65f, 2026-10-15) до живых 8 секций в DOM-порядке (Алерты, Готовность системы, Резервные копии и проверка восстановления, Состояние поставщиков, Использование квот, Неудачные задачи и мёртвые письма, Ошибки качества данных, Последние инциденты)
- Постоянный регрессионный guard операций-центра снова зелёный: утверждение no-scroll на zoom 100% (строка 44) достигаемо и зелёное внутри обоих render-кейсов; zoom-200% кейс зелёный с реальными данными — CSS-фиксы T-09-21 не понадобились
- Ничего не сломано: web typecheck exit 0, SSR-наборы блоков 60/60, release-accessibility 20/20, код прокси/подписи (route.ts, operator-proxy-authorization.ts) не тронут — fail-closed 404 сохранён

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared overviewFetchSearch helper** - `b98eb63` (feat)
2. **Task 2: operator-overview.spec.ts contract update** - `10b9653` (test)
3. **Task 3: Full unfiltered acceptance run** - verification-only, no source changes (evidence in this SUMMARY)

## Files Created/Modified
- `apps/web/app/internal/operations/overview-request.ts` — новый чистый хелпер overviewFetchSearch (без react/next импортов, импортируем из e2e)
- `apps/web/app/internal/operations/page.tsx` — fetch строки 60 собирает URL через overviewFetchSearch(query, alertPage); байты URL идентичны прежним
- `tests/e2e/operator-overview.spec.ts` — импорт хелпера (.js поверх .ts, прецедент privacy-retention.spec.ts), подпись `overviewFetchSearch(search, 1)` в render-цикле и zoom-кейсе, ожидание 8 h2

## Decisions Made
- Взята опция плана «preferred if compact»: один общий хелпер вместо копирования search-строки в два места — будущий параметр обновляет одну функцию
- Литерал `1` в подписи задокументирован в spec как связанный с дефолтом memo alertPage для этого search
- Вне скоупа (по запрету плана) остались: tests/e2e/release-degradation.spec.ts (строки 49–51) и operations-gateway.spec.ts (строка 16) — они намеренно продолжают подписывать 3-параметровый search, поскольку их утверждения не зависят от успешного overview-fetch страницы

## Deviations from Plan

None - план исполнен точно как написано.

## Issues Encountered
- Ни одного сбоя в прогонах: smoke, полный и регрессионный прогоны прошли зелёными с первой попытки; zoom-200% кейс прошёл overflow-проверку с реальными данными (alert/backup-строки), поэтому дисциплина T-09-21 не активировалась

## User Setup Required

None - никакой внешней конфигурации не требуется.

## Known Stubs

Нет. Стабов в созданных/изменённых файлах нет.

## Next Phase Readiness
- Единый gap round-3 фазы 09 закрыт: все 9 must-haves фазы выполнимы; guard операций-центра жив и защищает zoom-инвариант 100%
- Фаза 10 (Performance Audit) не блокируется; класс дрифт-ошибок подписи устранён архитектурно (одна функция для страницы и теста)

---
*Phase: 09-degradation-alerting*
*Completed: 2026-11-15*
