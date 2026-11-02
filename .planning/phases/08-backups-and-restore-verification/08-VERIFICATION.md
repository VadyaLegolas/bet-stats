---
phase: 08-backups-and-restore-verification
verified: 2026-11-02T15:04:35Z
status: gaps_found
score: 23/26 must-haves verified
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
  - ".planning/phases/08-backups-and-restore-verification/08-06-PLAN.md"
  - ".planning/phases/08-backups-and-restore-verification/08-06-SUMMARY.md"
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
covered_digest: "v3:sha256:3973d39042293070dc69cc97ae9c879420a7477779e369d8a9613a27d3be0349"
behavior_unverified: 2
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 20/23
  gaps_closed:
    - "(08-05/WR-01) post-rm inspect со spawnError → REMOVED: закрыто — backup-drill.ts:489 требует !postInspect.spawnError, юнит-кейс G зелёный"
    - "(08-05/WR-01) post-rm «daemon unreachable» stderr → REMOVED: закрыто — isDockerUnreachableError() (backup-drill.ts:233-240) узкий (cannot connect / error during connect / is the docker daemon running), канонический «Error response from daemon: No such container» не матчится — юнит-кейс H зелёный, регресс C зелёный"
    - "(IN-02) throw из cleanup-exec мог обойти record(): закрыто — safeCleanupRun() (backup-drill.ts:473-479) ограждает каждый из трёх вызовов, юнит-кейс I зелёный"
    - "grep-0 тестового покрытия fail-open ветки устранён: кейсы G/H/I в tests/unit/backup-drill.test.ts, файл 32/32"
  gaps_remaining:
    - "(08-05/08-06) истина 22: остаточный fail-open corner WR-05 — пост-rm inspect с code: undefined БЕЗ spawnError проходит `code !== 0` и записывает REMOVED без exit-кода (см. gaps)"
  regressions: []
gaps:
  - truth: "(08-05/08-06) containerCleanup = 'REMOVED' фиксируется только при позитивном доказательстве: контейнер присутствовал до rm И пост-rm inspect дошёл до демона и вернул не-нулевой exit-код — любое другое пост-rm состояние пишет 'FAILED' (два бюллетена предыдущего gap закрыты; остаётся третий reachable-кейс)."
    status: failed
    reason: "Первые две контрпримеры предыдущего раунда действительно закрыты (G/H зелёные, каноническое отсутствие — REMOVED по C, IN-02 закрыт по I), но условие «exited non-zero» реализовано как `postInspect.code !== 0` (backup-drill.ts:489), а тип поля — `number | undefined`. Состояние `{ code: undefined }` без spawnError удовлетворяет `undefined !== 0` и, при pre-inspect-hit и rm=0, записывает REMOVED, хотя inspect НЕ вернул ни одного exit-кода и не сообщил об отсутствии контейнера — позитивного доказательства отсутствия нет. Reachable в проде: spawnBackupExec (backup.ts:43-60) устанавливает spawnError только из таймера таймаута и события 'error'; ребёнок, убитый сигналом (краш docker CLI, внешний kill, OOM), даёт close(code=null) → settle(undefined) без spawnError — воспроизведено мной отдельным node-прогоном («close event: code=null signal=SIGKILL → result.code=undefined, spawnError unset»). Следствие — самоопровергающаяся immutable-строка: audit (backup-drill.ts:499) пишет `postInspect: code ?? 'spawn_error'`, т.е. чек получается `{ postInspect: 'spawn_error', verdict: 'REMOVED' }` — сам аудит говорит «exit-кода не было», а вердикт ссылается на его не-нулевой выход как на доказательство. Это вновь расходится с комментарием инварианта backup-drill.ts:464-467 («actually ran … exited non-zero») — тот же комментарий/код конфликт, что был ядром WR-01, и прямо нарушает must-have 08-06-PLAN truth 1 («exited non-zero … every other post-rm state records 'FAILED'») и бюллетен предыдущего gap «не spawn_error … иначе FAILED» (аудит сам маркирует это состояние как spawn_error). Независимо зафиксировано 08-REVIEW.md WR-05 (open в 08-REVIEW-DISPOSITION.md), severity warning, с готовым патчем. Тестовой охраны нет: в tests/unit/backup-drill.test.ts кейс с `{ code: undefined }` БЕЗ spawnError в пост-rm позиции отсутствует (G использует POST_SPAWN_GONE, у которого spawnError: 'ENOENT'). Вероятность низкая (аномальный exec-результат), но это ровно тот класс отказа, ради устранения которого затевался 08-06; ложный фактический REMOVED дополнительно требует rename-гонки WR-02, однако обязанность честности лежит на доказательстве, а не на совпадении."
    artifacts:
      - path: "workers/data-sync/src/jobs/backup-drill.ts"
        issue: "строка 489: `absentPerInspect = !postInspect.spawnError && postInspect.code !== 0 && !isDockerUnreachableError(postInspect.stderr)` — `code: undefined` без spawnError проходит; комментарий 464-467 требует «exited non-zero»; audit 499 при этом пишет «spawn_error» рядом с verdict REMOVED"
      - path: "tests/unit/backup-drill.test.ts"
        issue: "grep-0 на кейс `inspects: [INSPECT_FOUND, { code: undefined, stdout: empty, stderr: \"\" }]` (без spawnError) — остаточный fail-open не охранён тестом (аналог WR-05 из 08-REVIEW.md)"
    missing:
      - "Требовать числовой не-нулевой exit-код пост-rm inspect: `typeof postInspect.code === 'number' && postInspect.code !== 0 && !postInspect.spawnError && !isDockerUnreachableError(stderr)` — иначе FAILED (патч WR-05, 08-REVIEW.md:38-49); заодно согласует вердикт с собственной audit-маркой «spawn_error» и комментарием 464-467"
      - "Юнит-кейс J рядом с G: post-rm inspect `{ code: undefined, stdout: Buffer.alloc(0), stderr: \"\" }` без spawnError → containerCleanup = 'FAILED' при overall VERIFIED, audit `{ postInspect: \"spawn_error\", verdict: \"FAILED\" }`"
