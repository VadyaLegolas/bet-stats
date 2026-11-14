---
status: testing
phase: 09-degradation-alerting
source: [09-VERIFICATION.md]
started: 2026-11-13T09:00:00Z
updated: 2026-11-14T15:00:00Z
---

## Current Test

number: 5
name: Живой тик evaluator'а (ре-верификация round 2; carried)
expected: |
  На работающем сервисе установить ALERTS_ENABLED=true (+ опционально ALERT_WEBHOOK_URL), сгенерировать отказ, подождать тик, проверить OpsAlert/OpsAlertDelivery в PostgreSQL и TTL ключа bet-stats:http5xx:* (ожидание: 420s после WR-02). Без ошибок выполнения; алерты появляются в PostgreSQL; channelState корректен.
awaiting: user response

## Tests

### 1. Живой тик evaluator'а (behavior_unverified, унаследован; proxy-тесты приняты)
expected: Тик по интервалу; алерты пишутся в PostgreSQL; channelState честный.
result: issue
reported: "Выполнено агентом (разовый тик evaluateAndDispatch против живых PostgreSQL+Redis без рестарта воркера). Тик выполняется, авто-resolve работает на живой БД (7 legacy-алертов переведены в RESOLVED с OpsAlertTransition), но дедуп-запись алерта падает: PostgreSQL 22021 «invalid byte sequence for encoding UTF8: 0x00» — alertFingerprint использует символ NUL (\\0) как разделитель, а TEXT-колонка dedupFingerprint хранить NUL не может. OpsAlert.create/findUnique всегда падает с реальным отпечатком; ни один алерт evaluator'а не может быть записан в PostgreSQL."
severity: blocker

### 2. Визуальная/интерактивная адекватность блока «Алерты»
expected: Открыть /internal/operations: светлая/тёмная тема, 320px, zoom 200%, клавиатурный ack с фокусом на маркере, живой ack-раундтрип. Чипы с текстом, reflow без горизонтали, маркер «Подтверждён» после ack.
result: issue
reported: "Выполнено агентом через реальный operator-gateway (Playwright, 320px). Пройдено: светлая/тёмная тема, чипы с текстом («Критично», «Предупреждение»), честная строка канала, 320px без горизонтали, клавиатурный ack, статус-сообщение, фокус на маркере «Подтверждён», живой ack-раундтрип с сохранением в БД (transition OPEN→ACKNOWLEDGED). Проблема: zoom 200% даёт горизонтальный скролл (scrollWidth 369 > 320) — разъезжаются release-header-tools/quota-counter/theme-toggle и секции (right до 369)."
severity: minor

### 3. Живые Redis-счётчики 5xx
expected: На живом стеке вызвать заведомо ошибочные запросы и проверить ключи bet-stats:http5xx:*/httpTotal:*: ключи растут с минутным индексом, TTL 420s, сырые 500-ответы тоже увеличивают http5xx (WR-01).
result: pass
note: "Агент на живом Redis: ключи bet-stats:httpTotal:* растут с минутным индексом (последовательные минуты, каждый val растёт), TTL 403-413s => WR-02 (420s) подтверждён на живом стеке. WR-01 (сырые 500 и null-status увеличивают http5xx): live-инъекция детерминированного 500 без нарушения целостности dev-стека невозможна — покрыто юнит-тестами (5/5) и межмодульным mirror-тестом; работающий процесс API доказанно несёт WR-02 (наблюдаемый TTL 420s) из того же модуля, что и WR-01."

### 4. Интеграционные тесты на реальном PostgreSQL
expected: `tests/integration/alerts.test.ts` (9 кейсов: mutation-rejection триггеров, дедуп-конвергенция, ack-идемпотентность) и `operator-overview.test.ts` зелёные в окружении с DATABASE_URL+Docker.
result: pass
note: "Агент: vitest --project integration на живом Docker-PostgreSQL 18.6 — 34/34 зелёные (alerts.test.ts + operator-overview.test.ts). Сид-фикстуры используют ASCII-отпечатки, NUL-путь evaluator'а (G-09-1) этими тестами не покрывается."

### 5. Живой тик evaluator'а (ре-верификация round 2; carried)
expected: На работающем сервисе установить ALERTS_ENABLED=true (+ опционально ALERT_WEBHOOK_URL), сгенерировать отказ, подождать тик, проверить OpsAlert/OpsAlertDelivery в PostgreSQL и TTL ключа bet-stats:http5xx:* (ожидание: 420s после WR-02).
result: pending
note: "Из 09-VERIFICATION.md (2026-11-14, re-verification): NUL-блокер G-09-1 закрыт с поведенческим доказательством — верификатор развернул owned PostgreSQL 18.6 (test:integration:docker, migrate deploy) и провёл roundtrip dedupUpsert с реальным U+001F-отпечатком: alerts-fingerprint 3/3, полный alert-набор 37/37. Остался живой тик в полном сервисе (интеграционный proxy-путь startAlertingRuntime не эвфемизирует PostgreSQL/Redis/BullMQ-соединение тика)."

