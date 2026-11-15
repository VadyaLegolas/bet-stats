---
status: complete
phase: 09-degradation-alerting
source: [09-VERIFICATION.md]
started: 2026-11-13T09:00:00Z
updated: 2026-11-15T00:03:00.548Z
---

## Current Test

[testing complete]

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
result: pass
note: "2026-11-14: агент выполнил два подряд живых тика evaluateAndDispatch против Docker PostgreSQL 18.6 + Redis + BullMQ (контейнеры healthy). Реальный dead letter: job добавлен в живую очередь bet-stats-sync-standard, съеден реальным работающим воркером. Тик 1 — WARNING поглощён flap-damping'ом (2 consecutive ticks, D-13); тик 2 — durable OpsAlert DEAD_LETTER/WARNING/OPEN создан в PostgreSQL с отпечатком DEAD_LETTER<U+001F>uat-dead-letter-probe/UAT — разделитель U+001F, NUL отсутствует (G-09-1 жив). Ошибок тика нет; webhook не настроен — deliveries пустые (честный channelState). Тик авто-разрешил legacy-якоря (RESOLVED + immutable transition). Очистка: синтетический job удалён из failed set, 2 синтетических OPEN-алерта разрешены честным путём (status+transition), временные скрипты удалены. TTL http5xx-ключей: 0 ключей (счётчики истекли; предмет теста 7)."
evidence: "evaluateAndDispatch × 2, OpsAlert rows + OpsAlertTransition rows read back via Prisma, fingerprints verified containsNUL=false separatorIsUS=true"

### 6. Финальное визуальное подтверждение reflow: zoom 200% @ 320px (G-09-2) + визуальная проверка operations center
expected: Запустить `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts` (owned release stack), затем визуально: 320px/zoom 200% — нет горизонтального скролла, theme-toggle ≥ 44px, ack через фейковый HMAC-прокси, ack-конфирм. e2e-тест 'html zoom 200% at 320px reflows without horizontal scroll (G-09-2)' зелёный; desktop/mobile прогоны зелёные; в живом тёмном THEME подтверждение, ничего не сломалось.
result: pass
note: "2026-11-14: формальный e2e на owned release stack (live-release-stack: docker PG/Redis, API :3241, web `next start` :3240) — 'html zoom 200% at 320px reflows without horizontal scroll (G-09-2)' ЗЕЛЁНЫЙ в обоих проектах (desktop-chromium + mobile-chromium, 2 passed, 1.6m); спека содержит единственный тест, поэтому прогоны полные. Живая визуальная проверка в реальном Chrome (operator-gateway :8080, тёмная тема активна, authenticated operator): 320px/zoom 200% — scrollWidth−clientWidth = 0 (горизонтального скролла нет, фикс G-09-2 жив на dev-стеке), theme-toggle 88×88 CSS px в zoom 200% (базовые 44px ≥ 44px), квота-блок рендерится с живыми данными (0/100, сброс через ~10 ч), все 8 секций operations center на месте, данные загружаются (51 запрос, 0 сетевых отказов), честное состояние «Активных алертов нет» (после очистки UAT-проб), «Канал доставки: не настроен», «Решённые за 7 дней · 19 алертов» (включая разрешённый UAT DEAD_LETTER-проб). ack-раундтрип: на живой странице OPEN-алертов нет (кнопок ack нет — честно), ack-флоу подтверждён ранее (тест 2 прошлого раунда: клавиатурный ack, фокус на маркере, transition OPEN→ACKNOWLEDGED в БД) и интеграционными тестами (34/34, тест 4). Скриншот uat6-zoom-200-320px.png."
evidence: "playwright.phase06.config.ts run: 2 passed (desktop+mobile); live Chrome via browse relay: zoomDiff=0, toggle 88x88, quota block live data, dark theme, network 51 req/0 failures; screenshot uat6-zoom-200-320px.png"

### 7. Живые Redis-счётчики 5xx (carried; повторное подтверждение)
expected: На живом стеке вызвать заведомо ошибочные запросы и проверить ключи bet-stats:http5xx:*/httpTotal:*: рост с минутным индексом, TTL 420s, сырые 500-ответы (и null-status, WR-01) увеличивают http5xx.
result: pass
note: "2026-11-14/15: финальное живое переподтверждение после плана 09-07. Реальный трафик против живого API (:3001, 200-ответы через Http5xxBucketFilter): burst 1 (2026-11-14) — 8 ключей bet-stats:httpTotal:* с последовательными минутными индексами; burst 2 (2026-11-15, через минутную границу) — новые последовательные ключи 29911680..29911682, TTL свежего бакета 418s ≈ 420s (WR-02 подтверждён живьём), TTL соседних минут 311/371/418 — ровно +60s между бакетами, значения совпадают с числом запросов (val=5 после 5 запросов). http5xx-ключей 0 — в окне нет 500-ответов (честное состояние); WR-01 (сырые 500 и null-status увеличивают http5xx) остаётся покрытым юнит-тестами (5/5) и mirror-тестом, живая инъекция детерминированного 500 невозможна без нарушения целостности dev-стека — как в принятом прогоне теста 3 (2026-11-13, TTL 403-413s)."
evidence: "docker exec redis-cli: --scan bet-stats:httpTotal:* sequential minute keys, ttl 311/371/418 (fresh 418s vs WR-02 420s), val matches request count; http5xx scan empty"

## Summary

total: 7
passed: 5
issues: 2
pending: 0
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