behavior_unverified_items:
  - truth: "(08-04) Оператор открывает http://127.0.0.1:8080/internal/operations в обычном браузере, один раз проходит Basic auth, и все операционные блоки рендерятся с реальными данными вместо «Этот операционный блок недоступен»."
    test: "Открыть http://127.0.0.1:8080/internal/operations после scripts\\app-lifecycle.ps1 -Action Start, авторизоваться Basic-кредами из .env"
    expected: "«Центр операций» и все блоки операций рендерятся с реальными данными; «Этот операционный блок недоступен» не показывается"
    why_human: "Артефакты на месте и подключены (security.mjs покрывает /internal*/operations*, server.mjs Basic-гейт + подпись, шлюз в dev-лаунчере), e2e tests/e2e/operations-gateway.spec.ts существует (исполнитель: 4/4) и юнит/интеграционные звенья зелёные (17/17 и 12/12), но мной e2e не запускался (нужен owned release-стек; поднимать сервисы в верификации запрещено). Live-пробы этого раунда не прошли: :3000 и :8080 не ответили за 2 с (стек не поднят) — предыдущий раунд фиксировал live 401/404, файлы с тех пор не менялись. Сквозной браузерный прогон — предмет UAT-ретеста G-08-6"
  - truth: "(08-04) Обе кнопки триггеров («Создать резервную копию сейчас» и «Запустить проверку восстановления сейчас») работают у оператора через шлюз и отвечают «поставлена в очередь…» через role=status."
    test: "В живом браузере через шлюз нажать обе кнопки триггеров"
    expected: "role=status «Резервная копия поставлена в очередь…» и «Проверка восстановления поставлена в очередь…», страница обновляется через load()"
    why_human: "Составные звенья зелёные (подпись gateway→proxy — интеграционно, enqueue/202 — operator-overview, рендер кнопок — веб-тесты), но сквозное нажатие браузером исполняется только в незапущенном мной e2e/UAT-ретесте G-08-6"
---

# Phase 8: Backups and Restore Verification — Отчёт верификации (re-verification)

**Цель фазы (ROADMAP):** An operator can enable automated PostgreSQL backups and trust them because a scheduled restore drill proves every backup actually restores — with never-verified and stale states rendered honestly in the operations center.
**Верифицировано:** 2026-11-02T15:04:35Z
**Статус:** gaps_found
**Режим:** re-verification — предыдущий `08-VERIFICATION.md` содержал `gaps:` (gaps_found, 20/23, истина 22). Gap закрыт планом 08-06 (gap_ids: [WR-01], коммиты 86f801c / 8eb37e3 / 5085314 / 8d2eab1 / 5cb658c, все проверены валидными: `verify.commits` 6/6 exit 0). Выполнен СВЕЖИЙ goal-backward проход ВСЕЙ фазы (планы 08-01..08-06): failed-item — полная 3-уровневая проверка; passed-item — регрессионная (изменённые с предыдущего `verified:` файлы определены через `git log --since=2026-11-01T01:13:27Z` — среди файлов реализации только `workers/data-sync/src/jobs/backup-drill.ts` и `tests/unit/backup-drill.test.ts`, т.е. результаты 08-01..08-05 перенесены с регрессионным подтверждением).

**Итог круга:** два бюллетена предыдущего gap реально закрыты и закреплены тестами (G/H/I зелёные, классификатор узкий, `record()` ограждён), но остался третий reachable-кейс того же класса (WR-05, новый раунд-2 ревью): пост-rm inspect без exit-кода по-прежнему даёт REMOVED. Истина 22 остаётся проваленной → `gaps_found`.

## Достижение цели (Goal Achievement)

Цель разложена на 3 success criteria ROADMAP и 26 must-have-истин: 23 из планов 08-01..08-05 (7 + 5 + 5 + 3 + 3) + 3 новых из must_haves плана 08-06 (truth 1 плана 08-06 сведена к истине 22 — это один и тот же инвариант). Требования сведены к планам: BAK-01 → 08-01; BAK-02 → 08-02, 08-05, 08-06; BAK-03 → 08-03, 08-04. В `.planning/REQUIREMENTS.md` все три ID отнесены к Phase 8 (строки 18-20, 102-104) — осиротевших требований нет, каждый ID закреплён в frontmatter плана.

### Observable Truths

