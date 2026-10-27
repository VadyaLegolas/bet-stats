---
phase: 08-backups-and-restore-verification
verified: 2026-10-26T13:55:57Z
status: human_needed
score: 16/17 must-haves verified
covered_files:
  - ".planning/phases/08-backups-and-restore-verification/08-01-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-01-SUMMARY.md"
  - ".planning/phases/08-backups-and-restore-verification/08-02-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-02-SUMMARY.md"
  - ".planning/phases/08-backups-and-restore-verification/08-03-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-03-SUMMARY.md"
  - "README.md"
  - "apps/api/src/modules/operations/operations.controller.ts"
  - "apps/api/src/modules/operations/operations.service.ts"
  - "apps/web/app/internal-api/operations/[[...path]]/route.test.ts"
  - "apps/web/app/internal-api/operations/[[...path]]/route.ts"
  - "apps/web/app/internal/operations/backup-status-block.test.ts"
  - "apps/web/app/internal/operations/backup-status-block.tsx"
  - "apps/web/app/internal/operations/page.tsx"
  - "apps/web/components/enum-labels.test.ts"
  - "apps/web/components/enum-labels.ts"
  - "packages/config/src/index.test.ts"
  - "packages/config/src/index.ts"
  - "packages/database/prisma/migrations/20261022_phase08_backup_runs/migration.sql"
  - "packages/database/prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql"
  - "packages/database/prisma/migrations/20261024_phase08_backup_byte_size_bigint/migration.sql"
  - "packages/database/prisma/schema.prisma"
  - "tests/integration/backup-restore-drill.test.ts"
  - "tests/integration/mutation-rejection.test.ts"
  - "tests/integration/operator-overview.test.ts"
  - "tests/unit/backup-drill.test.ts"
  - "tests/unit/backup-job.test.ts"
  - "workers/data-sync/src/jobs/backup-drill.ts"
  - "workers/data-sync/src/jobs/backup.ts"
  - "workers/data-sync/src/main.ts"
covered_digest: "v3:sha256:996d67cb37a536b3a1a6bd8bbf7df52afd99d180cc9f7a19072cc05c9f0d8319"
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "A cleanup failure is recorded in the receipt rather than hidden; the container name is owned-unique and removal runs in a finally block (08-02 truth 3)"
    test: "Запустить drill так, чтобы `docker rm --force` завершился ошибкой (например, временно заблокировать удаление контейнера или оборвать docker-демон во время финальной очистки) и прочитать строку `BackupVerificationReceipt`"
    expected: "Строка содержит `containerCleanup = 'FAILED'` (а не 'REMOVED'/'NOT_STARTED'), при этом `overall` не поднимается до 'VERIFIED' из-за неудачной очистки; имя контейнера — `bet-stats-drill-pg-<pid>-<ts>` и отсутствует в `docker ps --all` либо остаётся с зафиксированной неудачей"
    why_human: "Код присутствует и подключён (backup-drill.ts: `containerCleanup` инициализируется 'FAILED' до вызова `rm` в блоке `finally`, затем перезаписывается результатом), но ни один тест не исполняет ветку падающего `rm` — существующие тесты покрывают только 'REMOVED' и 'NOT_STARTED'. Grep по коду доказывает наличие перехода, но не его поведение в рантайме"