### 6. Финальное визуальное подтверждение reflow: zoom 200% @ 320px (G-09-2) + визуальная проверка operations center
expected: Запустить `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts` (owned release stack), затем визуально: 320px/zoom 200% — нет горизонтального скролла, theme-toggle ≥ 44px, ack через фейковый HMAC-прокси, ack-конфирм. e2e-тест 'html zoom 200% at 320px reflows without horizontal scroll (G-09-2)' зелёный; desktop/mobile прогоны зелёные; в живом тёмном THEME подтверждение, ничего не сломалось.
result: pending
note: "Из 09-VERIFICATION.md (2026-11-14): единственный behavior-unverified truth (must-have 9) — e2e-кейс (operator-overview.spec.ts:48-62) и CSS-фикс (globals.css min-width:0 + overflow-wrap) на месте (presence VERIFIED), поведенческий прогон требует owned release stack."

### 7. Живые Redis-счётчики 5xx (carried; повторное подтверждение)
expected: На живом стеке вызвать заведомо ошибочные запросы и проверить ключи bet-stats:http5xx:*/httpTotal:*: рост с минутным индексом, TTL 420s, сырые 500-ответы (и null-status, WR-01) увеличивают http5xx.
result: pending
note: "Из 09-VERIFICATION.md (2026-11-14, re-verification): carried как human-пункт повторно. Предыдущий живой прогон (тест 3 ниже, 2026-11-13) подтвердил минутный индекс и TTL 403-413s; сырые 500 — покрыто юнит-тестами. Верификатор просит финальное живое переподтверждение после плана 09-07."

## Summary

total: 7
passed: 2
issues: 2
pending: 3
skipped: 0
blocked: 0

## Gaps

- gap_id: G-09-1
  truth: "Тик evaluator'а пишет алерты (OpsAlert) в PostgreSQL; дедуп-апсерт работает на живой БД"
  status: resolved
  reason: "Agent-performed live tick: PostgreSQL 22021 invalid byte sequence for encoding UTF8: 0x00 on OpsAlert.findUnique — alertFingerprint uses a NUL (\\0) separator, TEXT columns cannot store NUL; dedup upsert/create always fails with real fingerprints on real PostgreSQL"
  severity: blocker
  test: 1
  root_cause: "alertFingerprint (workers/data-sync/src/jobs/alerts.ts) строит отпечаток как `${signal}\\0${scope}` — строковый литерал NUL. PostgreSQL TEXT не может хранить NUL-байт: OpsAlert.create/findUnique/update по dedupFingerprint с реальным отпечатком всегда падает с 22021. Фейки в юнит-тестах и ASCII-сид-фикстуры интеграционных тестов путь не покрывают."
  artifacts:
    - path: "workers/data-sync/src/jobs/alerts.ts"
      issue: "alertFingerprint NUL separator (line ~66-68); влияет на dedupUpsert и resolveClearedAlerts"
    - path: "packages/database/prisma/migrations/20261108_phase09_ops_alerts/migration.sql"
      issue: "dedupFingerprint TEXT NOT NULL — не может хранить NUL по определению PostgreSQL"
  missing:
    - "Заменить NUL-разделитель на NUL-free separator (например, U+001F или составной формат), обновить alertFingerprint и все сравнения (UI dedup в alerts-block.tsx line 103 тоже использует \\0 — в памяти, но для консистентности), добавить интеграционный тест раундтрипа alertFingerprint на реальном PostgreSQL"
  debug_session: ""
  resolved_by: "09-07-PLAN.md"
  resolved_at: "2026-11-13"

- gap_id: G-09-2
  truth: "zoom 200% на /internal/operations: reflow без горизонтального скролла"
  status: resolved
  reason: "Agent-performed browser check: при html zoom 200% scrollWidth 369 > clientWidth 320; переполняют release-header-tools, quota-counter, theme-toggle (right 328) и header/H1/P/section блоки (right 369). На 100% на 320px горизонтальный скролл отсутствует."
  severity: minor
  test: 2
  root_cause: "Элементы шапки сайта (release-header-tools, quota-counter, theme-toggle) и внутренние секции не сжимаются при 200%-зуме на 320px: минимальные ширины/отступы дают ~49px горизонтального переполнения."
  artifacts:
    - path: "apps/web/app/internal/operations/page.tsx"
      issue: "секции с card-стилями (padding 20) и header переполняют 320px при zoom 200%"
  missing:
    - "Адаптивная правка шапки/секций для zoom 200% @ 320px (min-width сжатие, overflow-wrap, сжатие padding), e2e-проверка reflow при zoom"
  debug_session: ""
  resolved_by: "09-07-PLAN.md"
  resolved_at: "2026-11-13"