| # | Истина | Статус | Доказательство |
| --- | --- | --- | --- |
| 1 | (08-01) Настоящий `pg_dump -Fc` даёт непустой файл + ровно одну строку `BackupRun SUCCEEDED`; сбойный дамп → `FAILED`, без `.dump`, ничего не удаляется | ✓ VERIFIED | Регрессия: файлы 08-01 не менялись с prior round; интеграционный `tests/integration/backup-restore-drill.test.ts` **прогнан мной пост-change: 7/7** на реальном Docker (в т.ч. «one real non-empty dump…sha256», «FAILED и без дампа», «PG_IDENTITY_UNRESOLVED») |
| 2 | (08-01) Ротация оставляет ровно новейшие `BACKUP_RETENTION_COUNT` (14) и только после успеха | ✓ VERIFIED | `tests/unit/backup-job.test.ts` + config **37/37 прогнаны мной** |
| 3 | (08-01) Незаданный `BACKUP_OFFSITE_DIR` → `NOT_CONFIGURED`; сбой robocopy → `SUCCEEDED` + `DEGRADED` с кодом | ✓ VERIFIED | 37/37 (мой прогон); UAT-тест 2 (живой robocopy обе половины) — pass |
| 4 | (08-01) Ежесуточный тик вооружается из persisted-состояния `BackupRun`, без BullMQ repeat-опций | ✓ VERIFIED | `scheduleBackupTick` + юнит-кейсы в 37/37 (мой прогон); `main.ts` не менялся; UAT-тест 3 — pass |
| 5 | (08-01) Креды только через child env; payload BullMQ несёт только trigger-дискриминатор | ✓ VERIFIED | 37/37 (мой прогон): argv без conninfo, conn-поля в `options.env`, job data ровно `{trigger}` |
| 6 | (08-01) docker-exec fallback берёт роль/БД из конфига/env, иначе fail-closed `PG_IDENTITY_UNRESOLVED` | ✓ VERIFIED | Интеграционный кейс в моём прогоне 7/7 |
| 7 | (08-01) `sha256` считается с `.partial` до rename | ✓ VERIFIED | Интеграционный кейс в моём прогоне 7/7 |
| 8 | (08-02) Drill: restore в throwaway → миграции head → chain-integrity → удаление контейнера → один `BackupVerificationReceipt` | ✓ VERIFIED | **Мой прогон пост-change: интеграционный 7/7 на живом Docker** (containerCleanup REMOVED, реальные exit-коды, контейнер отсутствует в `docker ps -a`) |
| 9 | (08-02) Docker недоступен / pending-миграция / ошибка restore / проваленный чек → FAILED или UNVERIFIED; drill не может молча пройти | ✓ VERIFIED | Юнит `backup-drill.test.ts` **32/32 прогнан мной** (DOCKER_UNAVAILABLE, PG_IDENTITY_UNRESOLVED, RESTORE_FAILED, CHAIN_INTEGRITY_FAILED); `MIGRATIONS_NOT_AT_HEAD` — UAT-тест 4 pass |
| 10 | (08-02) Сбой очистки фиксируется в чеке, а не скрывается; имя owned-unique; удаление в `finally` | ✓ VERIFIED | Юнит A-F + интеграционный негатив (forced pre-rm miss → `FAILED` при `overall VERIFIED`) — прогнаны мной (32/32 + 7/7); `safeCleanupRun` дополнительно гарантирует доставку чека |
| 11 | (08-02) Паритет: FAIL только при restored < captured, позитивные дельты пишутся, нулевые таблицы → SKIPPED | ✓ VERIFIED | Юнит-кейсы паритета в моём прогоне 32/32 |
| 12 | (08-02) Обе таблицы чеков отвергают UPDATE и DELETE на уровне БД | ✓ VERIFIED | Prior round: `mutation-rejection.test.ts` 8/8 на throwaway `postgres:18-alpine`; миграционные файлы и schema не менялись с prior verified (`git log --since`) — регрессионно исключена |
| 13 | (08-03) Секция `backups` со state, считаемым при чтении: NOT_CONFIGURED / NEVER_VERIFIED / STALE / FAILED / HEALTHY | ✓ VERIFIED | **Мой прогон: `tests/integration/operator-overview.test.ts` 24/24** (`computeBackupFact` с инжектированным clock) |
| 14 | (08-03) Бэкап >25 ч → STALE, drill старше интервала+grace → drill-stale, оба не-зелёные даже при последнем VERIFIED | ✓ VERIFIED | Границы в operator-overview 24/24 (мой прогон) + веб «never renders green Здорово» (prior 82/82; web-файлы не менялись) |
| 15 | (08-03) Payload overview без connection string, кредов и директорий | ✓ VERIFIED | operator-overview 24/24 (мой прогон): нет scheme-marker/пути каталога; `redactSecrets` + `safeFileName`; новый audit `checks.containerCleanup` несёт только системное имя и exit-коды |
| 16 | (08-03) Триггеры gateway → подписанный proxy → OperatorGuard; неверный кред → унифицированный 404 | ✓ VERIFIED | **Мой прогон: `tests/unit/operator-gateway.test.ts` 17/17**; prior: интеграционный 12/12 (подпись против канонической строки прокси), route.test, live 401/404. Live-пробы этого раунда: :3000/:8080 не ответили за 2 с (стек не поднят) → SKIP; файлы не менялись с prior verified |
| 17 | (08-03) Русский блок с двумя кнопками; never-verified / stale / failed / not-configured — явные не-зелёные состояния | ✓ VERIFIED | `backup-status-block.tsx` + `enum-labels.ts` смонтированы в `page.tsx`; prior веб 82/82; web-файлы не менялись с prior verified (`git log --since`) |
| 18 | (08-04) Оператор открывает :8080/internal/operations в обычном браузере, Basic auth один раз, все блоки с реальными данными | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Артефакты на месте и подключены (`security.mjs` protectedPrefixes, `server.mjs:114-125`, лаунчер со шлюзом), юнит 17/17 (мой прогон) + интеграционный 12/12 (prior), e2e spec существует (4/4 по заявлению) — но мой прогон браузером невозможен; live-пробы SKIP (стек не поднят) → `behavior_unverified_items` |
| 19 | (08-04) Обе кнопки триггеров отвечают «поставлена в очередь…» через role=status | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Составные звенья зелёные; сквозное нажатие браузером — только в незапущенном e2e/UAT → `behavior_unverified_items` |
| 20 | (08-04) Fail-closed 404 прокси для неподписанных `/internal-api/operations` не изменён — dev-обхода нет | ✓ VERIFIED | `route.ts` не менялся с prior verified (git); prior live `404 {"message":"Not found"}`; route.test зелёный в prior веб-наборе 82/82 |
| 21 | (08-05) Throwaway-контейнер переименован/удалён ДО очистки → containerCleanup = 'FAILED', никогда ложный 'REMOVED' | ✓ VERIFIED | Юнит A (pre-rm exit 1 → FAILED) в моём прогоне 32/32 + **интеграционный негатив на живом демоне в моём прогоне 7/7**. Остаточное окно rename МЕЖДУ pre-inspect и rm — WR-02 (адвайзори), за пределами «до очистки» |
| 22 | (08-05/08-06) containerCleanup = 'REMOVED' означает verifiably present до rm и verifiably absent после rm; каждый пост-rm state без позитивного доказательства → FAILED | ✗ FAILED | Обе контрпримеры предыдущего gap закрыты и закреплены (G/H зелёные, C зелёный), но остаётся reachable-кейс: `postInspect = { code: undefined }` без spawnError проходит `code !== 0` (backup-drill.ts:489) → REMOVED без exit-кода; аудит пишет `{ postInspect: "spawn_error", verdict: "REMOVED" }`. Reachability доказана мной node-прогоном (signal-kill → close(null) → code undefined, spawnError unset, backup.ts:60). Нет теста. Подтверждено 08-REVIEW.md WR-05. См. `gaps:` |
| 23 | (08-05) Исход очистки никогда не перекрашивает заработанный overall drill | ✓ VERIFIED | Юнит E и I в моём прогоне 32/32 + интеграционный негатив 7/7; `record()` пишет оба поля независимо |
| 24 | (08-06) Юнит-набор охраняет обе fail-open углы: пост-rm spawnError → FAILED, пост-rm daemon-unreachable stderr → FAILED, канонический «No such container» → REMOVED (регресс C) | ✓ VERIFIED | **Мой прогон `tests/unit/backup-drill.test.ts`: 32/32** — кейсы G (POST_SPAWN_GONE), H (Cannot connect…), C (canonical absence → REMOVED) присутствуют и зелёные; файл соответствует artifacts 08-06 |
| 25 | (08-06) Throw из BackupExec во время очистки больше не может обойти record(): каждый вызов ограждён, throw → spawn_error, чек падает с FAILED | ✓ VERIFIED | `safeCleanupRun` (backup-drill.ts:473-479) + юнит I (мой прогон 32/32): ровно один receipt, `{preInspect, rmExitCode, postInspect: "spawn_error", verdict: "FAILED"}`, overall VERIFIED |
| 26 | (08-06) Заработанный overall не перекрашивается (E остаётся зелёным) и все pre-existing backup-drill юнит-тесты зелёные | ✓ VERIFIED | E в 32/32 (мой прогон); **единственный полный прогон этой верификации: `vitest --project unit` → 447/454**, единственныеОтказы — известный предсуществующий `tests/unit/fixtures-sync.test.ts` (7 failed, live-DB auth `user`) |

