---
status: testing
phase: 08-backups-and-restore-verification
source: [08-VERIFICATION.md]
started: 2026-10-27T00:00:00.000Z
updated: 2026-10-27T00:00:00.000Z
---

## Current Test

number: 1
name: Живой прогон реального бэкапа: оператор выставляет `BACKUP_ENABLED=true` и `BACKUP_DIR` в секретном `.env`, жмёт «Создать резервную копию сейчас» на странице операций (VALIDATION §Manual-Only, строка 1)
expected: |
  В `BACKUP_DIR` появляется файл `football_prediction-<UTC>.dump` ненулевого размера, в `BackupRun` — ровно одна строка `SUCCEEDED`, блок операций показывает свежую резервную копию.
awaiting: user response

## Tests

### 1. Живой прогон реального бэкапа
expected: В `BACKUP_DIR` появляется файл `football_prediction-<UTC>.dump` ненулевого размера, в `BackupRun` — ровно одна строка `SUCCEEDED`, блок операций показывает свежую резервную копию.
result: [pending]

### 2. Реальный off-host robocopy
expected: Файл копируется, `offsiteStatus = 'COPIED'`, в блоке операций строка «Хранение вне сервера» показывает «Скопировано»; при недоступном шаре — «Деградировано» с кодом, локальный бэкап остаётся `SUCCEEDED`.
result: [pending]

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
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
