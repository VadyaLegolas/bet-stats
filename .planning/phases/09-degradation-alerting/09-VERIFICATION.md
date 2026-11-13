---
phase: 09-degradation-alerting
verified: 2026-11-13T08:30:00Z
status: human_needed
score: 7/7 must-haves verified
covered_files: [".planning/phases/09-degradation-alerting/09-01-PLAN.md", ".planning/phases/09-degradation-alerting/09-01-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-02-PLAN.md", ".planning/phases/09-degradation-alerting/09-02-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-03-PLAN.md", ".planning/phases/09-degradation-alerting/09-03-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-04-PLAN.md", ".planning/phases/09-degradation-alerting/09-04-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-05-PLAN.md", ".planning/phases/09-degradation-alerting/09-05-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-06-PLAN.md", ".planning/phases/09-degradation-alerting/09-06-SUMMARY.md", "apps/api/src/main.ts", "apps/api/src/modules/operations/http-5xx-bucket.filter.ts", "apps/api/src/modules/operations/operations.controller.ts", "apps/api/src/modules/operations/operations.service.ts", "apps/web/app/internal/operations/alerts-block.test.ts", "apps/web/app/internal/operations/alerts-block.tsx", "apps/web/app/internal/operations/page.tsx", "apps/web/components/enum-labels.ts", "packages/config/src/index.ts", "packages/database/prisma/migrations/20261108_phase09_ops_alerts/migration.sql", "packages/database/prisma/schema.prisma", "tests/integration/alerts.test.ts", "tests/integration/operator-overview.test.ts", "tests/unit/alerts-5xx-filter.test.ts", "tests/unit/alerts-composition.test.ts", "tests/unit/alerts-delivery-probe.test.ts", "tests/unit/alerts-dispatch.test.ts", "tests/unit/alerts-signals.test.ts", "workers/data-sync/src/jobs/alerts.ts", "workers/data-sync/src/jobs/delivery-probe.ts", "workers/data-sync/src/main.ts"]
covered_digest: "v4:sha256:633429430b90444fb37395acd490917f69fcfc2d335ab19ead16d1b1a13ca316"
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/7
  gaps_closed:
    - "SC1: каждый настроенный сигнал деградации даёт durable-запись — dead-letter-сигнал ожил в production-композиции (CR-01 закрыт: inspector передан в scheduleAlertingTick, main.ts:187; композиционный тест прогоняет тик через startAlertingRuntime)"
    - "Plan 02: все шесть signal-адаптеров запускаются в тике (CR-01 закрыт — композиционный тест tests/unit/alerts-composition.test.ts доказывает вызов inspector.getFailed и durable OPEN/CRITICAL DEAD_LETTER-строку)"
    - "Plan 02: delivery-probe self-alert остаётся активным, пока канал сломан (CR-02 закрыт: resolveClearedAlerts исключает PROBE_ANCHOR_SIGNAL, alerts.ts:409; кросс-тест: якорь остаётся OPEN после тика, контрольный non-probe-алерт резолвится)"
    - "IN-05: успех probe разрешает якорь из OPEN и ACKNOWLEDGED с truthful-переходом (delivery-probe.ts:92-95; тест ACKNOWLEDGED→RESOLVED)"
    - "WR-01: сырые исключения считаются в 5xx-числитель (filter.ts:80 `status === null || status >= 500`; тест фиксирует и bucket-write, и неизменный ответ { statusCode: 500, message: \"Internal server error\" })"
    - "WR-02: BUCKET_TTL_SECONDS=420 покрывает 5-минутное окно чтения с запасом (обе expire-ассертции 420; кросс-модульный mirror-тест TTL ≥ window*60+60)"
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "WR-G1: якорь DELIVERY_HEALTH навсегда OPEN/CRITICAL, если после неудачного probe удалить ALERT_WEBHOOK_URL и перезапустить воркер (probe не вооружается, evaluator якорь исключил)"
    category: other
    reason: "Достижимый тупик жизненного цикла якоря после CR-02; осознанно открыт в 09-REVIEW-DISPOSITION.md — вне объёма closure по решению пользователя"
    evidence_status: "none provided"
  - finding: "WR-G2: повторный провал probe на ACKNOWLEDGED-якоре переводит его в OPEN без transition-строки и с висящим acknowledgedAt (смежный скоуп, блок существовал до closure)"
    category: other
    reason: "Осознанно открыт (смежный скоуп якорного цикла) в 09-REVIEW-DISPOSITION.md"
    evidence_status: "none provided"
  - finding: "WR-G3: невозможное состояние — instanceof Redis/Queue в close() недостижимо ложны (necessity)"
    category: other
    reason: "Безвредный guard; удаление — scope-решение человека, осознанно открыт"
    evidence_status: "none provided"
  - finding: "IN-G1: нецелочисленный статус HttpException (fractional) попадает в 5xx-числитель на посылке «null ⇒ 500», верной только для сырых исключений"
    category: other
    reason: "С contrived-случай; осознанно открыт в 09-REVIEW-DISPOSITION.md"
    evidence_status: "none provided"
  - finding: "IN-G2: мёртвый параметр runtime в хелпере runOneTick композиционного теста"
    category: other
    reason: "Косметика теста; осознанно открыт"
    evidence_status: "none provided"