**Score:** 23/26 истин верифицировано (2 — present, behavior-unverified; 1 — провал → gap). Проваленная истина — ровно та, что была gap предыдущего раунда: закрыта частично.

### Advisory (New Scope, Unevidenced)

Ревью-находки — advisory, не автоматические отказы; ниже они взвешены по отношению к must-haves. Единственная, которая ломает истину (WR-05), вынесена в `gaps:`, а не сюда.

| # | Finding | Категория | Почему advisory |
| --- | --- | --- | --- |
| 1 | **WR-05** (новое, round-2) — пост-rm inspect с `code: undefined` без spawnError пишет REMOVED | security/honesty | **не advisory** — это и есть gap по истине 22 (см. `gaps:`); зафиксирован open в 08-REVIEW-DISPOSITION.md |
| 2 | **IN-04** (новое) — `isDockerUnreachableError` это чёрный список фраз: неперечисленная формулировка сбоя демона (напр. «permission denied while trying to connect…», exit 1) считается absence-evidence | architectural | must-have 08-06 требовал покрыть указанные фразы («cannot connect», «error during connect») — они покрыты; позитивная проверка канонического absence-текста («no such object/container») — улучшение, не требование плана. Вероятность низкая (pre-inspect и rm только что прошли успешно). Записан open (IN-04) |
| 3 | **IN-05** (новое) — две из трёх веток классификатора и вариант «No such object» не закреплены тестами | test-coverage | Must-have 08-06 truth 2 называет ровно кейсы G/H/C — они закреплены и зелёные; соседние ветки — пожелание. Записан open (IN-05) |
| 4 | **IN-06** (новое) — `record()` ограждён от throw exec, но throw внедрённого логгера (строки 502, 455) всё ещё может выйти из finally | architectural | Must-have 08-06 truth 3 ограничен cleanup-трио (`safeCleanupRun`) — доставлен; дефолтный логгер no-op, путь латентен. Записан open (IN-06) |
| 5 | **WR-02** (carried) — вердикт ключуется на изменяемом ИМЕНИ контейнера, а не на неизменяемом ID (`docker run` stdout уже содержит ID) | architectural | Истинa 21 («до очистки») доказана тестами; окно — миллисекунды внутри cleanup; не является must-have ни одного плана. Записан open |
| 6 | **WR-03 / WR-04 / IN-01 / IN-03** (carried) — Load-Env в Stop/Status, bind 0.0.0.0 шлюза, probe готовности, grep-ассершн в тесте | security / other | Ни одна must-have-истина ими не покрыта; сознательно вне скоупа 08-06 (recorded open). WR-04 стоит отдельного решения оператора до прод-развёртывания шлюза |

### Required Artifacts

