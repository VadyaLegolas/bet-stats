---
phase: 08-backups-and-restore-verification
verified: 2026-11-01T01:13:27Z
status: gaps_found
score: 20/23 must-haves verified
covered_files:
  - ".env.example"
  - ".planning/phases/08-backups-and-restore-verification/08-01-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-01-SUMMARY.md"
  - ".planning/phases/08-backups-and-restore-verification/08-02-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-02-SUMMARY.md"
  - ".planning/phases/08-backups-and-restore-verification/08-03-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-03-SUMMARY.md"
  - ".planning/phases/08-backups-and-restore-verification/08-04-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-04-SUMMARY.md"
  - ".planning/phases/08-backups-and-restore-verification/08-05-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-05-SUMMARY.md"
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
  - "infra/operator-gateway/security.mjs"
  - "infra/operator-gateway/server.mjs"
  - "package.json"
  - "packages/config/src/index.test.ts"
  - "packages/config/src/index.ts"
  - "packages/database/prisma/migrations/20261022_phase08_backup_runs/migration.sql"
  - "packages/database/prisma/migrations/20261022_phase08_backup_verification_receipts/migration.sql"
  - "packages/database/prisma/migrations/20261024_phase08_backup_byte_size_bigint/migration.sql"
  - "packages/database/prisma/schema.prisma"
  - "scripts/app-lifecycle.ps1"
  - "tests/e2e/live-provider-stack.ts"
  - "tests/e2e/operations-gateway.spec.ts"
  - "tests/integration/backup-restore-drill.test.ts"
  - "tests/integration/mutation-rejection.test.ts"
  - "tests/integration/operator-gateway.test.ts"
  - "tests/integration/operator-overview.test.ts"
  - "tests/unit/backup-drill.test.ts"
  - "tests/unit/backup-job.test.ts"
  - "tests/unit/operator-gateway.test.ts"
  - "workers/data-sync/src/jobs/backup-drill.ts"
  - "workers/data-sync/src/jobs/backup.ts"
  - "workers/data-sync/src/main.ts"
covered_digest: "v3:sha256:2baecddee37293a748cee9a1af0a9c7d1805b80c229f88f0baccae78baa211bb"
behavior_unverified: 2
overrides_applied: 0
gaps:
  - truth: "(08-05) containerCleanup = 'REMOVED' now means the container was verifiably present before rm and verifiably absent after rm — not merely that rm exited 0."
    status: failed
    reason: "Вердикт fail-closed не универсален: backup-drill.ts:450-453 — `survivedRm = !postInspect.spawnError && postInspect.code === 0`, verdict = identityLost || rmFailed || survivedRm ? FAILED : REMOVED. Если ПОСТ-rm inspect не смог выполниться (spawnError) или упал с ошибкой демона (exit≠0, «Cannot connect», неотличимой по коду от «No such object»), все три условия ложны → REMOVED без позитивного доказательства отсутствия. Это прямо противоречит комментарию backup-drill.ts:445-446 («REMOVED therefore requires positive inspect evidence twice; every other path fails closed to FAILED») и инварианту G-08-5/T-08-21. Независимо подтверждено 08-REVIEW.md (WR-01, open). Покрытия нет: в tests/unit/backup-drill.test.ts нет кейса с post-rm spawnError (тест F покрывает только ПРЕ-rm spawnError). Детерминированно выводимый контрпример — не требует рантайма."
    artifacts:
      - path: "workers/data-sync/src/jobs/backup-drill.ts"
        issue: "строки 450-453: post-rm spawnError / ошибка демона не включены в условия FAILED — fall-through к REMOVED; комментарий 445-446 описывает поведение, которого нет"
      - path: "tests/unit/backup-drill.test.ts"
        issue: "grep-0 на кейс `inspects: [INSPECT_FOUND, postSpawnGone]` — fail-open ветка не охраняется тестом (совпадает с WR-01)"
    missing:
      - "Требовать для REMOVED успешный (не spawn_error) пост-rm inspect, дошедший до демона, с exit≠0 и без признаков ошибки демона («cannot connect»), иначе FAILED — патч WR-01 из 08-REVIEW.md"
      - "Юнит-тест: pre-rm inspect OK, rm OK, post-rm inspect spawnError → FAILED (зеркало теста F) — и, по желанию, пост-rm «daemon unreachable» → FAILED"
