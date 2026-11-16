---
phase: 09-degradation-alerting
reviewed: 2026-11-16T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - apps/web/app/internal/operations/overview-request.ts
  - apps/web/app/internal/operations/page.tsx
  - tests/e2e/operator-overview.spec.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
  necessity: 0
status: issues_found
---

# Phase 09: Code Review Report (incremental re-review after gap plan 09-08)

**Reviewed:** 2026-11-16
**Depth:** standard
**Files Reviewed:** 3 (scope: commits `b98eb63` + `10b9653` since `5967119a`)
**Status:** issues_found

## Summary

Повторное ревью замыкает verification round-3 gap плана 09-08: Cause A (spec ожидал замороженный список из 6 h2-секций против живых 8) и Cause B (страница дописывает `alertPage=N` в fetch, а e2e-HMAC подписывал только 3 параметра → расхождение digest → 404 proxy). Проверены все три файла скоупа плюс сквозная цепочка подписи: `overviewFetchSearch` → `page.tsx:61` → канонизация `apps/web/app/internal-api/operations/[[...path]]/route.ts:20-23` → подписывающие потребители (`infra/operator-gateway/security.mjs:42-51`, оба e2e-спека, `scripts/capture-faq-screenshots.mjs`).

Основной результат: ядро фикса корректно и соответствует плану. Хелпер чистый (нет `"use client"`, react/next-импортов, сайд-эффектов), байт-в-байт воспроизводит прежнюю inline-семантику (`page.tsx:61`; URL-байты идентичны), оба вызова в spec (`operator-overview.spec.ts:36,54`) формируют подпись ровно над той строкой, которую страница отправляет: входные данные совпадают (`window.location.search` = навигационный `search`; memo `alertPage` = 1 для этого search), канонизация (sort → `URLSearchParams.toString()` → sha256 base64url) идентична на всех трёх сторонах. Ожидание 8 h2-заголовков в spec (`operator-overview.spec.ts:40`) дословно совпадает с Block-заголовками `page.tsx:90-112` в DOM-порядке; `AlertsBlock` собственных h2 не добавляет. Запрет тронут не выполнен: код валидации подписи (`route.ts`, `operator-proxy-authorization.ts`) в диффе отсутствует, fail-closed 404 сохранён.

Ключевая проблема: гарантия «cannot silently drift» из плана 09-08 неполна — найден третий подписывающий потребитель, не упомянутый ни в must_haves, ни в prohibitions плана, для которого drift Cause B воспроизводится один в один и который, в отличие от release-degradation/operations-gateway, реально зависит от успешности overview-fetch. Это `scripts/capture-faq-screenshots.mjs` (внутри ревью-диапазона, коммит `ee658ff`): закоммиченный `operations.png` показывает живые данные (снято 28.10, до появления `alertPage`), но текущий скрипт более не может воспроизвести этот снимок — повторный прогон молча перезапишет корректный FAQ-артефакт деградировавшим состоянием.

Подтверждение evidence из промпта согласуется с кодом: контрпримеров в ревьюированных файлах, опровергающих «e2e 6 passed / typecheck 0 / SSR 60/60», не найдено. Счётчики `findings:` ниже учитывают только новые находки этого прохода; перенесённые из 09-REVIEW-DISPOSITION.md стоящие открытые находки перечислены в отдельном разделе и в счётчики не входят (они уже учтены в леджере, `open: 19`).

## Narrative Findings (AI reviewer)

### Critical Issues

Нет. Новых критических дефектов, дыр в безопасности или риска потери данных в трёх файлах скоупа не обнаружено. Требование плана T-09-22 соблюдено: код валидации подписи не тронут, канонизация `route.ts:20-23` и fail-closed 404 без изменений.

### Warnings

### WR-09: Неполное замыкание drift-класса Cause B — `scripts/capture-faq-screenshots.mjs` подписывает 3-параметровый search, страница отправляет 4 (alertPage), FAQ-снимок operations.png деградирует молча (external-потребитель, cross-file)