| Артефакт | Ожидание | Статус | Детали |
| --- | --- | --- | --- |
| `packages/config/src/index.ts` | `readBackupConfig` + `BackupConfig` fail-closed | ✓ VERIFIED | 143 строки; дефолты 14/168; юнит 37/37 (мой прогон) |
| `…/20261022_phase08_backup_runs/migration.sql` | `BackupRun` + sha256 + guard-триггер | ✓ VERIFIED | `guarded_append_only`; не менялся с prior verified |
| `…/20261022_phase08_backup_verification_receipts/migration.sql` | `BackupVerificationReceipt` + guard | ✓ VERIFIED | `guard_backup_verification_receipt()`; immutable-тесты 8/8 prior |
| `…/20261024_phase08_backup_byte_size_bigint/migration.sql` | int4 → bigint | ✓ VERIFIED | схема синхронна |
| `workers/data-sync/src/jobs/backup.ts` | `runBackup`, резолв идентичности, ротация, offsite, тик, `spawnBackupExec` | ✓ VERIFIED | 493 строки; подключён в `main.ts`; signal-путь `close(code ?? undefined)` (строка 60) — источник формы результата WR-05 |
| `workers/data-sync/src/jobs/backup-drill.ts` | `runBackupDrill` + inspect-вердикация и `checks.containerCleanup`; (08-06) fail-closed пост-rm verdict + классификатор + `safeCleanupRun` | ✓ VERIFIED (с gap по истине 22) | Существует, содержателен, подключён: `isDockerUnreachableError` (233-240), вердикт (483-490), guard (473-479), audit (495-501), инвариант-комментарий (456-472). Остаточный fail-open на строке 489 — gap |
| `tests/integration/backup-restore-drill.test.ts` | герметичный dump + FAILED-путь + inspect-последовательность и негатив | ✓ VERIFIED | **7/7 прогнан мной пост-change на живом Docker** |
| `README.md` | заметка оператору о персональных данных в дампах | ✓ VERIFIED | раздел `BACKUP_DIR`/`BACKUP_OFFSITE_DIR`, ACL/шифрование |
| `operations.service.ts` | `backups()`, 5-state read-time, `triggerBackup/triggerDrill` | ✓ VERIFIED | `safeCode(containerCleanup, "FAILED")` на выходе (строка 213); 24/24 мой прогон |
| `operations.controller.ts` | два POST под OperatorGuard | ✓ VERIFIED | `@HttpCode(202)`, guard на классе |
| `…/internal-api/operations/[[...path]]/route.ts` | POST-прокси с методом в подписи | ✓ VERIFIED | не менялся с prior verified; prior live 404 |
| `…/internal/operations/backup-status-block.tsx` | операторский блок | ✓ VERIFIED | `containerCleanupLabel` (строки 32, 59): REMOVED → «Контейнер удалён», FAILED → «Не удалось удалить контейнер» |
| `page.tsx`, `enum-labels.ts` | монтирование + лейблы | ✓ VERIFIED | не менялись с prior verified |
| `infra/operator-gateway/security.mjs` (08-04) | protected-path покрывает `/internal*/operations*` | ✓ VERIFIED | юнит 17/17 мой прогон |
| `infra/operator-gateway/server.mjs` (08-04) | Basic-гейт + HMAC с методом | ✓ VERIFIED | строки 114-125; не менялся |
| `scripts/app-lifecycle.ps1` (08-04) | dev-лаунчер поднимает/останавливает/показывает шлюз | ✓ VERIFIED | `-Gateway` ветка; не менялся (WR-03 — advisory) |
| `.env.example` (08-04) | `GATEWAY_PORT=8080` документирован | ✓ VERIFIED | строка 11 |
| `tests/e2e/operations-gateway.spec.ts` (08-04) | браузер через шлюз + негативы | ⚠️ PRESENT (не запускался мной) | существует, wired в `verify:release`; поведение не упражнено в моём процессе → истины 18-19 |
| `tests/e2e/live-provider-stack.ts` (08-04) | owned API с `BACKUP_ENABLED=true` + mkdtemp `BACKUP_DIR` | ✓ VERIFIED | строка 91 |
| `tests/unit/backup-drill.test.ts` (08-05/08-06) | FAILED-ветки A-F + (08-06) G/H/I | ✓ VERIFIED | describe G-08-5 с 9 кейсами A-I; **32/32 мой прогон**. Пробел: нет кейса `{code: undefined}` без spawnError → gap |
| `tests/unit/operator-gateway.test.ts` (08-04) | сегментная граница | ✓ VERIFIED | 17/17 мой прогон |
| `tests/integration/operator-gateway.test.ts` (08-04) | signed-operations boundary | ✓ VERIFIED | 12/12 prior; файл не менялся |
| `tests/integration/mutation-rejection.test.ts` (08-02) | append-only обеих таблиц | ✓ VERIFIED | 8/8 prior; миграции не менялись |
| `tests/integration/operator-overview.test.ts` (08-03) | 5-state read-time | ✓ VERIFIED | **24/24 мой прогон** |

### Key Link Verification