behavior_unverified_items:
  - truth: "(08-04) An operator opens http://127.0.0.1:8080/internal/operations in a normal browser, authenticates once with Basic auth, and every operations block renders with real data instead of «Этот операционный блок недоступен»."
    test: "Открыть http://127.0.0.1:8080/internal/operations в обычном браузере после scripts\app-lifecycle.ps1 -Action Start, авторизоваться Basic-кредами из .env"
    expected: "«Центр операций» и все блоки операций рендерятся с реальными данными; «Этот операционный блок недоступен» не показывается"
    why_human: "Артефакты на месте и подключены (security.mjs защищает пути, шлюз живёт на :8080 — live 401, интеграционный тест подписи 12/12), e2e specs tests/e2e/operations-gateway.spec.ts существует (заявлено 4/4 исполнителем и просмотрено ревью), но мной он не запускался: readLiveReleaseState() требует поднятого owned release-стека (файл состояния отсутствует), а поднимать сервисы в верификации запрещено. Полноценный браузерный прогон цепочки не упражнён ни одним тестом в моём процессе — это предмет UAT-ретеста G-08-6"
  - truth: "(08-04) Both trigger buttons («Создать резервную копию сейчас» и «Запустить проверку восстановления сейчас») work for the operator through the gateway and report «поставлена в очередь…» via role=status."
    test: "В живом браузере через шлюз нажать обе кнопки триггеров"
    expected: "role=status «Резервная копия поставлена в очередь…» и «Проверка восстановления поставлена в очередь…», страница обновляется через load()"
    why_human: "Составные части проверены (подпись gateway→proxy — интеграционно, enqueue/202 — operator-overview 24/24, рендер кнопок и status — веб-тесты 82/82), но сквозное нажатие браузером исполняется только в незапущенном мной e2e (см. п. 1); визуальный поток и живой 202 — предмет UAT-ретеста G-08-6"
---

# Phase 8: Backups and Restore Verification — Отчёт верификации

**Цель фазы (ROADMAP):** An operator can enable automated PostgreSQL backups and trust them because a scheduled restore drill proves every backup actually restores — with never-verified and stale states rendered honestly in the operations center.
**Верифицировано:** 2026-11-01T01:13:27Z
**Статус:** gaps_found
**Режим:** предыдущий `08-VERIFICATION.md` не содержал `gaps:` (human_needed, 16/17) — формально первичный режим, но данная верификация выполнена как свежий goal-backward проход ВСЕЙ фазы (планы 08-01..08-05) после UAT (`08-UAT.md`, gaps G-08-6/G-08-5) и их закрывающих планов 08-04/08-05, с особым вниманием к gap-closure-поставкам.

## Достижение цели (Goal Achievement)

Цель разложена на 3 success criteria ROADMAP и 23 must-have-истины из пяти PLAN-ов (7 + 5 + 5 + 3 + 3). Требования сведены к планам: BAK-01 → 08-01; BAK-02 → 08-02 + 08-05 (gap-closure честности вердикта); BAK-03 → 08-03 + 08-04 (gap-closure ingress). В `.planning/REQUIREMENTS.md` все три ID отнесены к Phase 8 (строки 18-20, 102-104) — осиротевших требований нет, и каждый ID закреплён в frontmatter соответствующего плана.

### Observable Truths

