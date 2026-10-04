---
phase: 06-release-experience-and-operations
reviewed: 2026-09-27T10:23:09Z
depth: standard
files_reviewed: 42
files_reviewed_list:
  - apps/api/src/modules/operations/operations.service.ts
  - apps/api/src/modules/privacy/privacy.service.ts
  - apps/web/app/internal-api/privacy/[[...path]]/route.test.ts
  - apps/web/app/internal-api/privacy/[[...path]]/route.ts
  - apps/web/package.json
  - apps/web/vitest.config.ts
  - package.json
  - packages/database/prisma/migrations/20260924_retained_view_bounds/migration.sql
  - packages/database/prisma/migrations/20260924_retention_purge_audit/migration.sql
  - packages/database/prisma/schema.prisma
  - scripts/verify-release-integration.mjs
  - tests/e2e/live-provider-stack.ts
  - tests/e2e/live-release-stack.ts
  - tests/e2e/privacy-retention.spec.ts
  - tests/e2e/release-accessibility.spec.ts
  - tests/e2e/release-degradation.spec.ts
  - tests/e2e/release-journey.spec.ts
  - tests/integration/backtest-production.test.ts
  - tests/integration/evidence-publication.test.ts
  - tests/integration/forecast-scoring.test.ts
  - tests/integration/migration-empty.test.ts
  - tests/integration/operator-overview.test.ts
  - tests/integration/phase-04-security.test.ts
  - tests/integration/privacy-retention.test.ts
  - tests/integration/provider-capability.test.ts
  - tests/integration/provider-fallback-identity.test.ts
  - tests/integration/provider-routing.test.ts
  - tests/integration/replay-crash-recovery.test.ts
  - tests/integration/replay-lease-upgrade.test.ts
  - tests/integration/replay.test.ts
  - tests/integration/review.test.ts
  - tests/integration/settlement-pipeline.test.ts
  - tests/integration/settlement.test.ts
  - tests/integration/temporal-provenance.test.ts
  - tests/integration/value-settlement.test.ts
  - tests/unit/privacy-consent-retry.test.ts
  - tests/unit/privacy-proxy-assertion.test.ts
  - tests/unit/privacy-retained-view-input.test.ts
  - tests/unit/release-db-lifecycle.test.ts
  - tests/unit/retention-purge-scheduler.test.ts
  - workers/data-sync/src/jobs/retention-purge.ts
  - workers/data-sync/src/main.ts
findings:
  critical: 3
  warning: 5
  info: 0
  total: 8
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-09-27T10:23:09Z
**Depth:** standard
**Files Reviewed:** 42
**Status:** issues_found

## Summary

Проверены девять summary Phase 06, исходники и тесты, изменённые после предыдущего review от 2026-09-24, и текущие изменения release integration gate. Planning-документы, логи и сгенерированный apps/web/next-env.d.ts исключены. Найдены 3 BLOCKER и 5 WARNING: три риска в сроках и удалении retention-данных и пять пробелов в проверках release/security gate. Исходники не изменялись; тесты не запускались.

## Narrative Findings (AI reviewer)

### Critical Issues

#### CR-01: Длительный retention timer запускает purge почти каждую миллисекунду