behavior_unverified_items:
  - truth: "Evaluator tick реально работает в живом стеке (startAlertingRuntime с ALERTS_ENABLED=true против живых PostgreSQL/Redis/BullMQ)"
    test: "В удобный момент перезапустить воркер с ALERTS_ENABLED=true (+ опционально ALERT_WEBHOOK_URL), дождаться тика и проверить появление OpsAlert/OpsAlertDelivery записей"
    expected: "Тик выполняется по интервалу, алерты пишутся в PostgreSQL, канал честно отражается в channelState, TTL живых ключей bet-stats:http5xx:* равен 420s"
    why_human: "Рестарт dev-серверов пользователя запрещён (документированное ограничение); композиция проверена proxy-тестами уровня startAlertingRuntime на фейках (7/7 в alerts-composition.test.ts) — живая инфраструктура остаётся вне автоматической досягаемости"
---

# Phase 9: Degradation Alerting — Verification Report (ре-верификация после gap-closure)

**Phase Goal:** An operator is proactively told when the platform degrades — provider-quota exhaustion, worker failures and dead letters, sync-run failures, 5xx spikes, and backup staleness — with PostgreSQL as the source of truth and the operations center as the operator's view.
**Verified:** 2026-11-13T08:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (планы 09-05: CR-01/CR-02/IN-05; 09-06: WR-01/WR-02)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: каждый настроенный сигнал деградации (квота, сбои задач/мёртвые письма, сбои синка, всплески 5xx, устаревание бэкапов) даёт durable-запись с дедупликацией, severity-тирами и историей переходов | ✓ VERIFIED | Все пять сигналов работают: dead-letter-сигнал ожил — `startAlertingRuntime` передаёт `inspector` в `scheduleAlertingTick` (workers/data-sync/src/main.ts:187, комментарий CR-01); композиционный тест доказывает тик на уровне production-композиции: `inspector.getFailed` вызван, в fake-БД попадает durable OPEN/CRITICAL DEAD_LETTER-строка scope `settlement/QUARANTINE_IDENTITY`. 5xx-сигнал честен после WR-01/WR-02. Прогон: 62/62 unit-теста alert-набора |
| 2 | SC2: оператор видит активные и недавние алерты в operations center с correlation-контекстом и секретами, прошедшими редакцию | ✓ VERIFIED | Регресс: alerts-block.tsx + page.tsx:90 на месте; SSR-тесты **39/39 passed** (собственный прогон); read model в operations.service.ts не изменялась (git diff 895b017..HEAD пуст по apps/web) |
| 3 | SC3: доставка в настраиваемый вебхук без утечки секретов и betting-данных; упавшая доставка не теряет алерт | ✓ VERIFIED | dispatchWebhook не изменён; canary-тесты в alerts-dispatch.test.ts зелёные (в прогоне 62/62); состояние алерта живёт в PostgreSQL независимо от доставки (D-02) |
| 4 | SC4: пробы и алертинг не вызывают живых внешних провайдеров; сбои отдельных задач не создают alert fatigue | ✓ VERIFIED | Регресс: probe-тест «never calls live providers — payload is a typed allowlist only» зелёный; дедуп по signal\0scope сохранён; авто-резолюция сузилась только на probe-сигнал (контрольный тест доказывает, что non-probe-алерты резолвятся как прежде) |
| 5 | Plan 02: шесть signal-адаптеров каждый запускается в тике | ✓ VERIFIED | CR-01 закрыт: в production-композиции (main.ts:177-190) ключ `inspector` передан; тест «one evaluator tick armed through startAlertingRuntime consumes inspector.getFailed…» — green. Тест лежит на уровне композиционного корня (не адаптера), что закрывает класс дефекта, ускользнувший от прежних юнит-тестов |
| 6 | Plan 02: недельный delivery-probe поднимает CRITICAL self-alert (D-13), который остаётся активным, пока канал сломан | ✓ VERIFIED | CR-02 закрыт: `resolveClearedAlerts` где-клаус `signal: { not: PROBE_ANCHOR_SIGNAL }` (alerts.ts:409); кросс-тест «probe-failure self-alert stays OPEN after an evaluator tick — no OPEN→RESOLVED transition» — green; контрольный тест (non-probe PROVIDER_QUOTA резолвится с ровно одним переходом) доказывает, что исключение скоупировано по сигналу; drift-тест `PROBE_ANCHOR_SIGNAL === DELIVERY_PROBE_SIGNAL` — green |
| 7 | Plan 01: OpsAlert/OpsAlertTransition/OpsAlertDelivery в PostgreSQL с guarded-триггерами, append-only аудитом, дедуп-индексом | ✓ VERIFIED | Регресс: schema.prisma:1127/1148/1164 на месте; миграция не изменялась (git diff 895b017..HEAD пуст по packages/database/prisma); интеграционные тесты (9 кейсов) существуют, в этой сессии не запускались — требуют DATABASE_URL/Docker (см. Human Verification) |