| # | Истина | Статус | Доказательство |
| --- | --- | --- | --- |
| 1 | (08-01) Настоящий `pg_dump -Fc` даёт непустой файл + ровно одну строку `BackupRun SUCCEEDED`; сбойный дамп → `FAILED`, без `.dump`, ничего не удаляется | ✓ VERIFIED | Интеграционный `tests/integration/backup-restore-drill.test.ts` прогнан мной: кейсы «one real non-empty dump…sha256», «FAILED и без дампа при недоступной БД», «PG_IDENTITY_UNRESOLVED без вызова дампа» — 7/7 |
| 2 | (08-01) Ротация оставляет ровно новейшие `BACKUP_RETENTION_COUNT` (14) и только после успеха | ✓ VERIFIED | `tests/unit/backup-job.test.ts` прогнан мной (в составе 37/37 с config): prune-after-success, no-prune-on-dump-failure |
| 3 | (08-01) Незаданный `BACKUP_OFFSITE_DIR` → `NOT_CONFIGURED`; сбой robocopy → локальный `SUCCEEDED` + off-host `DEGRADED` с кодом | ✓ VERIFIED | `backup-job.test.ts`: COPIED/DEGRADED-кейсы, spawn ENOENT, offsite без настройки не вызывается; UAT-тест 2 (живой robocopy обе половины) — pass |
| 4 | (08-01) Ежесуточный тик вооружается из persisted-состояния `BackupRun` (паттерн setTimeout), без BullMQ repeat-опций | ✓ VERIFIED | `scheduleBackupTick` + юнит-кейсы idle/anchor/re-arm/close; `main.ts` `startBackupRuntime`; UAT-тест 3 (живая каденция) — pass |
| 5 | (08-01) Креды только через child env; payload BullMQ несёт только trigger-дискриминатор | ✓ VERIFIED | `backup-job.test.ts`: argv без conninfo, conn-поля только в `options.env`, job data ровно `{trigger}` |
| 6 | (08-01) docker-exec fallback берёт роль/БД из конфига или env контейнера, иначе fail-closed `PG_IDENTITY_UNRESOLVED` | ✓ VERIFIED | Интеграционный кейс `PG_IDENTITY_UNRESOLVED` без вызова дампа (прогнан); argv `-U postgres -d bet_stats` из резолвленной идентичности |
| 7 | (08-01) `sha256` считается с `.partial` до rename | ✓ VERIFIED | Интеграционный кейс пересчитывает hash от файла и сравнивает со строкой чека (прогнан) |
| 8 | (08-02) Drill восстанавливает новейший дамп в throwaway-контейнер, доводит миграции до head, проходит chain-integrity, удаляет контейнер, пишет один `BackupVerificationReceipt` | ✓ VERIFIED | Интеграционный «VERIFIED verification receipt» (прогнан мной, реальный Docker): `containerCleanup REMOVED`, аудит `checks.containerCleanup` с реальными exit-кодами, контейнер отсутствует в `docker ps -a` |
| 9 | (08-02) Docker недоступен / pending-миграция / ошибка restore / проваленный чек → FAILED или UNVERIFIED; drill не может молча пройти | ✓ VERIFIED | Юнит `backup-drill.test.ts` (29/29 прогнаны): DOCKER_UNAVAILABLE, PG_IDENTITY_UNRESOLVED, RESTORE_FAILED, CHAIN_INTEGRITY_FAILED; ветка `MIGRATIONS_NOT_AT_HEAD` (backup-drill.ts:406-411) — живо доказана UAT-тестом 4 (pass: `UNVERIFIED/MIGRATIONS_NOT_AT_HEAD`) |
| 10 | (08-02) Сбой очистки фиксируется в чеке, а не скрывается; имя owned-unique; удаление в `finally` | ✓ VERIFIED | Теперь поведенчески: юнит A-F (FAILED-ветки, включая потерю идентичности и spawnError) + интеграционный негатив (pre-rm inspect exit 1 → `containerCleanup FAILED` при `overall VERIFIED` в той же immutable-строке) — прогнаны мной. Апгрейд с ⚠️ round-1: ветка падения больше не «только на присутствии кода» |
| 11 | (08-02) Паритет: FAIL только при restored < captured, позитивные дельты пишутся, таблицы с нулевым source → SKIPPED | ✓ VERIFIED | Юнит-кейсы паритета/дельт/SKIPPED прогнаны (29/29) |
| 12 | (08-02) Обе таблицы чеков отвергают UPDATE и DELETE на уровне БД | ✓ VERIFIED | Прогнано мной на свежем throwaway `postgres:18-alpine` (миграции применены, контейнер удалён после): `tests/integration/mutation-rejection.test.ts` 8/8, включая `BackupRun`/`BackupVerificationReceipt` с `/immutable/i` |
| 13 | (08-03) Секция `backups` со state, считаемым при чтении: NOT_CONFIGURED / NEVER_VERIFIED / STALE / FAILED / HEALTHY; зелёный только при свежем бэкапе + прошедшем + неустаревшем drill | ✓ VERIFIED | `tests/integration/operator-overview.test.ts` прогнан мной: 24/24, `computeBackupFact` read-time с инжектированным clock |
| 14 | (08-03) Бэкап >25 ч → STALE, drill старше интервала+grace → drill-stale, оба не-зелёные даже при последнем VERIFIED | ✓ VERIFIED | Границы 24h59m/25h01m/192h01m в operator-overview (24/24) + веб-тест «never renders green «Здорово»» (82/82) |
| 15 | (08-03) Payload overview без connection string, кредов и директорий — только имена файлов, размеры, времена, коды, исходы чеков | ✓ VERIFIED | operator-overview: нет scheme-marker/пути каталога; `redactSecrets` + `safeFileName`; веб «never renders a directory path». Новая аудит-запись `checks.containerCleanup` несёт только системное имя `bet-stats-drill-pg-<pid>-<ts>` и exit-коды (без секретов) |
| 16 | (08-03) Триггеры идут gateway → подписанный proxy → OperatorGuard; неверный кред → унифицированный 404 без оракула | ✓ VERIFIED | Куски цепочки поведенчески зелёные: интеграционный шлюз (подпись против канонической строки Next-прокси), route.test (метод в подписи), operator-overview (enqueue/404). Live-прогнано: `GET :3000/internal-api/operations/overview` без подписи → ровно `404 {"message":"Not found"}`; шлюз на :8080 → `401` на незащищённый путь. Сквозной браузерный прогон — истины 18-19 ниже |
| 17 | (08-03) Русский блок «Резервные копии и проверка восстановления» с двумя кнопками; never-verified / stale / failed / not-configured — явные не-зелёные состояния | ✓ VERIFIED | `backup-status-block.tsx` + `enum-labels.ts` смонтированы в `page.tsx`; веб-набор 82/82 прогнан мной (в т.ч. оба cleanup-лейбла «Контейнер удалён»/«Не удалось удалить контейнер») |
| 18 | (08-04) Оператор открывает :8080/internal/operations в обычном браузере, один раз проходит Basic auth, все блоки рендерятся с реальными данными | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Артефакты на месте и подключены: `security.mjs` (protectedPrefixes включает `/internal/operations`, `/internal-api/operations`, segment-boundary), `server.mjs:114-125` (Basic-гейт + подпись с методом), шлюз живёт на :8080 (live 401). Юнит 17/17 и интеграционный 12/12 прогнаны. E2E `operations-gateway.spec.ts` существует (исполнитель: 4/4, ревью просмотрело), но мной не запускался (нет owned release-стека; поднимать сервисы запрещено) — см. behavior_unverified_items |
| 19 | (08-04) Обе кнопки триггеров работают у оператора через шлюз и отвечают «поставлена в очередь…» через role=status | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Составные звенья зелёные (подпись, enqueue 202, рендер кнопок), live-стек: шлюз отвечает 401-челленджем; сквозное нажатие браузером — только в незапущенном e2e/UAT — см. behavior_unverified_items |
| 20 | (08-04) Fail-closed 404 прокси для неподписанных `/internal-api/operations` не изменён — dev-обхода нет | ✓ VERIFIED | Live: `fetch http://127.0.0.1:3000/internal-api/operations/overview` → `404 {"message":"Not found"}`; негативные e2e-пробы (401 на шлюзе / 404 на web) написаны plain-`fetch` (без инъекции кредов Playwright); route.test зелёный в веб-наборе 82/82 |
| 21 | (08-05) Drill, у которого throwaway-контейнер переименован/удалён ДО очистки, пишет containerCleanup = 'FAILED', никогда ложный 'REMOVED' | ✓ VERIFIED | Юнит A (pre-rm inspect exit 1 → FAILED даже при rm=0 и post=1) + интеграционный негатив на живом демоне (forced pre-rm miss → `FAILED` в результате и в персистентной строке при `overall VERIFIED`) — прогнаны мной. Остаточное окно rename МЕЖДУ pre-inspect и rm — WR-02 (см. Anti-Patterns), за пределами данной истины («до очистки») |
| 22 | (08-05) containerCleanup = 'REMOVED' теперь означает verifiably present до rm и verifiably absent после rm — не merely exit-код rm | ✗ FAILED | Контрпример в коде: `backup-drill.ts:450-453` — post-rm `spawnError` (inspect не выполнился) или exit≠0 с ошибкой демона → все условия FAILED ложны → REMOVED без позитивного доказательства отсутствия; противоречит комментарию 445-446 и требованию G-08-5. Подтверждено 08-REVIEW.md WR-01 (open); тестовой охраны нет (grep-0 на post-spawnError). См. `gaps:` |
| 23 | (08-05) Исход очистки никогда не перекрашивает заработанный overall drill | ✓ VERIFIED | Юнит E (VERIFIED + post-rm survival → `overall VERIFIED` c `containerCleanup FAILED` в той же immutable-строке) + интеграционный негатив — прогнаны мной; `record()` структурно пишет оба поля независимо |