human_verification:
  - test: "Живой прогон реального бэкапа: оператор выставляет `BACKUP_ENABLED=true` и `BACKUP_DIR` в секретном `.env`, жмёт «Создать резервную копию сейчас» на странице операций (VALIDATION §Manual-Only, строка 1)"
    expected: "В `BACKUP_DIR` появляется файл `football_prediction-<UTC>.dump` ненулевого размера, в `BackupRun` — ровно одна строка `SUCCEEDED`, блок операций показывает свежую резервную копию"
    why_human: "Требуется реальный `DATABASE_URL` продакшн-базы оператора и запись в файловую систему хоста; тестовый контур использует только throwaway-контейнер"
  - test: "Реальный off-host копию: указать `BACKUP_OFFSITE_DIR` на существующий SMB-/sync-каталог и выполнить бэкап (VALIDATION §Manual-Only, строка 2)"
    expected: "Файл копируется, `offsiteStatus = 'COPIED'`, в блоке операций строка «Хранение вне сервера» показывает «Скопировано»; при недоступном шаре — «Деградировано» с кодом, локальный бэкап остаётся `SUCCEEDED`"
    why_human: "Нужен реальный сетевой шар/синк-каталог, который нельзя смоделировать в герметичном тесте"
  - test: "Проверить недельную (168 ч) каденцию drill на живом хосте оператора (VALIDATION §Manual-Only, строка 3)"
    expected: "После старта worker'а тик расписания запускается от последнего `BackupVerificationReceipt`, drill отрабатывает по расписанию, блок остаётся зелёным (HEALTHY) после каждой успешной проверки"
    why_human: "Каденция привязана к реальному времени работы хоста и реальному Redis/BullMQ — проверяемо только наблюдением"
  - test: "Срабатывание ветки «миграции не на head»: создать ситуацию, когда в промежуточной БД есть незакоммиченная миграция (например, добавить локальную миграцию после последнего деплоя) и запустить drill"
    expected: "`BackupVerificationReceipt.overall = 'UNVERIFIED'`, `failureReason = 'MIGRATIONS_NOT_AT_HEAD'`, drill никогда не даёт `VERIFIED` при pending-миграциях"
    why_human: "Ветка `backup-drill.ts:406-411` присутствует и подключена, но не имеет выделенного теста; остальные три fail-closed ветки (DOCKER_UNAVAILABLE / RESTORE_FAILED / CHAIN_INTEGRITY_FAILED) покрыты зелёными тестами"
  - test: "Сценарий сбоя очистки контейнера (см. behavior_unverified_items) — принудительно сломать `docker rm` во время drill"
    expected: "В чеке `containerCleanup = 'FAILED'` фиксируется, а не скрывается; `overall` остаётся прежним (заработанным) значением и не подкрашивается в зелёное из-за (не)успешной очистки"
    why_human: "Отсутствует тест, воспроизводящий отказ `docker rm`; проверка кода доказывает только наличие логики"
  - test: "Живой UI-прогон: открыть http://localhost:3000/internal/operations и нажать обе кнопки триггеров при включённых бэкапах"
    expected: "Кнопки дают role=status обратную связь, после завершения страница обновляется через `load()`; при выключенных бэкапах — одинаковый 404 без утечки информации о конфигурации; русские подписи пяти состояний на месте, «Здорово» не показывается ни в одном не-зелёном состоянии"
    why_human: "Визуальный вид, поведение кнопок и поток пользователя в живом приложении не проверяются grep-тестами"
---

# Phase 8: Backups and Restore Verification — Отчёт верификации

**Цель фазы (ROADMAP):** An operator can enable automated PostgreSQL backups and trust them because a scheduled restore drill proves every backup actually restores — with never-verified and stale states rendered honestly in the operations center.
**Верифицировано:** 2026-10-26T13:55:57Z
**Статус:** human_needed
**Re-verification:** Нет — первичная верификация (файла `08-VERIFICATION.md` до этого не существовало)

## Достижение цели (Goal Achievement)

Цель фазы разложена на 3 success criteria ROADMAP + 17 must-have истин из трёх PLAN-ов (7 + 5 + 5). Все три требования (BAK-01..03) сведены к планам: 08-01 → BAK-01, 08-02 → BAK-02, 08-03 → BAK-03; в `.planning/REQUIREMENTS.md` все три ID отнесены к Phase 8 (строки 18-20, 102-104) — осиротевших требований нет.

### Observable Truths

