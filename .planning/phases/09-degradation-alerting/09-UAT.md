---
status: testing
phase: 09-degradation-alerting
source: [09-VERIFICATION.md]
started: 2026-11-13T09:00:00Z
updated: 2026-11-13T09:00:00Z
---

## Current Test

number: 1
name: Живой тик evaluator'а (behavior_unverified, унаследован; proxy-тесты приняты)
expected: |
  При ALERTS_ENABLED=true (опционально ALERT_WEBHOOK_URL) и перезапуске воркера: тик
  выполняется по интервалу; алерты (OpsAlert/OpsAlertDelivery) пишутся в PostgreSQL;
  channelState честный; TTL живых ключей bet-stats:http5xx:* = 420s (после WR-02).
awaiting: user response

## Tests

### 1. Живой тик evaluator'а (behavior_unverified, унаследован; proxy-тесты приняты)
expected: Тик по интервалу; алерты пишутся в PostgreSQL; channelState честный.
result: [pending]

### 2. Визуальная/интерактивная адекватность блока «Алерты»
expected: Открыть /internal/operations: светлая/тёмная тема, 320px, zoom 200%, клавиатурный ack с фокусом на маркере, живой ack-раундтрип. Чипы с текстом, reflow без горизонтали, маркер «Подтверждён» после ack.
result: [pending]

### 3. Живые Redis-счётчики 5xx
expected: На живом стеке вызвать заведомо ошибочные запросы и проверить ключи bet-stats:http5xx:*/httpTotal:*: ключи растут с минутным индексом, TTL 420s, сырые 500-ответы тоже увеличивают http5xx (WR-01).
result: [pending]

### 4. Интеграционные тесты на реальном PostgreSQL
expected: `tests/integration/alerts.test.ts` (9 кейсов: mutation-rejection триггеров, дедуп-конвергенция, ack-идемпотентность) и `operator-overview.test.ts` зелёные в окружении с DATABASE_URL+Docker.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