**Score:** 20/23 истин верифицировано (2 — present, behavior-unverified; 1 — провал → gap)

### Required Artifacts

| Артефакт | Ожидание | Статус | Детали |
| --- | --- | --- | --- |
| `packages/config/src/index.ts` | `readBackupConfig` + `BackupConfig` fail-closed | ✓ VERIFIED | 143 строки; дефолты 14/168; юнит-тест прогнан |
| `…/20261022_phase08_backup_runs/migration.sql` | `BackupRun` + sha256 + guard-триггер | ✓ VERIFIED | `guarded_append_only`, чек-constraint'ы |
| `…/20261022_phase08_backup_verification_receipts/migration.sql` | `BackupVerificationReceipt` + guard-триггер | ✓ VERIFIED | `guard_backup_verification_receipt()`, immutable-тесты 8/8 прогнаны |
| `…/20261024_phase08_backup_byte_size_bigint/migration.sql` | int4 → bigint | ✓ VERIFIED | схема синхронна (prisma validate в ходе schema-gate) |
| `workers/data-sync/src/jobs/backup.ts` | `runBackup`, `resolvePgTools/Identity`, `pruneBackupRetention`, `copyOffsite`, `scheduleBackupTick`, queue-фабрики | ✓ VERIFIED | 493 строки; подключён в `main.ts` |
| `workers/data-sync/src/jobs/backup-drill.ts` | `runBackupDrill`, `captureSourceCounts`, `runChainIntegrityChecks`, `scheduleDrillTick` + (08-05) pre/rm/post inspect-верификация и `checks.containerCleanup` | ✓ VERIFIED (с gap по истине 22) | 3-step вердикт (строки 447-465) реализован и подключён; аудит `{containerName, preInspect, rmExitCode, postInspect, verdict}` пишется в immutable-чек — но fail-open-угол (WR-01) ломает истину 22 |
| `tests/integration/backup-restore-drill.test.ts` | герметичный dump + FAILED-путь + (08-05) inspect-последовательность и негатив | ✓ VERIFIED | 7/7 прогнан на реальном Docker |
| `README.md` | заметка оператору о персональных данных в дампах | ✓ VERIFIED | раздел про `BACKUP_DIR`/`BACKUP_OFFSITE_DIR`, ACL/шифрование |
| `operations.service.ts` | `backups()`, `BackupFact`, 5-state read-time, `triggerBackup/triggerDrill` | ✓ VERIFIED | 290 строк; `redactSecrets` на выходе; 24/24 теста |
| `operations.controller.ts` | два POST под OperatorGuard | ✓ VERIFIED | `@HttpCode(202)`, guard на классе |
| `…/internal-api/operations/[[...path]]/route.ts` | POST-прокси с методом в подписи | ✓ VERIFIED | live fail-closed 404 + route.test |
| `…/internal/operations/backup-status-block.tsx` | операторский блок | ✓ VERIFIED | русские подписи, две кнопки, role=status/alert |
| `page.tsx`, `enum-labels.ts` | монтирование блока + лейблы | ✓ VERIFIED | 5+3 маппинга |
| `infra/operator-gateway/security.mjs` (08-04) | protected-path покрывает `/internal*/operations*` | ✓ VERIFIED | `protectedPrefixes` включает оба operations-префикса, segment-boundary (11-12); юнит protects/public-кейсы 17/17 |
| `infra/operator-gateway/server.mjs` (08-04) | Basic-гейт + HMAC-подпись для всех protected-путей | ✓ VERIFIED | строки 114-125: `authenticateBasic` → отказ 401 без upstream-хопа; подпись с `method` |
| `scripts/app-lifecycle.ps1` (08-04) | dev-лаунчер поднимает/останавливает/показывает шлюз | ✓ VERIFIED | `-Gateway` ветка (117-128), спавн 5/5 (187-194), `Get-StackPids` ловит gateway (71-72), Stop гасит, Status показывает; best-effort не валит стек. Live: шлюз на :8080 отвечает. Оговорка WR-03 — Status/Stop без Load-Env при нестандартном `GATEWAY_PORT` |
| `.env.example` (08-04) | `GATEWAY_PORT=8080` документирован | ✓ VERIFIED | строка 11 |
| `tests/e2e/operations-gateway.spec.ts` (08-04) | браузер через шлюз без синтезированных HMAC-заголовков + негативы | ⚠️ PRESENT (не запускался мной) | 118 строк, 2 теста (desktop+mobile по заявлению — 4/4); wired в `verify:release` (package.json). Поведение не упражнено в моём процессе — ист. 18-19 |
| `tests/e2e/live-provider-stack.ts` (08-04) | owned API получает `BACKUP_ENABLED=true` + mkdtemp `BACKUP_DIR` | ✓ VERIFIED | строка 91 |
| `tests/unit/backup-drill.test.ts` (08-05) | FAILED-ветка (A-F) | ✓ VERIFIED | describe «inspect-verified (G-08-5)» с 6 кейсами; 29/29 прогнан; остаточный пробел — post-rm spawnError (gap) |
| `tests/unit/operator-gateway.test.ts` (08-04) | protects/public-кейсы сегментной границы | ✓ VERIFIED | 17/17 прогнан |
| `tests/integration/operator-gateway.test.ts` (08-04) | signed-operations boundary через спавн-шлюз | ✓ VERIFIED | 12/12 прогнан: unsigned → 401 без upstream, Basic → подпись, пересчитанная канонической строкой Next-прокси |

