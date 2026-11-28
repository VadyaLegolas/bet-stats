---
phase: 15-7-day-value-scanner
plan: 06
subsystem: value-scanner-gap-closure
tags: [scanner, client-bundle, tree-shaking, css-container-query, accessibility, playwright, perf-audit, release-gate]
requires:
  - phase: 15-7-day-value-scanner
    provides: "scanner domain module (15-01), page and CSS (15-03, 15-04), browser matrix and gate wiring (15-05), verification gaps (15-VERIFICATION.md)"
provides:
  - "scanner domain constants no longer reach any client chunk (pure annotations plus static guard 11)"
  - "Asian handicap main-line card stays inside 320 px at 200% text zoom, measured in release-accessibility"
  - "44 px target for the scanner match heading link, measured in the browser matrix"
  - "15-UI-SPEC.md aligned with the accepted navigation label and padding; amendments 1-8"
  - "same-session perf receipts for the phase start and the end of the gap closure, release gate stage results, open user decisions"
affects: [phase-16]
tech-stack:
  added: []
  patterns:
    - "Top-level calls in a barrel-exported domain module carry /*#__PURE__*/ so client importers do not ship them"
    - "A card that collapses under enlarged text becomes an inline-size container with a rem threshold, scoped to its own wrapper"
key-files:
  created:
    - .planning/phases/15-7-day-value-scanner/15-06-SUMMARY.md
  modified:
    - packages/domain/src/value/scanner.ts
    - tests/unit/scanner-guards.test.ts
    - apps/web/app/globals.css
    - apps/web/components/design-tokens.test.ts
    - tests/e2e/release-accessibility.spec.ts
    - tests/e2e/value-scanner.spec.ts
    - .planning/phases/15-7-day-value-scanner/15-UI-SPEC.md
    - .planning/phases/15-7-day-value-scanner/deferred-items.md
key-decisions:
  - "D-11 closed by the primary method (pure annotations); the type-only barrel fallback was not needed, so index.ts, package.json, the service and the Vitest aliases are unchanged."
  - "The card fix is scoped to .market-table .evidence-card (container-type plus @container max-width 11rem); the shared .evidence-card dl > div rule and ResponsiveEvidence are unchanged."
  - "The bound 5 960 160 is recorded as not met (C is 143 bytes above, the phase start is already 68 bytes above); the decision belongs to the user."
requirements-completed: [SCAN-01, SCAN-02]
coverage:
  - id: D1
    description: "Клиентские чанки продакшен-сборки не содержат кода доменного модуля сканера"
    requirement: SCAN-01
    verification:
      - kind: unit
        ref: "tests/unit/scanner-guards.test.ts#(11) scanner domain module adds nothing to a client chunk"
        status: pass
      - kind: other
        ref: "grep по apps/web/.next-e2e/static: scanner-freshness-v1 = 0, список выборов = 0, список семейств рынков = 1, value-policy-v1 найден"
        status: pass
    human_judgment: false
  - id: D2
    description: "Карточка главной линии АГ при 320 px и тексте 200 % не выходит за экран, при 100 % остаётся в две колонки"
    verification:
      - kind: e2e
        ref: "tests/e2e/release-accessibility.spec.ts#200 percent text zoom keeps essential actions and content available"
        status: pass
      - kind: unit
        ref: "apps/web/components/design-tokens.test.ts#stacks label over value in a narrow Asian handicap card"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ссылка названия матча на /scanner имеет высоту цели не меньше 44 px"
    requirement: SCAN-01
    verification:
      - kind: e2e
        ref: "tests/e2e/value-scanner.spec.ts (pnpm verify:scanner, 31 из 31)"
        status: pass
    human_judgment: false
  - id: D4
    description: "15-UI-SPEC.md отражает принятые подпись и поля навигации, цель 44 px и подтверждённые поправки"
    verification:
      - kind: other
        ref: "команда проверки согласованности из задачи 2 (grep по 15-UI-SPEC.md)"
        status: pass
    human_judgment: true
    rationale: "Проверка строк не доказывает, что формулировки соответствуют решениям пользователя"
  - id: D5
    description: "Граница scriptTransferBytes 5 960 160 на конце плана"
    requirement: SCAN-02
    verification:
      - kind: other
        ref: "node scripts/perf-audit.mjs --record, квитанции perf-A.json и perf-C.json: C = 5 960 303"
        status: fail
    human_judgment: true
    rationale: "Граница превышена на 143 байта; принять отклонение или заказать работу над пакетом решает пользователь"
  - id: D6
    description: "Полный релизный гейт verify:release"
    verification:
      - kind: e2e
        ref: "pnpm verify:release: release-degradation.spec.ts, случай D-16 sole-source outage, падает в обоих проектах (воспроизводится на b99004a)"
        status: fail
    human_judgment: true
    rationale: "Прежний красный случай вне объёма; исправить или принять решает пользователь"