| # | Истина | Статус | Доказательство |
| --- | --- | --- | --- |
| 1 | (08-01) Настоящий `pg_dump -Fc` даёт непустой файл + ровно одну строку `BackupRun SUCCEEDED`; сбойный дамп → `FAILED`, без `.dump`, ничего не удаляется | ✓ VERIFIED | Интеграционный `tests/integration/backup-restore-drill.test.ts` (it 97 и 135) прогнан мной: 1 файл >0 байт, 0 `.partial`, sha256 совпадает с пересчётом, `FAILED`-строка `DUMP_FAILED` без файлов |
| 2 | (08-01) Ротация оставляет ровно новейшие `BACKUP_RETENTION_COUNT` (14) и запускается только после успеха | ✓ VERIFIED | `tests/unit/backup-job.test.ts`: «prunes to the retention count after the new dump lands» + «invokes no pruning and deletes no dumps when the dump itself fails» — в составе 62 зелёных unit-тестов |
| 3 | (08-01) Не заданный `BACKUP_OFFSITE_DIR` → `NOT_CONFIGURED`; сбой robocopy → локальный `SUCCEEDED` + off-host `DEGRADED` с кодом | ✓ VERIFIED | `it.each([0,1,3,7]) → COPIED`, `it.each([8,16]) → DEGRADED`, spawn ENOENT → `offsiteError: "ENOENT"`, «never invokes the copy when BACKUP_OFFSITE_DIR is unset» — все зелёные |
| 4 | (08-01) Ежесуточный тик вооружается из состояния `BackupRun` по паттерну setTimeout retention-purge — без BullMQ v5 repeat-опций | ✓ VERIFIED | `scheduleBackupTick` в `workers/data-sync/src/jobs/backup.ts`; юнит-кейсы idle-poll / anchor 24h / re-arm от persisted state / close(); опции `repeat:` в файле нет; тик подключён в `main.ts` (`startBackupRuntime`) |
| 5 | (08-01) Учётные данные — только через child env; payload BullMQ несёт только дискриминатор trigger | ✓ VERIFIED | CR-01 тест: argv без conninfo, `PGHOST/PGPASSWORD/...` только в `options.env`; `expect(enqueued).toEqual([{ trigger: "SCHEDULED" }])`; операторский тест: data ровно `{ trigger: "MANUAL" }` |
| 6 | (08-01) docker-exec fallback берёт роль/БД из `BACKUP_PG_USER/BACKUP_PG_DB` или env контейнера, иначе fail-closed `PG_IDENTITY_UNRESOLVED` | ✓ VERIFIED | Интеграционный тест фиксирует argv `["exec", …, "-U", "postgres", "-d", "bet_stats"]`; fail-closed кейс: `FAILED PG_IDENTITY_UNRESOLVED`, дамп не вызывается (it 157) |
| 7 | (08-01) `sha256` считается с `.partial` до rename — идентификатор файла дампа | ✓ VERIFIED | Интеграционный тест пересчитывает hash от файла и сравнивает со строкой чека и с результатом `runBackup` (строки 122-124) |
| 8 | (08-02) Drill восстанавливает новейший дамп в throwaway-контейнер, доводит миграции до head, проходит chain-integrity, удаляет контейнер и добавляет один `BackupVerificationReceipt` | ✓ VERIFIED | Интеграционный it 180 прогнан мной: `overall VERIFIED`, `migrations AT_HEAD`, `restoreDurationMs > 0`, `containerCleanup REMOVED`, `docker ps --all --filter name=…` пуст |
| 9 | (08-02) Недоступный Docker / pending-миграция / ошибка restore / проваленный чек → `FAILED` или `UNVERIFIED`; drill не может молча пройти | ✓ VERIFIED | `tests/unit/backup-drill.test.ts` зелёный: DOCKER_UNAVAILABLE (137), PG_IDENTITY_UNRESOLVED (148), RESTORE_FAILED с редакцией stderr (163), CHAIN_INTEGRITY_FAILED (179); интеграционно NO_BACKUP_FOUND (232). Ветка pending-миграции (`MIGRATIONS_NOT_AT_HEAD`, backup-drill.ts:406-411) присутствует и подключена, но отдельного теста нет — вынесена в human-верификацию |
| 10 | (08-02) Сбой очистки фиксируется в чеке, а не скрывается; имя контейнера owned-unique; удаление в `finally` | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Код на месте: `containerCleanup` инициализируется `'FAILED'` до `rm` в `finally`, имя `bet-stats-drill-pg-<pid>-<ts>`, owned-uniq подтверждён интеграционной проверкой `docker ps`; но ветка падающего `rm` не исполняется ни одним тестом (тесты видят только `REMOVED`/`NOT_STARTED`) — см. behavior_unverified_items |
| 11 | (08-02) Паритет: FAIL только при restored < captured, позитивные дельты записываются, таблицы с нулевым source → SKIPPED | ✓ VERIFIED | Юнит-кейсы 179 / 192 / 203 / 295 зелёные |
| 12 | (08-02) Обе таблицы чеков отвергают UPDATE и DELETE на уровне БД | ✓ VERIFIED | Прогнал интеграционно на выделенном throwaway Postgres 18 (миграции применены, контейнер удалён после): `tests/integration/mutation-rejection.test.ts` 8/8, включая `BackupRun` и `BackupVerificationReceipt` с `/immutable/i` |
| 13 | (08-03) Секция `backups` в overview со state, считаемым при чтении: NOT_CONFIGURED / NEVER_VERIFIED / STALE / FAILED / HEALTHY; зелёный только при свежем бэкапе + прошедшем + не устаревшем drill | ✓ VERIFIED | `computeBackupFact` в `operations.service.ts` (read-time, clock injected); тесты 107-168 в `operator-overview.test.ts` зелёные, включая «staleness flips as the injected clock advances» |
| 14 | (08-03) Бэкап старше 25 ч → STALE, drill старше интервала + grace → drill-stale, оба не-зелёные даже при последнем VERIFIED | ✓ VERIFIED | Тесты границ 24h59m → HEALTHY / 25h01m → STALE / 192h01m → drill-stale; веб-тест «never renders green «Здорово»» для STALE при VERIFIED-чеке |
| 15 | (08-03) Payload overview не содержит connection string, кредов и директорий — только имена файлов, размеры, времена, коды и исходы чеков | ✓ VERIFIED | Тест 144 (нет scheme marker, нет пути каталога) + `redactSecrets(computeBackupFact(...))` + `safeFileName()` (basename, иначе `unavailable`); веб-тест «never renders a directory path» |
| 16 | (08-03) Триггеры «Backup now»/«Drill now» идут через gateway → подписанный proxy → OperatorGuard; неверный кред → унифицированный 404 без оракула | ✓ VERIFIED | Контроллер `@UseGuards(OperatorGuard)` + `@Post("backups/run"|"backups/drill")`; `route.ts` форвардит метод, HMAC-канон включает метод; тесты enqueue / disabled-404 / bad-credential-404 / ingress зелёные; `route.test.ts` входит в зелёный веб-набор |
| 17 | (08-03) Русский блок «Резервные копии и проверка восстановления» с двумя кнопками; never-verified / stale / failed / not-configured — явные не-зелёные состояния | ✓ VERIFIED | `backup-status-block.tsx` + `enum-labels.ts` (5 + 3 русских лейбла) смонтированы в `page.tsx:77-78`; веб-тесты (14 кейсов) зелёные: ни один не-зелёный state не рендерит «Здорово» |