### Key Link Verification

| From | To | Via | Статус | Детали |
| --- | --- | --- | --- | --- |
| `readBackupConfig` | `runBackup` → `BackupRun` | `startBackupRuntime` в `main.ts` | WIRED | нет конфига → `FAILED BACKUP_NOT_CONFIGURED` / `backup.disabled`, никогда молча |
| `resolvePgTools` → `resolvePgIdentity` → fail-closed | `pg_dump`/`pg_restore` с явными `-U`/`d` | `backup.ts` + импорт в drill | WIRED | `PG_IDENTITY_UNRESOLVED` без вызова инструментов (прогнано) |
| `scheduleBackupTick` → `bet-stats-backup` → `createBackupWorker` → `runBackup` | тик → enqueue → execute | `main.ts` | WIRED | concurrency 1, jobId-бакеты, без `repeat:` |
| `scheduleDrillTick` → `runBackupDrill` | тик → `executeDrill` | `main.ts`, тот же воркер | WIRED | dispatch «drill»/«backup» |
| новейший дамп → throwaway → `migrate deploy/status` → chain-integrity → `BackupVerificationReceipt` | весь конвейер | `backup-drill.ts` | WIRED | порядок совпадает с D-08; `finally`-очистка; прогнано 7/7 |
| pre-rm `docker inspect` → `rm --force` → post-rm `docker inspect` → `containerCleanup` → `checks.containerCleanup` в immutable-чек | вердикт очистки (08-05) | `backup-drill.ts:447-464` | WIRED | последовательность по одному имени, аудит пишется; поведение доказано юнит+интеграционно. **Но семантика REMOVED ломается в spawnError-угле — gap (ист. 22)** |
| `BackupRun` + `BackupVerificationReceipt` → `backups()` → overview payload → веб-блок | Prisma findFirst → `computeBackupFact` → `backups:` → `fetch` в `page.tsx` → `BackupStatusBlock` | service + page | WIRED | см. Data-Flow |
| read-time staleness (25h / interval+24h) | `computeBackupFact(rows, current)` с инжектированным clock | `operations.service.ts` | WIRED | значение не сохраняется |
| шлюз: Basic → `signedOperatorHeaders` (метод в каноне) → web POST-proxy → `OperatorGuard` → BullMQ | ingress-цепочка (08-04) | `security.mjs` → `server.mjs:114-125` → `route.ts` → controller | WIRED | интеграционно: подпись верифицируется канонической строкой прокси; unsigned → 401 на шлюзе; live: 401/404 |
| `scripts/app-lifecycle.ps1 -Gateway` → `infra/operator-gateway/server.mjs` на :8080 | documented dev topology (08-04) | спавн после readiness, `Get-StackPids`/Stop/Status | WIRED | live-факт: шлюз слушает :8080 и отдаёт 401-челлендж |