| From | To | Via | Статус | Детали |
| --- | --- | --- | --- | --- |
| `readBackupConfig` | `runBackup` → `BackupRun` | `startBackupRuntime` в `main.ts` | WIRED | нет конфига → `FAILED BACKUP_NOT_CONFIGURED` / `backup.disabled`, никогда молча |
| `resolvePgTools/Identity` | `pg_dump`/`pg_restore` с явными `-U`/`d` | `backup.ts` + импорт в drill | WIRED | `PG_IDENTITY_UNRESOLVED` без вызова инструментов (интеграционно, 7/7 мой прогон) |
| `scheduleBackupTick` → `bet-stats-backup` → `runBackup` | тик → enqueue → execute | `main.ts` | WIRED | concurrency 1, jobId-бакеты, без `repeat:` |
| `scheduleDrillTick` → `runBackupDrill` | тик → `executeDrill` | `main.ts` | WIRED | dispatch «drill»/«backup» |
| новейший дамп → throwaway → `migrate deploy/status` → chain-integrity → `BackupVerificationReceipt` | весь конвейер | `backup-drill.ts` | WIRED | порядок совпадает с D-08; `finally`-очистка; **7/7 мой прогон на живом Docker** |
| pre-rm `docker inspect` → `rm --force` → post-rm `docker inspect` → вердикт → `checks.containerCleanup` | вердикт очистки (08-05/08-06) | `backup-drill.ts:473-501` | WIRED | последовательность через `safeCleanupRun`, аудит пишется, юнит A-I + интеграционный негатив зелёные. **Семантика REMOVED ломается в corner `code: undefined` — gap (ист. 22)** |
| post-rm inspect evidence → `containerCleanup` → immutable receipt → `backups()` → «Контейнер удалён»/«Не удалось удалить контейнер» | key_link плана 08-06 | `backup-drill.ts` → `operations.service.ts:208,213` → `backup-status-block.tsx:32,59` | WIRED (с оговоркой) | цепочка прерывисто подключена и задокументирована тестами (веб 82/82 prior); оговорка: метка «Контейнер удалён» может отрисоваться и без positive absence evidence в corner WR-05 — это и есть gap |
| `BackupRun` + `BackupVerificationReceipt` → `backups()` → overview → веб-блок | Prisma findFirst → `computeBackupFact` → `fetch` в `page.tsx` → `BackupStatusBlock` | service + page | WIRED | см. Data-Flow |
| read-time staleness (25h / interval+24h) | `computeBackupFact(rows, current)` | `operations.service.ts` | WIRED | значение не сохраняется; 24/24 мой прогон |
| шлюз: Basic → `signedOperatorHeaders` (метод в каноне) → web POST-proxy → `OperatorGuard` → BullMQ | ingress (08-04) | `security.mjs` → `server.mjs:114-125` → `route.ts` → controller | WIRED | юнит 17/17 (мой прогон) + prior интеграционный 12/12 и live 401/404 |
| `app-lifecycle.ps1 -Gateway` → `server.mjs` на :8080 | dev-топология (08-04) | спавн + `Get-StackPids`/Stop/Status | WIRED | не менялся с prior verified; live-пробы этого раунда SKIP (стек не поднят) |

### Data-Flow Trace (Level 4)

| Артефакт | Переменная | Источник | Реальные данные | Статус |
| --- | --- | --- | --- | --- |
| «Последняя резервная копия» | `lastBackup` | `database.backupRun.findFirst({status:"SUCCEEDED"})` | да — реальные строки `BackupRun` | ✓ FLOWING |
| «Последняя проверка восстановления» + failed checks | `lastDrill`, `failedDrillChecks(checks)` | `backupVerificationReceipt.findFirst` | да — реальные строки чека | ✓ FLOWING |
| Общее состояние / stale-флаги | `state`, `backupStale`, `drillStale` | read-time из строк + `readBackupConfig(process.env)` | да | ✓ FLOWING |
| Аудит очистки (08-05/08-06) | `checks.containerCleanup` → `lastDrill.containerCleanup` → `containerCleanupLabel` | реальные exit-коды `docker inspect/rm` в `runBackupDrill` → `safeCode(..., "FAILED")` в service | да — immutable-строка, `redactSecrets`, закрытый DTO; лейблы покрыты веб-тестами | ⚠️ FLOWING (семантика REMOVED в corner WR-05 — gap, ист. 22) |
| Триггеры | `queued` | `queue.add(job, {trigger:"MANUAL"})` | да — реальный BullMQ enqueue | ✓ FLOWING |
| Резервный дамп | `fileName`, `sha256`, `byteSize` | реальный `pg_dump` + стримовый sha256 по `.partial` | да — файл на диске (интеграционно) | ✓ FLOWING |

### Behavioral Spot-Checks

| Поведение | Команда | Результат | Статус |
| --- | --- | --- | --- |
| Юнит: drill-вердикт A-I (G/H/I — ядро 08-06) | `pnpm vitest run --project unit tests/unit/backup-drill.test.ts` | **32 passed** (1 файл), 2.12s | ✓ PASS |
| Полный unit-гейт (единственный полный прогон) | `pnpm vitest run --project unit` | 47 файлов: **447 passed / 7 failed (454)**; единственный отказ — известный предсуществующий `tests/unit/fixtures-sync.test.ts` (live-DB auth `user`) — вне scope фазы | ✓ PASS (с известным исключением) |
| Полный drill + негатив cleanup (реальный Docker, пост-change) | `pnpm vitest run --project integration tests/integration/backup-restore-drill.test.ts` | **7 passed**, 47.2s | ✓ PASS |
| 5-state overview (BAK-03 read-time) | `pnpm vitest run --project integration tests/integration/operator-overview.test.ts` | **24 passed**, 2.6s | ✓ PASS |
| Юнит: backup-job + config (BAK-01) | `pnpm vitest run --project unit tests/unit/backup-job.test.ts packages/config/src/index.test.ts` | **37 passed** | ✓ PASS |
| Юнит: шлюз (сегментная граница) | `pnpm vitest run --project unit tests/unit/operator-gateway.test.ts` | **17 passed** | ✓ PASS |
| Типизация | `pnpm typecheck` | 7/7 задач | ✓ PASS |
| Reachability WR-05 (форма результата signal-kill) | `node -e "spawn … child.kill('SIGKILL') … close(code)"` | `close event: code=null signal=SIGKILL → result.code=undefined, spawnError unset` — подтверждает, что `spawnBackupExec` (backup.ts:43-60) возвращает `{code: undefined}` без spawnError | ✓ PASS (доказательство контрпримера) |
| Коммиты 08-06 + ревью-доки | `gsd_run query verify.commits 86f801c 8eb37e3 5085314 8d2eab1 5cb658c d32173d` | 6/6 valid, exit 0 | ✓ PASS |
| Регрессия scope: что менялось с prior `verified:` | `git log --since=2026-11-01T01:13:27Z --name-only` | среди файлов реализации только `backup-drill.ts` и `tests/unit/backup-drill.test.ts`; остальные артефакты 08-01..08-05 не тронуты | ✓ PASS |
| Задолженные маркеры (TBD/FIXME/XXX/PLACEHOLDER) | `Select-String` по `backup-drill.ts`, `tests/unit/backup-drill.test.ts` | 0 совпадений | ✓ PASS |
| Live: fail-closed прокси / шлюз | `Invoke-WebRequest :3000/…/overview`, `:8080/internal/operations` (2s) | таймаут — стек не поднят; prior round: `404 {"message":"Not found"}` и `401` | ? SKIP (стек не поднят; файлы не менялись) |
| E2E браузер через шлюз | `playwright test … tests/e2e/operations-gateway.spec.ts` | **SKIP** — требует поднятого owned release-стека; поднимать сервисы в верификации запрещено → behavior-unverified / UAT-ретест | ? SKIP |