**Score:** 16/17 истин верифицировано (1 — present, behavior-unverified)

### Required Artifacts

| Артефакт | Ожидание | Статус | Детали |
| --- | --- | --- | --- |
| `packages/config/src/index.ts` | `readBackupConfig` + `BackupConfig` fail-closed | ✓ VERIFIED | 143 строк; только явные входы, `BACKUP_*` вне superRefine, дефолты 14/168 |
| `…/20261022_phase08_backup_runs/migration.sql` | `BackupRun` + sha256 + guard-триггер | ✓ VERIFIED | `grep guarded_append_only` ≥ 1, чек-constraint'ы на status/offsite/trigger |
| `…/20261022_phase08_backup_verification_receipts/migration.sql` | `BackupVerificationReceipt` + guard-триггер | ✓ VERIFIED | `guard_backup_verification_receipt()`, констрейнты `VERIFIED/FAILED/UNVERIFIED` |
| `…/20261024_phase08_backup_byte_size_bigint/migration.sql` | исправление WR-01 (int4 → bigint) | ✓ VERIFIED | схема `byteSize BigInt? @db.BigInt` синхронна с миграциями (`pnpm verify:release:schema` exit 0, прогнан мной) |
| `workers/data-sync/src/jobs/backup.ts` | `runBackup`, `resolvePgTools`, `resolvePgIdentity`, `pruneBackupRetention`, `copyOffsite`, `scheduleBackupTick`, queue-фабрики | ✓ VERIFIED | 493 строки, полностью реализовано; подключено в `main.ts` |
| `workers/data-sync/src/jobs/backup-drill.ts` | `runBackupDrill`, `captureSourceCounts`, `runChainIntegrityChecks`, `scheduleDrillTick` | ✓ VERIFIED | 483 строки; generic FK-orphan по `pg_constraint`, curated-чеки, редакция stderr через `redactSecrets` |
| `tests/integration/backup-restore-drill.test.ts` | герметичный dump + FAILED-путь | ✓ VERIFIED | 6 кейсов, прогнан мной: зелёный |
| `README.md` | заметка оператору о персональных данных в дампах (RESEARCH Q7) | ✓ VERIFIED | раздел «Резервные копии…», `BACKUP_DIR`/`BACKUP_OFFSITE_DIR`, ACL и шифрование |
| `operations.service.ts` | `backups()`, `BackupFact`, 5-state read-time, `triggerBackup/triggerDrill` | ✓ VERIFIED | 290 строк, явные Prisma-select'ы, `redactSecrets` на выходе |
| `operations.controller.ts` | два POST-эндпоинта под OperatorGuard | ✓ VERIFIED | 23 строки, `@HttpCode(202)` |
| `…/internal-api/operations/[[...path]]/route.ts` | POST-прокси с методом в подписи | ✓ VERIFIED | `export const POST = proxy`, upstream-`fetch` с `request.method` |
| `…/internal/operations/backup-status-block.tsx` | операторский блок | ✓ VERIFIED | 72 строки, русские подписи, две кнопки, role=status/alert |
| `page.tsx`, `enum-labels.ts` | монтирование блока + лейблы | ✓ VERIFIED | `Block title="Резервные копии и проверка восстановления"`, 5+3 маппинга |
| Тесты (`backup-job`, `backup-drill`, `operator-overview`, `mutation-rejection`, `route.test`, `backup-status-block.test`, `enum-labels.test`) | покрытие по планам | ✓ VERIFIED | все существуют и зелёные в прогоне (см. Behavioral Spot-Checks) |