status: complete
duration: "~60 min"
completed: 2026-11-28
commits: 5
plan_head_before: 35dd12045bf0ac8ef94b88b2bb969a455991f3a5
plan_head_after: 899f22f0fc41869deb7dd8d5c8235117529d4e46
actuals:
  tokens: 12523
  tasks: 3
  commits: 5
---

# Phase 15 Plan 06: Gap closure сканера Summary

**Константы доменного модуля сканера убраны из клиентских чанков (минус 237 байт), карточка главной линии АГ и ссылка названия матча исправлены и закреплены измерениями в браузере. Две вещи не зелёные: граница scriptTransferBytes 5 960 160 превышена на 143 байта, а `verify:release` падает на одном прежнем случае деградации поставщика, который воспроизводится на начале фазы.**

## Performance

- **Duration:** около 60 минут (2026-11-28T09:57:26Z — 2026-11-28T10:57:53Z до записи этого файла)
- **Tasks:** 3 из 3
- **Files modified:** 8 и этот SUMMARY

## Accomplishments

- D-11: на настоящей продакшен-сборке в клиентских чанках нет кода модуля сканера; значения констант не менялись.
- Блокер `release-accessibility` (дефект фазы 14) устранён: 20 из 20.
- Ссылка названия матча стала целью 44 px: `verify:scanner` 31 из 31.
- 15-UI-SPEC.md: строки 1-6 «подтверждено пользователем», добавлены поправки 7 и 8.
- Снята пара замеров пакета в одной сессии и выполнен релизный гейт по этапам.

## Task Commits

1. **Задача 1 (tracer):** `32ca63d` fix(15-06): keep scanner domain constants out of the client chunk
2. **Задача 2, часть A:** `555bea0` fix(15-06): keep the Asian handicap main-line card inside 320 px at 200% text zoom
3. **Задача 2, часть B:** `6bafba0` fix(15-06): make the scanner match heading link a 44 px target
4. **Задача 2, часть C:** `39b43c9` docs(15-06): align the scanner UI-SPEC with accepted navigation and target sizes
5. **Задача 3:** `899f22f` docs(15-06): record gate results, bundle measurements and open decisions

Tracer-гейт задачи 1 (auto_advance включён): проверки перезапущены после коммита и прошли, работа продолжена без checkpoint.

## Задача 1: способ и размеры

Сработал **основной способ** (аннотации `/*#__PURE__*/` у трёх `Object.freeze`). Запасной способ не применялся. Компилятор аннотации сохраняет: в `packages/domain/dist/value/scanner.js` их три.

| Сборка (`NEXT_DIST_DIR=.next-gate`) | политика свежести | порядок выборов | семейства рынков | `static/chunks/*.js` | все JS в static (23 файла) |
|---|---|---|---|---|---|
| до правки (`35dd120`) | 1 | 1 | 2 | 1 287 996 | 1 288 391 |
| после правки | 0 | 0 | 1 | 1 287 759 | 1 288 154 (-237) |

Проверка (11) на базовом коде была красной (три неаннотированные константы), после правки зелёная; три файла тестов сканера — 46 из 46; `pnpm typecheck` — 7 из 7. `pnpm-lock.yaml` не менялся.

## Задача 2: красные состояния до правки

- `release-accessibility`, `-g "200 percent text zoom"`, неизменённый CSS: 2 failed (оба проекта), для всех проверенных строк карточки сообщение вида `Линия: value 0.0 px of a 204.0 px row`. Проверка переполнения идёт после этой и в красном прогоне не достигалась; прежний замер 22 px взят из 15-05.
- `value-scanner`, `-g "AVAILABLE at 320 px, light"`: 1 failed, `26.0px «Inter — Milan»`, `26.0px «Lyon — Nantes»` (план ожидал около 24 px).
- После правок: `release-accessibility` 20 из 20, `verify:scanner` 31 из 31, web-тесты 305 из 305.

## Замеры пакета (одна сессия, по одному запуску)

| Замер | Коммит | Время UTC | scriptTransferBytes: прогоны | медиана | LCP, мс | TBT, мс | CLS |
|---|---|---|---|---|---|---|---|
| C (конец плана) | `39b43c9` | 10:20:40 | 5 960 303 / 5 960 303 / 5 960 303 | **5 960 303** | 16 074.842499999999 | 695.5 | 0 |
| A (начало фазы) | `b99004a` | 10:25:26 | 5 960 228 / 5 960 228 / 5 960 228 | **5 960 228** | 16 183.597999999998 | 734 | 0.05709928262336324 |