### Probe Execution

Пробы (`scripts/*/tests/probe-*.sh`) в этой фазе не объявлены ни в одном из 6 PLAN, ни в ROADMAP — раздел неприменим.

### Requirements Coverage

| Требование | План(ы) | Описание | Статус | Доказательство |
| --- | --- | --- | --- | --- |
| BAK-01 | 08-01 | Оператор может включить автоматические PostgreSQL-бэкапы (`pg_dump` custom) с настраиваемым retention и ротацией | ✓ SATISFIED | `readBackupConfig` (opt-in), `runBackup` atomic rename + `BackupRun`, `pruneBackupRetention`, robocopy, persisted-state тик; юнит 37/37 (мой прогон) + интеграционный 7/7 + UAT-тесты 1-2 pass |
| BAK-02 | 08-02, 08-05, 08-06 | Периодический restore-drill восстанавливает последний бэкап в throwaway-контейнер, применяет миграции, запускает chain-integrity и пишет verification-чек | ✓ SATISFIED (с gap в суб-инварианте честности cleanup-вердикта) | Текст требования выполнен: полный конвейер доказан интеграционно **7/7 моим пост-change прогоном**, обе таблицы append-only 8/8, недельный тик, receipt всегда пишется (`safeCleanupRun`, юнит I). Gap касается честности поля `containerCleanup` в corner «нет exit-кода» (ист. 22) — отражён в `gaps:`; требование не заблокировано |
| BAK-03 | 08-03, 08-04 | Статус бэкапов и верификации виден в operations center без секретов; never-verified и stale — явные не-зелёные состояния | ✓ SATISFIED | 5-state read-time `backups()` (24/24 мой прогон), секрето-/path-free payload, русский блок с 5 состояниями и двумя кнопками, ingress: шлюз подписывает operations-пути (17/17 мой прогон + 12/12), прокси fail-closed (prior live 404); сквозной браузерный ретест — UAT G-08-6 |

Осиротевших требований нет: REQUIREMENTS.md относит к Phase 8 ровно BAK-01..03 (`grep "Phase 8"` → строки 102-104), каждый закреплён в frontmatter планов (08-01 → BAK-01; 08-02, 08-05, 08-06 → BAK-02; 08-03, 08-04 → BAK-03).

### Anti-Patterns Found

| Файл | Паттерн | Серьёзность | Влияние |
| --- | --- | --- | --- |
| `workers/data-sync/src/jobs/backup-drill.ts:489` | **WR-05** (08-REVIEW, open): пост-rm inspect `{code: undefined}` без spawnError → `undefined !== 0` → REMOVED без exit-кода; аудит пишет `{postInspect: "spawn_error", verdict: "REMOVED"}`; комментарий 464-467 снова расходится с кодом; теста нет | 🛑 BLOCKER | Основание gap по истине 22 (см. `gaps:`) |
| `workers/data-sync/src/jobs/backup-drill.ts:350-364,480-490` | **WR-02** (open): вердикт ключуется на изменяемом ИМЕНИ контейнера, хотя ID есть в stdout `docker run` | ⚠️ Warning | Истинa 21 не затронута и доказана тестами; окно — миллисекунды внутри cleanup. Адвайзори |
| `scripts/app-lifecycle.ps1:27,130-148` | **WR-03** (open): Stop/Status без `Load-Env` при нестандартном `GATEWAY_PORT` | ⚠️ Warning | При дефолте 8080 корректно; must-have «лаунчер запускает/останавливает шлюз» выполнен |
| `infra/operator-gateway/server.mjs:163` | **WR-04** (open): шлюз слушает `0.0.0.0` — cleartext Basic и подписанные триггеры с LAN | ⚠️ Warning (security) | Bind существовал до фазы; ни одна must-have истиной bind не покрыта. Рекомендация до прод-развёртывания |
| `workers/data-sync/src/jobs/backup-drill.ts:233-240` | **IN-04** (new): классификатор — чёрный список фраз; неперечисленный сбой демона считается absence-evidence | ℹ️ Info | Must-have требовал указанные фразы — они покрыты; позитивная проверка absence-текста — улучшение |
| `tests/unit/backup-drill.test.ts:65,285,328` | **IN-05** (new): ветка «error during connect» и absence-вариант «No such object» не закреплены тестами | ℹ️ Info | Must-have 08-06 называет G/H/C — они закреплены |
| `workers/data-sync/src/jobs/backup-drill.ts:455,502` | **IN-06** (new): throw внедрённого логгера может обойти `record()` | ℹ️ Info | Must-have ограничен cleanup-трио — доставлен; латентно |
| `scripts/app-lifecycle.ps1:49-54,133` | **IN-01** (open): probe готовности шлюза путём `/` конфлюит «шлюз down» с «upstream down» | ℹ️ Info | В штатной топологии корректно |
| `tests/unit/operator-gateway.test.ts:72-76` | **IN-03** (open): тест ассертит исходный текст `security.mjs`, а не поведение | ℹ️ Info | Поведение покрыто спавн-интеграционными тестами |
| `backup-drill.ts`, `tests/unit/backup-drill.test.ts` | Задолженные маркеры (TBD/FIXME/XXX/PLACEHOLDER), `return null`-заглушки, пустые обработчики | ℹ️ Info | Не найдено (0 совпадений, мой прогон) |

