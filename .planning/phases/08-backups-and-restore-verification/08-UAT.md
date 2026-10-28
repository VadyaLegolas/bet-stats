---
status: testing
phase: 08-backups-and-restore-verification
source: [08-VERIFICATION.md]
started: 2026-10-27T00:00:00.000Z
updated: 2026-10-28T00:00:00.000Z
---

## Current Test

number: 2
name: Реальный off-host robocopy — осталась негативная половина (недоступный шар → «Деградировано»)
expected: |
  При недоступном `BACKUP_OFFSITE_DIR` блок показывает «Деградировано» с кодом robocopy, локальный бэкап остаётся `SUCCEEDED`. Позитивная половина уже подтверждена (COPIED + «Скопировано»).
awaiting: agent execution — негативная половина требует рестарта стека для смены `BACKUP_OFFSITE_DIR`

## Tests

### 1. Живой прогон реального бэкапа
expected: В `BACKUP_DIR` появляется файл `football_prediction-<UTC>.dump` ненулевого размера, в `BackupRun` — ровно одна строка `SUCCEEDED`, блок операций показывает свежую резервную копию.
result: pass
evidence: |
  Исполнено агентом 2026-10-28 через подписанный операторский драйвер (HMAC подписывается in-process, секрет не покидает процесс): дамп `football_prediction-20261028T144115Z.dump` (18 541 903 байт) в `backups/`; событие `backup.succeeded` в логе стека (runId 14d91566…, durationMs 8634, offsiteStatus COPIED); UI-блок: «28 октября 2026 г. в 15:41 · …dump · 17.68 МБ · 8.6 с · SUCCEEDED», возраст «В норме»; скриншот показан оператору.
note: Недоступность блока для обычного браузера оператора зафиксирована отдельно как issue теста 6 (gap G-08-6) — сама функция бэкапа работает.

### 2. Реальный off-host robocopy
expected: Файл копируется, `offsiteStatus = 'COPIED'`, в блоке операций строка «Хранение вне сервера» показывает «Скопировано»; при недоступном шаре — «Деградировано» с кодом, локальный бэкап остаётся `SUCCEEDED`.
result: [pending]
positive: Подтверждено агентом 2026-10-28: копия 18 541 903 байт в `D:\Documents\Atom\bet-stats-offsite` (robocopy `/LOG:`), `offsiteStatus = 'COPIED'`, UI «Хранение вне сервера — Скопировано». Осталась негативная половина.

### 3. Недельная (168 ч) каденция drill на живом хосте
expected: После старта worker'а тик расписания запускается от последнего `BackupVerificationReceipt`, drill отрабатывает по расписанию, блок остаётся зелёным (HEALTHY) после каждой успешной проверки.
result: [pending]

### 4. Ветка «миграции не на head»
expected: `BackupVerificationReceipt.overall = 'UNVERIFIED'`, `failureReason = 'MIGRATIONS_NOT_AT_HEAD'`, drill никогда не даёт `VERIFIED` при pending-миграциях.
result: [pending]

### 5. Сбой очистки контейнера (behavior_unverified)
expected: В чеке `containerCleanup = 'FAILED'` фиксируется, а не скрывается; `overall` остаётся прежним (заработанным) значением и не подкрашивается в зелёное из-за (не)успешной очистки; имя контейнера — `bet-stats-drill-pg-<pid>-<ts>`.
result: [pending]

### 6. Живой UI-прогон обеих кнопок триггеров
expected: Кнопки дают role=status обратную связь, после завершения страница обновляется через `load()`; при выключенных бэкапах — одинаковый 404 без утечки информации о конфигурации; русские подписи пяти состояний на месте, «Здорово» не показывается ни в одном не-зелёном состоянии.
result: issue
reported: "все недоступно"
severity: major
diagnosis: |
  Обычный браузер не проходит HMAC-верификацию прокси `/internal-api/operations`: `apps/web/app/internal-api/operations/[[...path]]/route.ts:25-44` — fail-closed 404 для запросов без подписи, dev-обхода нет («Do not accept … a permissive development bypass», 02-19-PLAN). Операторский шлюз `infra/operator-gateway/security.mjs` подписывает только replay-пути (`isProtectedReplayPath` = `/internal*/pipeline/replay*`), пути операций — нет; в dev-топологии (`app-lifecycle.ps1`) шлюз вообще не запущен. Итог: все блоки `/internal/operations` показывают «Этот операционный блок недоступен…», обе кнопки триггеров недоступны оператору. Логика самого блока и кнопок проверена через подписанный драйвер (тест 1: данные рендерятся, триггер POST → 202), поэтому это gap ingress-обвязки, а не функции бэкапов.

## Summary

total: 6
passed: 1
issues: 1
pending: 4
skipped: 0
blocked: 0

## Gaps

- gap_id: G-08-6
  truth: "Оператор открывает /internal/operations в обычном браузере, жмёт обе кнопки триггеров и видит пять русских состояний блока (VALIDATION §Manual-Only)."
  status: failed
  reason: "User reported: все недоступно (все блоки /internal/operations показывают «Этот операционный блок недоступен», кнопки триггеров недоступны)"
  severity: major
  test: 6
  artifacts:
    - "apps/web/app/internal-api/operations/[[...path]]/route.ts:25-44 — fail-closed HMAC для /internal-api/operations*, dev-обхода нет"
    - "infra/operator-gateway/security.mjs — isProtectedReplayPath покрывает только /internal*/pipeline/replay*"
    - "docs/superpowers/specs/2026-08-31-docker-basic-auth-operator-gateway-design.md:9-14 — шлюз по дизайну подписывает только replay"
    - "tests/e2e/operator-overview.spec.ts — UI проверяется только с внедрённой подписью (setExtraHTTPHeaders)"
  missing:
    - "Расширить подписываемые пути шлюза на /internal*/operations* (тем же OPERATOR_PROXY_SIGNING_SECRET) + тесты isProtectedReplayPath"
    - "Штатный ingress для человека: либо поднять operator-gateway в dev-лаунчере (браузер через :8080 с Basic auth), либо иной документированный путь доступа к операциям"