### Key Link Verification

| From | To | Via | Статус | Детали |
| --- | --- | --- | --- | --- |
| `readBackupConfig` | `runBackup` → `BackupRun` | `startBackupRuntime` в `main.ts` передаёт `readBackupConfig(process.env)` в `runBackup` | WIRED | отсутствующая конфигурация → `FAILED BACKUP_NOT_CONFIGURED` / `backup.disabled`, никогда не молча |
| `PG_BIN` → PATH → docker exec | `resolvePgTools` → `resolvePgIdentity` → fail-closed | цепочка в `backup.ts:180-246`, drill импортирует `resolvePgIdentity` | WIRED | явные `-U`/`-d` из резолвленной идентичности; `PG_IDENTITY_UNRESOLVED` без вызова pg_dump/pg_restore |
| `scheduleBackupTick` → `bet-stats-backup` → `createBackupWorker` → `runBackup` | тик → `queue.enqueue` → воркер `execute` | `main.ts:118-122` | WIRED | concurrency 1, jobId `scheduled-<kind>-<bucket>`, без `repeat:` |
| `scheduleDrillTick` → тот же `runBackupDrill` | тик → `queue.enqueueDrill` → `executeDrill` | `main.ts:124-129`, dispatch `createBackupJobDispatcher` | WIRED | «drill» и «backup» делят один воркер |
| новейший дамп → throwaway-контейнер → `migrate deploy/status` → chain-integrity → `BackupVerificationReceipt` | весь конвейер в `runBackupDrill` | `backup-drill.ts:242-445` | WIRED | порядок совпадает с D-08; `finally`-очистка |
| `BackupRun` + `BackupVerificationReceipt` → `backups()` → overview payload → веб-блок | Prisma `findFirst` → `computeBackupFact` → `backups:` в JSON → `fetch` в `page.tsx` → `BackupStatusBlock` | `operations.service.ts` + `page.tsx` | WIRED | см. Data-Flow |
| read-time staleness (25h / interval+24h) | `computeBackupFact(rows, current)` с инжектированным clock | `operations.service.ts:82-105` | WIRED | значение не сохраняется в БД |
| HMAC (метод в канонической строке) → web POST proxy → API OperatorGuard → BullMQ enqueue | `route.ts` → `x-operator-credential` → `OperatorGuard` → `queue.add` | цепочка замкнута | WIRED | подпись для другого метода отклоняется; disabled и неверный кред — одинаковый 404 |

