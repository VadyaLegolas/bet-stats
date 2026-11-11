---
phase: 09-degradation-alerting
reviewed: 2026-11-11T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - packages/database/prisma/schema.prisma
  - packages/database/prisma/migrations/20261108_phase09_ops_alerts/migration.sql
  - packages/database/src/generated/prisma/models.ts
  - packages/database/src/generated/prisma/client.ts
  - packages/database/src/generated/prisma/models/OpsAlert.ts
  - packages/database/src/generated/prisma/models/OpsAlertTransition.ts
  - packages/database/src/generated/prisma/models/OpsAlertDelivery.ts
  - workers/data-sync/src/jobs/alerts.ts
  - workers/data-sync/src/jobs/delivery-probe.ts
  - workers/data-sync/src/main.ts
  - apps/api/src/main.ts
  - apps/api/src/modules/operations/http-5xx-bucket.filter.ts
  - apps/api/src/modules/operations/operations.service.ts
  - apps/api/src/modules/operations/operations.controller.ts
  - packages/config/src/index.ts
  - apps/web/app/internal/operations/alerts-block.tsx
  - apps/web/app/internal/operations/page.tsx
  - apps/web/components/enum-labels.ts
  - tests/integration/alerts.test.ts
  - tests/integration/operator-overview.test.ts
  - tests/unit/alerts-signals.test.ts
  - tests/unit/alerts-dispatch.test.ts
  - tests/unit/alerts-delivery-probe.test.ts
  - tests/unit/alerts-5xx-filter.test.ts
  - apps/web/app/internal/operations/alerts-block.test.ts
findings:
  critical: 2
  warning: 7
  info: 5
  total: 14
  necessity: 1
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-11-11
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Просмотрены все файлы фазы 09 на глубине standard: схема/миграция OpsAlert*, адаптеры сигналов и evaluator (`workers/data-sync`), сборка 5xx-бакетов в API, read-model + acknowledge, конфиг алертов, блок «Алерты» на `/internal/operations` и весь набор тестов. Сгенерированные файлы Prisma просмотрены бегло (источник истины — `schema.prisma`).

Общая оценка: ядро фазы сделано добротно — DB-триггеры иммутабельности корректны и покрыты интеграционными тестами, дедуп/флап-демпфирование/anti-fatigue диспатч соответствуют D-04/D-05, санитизация read-model (T-09-09) и typed-allowlist webhook-полезной нагрузки (T-09-04) подтверждены. Угрозы T-09-01..T-09-03, T-09-05..T-09-09 по видимым файлам подтверждаются.

Однако найдены два критических дефекта связки (wiring), которые тесты не ловят, потому что оба живут на стыке модулей: (1) в production-сборке `startAlertingRuntime` создаёт BullMQ-очередь для dead-letter inspector, но не передаёт его в `scheduleAlertingTick` — сигнал `DEAD_LETTER` никогда не вычисляется; (2) авто-резолюция evaluator'а гасит CRITICAL-самоалерт `DELIVERY_HEALTH` в течение одного тика (≤5 минут) после отказа канала, что противоречит контракту D-13 «сломанный канал алертит через durable-состояние PostgreSQL». Также: 5xx-счётчик пропускает необработанные исключения (самый важный класс 5xx), TTL бакетов 120s делает заявленное 5-минутное окно фактически ≤3-минутным, де-эскалация серьёзности отправляется как `alert_escalated`, а словарь русских меток сигналов ключами `SYNC_RUN`/`WORKER_JOBS` не совпадает с фактическими сигналами `SYNC_FAILURES`/`DEAD_LETTER`.

Решения, задокументированные в SUMMARY (жёсткий CRITICAL-порог 5xx при ratio ≥ 0.5, dead-letter CRITICAL по блокирующим root cause, RESOLVED-якорь `DELIVERY_HEALTH`, acknowledge на уровне view) — в коде соблюдены; противоречие найдено только для поведения авто-резолюции probe-алерта (CR-02).

Справочник necessity-review.md прочитан; необходимость (necessity) оценена на стандартной глубине.