### Data-Flow Trace (Level 4)

| Артефакт | Переменная | Источник | Реальные данные | Статус |
| --- | --- | --- | --- | --- |
| «Последняя резервная копия» | `lastBackup` | `database.backupRun.findFirst({status:"SUCCEEDED"})` + явные select'ы | да — реальные строки `BackupRun` | ✓ FLOWING |
| «Последняя проверка восстановления» + failed checks | `lastDrill`, `failedDrillChecks(checks)` | `backupVerificationReceipt.findFirst` | да — реальные строки чека, имена чеков из JSON | ✓ FLOWING |
| Общее состояние / stale-флаги | `state`, `backupStale`, `drillStale` | read-time из строк + `readBackupConfig(process.env)` | да — конфиг и времена из БД | ✓ FLOWING |
| Аудит очистки (08-05) | `checks.containerCleanup` | реальные exit-коды `docker inspect/rm` в `runBackupDrill` | да — пишется в immutable-строку, проходит `redactSecrets` и закрытый DTO; лейблы «Контейнер удалён»/«Не удалось удалить контейнер» покрыты веб-тестами | ✓ FLOWING (семантика REMOVED — gap см. ист. 22) |
| Триггеры | `queued` | `queue.add(job, {trigger:"MANUAL"})` | да — реальный BullMQ enqueue (24/24) | ✓ FLOWING |
| Резервный дамп | `fileName`, `sha256`, `byteSize` | реальный `pg_dump` + стримовый sha256 по `.partial` | да — файл на диске, интеграционно | ✓ FLOWING |

### Behavioral Spot-Checks

| Поведение | Команда | Результат | Статус |
| --- | --- | --- | --- |
| Юнит: drill-вердикт + шлюз | `pnpm vitest run --project unit tests/unit/backup-drill.test.ts tests/unit/operator-gateway.test.ts` | 2 файла, **46 passed**, 2.3s | ✓ PASS |
| Юнит: backup-job + config (BAK-01) | `pnpm vitest run --project unit tests/unit/backup-job.test.ts packages/config/src/index.test.ts` | 2 файла, **37 passed**, 1.4s | ✓ PASS |
| Интеграционный: шлюз (спавн, подпись, 401) | `pnpm vitest run --project integration tests/integration/operator-gateway.test.ts` | **12 passed**, 13.9s | ✓ PASS |
| Полный drill + негатив cleanup (реальный Docker) | `pnpm vitest run --project integration tests/integration/backup-restore-drill.test.ts` | **7 passed**, 63.6s | ✓ PASS |
| 5-state overview | `pnpm vitest run --project integration tests/integration/operator-overview.test.ts` | **24 passed**, 4.8s | ✓ PASS |
| Веб (блок, proxy-route, enum-labels, страница) | `pnpm --filter "@bet-stats/web" test` | 9 файлов, **82 passed** | ✓ PASS |
| Неизменяемость чек-таблиц | throwaway `postgres:18-alpine` (`-P`) + `prisma migrate deploy` + `vitest --project integration tests/integration/mutation-rejection.test.ts` | **8 passed**, контейнер `rm --force` удалён (проверено: пусто) | ✓ PASS |
| Полный юнит+веб гейт (единственный полный прогон) | `pnpm test` | 46/47 файлов, **444/451 passed**; единственный отказ — известный предсуществующий `tests/unit/fixtures-sync.test.ts` (7 failed, live-DB auth `user`) — вне scope фазы | ✓ PASS (с известным исключением) |
| Типизация | `pnpm typecheck` | 7/7 задач | ✓ PASS |
| Live: fail-closed прокси | `fetch http://127.0.0.1:3000/internal-api/operations/overview` | `404 {"message":"Not found"}` | ✓ PASS |
| Live: шлюз защищает operations-путь | `GET http://127.0.0.1:8080/internal/operations` | `401` (Basic-челлендж; шлюз живёт в документированной топологии) | ✓ PASS |
| Коммиты gap-closure | `gsd_run query verify.commits ad57d8b 0ea8210 5da9972 b99e75e 5dcca8e 657fb6f 2e41fb4 4be8bb1` | 8/8 valid, exit 0 | ✓ PASS |
| Антипаттерны/задолженность | `grep -E "TBD\|FIXME\|XXX\|PLACEHOLDER\|not yet implemented"` по 12 файлам gap-closure | 0 совпадений | ✓ PASS |
| E2E браузер через шлюз | `playwright test -c playwright.phase06.config.ts tests/e2e/operations-gateway.spec.ts` | **SKIP** — требует поднятого owned release-стека (`readLiveReleaseState()` без файла состояния); поднимать сервисы в верификации запрещено → см. Behavior-unverified / UAT-ретест | ? SKIP |