### Data-Flow Trace (Level 4)

| Артефакт | Переменная | Источник | Реальные данные | Статус |
| --- | --- | --- | --- | --- |
| Блок «Последняя резервная копия» | `lastBackup` | `database.backupRun.findFirst({where:{status:"SUCCEEDED"}})` + явные select'ы | да — реальные строки `BackupRun` | ✓ FLOWING |
| Блок «Последняя проверка восстановления» + failed checks | `lastDrill`, `failedDrillChecks(checks)` | `database.backupVerificationReceipt.findFirst(…)` | да — реальные строки чека, имена чеков вытащены из JSON | ✓ FLOWING |
| Общее состояние / stale-флаги | `state`, `backupStale`, `drillStale` | вычисляется при чтении из строк + `readBackupConfig(process.env)` | да — конфиг и времена из БД, не хардкод | ✓ FLOWING |
| Триггеры | `queued` | `queue.add(job, {trigger:"MANUAL"}, …)` на `${prefix}-backup` | да — реальный BullMQ enqueue | ✓ FLOWING |
| Резервный дамп | `fileName`, `sha256`, `byteSize` | реальный `pg_dump` + стримовый sha256 по `.partial` | да — файл на диске, проверено интеграционно | ✓ FLOWING |

### Behavioral Spot-Checks

| Поведение | Команда | Результат | Статус |
| --- | --- | --- | --- |
| Phase-unit (config, backup-job, backup-drill, worker-entry-guard) | `pnpm vitest run --project unit packages/config/src/index.test.ts tests/unit/backup-job.test.ts tests/unit/backup-drill.test.ts tests/unit/worker-entry-guard.test.ts` | 4 файла, **62 теста passed** | ✓ PASS |
| Веб (блок, proxy-route, enum-labels, страница) | `pnpm --filter web test` | 9 файлов, **82 теста passed** | ✓ PASS |
| Полный drill + overview | `pnpm vitest run --project integration tests/integration/backup-restore-drill.test.ts tests/integration/operator-overview.test.ts` | **30 тестов passed** (42 c) | ✓ PASS |
| Неизменяемость обеих таблиц чеков | throwaway `postgres:18-alpine` + `prisma migrate deploy` + `vitest --project integration tests/integration/mutation-rejection.test.ts` | **8 тестов passed**, контейнер `rm --force` удалён после (проверено: `docker ps -a` пуст) | ✓ PASS |
| Схема ↔ миграции согласованы | `pnpm verify:release:schema` | exit 0, «The schema at prisma\schema.prisma is valid» | ✓ PASS |
| Типизация монорепо | `pnpm typecheck` | 7/7 задач успешны | ✓ PASS |
| Антипаттерны в файлах фазы | `grep -E "TBD\|FIXME\|XXX\|PLACEHOLDER\|not yet implemented"` по 14 файлам фазы | 0 совпадений | ✓ PASS |
| Остаточные контейнеры фазы | `docker ps -a --filter "name=bet-stats-"` | пусто (ни один throwaway не остался) | ✓ PASS |

### Probe Execution

Пробы (`scripts/*/tests/probe-*.sh`) в этой фазе не объявлены ни в PLAN, ни в ROADMAP — раздел неприменим.