## Critical Issues

### CR-01: Dead-letter inspector создаётся, но не передаётся в планировщик — сигнал `DEAD_LETTER` никогда не срабатывает в production

**Файл:** `workers/data-sync/src/main.ts:163-171`
**Issue:** В `startAlertingRuntime` создаётся очередь `const inspector = new Queue(standardQueue(input.prefix), ...)` ровно для того, чтобы evaluator читал BullMQ failed set. Но в вызове `scheduleAlertingTick({ database, redis, intervalMs, webhookConfig, onError, log })` ключ `inspector` отсутствует. Внутри `evaluateAndDispatch` (`workers/data-sync/src/jobs/alerts.ts:523`) при `options.inspector ?? null === null` ветка `evaluateDeadLetters` пропускается: `options.inspector ? evaluateDeadLetters(...) : Promise.resolve([])`. Очередь при этом открывается, держит Redis-соединение и закрывается в `close()` (строка 189), ни разу не использовавшись. Итог: мёртвые письма (включая CRITICAL по блокирующим root cause, D-03) не порождают алертов вовсе, а тесты этого не видят, потому что `inspector` передаётся только в тестах. Противоречит заявленному «six signal adapters» в контракте фазы.
**Fix:**
```ts
const scheduler = scheduleAlertingTick({
  database,
  redis,
  intervalMs: config.tickMs ?? DEFAULT_ALERTS_TICK_MS,
  webhookConfig,
  onError: (error) => log({ event: "alerts.tick_failed", error: error instanceof Error ? error.message : "UNKNOWN" }),
  log,
  inspector, // было создано, но не передано
});
```
И добавить тест уровня композиции (`startAlertingRuntime` с фейковой очередью), проверяющий, что `getFailed` вызывается в тике.

### CR-02: Evaluator авто-разрешает CRITICAL-алерт `DELIVERY_HEALTH` в течение одного тика — самооповещение об отказе канала доставки гасится, пока канал всё ещё сломан

**Файл:** `workers/data-sync/src/jobs/alerts.ts:399-409` (взаимодействие с `workers/data-sync/src/jobs/delivery-probe.ts:96-114`)
**Issue:** При провале недельного probe (`runDeliveryProbe`) якорная запись переводится в `OPEN`/`CRITICAL` с переходом `RESOLVED → OPEN` (D-13: «a broken channel must alert through the durable PostgreSQL state»). Но `resolveClearedAlerts` в каждом тике evaluator'а разрешает все `OPEN`/`ACKNOWLEDGED`-алерты, чей fingerprint не входит в текущий набор сработавших адаптеров. Fingerprint `DELIVERY_HEALTH\0synthetic` не порождается ни одним адаптером, поэтому в ближайший тик (≤ `DEFAULT_ALERTS_TICK_MS` = 5 минут, а probe и evaluator живут в одном процессе `startAlertingRuntime`) CRITICAL-алерт переводится в `RESOLVED` с переходом `OPEN → RESOLVED`. До следующего probe 7 дней спустя алерт о сломанном канале числится решённым. Это противоречит документированному решению D-13/SUMMARY; тесты проходят, потому что `alerts-signals.test.ts` и `alerts-delivery-probe.test.ts` проверяют модули изолированно. Частично картину маскирует только блок `channelState` в UI (последняя неудачная доставка), но жизненный цикл алерта неверен.
**Fix:** Исключить probe-якорь из авто-резолюции, например по сигналу:
```ts
const open = await database.opsAlert.findMany({
  where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, signal: { not: "DELIVERY_HEALTH" } },
  select: { id: true, status: true, severity: true, dedupFingerprint: true },
});
```
(или резолвить его только из `runDeliveryProbe` на успехе), и добавить кросс-тест: probe-провал → тик evaluator'а → алерт остаётся `OPEN`.

## Warnings

### WR-01: `Http5xxBucketFilter` не считает необработанные исключения — самый важный класс 5xx не попадает в числитель