- C − A = **+75 байт** по передаче.
- На диске: A 1 287 963, C 1 288 154, разница +191. Сравнение содержимого чанков: различаются ровно три — чанк навигации (+75, пункт «Сканер») и два чанка разметки `date-range-filter.tsx` (+58 каждый), которых аудируемая страница не загружает. `match-hero.tsx` тоже менялся после `b99004a`, но это серверный компонент и в чанках разницы не даёт. Модуля сканера в разнице нет.
- Сопоставимость: |A − 5 960 540| = 312, |C − 5 960 540| = 237, оба в пределах 1 000 байт — замеры **сопоставимы** с 15-05.
- Граница 5 960 160: **не выполнена**, C выше на 143 байта (как и прогнозировалось). Само начало фазы в этой сессии выше границы на 68 байт.
- Общий бюджет 5 500 000: превышен, C на 460 303, A на 460 228. LCP, TBT и CLS в бюджете.
- Сборка замера C: остатков модуля сканера нет, список семейств рынков один раз.

### Черновик блока overrides (в 15-VERIFICATION.md не вставлен)

```yaml
overrides:
  - must_have: "D-11: страница сканера не увеличивает клиентский пакет; scriptTransferBytes не выше 5 960 160 (фазовый гейт плана 15-05)"
    reason: "Константы доменного модуля сканера убраны из клиентских чанков. Замеры одной сессии: начало фазы (b99004a) 5 960 228, конец плана 15-06 (39b43c9) 5 960 303, разница 75 байт — пункт навигации, обязательный по D-11. Выше границы на 143 байта, при этом само начало фазы выше неё на 68 байт; общий бюджет 5 500 000 превышен до фазы."
    accepted_by: ""
    accepted_at: ""
```

## Этапы гейта (итоговый код)

Логи и квитанции лежат вне репозитория в `%TEMP%\bs-15-06`.

| Этап | Команда | Лог | Результат |
|---|---|---|---|
| lint | `pnpm lint` | lint.log | passed: 7 из 7 задач, 0 ошибок, 9 предупреждений |
| первый запуск гейта | `pnpm verify:release` | env-blocked/release-attempt1.log | **остановлен на предпосылках**: `cmd.exe` не нашёл `docker`; ни одна проверка кода не выполнялась |
| предпосылки, install, схема | `pnpm verify:release` | release.log | passed |
| typecheck | там же | release.log | passed: 7 из 7 |
| unit | там же | release.log | passed: 94 файла, 1652 теста, 0 failed |
| web | там же | release.log | passed: 14 файлов, 305 тестов |
| интеграция (одноразовые контейнеры) | там же | release.log | passed: 86 файлов, 801 тест, 0 failed |
| build | там же | release.log | passed: 7 из 7 |
| release e2e, 8 спецификаций | там же | release.log | **failed**: 62 passed, 2 failed из 64 |
| сканер (цепочка до него не дошла) | `pnpm verify:scanner` | stage-scanner.log | passed: 31 из 31 |

Разбивка e2e: methodology 4/4, operations-gateway 4/4, operator-overview 6/6, operator-recovery 4/4, privacy-retention 10/10, release-accessibility 20/20, release-journey 2/2, release-degradation 12 из 14.

Все проверки задачи 3 по логам и квитанциям прошли (EXIT в логах, 20 строк release-accessibility, 31 строка value-scanner, пара квитанций, неизменность `apps` и `packages` после замера C, проверка чанков). Строка `EXIT=1` в release.log относится к красному этапу e2e.

### Прежний красный случай

`tests/e2e/release-degradation.spec.ts`, «D-16 sole-source outage preserves canonical facts and last-valid timestamp», desktop и mobile:

```
Error: expect(locator).toContainText(expected) failed
Locator: getByLabel('Статус поставщика')
Expected substring: "PROVIDER_UNAVAILABLE"
```

Давность доказана двумя способами: тот же случай с тем же сообщением падает 2 из 2 на отдельном worktree `b99004a` (repro/base-degradation.log); `ProviderStateNotice` выводит русскую подпись с `e7505c5` (2026-10-17), это предок начала фазы. План не менял ни спецификацию, ни компонент. Не исправлялось.

Таймаут `calibration-full-loop` в этом прогоне не проявился; `replay-crash-recovery` прошёл после предсборки dist-пакетов.

## Ограничения на изменения