### Requirements Coverage

| Требование | План | Описание | Статус | Доказательство |
| --- | --- | --- | --- | --- |
| BAK-01 | 08-01 | Оператор может включить автоматические PostgreSQL-бэкапы (`pg_dump` custom) с настраиваемым retention и ротацией | ✓ SATISFIED | `readBackupConfig` (opt-in `BACKUP_ENABLED`), `runBackup` c atomic rename + `BackupRun`, `pruneBackupRetention`, robocopy off-host, дневной persisted-state тик; юнит 62 + интеграционный реальный дамп зелёные |
| BAK-02 | 08-02 | Периодический restore-drill восстанавливает последний бэкап в throwaway-контейнер, применяет миграции, запускает chain-integrity чеки и пишет verification-чек | ✓ SATISFIED | `runBackupDrill` (restore → `migrate deploy/status` → 4 группы чеков → `BackupVerificationReceipt`), недельный `scheduleDrillTick`, обе таблицы append-only (прогнано: 8/8) |
| BAK-03 | 08-03 | Статус бэкапов и верификации виден в operations center без секретов; never-verified и stale — явные не-зелёные состояния | ✓ SATISFIED | 5-state read-time `backups()`, секрето-/path-free payload (тесты), русский блок с 5 состояниями и двумя триггерами (веб-тесты 82/82) |

Осиротевших требований нет: в REQUIREMENTS.md фазе отнесены ровно BAK-01..03, и каждое закреплено за планом в его frontmatter.

### Anti-Patterns Found

| Файл | Паттерн | Серьёзность | Влияние |
| --- | --- | --- | --- |
| — | Задолженных маркеров (TBD/FIXME/XXX/PLACEHOLDER), `return null`-заглушек, пустых обработчиков и консольных-only реализаций в 14 проверенных файлах фазы не найдено | ℹ️ Info | Отсутствует |

### Human Verification Required

1. **Живой реальный бэкап** (VALIDATION §Manual-Only) — выставить `BACKUP_ENABLED=true` + `BACKUP_DIR` в секретном `.env` и нажать «Создать резервную копию сейчас». *Ожидание:* появляется непустой `football_prediction-<UTC>.dump` и строка `SUCCEEDED` в `BackupRun`.
2. **Реальный off-host robocopy** — `BACKUP_OFFSITE_DIR` на настоящий шар/синк-каталог. *Ожидание:* `COPIED` и «Скопировано» в блоке; при недоступности — `DEGRADED` с кодом, локальный бэкап остаётся успешным.
3. **Недельная каденция drill на живом хосте** — тик запускается от последнего чека, блок остаётся зелёным после успешного drill.
4. **Ветка pending-миграций** — дрill при незакоммиченной миграции обязан дать `UNVERIFIED / MIGRATIONS_NOT_AT_HEAD` (ветка есть в коде, выделенного теста нет).
5. **Сбой очистки контейнера** — см. `behavior_unverified_items`: падающий `docker rm` обязан зафиксировать `containerCleanup = 'FAILED'` в чеке.
6. **Живой UI-прогон** обеих кнопок триггеров и отрисовки пяти русских состояний на http://localhost:3000/internal/operations.

### Gaps Summary

Проваленных истин, отсутствующих/заглушечных артефактов и неподключённых key-link'ов не обнаружено — структурированных gaps нет (`gaps:` во frontmatter отсутствует). Автоматически проверяемая часть цели достигнута: бэкапы opt-in и герметично доказаны на настоящем `pg_dump`, drill проходит полный цикл с immutable-чеками, статус в operations center считается при чтении и честно рендерит все не-зелёные состояния без секретов. Статус `human_needed` обусловлен (а) одной истиной о сбое очистки контейнера, чьё поведение не исполняется ни одним тестом, и (б) шестью позициями живой/визуальной проверки, которые принципиально не проверяются grep- и юнит-тестами (реальный продакшн-дамп, реальный off-host шар, недельная каденция, UI-поток).

---

_Verified: 2026-10-26T13:55:57Z_
_Verifier: the agent (gsd-verifier)_