**Файл:** `apps/api/src/modules/operations/http-5xx-bucket.filter.ts:45-67`
**Issue:** `exceptionStatus` возвращает `null` для любого не-`HttpException`. Но `BaseExceptionFilter` для «сырых» `Error` (самая частая причина 5xx — необработанное исключение) сам отвечает клиенту 500 «Internal server error» (собственный тест на строке 76 это фиксирует). В результате: знаменатель (`httpTotal`) считает все запросы, а числитель (`http5xx`) — только `HttpException` со статусом ≥ 500._ratio систематически занижается именно там, где всё хуже всего; при всплеске необработанных ошибок сигнал `HTTP_5XX` (D-09) может не сработать вовсе. Комментарий «Catches every exception, and for status >= 500 increments» не соответствует поведению.
**Fix:**
```ts
override catch(exception: unknown, host: ArgumentsHost): void {
  const status = exceptionStatus(exception);
  if (status === null || status >= 500) recordMinuteBucket(this.buckets, HTTP5XX_BUCKET_PREFIX); // неизвестное исключение Nest рендерит как 500
  super.catch(exception, host);
}
```
и обновить тест «handles an exception without a status code» — он сейчас кодифицирует баг.

### WR-02: TTL бакетов 120s против 5-минутного окна чтения — бакеты минут −3 и −4 всегда истекли, фактическое окно ≤ 3 минуты

**Файлы:** `apps/api/src/modules/operations/http-5xx-bucket.filter.ts:6`, `workers/data-sync/src/jobs/alerts.ts:39,222-247`
**Issue:** `EXPIRE 120` обновляется при каждом `INCR` внутри минуты M, значит ключ минуты M исчезает не позднее начала минуты M+2. Evaluator читает смещения 0..4: в момент чтения T ключ M−4 гарантированно истёк (истекает ≤ начала M−1... максимум `start(M−2)+120 = start(M)−60 < T`), ключ M−3 истекает не позже `start(M)` ≤ T, ключ M−2 — лишь частично доступен. Итог: «rolling 5-minute window» (D-09) фактически — 2–3 минуты; `HTTP5XX_MIN_VOLUME = 10` применяется к урезанному знаменателю (чаще блокирует), `firstSeen` алерта лжёт о начале окна, а чувствительность ниже заявленной. Оба префикса согласованы между собой (пары читаются консистентно), но не с длиной окна.
**Fix:** Поднять `BUCKET_TTL_SECONDS` до длины окна с запасом (например, `HTTP5XX_WINDOW_MINUTES * 60 + 120 = 420`), оставить окно чтения 5; либо читать окно ≤ 2 минут и честно переименовать пороги. Добавить тест, фиксирующий, что бакет 4-минутной давности ещё учитывается.

### WR-03: Де-эскалация (CRITICAL → WARNING) классифицируется как «escalation» — вебхук `alert_escalated` с пониженной серьёзностью и вводящий в заблуждение переход

**Файл:** `workers/data-sync/src/jobs/alerts.ts:371-391,544`
**Issue:** `escalated = existing.severity !== evaluation.severity` — любое изменение серьёзности, включая понижение. Реальный сценарий: квота при `ratio ≥ 1` даёт CRITICAL, после естественного сброса (`ratio 0.85`) адаптер продолжает срабатывать с WARNING; для того же fingerprint `dedupUpsert` вернёт `action: "escalation"`, в БД запишется переход `severityFrom: CRITICAL → severityTo: WARNING`, а оператору уйдёт `alert_escalated` с `severity: "WARNING"` — событие, семантика которого обратна происходящему. Отдельного события понижения нет (и, возможно, не нужно), но текущая классификация некорректна.
**Fix:**
```ts
const escalated = evaluation.severity === "CRITICAL" && existing.severity !== "CRITICAL";
const deEscalated = evaluation.severity === "WARNING" && existing.severity === "CRITICAL";
```
При де-эскалации обновлять серьёзность на месте без вебхука (и без перехода-«эскалации»); при необходимости завести отдельный тип перехода.