**File:** `scripts/capture-faq-screenshots.mjs:22,32,120` (cross-file: `apps/web/app/internal/operations/page.tsx:61`, `apps/web/app/internal-api/operations/[[...path]]/route.ts:20-23`)
**Категория:** cross-file consequence ревьюируемого изменения (файл вне явного списка `files`, но внутри диапазона `5967119a..HEAD`, коммит `ee658ff`; найден при трассировке потребителей контракта нового хелпера)
**Issue:** План 09-08 закрывает drift-класс «подписанный набор ≠ отправленный набор» единственным источником `overviewFetchSearch`, но перечисляет только двух прочих потребителей (release-degradation, operations-gateway) с обоснованием «их assertions не зависят от успешности fetch». Третий потребитель пропущен. Скрипт снимает `/internal/operations${OPERATIONS_QUERY}` (строка 32, `wait: "Последняя проверка"`) и подписывает `/internal-api/operations/overview` ровно над 3-параметровым `OPERATIONS_QUERY` (строки 22, 120). Страница же при hydration fetch-ает `?page=1&pageSize=25&windowHours=24&alertPage=1` (page.tsx:61 через хелпер) → `queryDigest` в route.ts:20-23 включает `alertPage` → `timingSafeEqual` расходится → 404 → в `load()` при `port === "3000"` следует редирект на `/internal/operations/gateway…`. Это тот же доказанный round-3 механизм Cause B. Скрипт подписывает один раз на выстрел и не пересчитывает подпись под fetch страницы, поэтому: (1) маркер «Последняя проверка» не появится (он рендерится только после успешного fetch), `waitForContent` сработает в catch и снимок всё равно будет сделан; (2) валидация снимка — только размер ≥ 10 КБ (строки 23, 161), деградировавшая страница её проходит → `OK` в консоли. Закоммиченный `apps/web/public/images/faq/operations.png` показывает живые данные («Последняя проверка: 28 октября 2026») — он снят до появления `alertPage` и текущим скриптом невоспроизводим; повторный прогон `node scripts/capture-faq-screenshots.mjs operations` молча перезапишет корректный скриншот страницы-ходунка в FAQ на состояние ошибки/загрузки. Для операций-gateway (реальный gateway-прокси, подписывающий фактические байты запроса — `server.mjs:217-224`) и release-degradation (assert отсутствия канарейки, истинный и в деградировавшем состоянии, `release-degradation.spec.ts:52`) претензий нет — проверено.
**Fix:** Синхронизировать подпись с фактически отправляемым search — например, под Node 24 импортировать хелпер напрямую в `.mjs` (нативный type-stripping: `import { overviewFetchSearch } from "../apps/web/app/internal/operations/overview-request.ts"`) и подписывать `overviewFetchSearch(OPERATIONS_QUERY, 1)`; либо держать 4-параметровый литерал рядом с комментарием-зеркалом. Дополнительно: сделать для `operations.png` отсутствие маркера «Последняя проверка» фейлом прогона (сейчас catch-ветка `waitForContent` только пишет note), чтобы деградация артефакта не проходила как `OK`.

### Info

### IN-10: `overviewFetchSearch` двойной append `alertPage` при навигации с уже содержащимся `alertPage` — путь alertPage>1 не покрыт e2e; сохранено байт-в-байт по мандату плана