**Score:** 7/7 truths verified (0 failed; 1 carried behavior-unverified live-stack item — см. behavior_unverified_items, proxy принят)

Верификационные прогоны этой сессии (собственные, не из SUMMARY):
- `pnpm vitest run --project unit tests/unit/alerts-composition.test.ts tests/unit/alerts-delivery-probe.test.ts tests/unit/alerts-signals.test.ts tests/unit/alerts-dispatch.test.ts tests/unit/alerts-5xx-filter.test.ts`: **62/62 passed** (5 файлов; прежние 55 + 7 новых композиционных/IN-05/mirror-кейсов)
- Web SSR `alerts-block.test.ts`: **39/39 passed**
- `npx tsc --noEmit` workers/data-sync: **exit 0**; apps/api: **exit 0**
- Интеграционные тесты (Testcontainers) не запускались — требуют DATABASE_URL/Docker; существование и состав проверены чтением

### Advisory (New Scope, Unevidenced)

New-scope findings from Step 7 with no deterministic evidence — reported, not blocking. Include this section (even "None") whenever re-verification ran.

| # | Finding | Category | Why Advisory |
|---|---------|----------|--------------|
| 1 | WR-G1: после CR-02 якорь DELIVERY_HEALTH stranded OPEN/CRITICAL навсегда, если канал удаляют после неудачного probe | other | Осознанно открыт в 09-REVIEW-DISPOSITION.md; вне объёма closure по решению пользователя |
| 2 | WR-G2: повторный провал probe на ACKNOWLEDGED-якоре — переход в OPEN без transition-строки (смежный скоуп, блок предшествовал closure) | other | Осознанно открыт (ledger: «смежный скоуп») |
| 3 | WR-G3: instanceof-guard в close() недостижимо ложны (necessity) | other | Безвредный guard; scope-решение человека |
| 4 | IN-G1: нецелочисленный статус HttpException попадает в 5xx-числитель на посылке «null ⇒ 500» | other | Contrived-случай; осознанно открыт |
| 5 | IN-G2: мёртвый параметр runtime в runOneTick | other | Косметика теста |
| 6 | Унаследованный остаток WR-03..WR-07, IN-01..IN-04 (pre-existing disposition) | other | Задокументирован в 09-REVIEW-DISPOSITION.md как сознательный остаток; не является gap-ами этой верификации |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `workers/data-sync/src/main.ts` | startAlertingRuntime передаёт inspector в scheduleAlertingTick (CR-01) | ✓ VERIFIED | main.ts:187 `inspector,` внутри вызова планировщика + injection-seam (deps, setTimeout/clearTimeout); close() не трогает caller-owned зависимости (main.ts:209-212); `git diff 895b017..HEAD` подтверждает коммиты 8948374/a08e05c |
| `workers/data-sync/src/jobs/alerts.ts` | resolveClearedAlerts исключает probe-сигнал (CR-02) | ✓ VERIFIED | alerts.ts:61 `PROBE_ANCHOR_SIGNAL = "DELIVERY_HEALTH"`, alerts.ts:409 `signal: { not: PROBE_ANCHOR_SIGNAL }` в where findMany |
| `workers/data-sync/src/jobs/delivery-probe.ts` | успех probe разрешает якорь из любого non-RESOLVED статуса (IN-05) | ✓ VERIFIED | delivery-probe.ts:92-95: условие `anchor.status !== "RESOLVED"`, переход `from: anchor.status` — truthful для OPEN и ACKNOWLEDGED |
| `tests/unit/alerts-composition.test.ts` | Композиционные тесты CR-01/CR-02/IN-05 | ✓ VERIFIED | Новый файл, 5 кейсов (композиция getFailed+create, close-цепочка, якорь остаётся OPEN, контроль non-probe, drift-guard); все зелёные в прогоне |
| `tests/unit/alerts-delivery-probe.test.ts` | ACKNOWLEDGED-успех резолвится с truthful-переходом | ✓ VERIFIED | Строка 136 «success resolves an ACKNOWLEDGED anchor with a truthful ACKNOWLEDGED→RESOLVED transition (IN-05)» — green |
| `apps/api/src/modules/operations/http-5xx-bucket.filter.ts` | WR-01 + WR-02 | ✓ VERIFIED | Строка 80 `status === null || status >= 500` (с комментарием про BaseExceptionFilter/500); строка 14 `BUCKET_TTL_SECONDS = 420` с инвариантом в док-комментарии; BaseExceptionFilter-делегирование не изменено |
| `tests/unit/alerts-5xx-filter.test.ts` | Перевёрнутый raw-exception тест, TTL 420, mirror-guard | ✓ VERIFIED | Строка 69 «counts a raw exception as a 5xx — Nest answers it 500 «Internal server error»» (assert'ит и bucket-write, и неизменный reply-контракт); expire-ассертции 420 (строки 51, 109); mirror-тест строка 130-136 `BUCKET_TTL_SECONDS ≥ HTTP5XX_WINDOW_MINUTES * 60 + 60` с импортом reader-side константы |
| `packages/database/prisma/schema.prisma` | OpsAlert/OpsAlertTransition/OpsAlertDelivery | ✓ VERIFIED | Регресс: строки 1127/1148/1164; не изменялась closure-ом |
| `packages/database/prisma/migrations/20261108_phase09_ops_alerts/migration.sql` | DDL + CHECK + триггеры | ✓ VERIFIED | Регресс: файл на месте, не изменялся (git diff пуст) |
| `apps/api/src/main.ts` | Регистрация фильтра + httpTotal-счётчик | ✓ VERIFIED | Регресс: main.ts:11, 44 |
| `apps/api/src/modules/operations/operations.service.ts` / `.controller.ts` | Read model + acknowledge | ✓ VERIFIED | Регресс: не изменялись в closure; прежняя верификация (read model, OperatorGuard, 202) |
| `packages/config/src/index.ts` | readAlertsConfig | ✓ VERIFIED | Регресс: прежняя верификация |
| `apps/web/app/internal/operations/{alerts-block.tsx,page.tsx}` | AlertsBlock + «Алерты» первым блоком | ✓ VERIFIED | Регресс: page.tsx:7, 60, 90; UI не изменялся closure-ом; SSR 39/39 |
| `apps/web/components/enum-labels.ts` | alert-словари | ✓ VERIFIED | Регресс: прежняя верификация (оговорка WR-05 — унаследованный advisory) |
| `tests/integration/alerts.test.ts` / `operator-overview.test.ts` | Интеграционные на реальном PostgreSQL | ✓ VERIFIED (существование) | Регресс: файлы на месте, не изменялись; прогон требует Docker/DB — не запускались |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| startAlertingRuntime (main.ts) | scheduleAlertingTick input `inspector` | evaluateAndDispatch → evaluateDeadLetters | ✓ WIRED | Точная связь, разорванная CR-01: main.ts:187 передаёт ключ; композиционный тест прогоняет тик через composition root и доказывает вызов getFailed + durable-строку |
| resolveClearedAlerts fired-set | DELIVERY_PROBE_FINGERPRINT | исключение `signal: { not: PROBE_ANCHOR_SIGNAL }` | ✓ WIRED | Точная связь CR-02: alerts.ts:409; drift-guard тест фиксирует равенство констант alerts.ts ↔ delivery-probe.ts; контрольный кейс доказывает non-probe-резолюцию жива |
| runDeliveryProbe success | anchor OPEN/ACKNOWLEDGED → RESOLVED | transition из фактического статуса | ✓ WIRED | IN-05: delivery-probe.ts:92-95; оба теста (OPEN→RESOLVED существующий, ACKNOWLEDGED→RESOLVED новый) зелёные |
| Filter numerator bucket | BaseExceptionFilter 500 rendering | подсчёт до делегирования | ✓ WIRED | WR-01: filter.ts:80; тест фиксирует incr/expire/exec И неизменный reply { statusCode: 500, message: "Internal server error" } в одном кейсе |
| BUCKET_TTL_SECONDS (filter) | HTTP5XX_WINDOW_MINUTES (worker alerts.ts) | кросс-модульный mirror-тест | ✓ WIRED | WR-02: тест импортирует обе константы и пинит TTL ≥ window*60+60 |
| NestJS filter (apps/api) | Redis 5xx/httpTotal buckets | recordMinuteBucket | ✓ WIRED | Регресс: main.ts:11,44 |
| Evaluator (worker) | PostgreSQL OpsAlert | Prisma upsert | ✓ WIRED | Регресс: дедуп/диспатч не изменялись |
| alerts() read model | Next.js page → AlertsBlock | overview fetch | ✓ WIRED | Регресс: page.tsx:60,90 |
| Acknowledge кнопка | POST /internal-api/…/acknowledge | fetch POST | ✓ WIRED | Регресс: не изменялась |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Композиция тика (CR-01/CR-02/IN-05) + сигналы + dispatch + 5xx-фильтр | `pnpm vitest run --project unit tests/unit/alerts-composition.test.ts tests/unit/alerts-delivery-probe.test.ts tests/unit/alerts-signals.test.ts tests/unit/alerts-dispatch.test.ts tests/unit/alerts-5xx-filter.test.ts` | 62/62 passed | ✓ PASS |
| SSR-состояния AlertsBlock | `pnpm --filter @bet-stats/web exec vitest run … alerts-block.test.ts` | 39/39 passed | ✓ PASS |
| Компиляция воркера | `npx tsc --noEmit -p workers/data-sync/tsconfig.json` | exit 0 | ✓ PASS |
| Компиляция API | `npx tsc --noEmit -p apps/api/tsconfig.json` | exit 0 | ✓ PASS |
| Scope-гейт (prohibitions 09-05/09-06: нет schema/UI-изменений) | `git diff --stat 895b017..HEAD -- packages/database/prisma apps/web` | пусто | ✓ PASS |
| Debt-маркеры (TBD/FIXME/XXX/PLACEHOLDER) в файлах фазы | grep по workers/data-sync/src, apps/api/src/modules/operations | не обнаружены | ✓ PASS |
| Интеграционные тесты на реальном PostgreSQL | требуют DATABASE_URL/Docker | не запускались | ? SKIP → human verification (унаследовано) |
| Живой тик evaluator'а в стеке | требует ALERTS_ENABLED=true + рестарт воркера (запрещён) | не выполнено | ? SKIP → human verification (покрыт proxy — см. behavior_unverified_items) |

### Probe Execution

Проб-скриптов (`scripts/*/tests/probe-*.sh`) в фазе нет; PLAN/SUMMARY не декларируют probe-файлы — шаг не применим.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ALRT-01 | 01, 02, 03, 05, 06 | Оператор получает алерты: квота, сбои задач/мёртвые письма, сбои синка, 5xx, бэкапы | ✓ SATISFIED | Все пять сигналов живы: dead-letter — через композиционный тест (CR-01); 5xx — честный числитель/окно (WR-01/WR-02 + mirror-guard); остальные четыре — прежние юнит-тесты (62/62). Advisory WR-G1/IN-G1 не влияют на утверждение сигнала в основной конфигурации |
| ALRT-02 | 01, 02, 05 | Durable PostgreSQL-записи с дедупликацией, severity-тирами, историей переходов; доставка — попытка, не источник истины | ✓ SATISFIED | Схема/миграция не изменялись; анкер-переходы теперь truthful (IN-05); Advisory WR-G2 — единственное нетривиальное отклонение от D-04, осознанно открыто |
| ALRT-03 | 03, 04 | Оператор видит активные/недавние алерты с correlation-контекстом и секретами, прошедшими редакцию | ✓ SATISFIED | Регресс: read model + AlertsBlock + 39/39 SSR; UI не изменялся |
| ALRT-04 | 02, 03, 04 | Доставка в настраиваемый вебхук без утечки секретов/betting-данных | ✓ SATISFIED | dispatchWebhook не изменён; canary-тесты зелёные; CR-02 усиливает D-13 (self-alert о сломанном канале больше не гасится) |

Orphaned requirements: нет — все 4 ID фазы заявлены в планах (01: ALRT-02; 02: 01/02/04; 03: 01/03/04; 04: 03/04; 05: 01/02; 06: 01) и покрыты выше.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| workers/data-sync/src/main.ts | 210-211 | Невозможное состояние: instanceof-guard всегда истинны (WR-G3) | ℹ️ Info | Безвредно; осознанно открыто |
| tests/unit/alerts-composition.test.ts | 222 | Мёртвый параметр runtime в runOneTick (IN-G2) | ℹ️ Info | Косметика теста |
| workers/data-sync/src/jobs/delivery-probe.ts | 100-114 | ACKNOWLEDGED→OPEN без transition-строки (WR-G2) | ⚠️ Warning (advisory) | Осознанно открыт как смежный скоуп в 09-REVIEW-DISPOSITION.md — не gap этой верификации |
| workers/data-sync/src/jobs/delivery-probe.ts + main.ts + alerts.ts | — | Stranded OPEN-якорь при удалении webhook после провала (WR-G1) | ⚠️ Warning (advisory) | Осознанно открыт — не gap этой верификации |

Debt-маркеры (TBD/FIXME/XXX/PLACEHOLDER) в файлах фазы: не обнаружены. Blocking anti-patterns: отсутствуют.

**Вне фазы (наблюдение):** `tests/unit/fixtures-sync.test.ts` падает с «Authentication failed against the database server» — окруженческая проблема DB-креденшелов; файл предшествует фазе 09, ни один коммит фазы его не трогает. На оценку фазы не влияет.

### Human Verification Required

### 1. Живой тик evaluator'а (behavior_unverified, унаследован; proxy-тесты приняты)
**Test:** В удобный момент установить ALERTS_ENABLED=true (+ опционально ALERT_WEBHOOK_URL), перезапустить воркер, дождаться тика, проверить OpsAlert/OpsAlertDelivery в PostgreSQL и TTL живых ключей bet-stats:http5xx:* (ожидание: 420s после WR-02).
**Expected:** Тик по интервалу; алерты пишутся в PostgreSQL; channelState честный.
**Why human:** Рестарт dev-серверов пользователя запрещён (документированное ограничение); композиция на уровне startAlertingRuntime покрыта 5 proxy-тестами на фейках, но живые PostgreSQL/Redis/BullMQ-интеграция не упражнялась.

### 2. Визуальная/интерактивная адекватность блока «Алерты»
**Test:** Открыть /internal/operations: светлая/тёмная тема, 320px, zoom 200%, клавиатурный ack с фокусом на маркере, живой ack-раундтрип.
**Expected:** Чипы с текстом, reflow без горизонтали, маркер «Подтверждён» после ack.
**Why human:** Визуал и живой раундтрип за OperatorGuard+HMAC не покрываются SSR-тестами.

### 3. Живые Redis-счётчики 5xx
**Test:** На живом стеке вызвать заведомо ошибочные запросы и проверить ключи bet-stats:http5xx:*/httpTotal:*.
**Expected:** Ключи растут с минутным индексом, TTL 420s (после WR-02), сырые 500-ответы тоже увеличивают http5xx (WR-01).
**Why human:** Требует живого Redis и реального трафика.

### 4. Интеграционные тесты на реальном PostgreSQL
**Test:** Запустить `tests/integration/alerts.test.ts` (9 кейсов: mutation-rejection триггеров, дедуп-конвергенция, ack-идемпотентность) и `operator-overview.test.ts` в окружении с DATABASE_URL+Docker.
**Expected:** Все зелёные.
**Why human:** Testcontainers требуют Docker/DB, недоступных в этой сессии; существование и состав проверены чтением.

### Gaps Summary

Ре-верификация после closure-планов 09-05/09-06: **оба критических gap-а из предыдущей верификации закрыты и подтверждены свежим чтением кода и собственными прогонами**, регрессий не обнаружено.

- **CR-01** — `startAlertingRuntime` передаёт `inspector` в `scheduleAlertingTick` (main.ts:187); новый композиционный тест лежит именно на том уровне, где дефект ускользал от прежних юнит-тестов: тик вооружается через composition root, `inspector.getFailed` реально вызывается, durable OPEN/CRITICAL DEAD_LETTER-строка попадает в БД. Закрыт.
- **CR-02** — `resolveClearedAlerts` исключает `PROBE_ANCHOR_SIGNAL` (alerts.ts:409); кросс-тест доказывает, что якорь DELIVERY_HEALTH переживает тик в OPEN без переходов, а контрольный non-probe-алерт по-прежнему честно резолвится (исключение скоупировано, не blanket-freeze). Drift-guard пинит равенство констант между модулями. Закрыт.
- **IN-05** — успех probe разрешает якорь из OPEN и ACKNOWLEDGED с truthful-переходом (delivery-probe.ts:92-95). Закрыт.
- **WR-01** — `status === null || status >= 500` включает сырые исключения в 5xx-числитель; тест одновременно assert'ит bucket-write и байт-идентичный ответ { statusCode: 500, message: "Internal server error" }. Закрыт.
- **WR-02** — TTL 420s покрывает 5-минутное окно чтения; кросс-модульный mirror-тест не даст TTL и окну снова разъехаться. Закрыт.

Проверки: 62/62 unit alert-тестов, 39/39 SSR, tsc exit 0 ×2, prohibition-гейты (нет schema/UI-изменений — git diff 895b017..HEAD пуст), debt-маркеров нет, регрессий нет.

Статус **human_needed** (а не passed) только из-за четырёх унаследованных/инфраструктурных пунктов человеческой проверки: живой тик в стеке (proxy-тесты приняты как замещение в силу запрета рестарта dev-стека), визуальная адекватность UI-блока, живые Redis-счётчики (теперь с ожиданием TTL 420s), и запуск интеграционных тестов в окружении с DB. Все — инфраструктурные, ни один не блокирует следующий этап по коду: оба ранее блокировавших дефекта композиции устранены.

Осознанный остаток (advisory, не gaps): WR-03..WR-07, IN-01..IN-04 (pre-existing disposition) + WR-G1, WR-G2, WR-G3, IN-G1, IN-G2 (09-REVIEW-GAPS.md) — все задокументированы в 09-REVIEW-DISPOSITION.md как сознательно открытые.

---

_Verified: 2026-11-13T08:30:00Z_
_Verifier: the agent (gsd-verifier)_