### WR-04: Неограниченный `Retry-After` от вебхука способен остановить evaluator на часы

**Файл:** `workers/data-sync/src/jobs/alerts.ts:476-489`
**Issue:** При 429 значение `Retry-After` (секунды) умножается на 1000 и используется как пауза без верхней границы. `dispatchWebhook` вызывается последовательно внутри `await`-цикла по всем actionable-алертам одного тика, а сам тик — self-closing: следующий стартует только после завершения. Ответ `Retry-After: 86400` (или 3600) от зависшего/злонамеренного вебхука заморозит обработку всех последующих алертов и весь цикл оценки на срок до суток. `AbortSignal.timeout` ограничивает только сам HTTP-запрос, не паузу.
**Fix:** Ограничить сверху, например: `const backoff = Math.min(retryAfterMs ?? ..., 60_000)` — при превышении лимита полагаться на обычный экспоненциальный backoff; задокументировать кламп.

### WR-05: Ключи `ALERT_SIGNAL_LABELS` не совпадают с фактическими сигналами — русские метки для `SYNC_FAILURES` и `DEAD_LETTER` никогда не рендерятся

**Файл:** `apps/web/components/enum-labels.ts:35`
**Issue:** Адаптеры порождают сигналы `SYNC_FAILURES` (`workers/data-sync/src/jobs/alerts.ts:163`) и `DEAD_LETTER` (`alerts.ts:198`). Словарь же содержит `SYNC_RUN: "Сбой синхронизации"` и `WORKER_JOBS: "Групповые сбои задач и мёртвые письма"` — таких кодов ни один адаптер не производит. Из-за `?? signal` в `alertSignalLabel` UI молча показывает сырые коды, а тест `alerts-block.test.ts:113-114` проверяет метки на синтетических данных (`SYNC_RUN`, `WORKER_JOBS`), не сверяясь с产出 адаптеров — рассинхрон незаметен.
**Fix:**
```ts
export const ALERT_SIGNAL_LABELS: Record<string, string> = { ..., SYNC_FAILURES: "Сбой синхронизации", DEAD_LETTER: "Групповые сбои задач и мёртвые письма", ... };
```
Убрать/переименовать `SYNC_RUN`/`WORKER_JOBS` и в тесте импортировать коды сигналов (или сверять с константами из `alerts.ts`), чтобы словарь не мог разъехаться с адаптерами.

### WR-06: Гонка acknowledge: `updateMany` без проверки статуса может перевести RESOLVED-алерт обратно в ACKNOWLEDGED

**Файл:** `apps/api/src/modules/operations/operations.service.ts:395-405`
**Issue:** Сервис читает алерт (`status === "OPEN"`), затем evaluator параллельно выполняет авто-резолюцию (`status → RESOLVED, resolvedAt = now`), затем транзакция acknowledge выполняет `updateMany({ where: { id, acknowledgedAt: null }, data: { status: "ACKNOWLEDGED", acknowledgedAt } })`. Guard проверяет только `acknowledgedAt`, поэтому RESOLVED-строка матчится: алерт становится `ACKNOWLEDGED` с непустым `resolvedAt` — противоречивое состояние (в UI попадает в «Активные», но с resolvedAt), плюс переход `OPEN → ACKNOWLEDGED`, не соответствующий фактической истории.
**Fix:** Включить статус в guard и в условие: `where: { id: alertId, acknowledgedAt: null, status: "OPEN" }` — при `updated.count === 0` повторно прочитать строку и вернуть идемпотентный результат.

### WR-07: Impossible-state guard — элемент `INFO` в `ALERT_SEVERITY_RANK` защищает от невозможного значения

**Файл:** `apps/api/src/modules/operations/operations.service.ts:58`
**Категория:** necessity
**Issue:** `ALERT_SEVERITY_RANK` содержит `INFO: 1`, но CHECK-констрейнт миграции (`migration.sql:11`: `severity IN ('CRITICAL','WARNING')`) исключает любые другие значения в таблице, а других писателей в `OpsAlert` в репозитории нет — состояние `severity = 'INFO'` не может возникнуть. Сортировка с рангом 0 для «неизвестных» уже покрыта fallback `?? 0`. (Подтип: impossible-state guard.)
**Fix:** Убрать элемент `INFO` из map, оставив `{ CRITICAL: 3, WARNING: 2 }` и fallback `?? 0`; инвариант CHECK-констрейнта зафиксировать комментарием у map.