### Probe Execution

Пробы (`scripts/*/tests/probe-*.sh`) в этой фазе не объявлены ни в одном из 5 PLAN, ни в ROADMAP — раздел неприменим.

### Requirements Coverage

| Требование | План(ы) | Описание | Статус | Доказательство |
| --- | --- | --- | --- | --- |
| BAK-01 | 08-01 | Оператор может включить автоматические PostgreSQL-бэкапы (`pg_dump` custom) с настраиваемым retention и ротацией | ✓ SATISFIED | `readBackupConfig` (opt-in), `runBackup` atomic rename + `BackupRun`, `pruneBackupRetention`, robocopy off-host, persisted-state тик; юнит 37 + интеграционный 7/7 + live UAT-тесты 1-2 (pass) |
| BAK-02 | 08-02, 08-05 | Периодический restore-drill восстанавливает последний бэкап в throwaway-контейнер, применяет миграции, запускает chain-integrity и пишет verification-чек | ✓ SATISFIED (с gap в суб-инварианте честности cleanup-вердикта) | Текст требования выполнен: полный конвейер доказан интеграционно 7/7, обе таблицы append-only 8/8, недельный тик. Gap касается честности поля `containerCleanup` в corner-случае (ист. 22) — отражён в `gaps:`, требование не заблокировано |
| BAK-03 | 08-03, 08-04 | Статус бэкапов и верификации виден в operations center без секретов; never-verified и stale — явные не-зелёные состояния | ✓ SATISFIED | 5-state read-time `backups()` (24/24), секрето-/path-free payload (тесты), русский блок с 5 состояниями и двумя кнопками (веб 82/82), ingress: шлюз подписывает operations-пути (17/17 + 12/12), прокси fail-closed live 404; сквозной браузерный ретест — UAT G-08-6 |

Осиротевших требований нет: REQUIREMENTS.md относит к Phase 8 ровно BAK-01..03, каждый закреплён в frontmatter планов (08-01 → BAK-01; 08-02, 08-05 → BAK-02; 08-03, 08-04 → BAK-03).

### Anti-Patterns Found

| Файл | Паттерн | Серьёзность | Влияние |
| --- | --- | --- | --- |
| `workers/data-sync/src/jobs/backup-drill.ts:450-453` | **WR-01** (08-REVIEW, open): post-rm inspect spawnError / ошибка демона → fall-through к REMOVED без позитивного доказательства отсутствия; противоречит комментарию 445-446 и G-08-5 | 🛑 BLOCKER | Является основанием gap по истине 22 (см. `gaps:`) |
| `workers/data-sync/src/jobs/backup-drill.ts:331-345,447-449` | **WR-02** (open): вердикт ключуется на изменяемом ИМЕНИ контейнера, хотя ID доступен из stdout `docker run`; rename в окне между pre-inspect и rm может дать ложный REMOVED (остаточная гонка внутри последовательности очистки) | ⚠️ Warning | Истина 21 (rename ДО очистки) не затронута и доказана тестами; окно — миллисекунды внутри cleanup. Рекомендация: ключевать по container ID |
| `scripts/app-lifecycle.ps1:27,130-148` | **WR-03** (open): Stop/Status не вызывают `Load-Env` — при нестандартном `GATEWAY_PORT` Status/Stop репортят/проверяют 8080 | ⚠️ Warning | При документированном дефолте 8080 корректно; Stop и так убивает шлюз по CommandLine-regex (71-72). Must-have «лаунчер запускает/останавливает шлюз» выполнен |
| `infra/operator-gateway/server.mjs:163` | **WR-04** (open): шлюз слушает `0.0.0.0` — cleartext Basic и подписанные operations-триггеры доступны с LAN | ⚠️ Warning (security) | Bind существовал до фазы; фаза повысила экспозицию (operations поверх replay). Рекомендация: default `127.0.0.1` + `GATEWAY_BIND`. Ни одно must-have истиной bind не покрыто |
| `scripts/app-lifecycle.ps1:49-54,133` | **IN-01** (open): probe готовности шлюза путём `/` конфлюит «шлюз down» с «upstream down» | ℹ️ Info | В штатной топологии (стек поднят) Status корректен |
| `workers/data-sync/src/jobs/backup-drill.ts:447-449` | **IN-02** (open): три exec-вызова в `finally` не обёрнуты try/catch — бросающий exec мог бы пропустить `record()` (без чека) | ℹ️ Info | Латентно: `spawnBackupExec`/тестовые дубли возвращают `spawnError`, не бросают. Чек-отсутствие ≠ «молча пройти» (never-verified рендерится честно) |
| `tests/unit/operator-gateway.test.ts:72-76` | **IN-03** (open): тест ассертит исходный текст `security.mjs`, а не поведение | ℹ️ Info | Хрупкость реформата; поведение покрыто спавн-интеграционными тестами |
| — | Задолженных маркеров (TBD/FIXME/XXX/PLACEHOLDER), `return null`-заглушек, пустых обработчиков в 12 gap-closure-файлах и остальных файлах фазы не найдено | ℹ️ Info | Отсутствует |