**Classification:** BLOCKER
**File:** workers/data-sync/src/jobs/retention-purge.ts:52-53
**Issue:** delay напрямую равен разнице между expiresAt и текущим временем. Для стандартного 30-дневного срока retention эта задержка превышает лимит Node.js setTimeout (2 147 483 647 мс); Node.js преобразует большее значение в 1 мс. Callback сразу выполняет purge, затем arm() снова выставляет тот же дальний срок и снова получает 1 мс. В итоге scheduler генерирует непрерывные запросы к БД и записи RetentionPurgeAudit задолго до истечения срока, создавая риск исчерпания БД. См. [документацию Node.js timers](https://nodejs.org/download/release/v24.1.0/docs/api/timers.html).
**Fix:** Ограничивать один таймер максимальной поддерживаемой задержкой и после его срабатывания пересчитывать остаток срока; вызывать purge только когда срок действительно наступил.

#### CR-02: Ошибка первого запроса scheduler оставляет retention purge навсегда выключенным

**Classification:** BLOCKER
**File:** workers/data-sync/src/jobs/retention-purge.ts:46-53,65; workers/data-sync/src/main.ts:61
**Issue:** Стартовый arm() запущен как void arm().catch(input.onError). Если запрос минимального expiresAt не проходит при старте из-за временной недоступности БД, onError только пишет лог, таймер не создаётся, а следующий запрос больше не планируется. Recovery-таймер есть только в run() (строки 59-62), который до первого успешного arm() вызван не будет; просроченные персональные записи поэтому могут сохраняться бессрочно.
**Fix:** Переводить и стартовую ошибку arm() в тот же ограниченный retry-механизм, что и ошибку во время run(), с повторным запросом БД после retryMs.

#### CR-03: Миграционный quarantine бессрочно сохраняет идентифицируемую privacy-историю

**Classification:** BLOCKER
**File:** packages/database/prisma/migrations/20260924_retained_view_bounds/migration.sql:5-23
**Issue:** Для неканонической записи миграция копирует в RetentionMigrationQuarantine.payload subjectId, consentId, resourceId и временные поля, затем удаляет её из RetainedViewHistory. Quarantine-таблица не описана в Prisma schema и не обрабатывается ни withdrawal в apps/api/src/modules/privacy/privacy.service.ts:117-120, ни expiry purge в workers/data-sync/src/jobs/retention-purge.ts:11-20; значит, связанные с субъектом данные остаются без срока удаления и переживают отзыв согласия.
**Fix:** Не сохранять в quarantine прямые идентификаторы и содержимое связанной истории: оставить только обезличенные сведения для аудита. Если строковая трассировка необходима, добавить явный короткий срок хранения и удаление по субъекту при withdrawal/purge.

### Warnings

#### WR-01: Проверка recovery сравнивает данные сразу после постановки задания в очередь

**Classification:** WARNING
**File:** tests/e2e/release-degradation.spec.ts:89-105
**Issue:** После ответа queue endpoint тест немедленно сравнивает immutable() с исходным значением; он не ждёт терминального состояния replay-плана. BullMQ обрабатывает работу асинхронно, поэтому проверка может пройти до её выполнения и не заметить последующую мутацию. К тому же snapshot включает только ForecastSnapshot и ValueReceipt, хотя preview обещает неизменность observations, issued forecasts, results, value receipts и settlements.
**Fix:** Опросить план до терминального состояния, затем сравнить все типы данных, указанные в immutableGuarantees.

#### WR-02: Тест quota/open circuit не проходит через production admission и не проверяет видимость

**Classification:** WARNING
**File:** tests/e2e/release-degradation.spec.ts:33-40
**Issue:** Несмотря на название про исчерпание quota, тест вызывает только executeProviderCall с локальным circuitState: OPEN и не передаёт reserve; quota guard и production provider-admission путь не исполняются. После этого открывается страница, но не проверяется отображение circuit/quota-состояния. Gate останется зелёным даже при нарушении production admission или неверной UI-деградации.
**Fix:** Проверять реальный ingestion/admission boundary с сохранёнными circuit/quota состояниями: подтвердить блокировку внешнего вызова, отсутствие расхода бюджета и видимый безопасный статус.

#### WR-03: Проверка invalid envelope не доказывает quarantine на ingestion boundary

**Classification:** WARNING
**File:** tests/e2e/release-degradation.spec.ts:42-53
**Issue:** Тест вызывает ApiFootballClient.fetchFixtures() напрямую, ожидает ошибку classification: quarantine и сверяет только число fixtures. Он не запускает ingestion runner/admission и не проверяет состояние quarantine/attempt в БД, поэтому не обнаружит ошибку, при которой production-путь публикует или неверно классифицирует отвергнутый ответ.
**Fix:** Провести malformed envelope через production ingestion flow и проверить durable quarantine/attempt outcome, неизменность canonical facts и отсутствие утечки сырого payload.

#### WR-04: Live release journey перестанет находить свой fixture после 2026-12-24

**Classification:** WARNING
**File:** tests/e2e/release-journey.spec.ts:80-84; tests/e2e/live-release-stack.ts:51-65
**Issue:** Fixture перед тестом получает kickoff Date.now() + 7 дней, но scorecard query всегда заканчивается 2027-01-01T00:00:00Z. Начиная с 2026-12-25 kickoff окажется за пределом запроса, fixture выпадет из scorecard и ожидаемый denominator fixtureCount: 1 сломает release gate.
**Fix:** Строить конец диапазона от возвращённого kickoffUtc с запасом либо использовать скользящее окно, которое гарантированно включает тестовый fixture.

#### WR-05: После удаления теста HMAC assertion не осталось проверки binding и защиты от replay

**Classification:** WARNING
**File:** apps/web/app/internal-api/privacy/[[...path]]/route.test.ts:1-32; tests/e2e/privacy-retention.spec.ts:74-93
**Issue:** Новый unit suite проверяет выдачу и валидацию privacy-session cookie и соответствие субъектов, а E2E — retired/cross-subject session. Удалённый tests/unit/privacy-proxy-assertion.test.ts проверял подпись assertion с привязкой к method/path/body и однократное использование nonce; эти критичные случаи в новом наборе не воспроизведены, поэтому регрессия подписи или replay-защиты может пройти gate.
**Fix:** Восстановить unit-регрессии для tampered method/path/body, canonical body и повторного nonce, проверяя отказ backend до обработки запроса.

---

_Reviewed: 2026-09-27T10:23:09Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