## Info

### IN-01: Мёртвая константа `MAX_TIMER_DELAY` в alerts.ts

**Файл:** `workers/data-sync/src/jobs/alerts.ts:574`
**Issue:** `const MAX_TIMER_DELAY = 2 ** 31 - 1;` объявлена и не используется в этом модуле (кламппинг применён только в `delivery-probe.ts:162`); `scheduleAlertingTick` ставит таймер с сырым `input.intervalMs` без кламппинга.
**Fix:** Либо удалить константу, либо применить `Math.min(MAX_TIMER_DELAY, input.intervalMs)` при постановке таймера — единообразно с `scheduleDeliveryProbe`.

### IN-02: Неиспользуемые поля `inspector`/`state` во входном типе `scheduleDeliveryProbe`

**Файл:** `workers/data-sync/src/jobs/delivery-probe.ts:136-137`
**Issue:** Тип входа объявляет `inspector?: DeadLetterInspector | null` и `state?: WarningTickState`, но тело функции к ним не обращается — мёртвые параметры, наводящие на мысль о несуществующей связи probe'а с dead-letter/флап-состоянием (в `startAlertingRuntime` они, соответственно, тоже не передаются).
**Fix:** Удалить оба поля из типа входа.

### IN-03: Read-model алертов: `take: 100` для активных без пагинации молча скрывает старые активные алерты

**Файл:** `apps/api/src/modules/operations/operations.service.ts:300-301`
**Issue:** Активные алерты берутся `take: 100` по `lastSeen desc`; при более чем 100 активных самые старые не попадают в overview ни в каком виде (пагинация на UI работает только по уже выбранным 100+100 строкам). Для операторского экрана это тихая слепая зона при лавине алертов.
**Fix:** Минимум — вернуть в полезную нагрузку признак усечения (например, `alertsTruncated: true` при достижении лимита), чтобы UI мог показать «показаны не все»; либо поднять лимит с пагинацией на стороне API.

### IN-04: Гонка `dedupUpsert` (find → create) роняет весь остаток тика при нарушении уникальности

**Файл:** `workers/data-sync/src/jobs/alerts.ts:349-369,540-543`
**Issue:** При конкурентном тике (например, два экземпляра воркера) оба вызова `findUnique` могут вернуть `null`, оба — `create`; второй упадёт по `dedupFingerprint` unique. Исключение выбрасывается из последовательного `await`-цикла `for (const evaluation of actionable)`, поэтому алерты после сбойного в этом тике не обрабатываются вовсе (тик-level catch лишь логирует). Вероятность мала, но цена — пропущенный тик алертинга.
**Fix:** Обернуть тело цикла в per-alert `try/catch` (логировать и продолжать) и/или обрабатывать unique-violation через повторный upsert; в Prisma — `create` с catch на `P2002` → повторный `update`.

### IN-05: Успешный probe не разрешает якорь в статусе ACKNOWLEDGED

**Файл:** `workers/data-sync/src/jobs/delivery-probe.ts:90-93`
**Issue:** На успехе probe разрешает якорь только при `status === "OPEN"`. Если оператор успел подтвердить алерт (acknowledge работает и для OPEN-якоря), после восстановления канала якорь останется `ACKNOWLEDGED` с непустым `resolvedAt = null`, пока его не разрешит evaluator (что для `DELIVERY_HEALTH` и так происходит — см. CR-02; после исправления CR-02 строка зависнет в `ACKNOWLEDGED` до следующего провала).
**Fix:** На успехе разрешать якорь при `status !== "RESOLVED"` (OPEN и ACKNOWLEDGED), записывая корректный переход.

---

_Reviewed: 2026-11-11_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