Все 11 находок записаны в `08-REVIEW-DISPOSITION.md` (WR-01 и IN-02 — `fixed` планом 08-06; остальные 9 — `open`); выше они взвешены по must-haves: только WR-05 ломает истину.

### Human Verification Required

(Статус `gaps_found`: раздел фиксирует остаточные human-пункты; фронтmatter `human_verification` по контракту заполняется только при `human_needed`.)

1. **UAT-ретест G-08-6 — живой браузер оператора** (покрывает истины 18-19): `scripts\app-lifecycle.ps1 -Action Start`, открыть **http://127.0.0.1:8080/internal/operations**, авторизоваться Basic-кредами из `.env`.
   *Ожидание:* «Центр операций» и все блоки с реальными данными (без «Этот операционный блок недоступен»); обе кнопки отвечают «поставлена в очередь…»; `-Action Status` показывает `gateway(:8080)=up`.
   *Почему человек:* сквозной браузерный путь исполняется только e2e на owned release-стеке; live-пробы этого раунда не прошли (стек не поднят — :3000/:8080 не ответили за 2 с).
2. **UAT-ретест G-08-5 — живой чек очистки**: выполнить drill и прочитать строку `BackupVerificationReceipt`.
   *Ожидание:* `checks.containerCleanup = { containerName, preInspect: 0, rmExitCode: 0, postInspect: ≠0, verdict: "REMOVED" }` — при этом `postInspect` обязан быть **числом** (не `"spawn_error"`); переименование контейнера до окна очистки даёт `FAILED` при нетронутом `overall`; UI показывает «Контейнер удалён»/«Не удалось удалить контейнер».
   *Почему человек:* подпись живого receipt и UI-лейблов на реальном хосте. (Дополнительное усиление после gap-закрытия WR-05: строка `{ postInspect: "spawn_error", verdict: "REMOVED" }` должна стать невозможной.)

(Успешно пройденные UAT-тесты 1-4 — живой бэкап, off-host robocopy, недельная каденция, `MIGRATIONS_NOT_AT_HEAD` — подтверждены ранее и в human-пункты не возвращаются.)

### Gaps Summary

Предыдущий gap (WR-01/истина 22) закрыт **частично — 2 из 3 требований доставлены и закреплены тестами**: (1) пост-rm `spawnError` больше не даёт REMOVED (вердикт backup-drill.ts:489 требует `!postInspect.spawnError`, юнит G зелёный); (2) пост-rm stderr с недоступным демоном даёт FAILED через узкий `isDockerUnreachableError()`, который намеренно не матчит канонический «Error response from daemon: No such container» — регресс C зелёный (классификатор корректен: bare `/daemon/i` здесь был бы ошибкой); (3) bonus IN-02 — `safeCleanupRun` ограждает каждый cleanup-вызов, `record()` не может быть пропущен (юнит I). Все кейсы прогнаны мной: файл 32/32, полный unit-гейт 447/454 (только известный fixtures-sync), живой интеграционный drill 7/7 пост-change.

Остаётся **третий, ранее не перечисленный corner того же класса (WR-05)**: условие «exited non-zero» реализовано как `code !== 0`, а `code: undefined` (тип `number | undefined`) это условие удовлетворяет. Состояние достижимо в проде — signal-kill docker CLI (backup.ts:60, воспроизведено мной node-прогоном) — и produces самоопровергающийся чек `{ postInspect: "spawn_error", verdict: "REMOVED" }`, т.е. аудит сам свидетельствует об отсутствии exit-кода, которым вердикт обосновывает отсутствие контейнера. Это буквальное нарушение must-have 08-06 truth 1 («exited non-zero … every other post-rm state records 'FAILED'»), бюллетена предыдущего gap («не spawn_error … иначе FAILED») и комментария-инварианта 464-467 — того же расхождения комментарий/код, что и было ядром WR-01. Лечится одной строкой (`typeof postInspect.code === "number" &&`) и юнит-кейсом J (патч уже написан в 08-REVIEW.md:38-49).

Отклонённых в более поздние фазы пунктов нет: следующая фаза (9, Degradation Alerting) покрывает «backup staleness», но не семантику cleanup-вердикта drill'а; ни одна поздняя фаза не закрывает WR-05/WR-02.

Две истины (18-19) — browser-цепочка 08-04 — присутствуют и подключены, но их сквозное поведение не упражнено ни одним тестом в моём процессе (e2e требует owned release-стека; live-пробы SKIP), поэтому они остаются в `behavior_unverified_items`.

---

_Verified: 2026-11-02T15:04:35Z_
_Verifier: the agent (gsd-verifier)_