Все 7 находок ревью записаны `open` в `08-REVIEW-DISPOSITION.md`; выше они взвешены по отношению к must-haves: только WR-01 ломает истину, остальные — advisory.

### Human Verification Required

(Статус `gaps_found`: раздел фиксирует остаточные human-пункты; фронтmatter `human_verification` по контракту заполняется только при `human_needed`.)

1. **UAT-ретест G-08-6 — живой браузер оператора** (покрывает истины 18-19): `scripts\app-lifecycle.ps1 -Action Start`, открыть **http://127.0.0.1:8080/internal/operations**, авторизоваться Basic-кредами из `.env`.
   *Ожидание:* «Центр операций» и все блоки с реальными данными (без «Этот операционный блок недоступен»); обе кнопки отвечают «поставлена в очередь…»; `-Action Status` показывает `gateway(:8080)=up`.
   *Почему человек:* сквозной браузерный путь исполняется только e2e на owned release-стеке (мной не запускался) и живым прогоном; визуал и поток не проверяются grep-тестами.
2. **UAT-ретест G-08-5 — живой чек очистки**: выполнить drill и прочитать строку `BackupVerificationReceipt`.
   *Ожидание:* `checks.containerCleanup = { containerName, preInspect: 0, rmExitCode: 0, postInspect: ≠0, verdict: "REMOVED" }`; переименование контейнера до окна очистки даёт `FAILED` при нетронутом `overall`; UI показывает «Контейнер удалён»/«Не удалось удалить контейнер» соответственно.
   *Почему человек:* подпись живого receipt и UI-лейблов на реальном хосте.

(Успешно пройденные UAT-тесты 1-4 — живой бэкап, off-host robocopy, недельная каденция, ветка `MIGRATIONS_NOT_AT_HEAD` — ранее подтверждены и в human-пункты не возвращаются.)

### Gaps Summary

Автоматически проверяемая часть цели достигнута существенно: бэкапы opt-in доказаны на настоящем `pg_dump` (7/7 + юниты), drill проходит полный цикл с immutable-чеками на реальном Docker, обе таблицы append-only (8/8), 5-state read-time честно рендерит все не-зелёные состояния без секретов (24/24 + веб 82/82), ingress-закрытие G-08-6 реализовано и подключено (шлюз подписывает `/internal*/operations*`, живёт в dev-топологии — live 401, неподписанный прокси — live 404), закрытие G-08-5 заменило exit-код на inspect-последовательность с юнит A-F и интеграционным негативом.

Статус `gaps_found` обусловлен ровно одной проваленной истиной (22): новый вердикт очистки остаётся fail-open в двух corner-случаях пост-rm inspect (spawnError и недоступный демон → REMOVED без доказательства отсутствия), что противоречит собственному комментарию кода и инварианту G-08-5/T-08-21, и не покрыто тестом (WR-01, grep-0). Исправление локально описано в 08-REVIEW.md (предложен патч + зеркальный юнит-кейс). Две истины (18-19) — browser-цепочка 08-04 — присутствуют и подключены, но их сквозное поведение не упражнено ни одним тестом в моём процессе (e2e требует owned release-стека), поэтому они вынесены в `behavior_unverified_items` и на UAT-ретест.

Отклонённых в более поздние фазы пунктов нет: ни одна поздняя фаза roadmap не покрывает cleanup-вердикт drill'а (следующая — observability/алерты, не эти corner-случаи).

---

_Verified: 2026-11-01T01:13:27Z_
_Verifier: the agent (gsd-verifier)_