`git diff 35dd120 HEAD` затрагивает только восемь файлов из `files_modified`. `scripts/`, корневой `package.json`, `.github/`, `pnpm-lock.yaml`, `packages/database/prisma`, 15-VERIFICATION.md, STATE.md, ROADMAP.md и REQUIREMENTS.md не менялись. Dev-база и dev-контейнеры не использовались, `.env` не читались и не копировались, `--html-dir` не передавался.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Лишняя кавычка в PATH этой машины останавливала verify:release**
- **Found during:** Task 3
- **Issue:** запись PATH после `AppData\Roaming\npm` содержит `"`; `cmd.exe` не видит следующие записи, включая Docker, и этап `verify:release:prerequisites` падает.
- **Fix:** кавычка убрана из PATH только в процессе гейта (`export PATH="${PATH//\"/}"`); системные настройки и скрипты не менялись. Лог первой попытки перенесён в `env-blocked/`.
- **Отступление от правила плана:** `verify:release` запускался дважды, а этап, на котором цепочка остановилась, был выполнен повторно. Первая попытка не проверила ни строки кода. Для диагностики один раз отдельно запускался `pnpm run verify:release:prerequisites`.
- **Files modified:** нет

**2. [Rule 3 - Blocking] Временный worktree не удалился целиком**
- **Found during:** Task 3
- **Issue:** `git worktree remove --force` снял регистрацию, но вернул «Directory not empty».
- **Fix:** проверено, что все 2193 ссылки внутри `%TEMP%\bs-15-06-base` ведут внутрь этого каталога, затем остаток удалён через `fs.rmSync`. Другие worktree не трогались.

### Прочие отступления

- Логи задач 1 и 2 и вспомогательный скрипт правки спецификации записаны в `%TEMP%\bs-15-06-work`; план этот каталог не называет, поэтому он не удалялся.
- `release-accessibility` 20 из 20 в задаче 2 прогонялся после части A, до CSS части B; на итоговом коде он повторён внутри `verify:release` (20 из 20).
- `apps/web/next-env.d.ts` переписывался сборками и `next dev`; каждый раз возвращался к версии из коммита и не индексировался.
- Реестр `.planning/WINDOWS.md` не пополнялся: в индекс разрешены только файлы из `files_modified` и этот SUMMARY.

**Total deviations:** 2 auto-fixed (Rule 3). **Impact:** код и гейты не изменены; результаты проверок не ослаблены.

## Открытые решения пользователя

1. **Граница scriptTransferBytes 5 960 160:** принять отклонение (вставить черновик overrides в 15-VERIFICATION.md) или заказать отдельную работу над клиентским пакетом. Общий бюджет 5 500 000 остаётся решением владельца фазы 10.
2. **Красный `release-degradation` D-16:** исправить отдельной задачей или принять. Пока он есть, релизный гейт целиком не зелёный, и цепочка не доходит до `verify:scanner`.
3. **Живой просмотр `/scanner` при 320 px в светлой и тёмной темах** на посеянных данных (human_verification, пункт 2) этим планом не закрыт.
4. Общее правило `.evidence-card dl > div` по-прежнему сжимает колонку значения при увеличенном тексте в других карточках `ResponsiveEvidence` (по расчёту CSS; отдельно не измерялось).
5. `perf-audit` удаляет каталог, переданный через `--html-dir`.
6. `verify:release` не делает предсборку dist-пакетов, которую делает CI.
7. Кавычка в PATH этой машины (видна в окружении процесса исполнителя; в какой переменной она задана, не проверялось): в таком окружении `verify:release` останавливается на предпосылках.
8. `extended-markets.spec.ts` не перезапускался: нужны порты dev-стека и `DATABASE_URL`.

## Issues Encountered

См. отступления и прежний красный случай. В логе `verify:scanner` задачи 2 есть предупреждение dev-сервера о несовпадении гидратации с атрибутом `open` у `details`; вероятная причина — тест раскрывает блоки до гидратации. Тесты при этом прошли.

## Known Stubs

None.

## Threat Flags

None. T-15-25..T-15-30 и T-15-SC соблюдены: проверка чанков с положительным контролем, только одноразовые контейнеры гейтов, таблица этапов и доказательство давности, новых пакетов нет.

## Next Phase Readiness

Код фазы 15 готов к повторной верификации. Блокирующих изменений для фазы 16 нет; релизный гейт остаётся красным из-за решения 2.

## Self-Check: PASSED

- Файлы на месте: все восемь изменённых файлов и этот SUMMARY.
- Коммиты `32ca63d`, `555bea0`, `6bafba0`, `39b43c9`, `899f22f` есть в истории HEAD.
- Self-check подтверждает только наличие файлов и коммитов; граница пакета и случай `release-degradation` остаются не пройденными.