**File:** `apps/web/app/internal/operations/overview-request.ts:8` (call sites: `page.tsx:51,61`, `alerts-block.tsx:187-189`)
**Issue:** Хелпер добавляет `alertPage=${alertPage}` без проверки, что `query` уже содержит этот параметр. Реальный путь: пагинация алертов строит ссылки `?…&alertPage=2` из `window.location.search` (`alerts-block.tsx:187-189`) → после перехода `query` (page.tsx:51) уже содержит `alertPage=2`, memo даёт 2 → fetch-URL содержит `alertPage=2&alertPage=2`. Сегодня это доброкачественно: upstream лишь вайтлистит `alertPage`, не используя его (`operations.service.ts:189`; пагинация алертов режется клиентски в `AlertsBlock`), а продовый gateway подписывает фактические байты запроса (`security.mjs:42-45`), так что digest сходится. Более того, план 09-08 явно требует байт-в-байт воспроизведения прежней inline-семантики («extracted, not redesigned»), так что это не регрессия этого диффа, а ранее существовавшее поведение, закреплённое теперь в «едином источнике». Существенно другое: e2e-гард «signed set = sent set» верифицирован только для дефолтного `alertPage=1` (оба вызова spec, строки 36 и 54); навигационный путь `alertPage>1` (реальный клик по пагинации) автоматизированного гарда не имеет — остаточная поверхность того же drift-класса, что WR-09.
**Fix:** Либо в хелпере заменять/вырезать уже присутствующий `alertPage` (единая каноническая форма), либо задокументировать инвариант «query не должен содержать alertPage» в комментарии модуля. Плюс дешёвый e2e-кейс: навигация на `?page=1&pageSize=25&windowHours=24&alertPage=2` с подписью `overviewFetchSearch(search, 2)`.

## Standing Findings (carried forward, unchanged)

Перенесены из 09-REVIEW-DISPOSITION.md (2026-11-14); все остаются `open` и не опровергнуты этим диффом. Прямо перепроверены в этом проходе (файлы скоупа/смежные): IN-06, IN-07, IN-09 — подтверждено, что всё ещё присутствуют. Остальные живут в файлах вне скоупа этого прохода (worker/api/прочие тесты) и перенесены как есть, без повторной верификации.

| ID | Severity | Статус | Примечание этого прохода |
|----|----------|--------|--------------------------|
| WR-08 | warning | open | Интеграционный тест отпечатков: PID-суффикс без очистки БД (файл вне скоупа) |
| WR-03 | warning | open | Де-эскалация CRITICAL→WARNING уходит как alert_escalated (вне скоупа) |
| WR-04 | warning | open | Неограниченный Retry-After может заморозить evaluator (вне скоупа) |
| WR-05 | warning | open | Ключи ALERT_SIGNAL_LABELS не совпадают с фактическими сигналами (вне скоупа) |
| WR-06 | warning | open | Гонка acknowledge: RESOLVED-алерт может вернуться в ACKNOWLEDGED (вне скоупа) |
| WR-07 | warning | open | INFO в ALERT_SEVERITY_RANK — impossible-state guard (necessity) (вне скоупа) |
| WR-G1 | warning | open | Якорь навсегда OPEN/CRITICAL после удаления webhook (вне скоупа) |
| WR-G2 | warning | open | Повторный провал probe на ACKNOWLEDGED-якоре → OPEN без transition-строки, D-04 (вне скоупа) |
| WR-G3 | warning | open | Impossible-state guard: instanceof Redis/Queue в close(), main.ts:210-211 (вне скоупа) |
| IN-01 | info | open | Мёртвая константа MAX_TIMER_DELAY (вне скоупа) |
| IN-02 | info | open | Неиспользуемые поля inspector/state в scheduleDeliveryProbe (вне скоупа) |
| IN-03 | info | open | take: 100 без пагинации скрывает старые активные алерты (вне скоупа) |
| IN-04 | info | open | Гонка find→create в dedupUpsert роняет остаток тика (вне скоупа) |
| IN-06 | info | open | Зеркало сепаратора U+001F (`alerts-block.tsx:53`) — по-прежнему без теста инъективности; подтверждено в этом проходе |
| IN-07 | info | open | Мёртвое ожидание `waitForTimeout(100)` — по-прежнему в `operator-overview.spec.ts:58`; подтверждено в этом проходе |
| IN-08 | info | open | Контрабандный рестайл `<summary>` в фикс-коммите 0a03eeb (историческая запись) |
| IN-09 | info | open | Спред `ACK_CHIP` с ключом `dot` в style — по-прежнему в `alerts-block.tsx:142`; подтверждено в этом проходе |
| IN-G1 | info | open | Нецелочисленный статус HttpException в 5xx-числителе (вне скоупа) |
| IN-G2 | info | open | Мёртвый параметр runtime в хелпере runOneTick (вне скоупа) |

---

_Reviewed: 2026-11-16T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
