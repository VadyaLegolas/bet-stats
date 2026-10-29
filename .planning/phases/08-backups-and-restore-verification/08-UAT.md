---
status: diagnosed
phase: 08-backups-and-restore-verification
source: [08-VERIFICATION.md]
started: 2026-10-27T00:00:00.000Z
updated: 2026-10-29T15:20:00.000Z
---

## Current Test

[testing complete]

## Tests

### 1. Живой прогон реального бэкапа
expected: В `BACKUP_DIR` появляется файл `football_prediction-<UTC>.dump` ненулевого размера, в `BackupRun` — ровно одна строка `SUCCEEDED`, блок операций показывает свежую резервную копию.
result: pass
evidence: |
  Исполнено агентом 2026-10-28 через подписанный операторский драйвер (HMAC подписывается in-process, секрет не покидает процесс): дамп `football_prediction-20261028T144115Z.dump` (18 541 903 байт) в `backups/`; событие `backup.succeeded` в логе стека (runId 14d91566…, durationMs 8634, offsiteStatus COPIED); UI-блок: «28 октября 2026 г. в 15:41 · …dump · 17.68 МБ · 8.6 с · SUCCEEDED», возраст «В норме»; скриншот показан оператору.
note: Недоступность блока для обычного браузера оператора зафиксирована отдельно как issue теста 6 (gap G-08-6) — сама функция бэкапа работает.

### 2. Реальный off-host robocopy
expected: Файл копируется, `offsiteStatus = 'COPIED'`, в блоке операций строка «Хранение вне сервера» показывает «Скопировано»; при недоступном шаре — «Деградировано» с кодом, локальный бэкап остаётся `SUCCEEDED`.
result: pass
evidence: |
  Обе половины исполнены агентом. Позитив (2026-10-28): копия 18 541 903 байт в `D:\Documents\Atom\bet-stats-offsite` (robocopy `/LOG:`), `offsiteStatus = 'COPIED'`, UI «Хранение вне сервера — Скопировано». Негатив (2026-10-29, `BACKUP_OFFSITE_DIR=Q:\…` — диск не существует): событие `backup.succeeded` runId 7360e0aa — дамп `football_prediction-20261029T134645Z.dump` (19 763 287 байт, 9.7 с) локально `SUCCEEDED` при `offsiteStatus: "DEGRADED", offsiteError: "16"` (robocopy exit 16, повтор /R:2), UI «Хранение вне сервера — Деградировано», в offsite-каталог копии нет, `/LOG:`-файл 875 байт в `backups/`. Побочно live подтверждено отличие «Не настроено» (пустой оверрайд → NOT_CONFIGURED) от «Деградировано». Восстановление конфига проверено: `COPIED` на дампе `football_prediction-20261029T135740Z.dump` (runId d7a42b16).

### 3. Недельная (168 ч) каденция drill на живом хосте
expected: После старта worker'а тик расписания запускается от последнего `BackupVerificationReceipt`, drill отрабатывает по расписанию, блок остаётся зелёным (HEALTHY) после каждой успешной проверки.
result: pass
evidence: |
  После каждого старта worker'а в логе стека `backup.armed` c `intervalHours: 24, drillIntervalHours: 168` (2026-10-28 и 2026-10-29). Тик реально стреляет от persisted-состояния: дрил 27.10 ушёл сам вскоре после старта worker'а при пустом журнале (UNVERIFIED/NO_BACKUP_FOUND — fail-closed, не зелёный); после каждого receipt каденция пере-оружается от его completedAt (включая финальный VERIFIED `00f71751` 29.10 14:49 → следующая проверка +168 ч). Три live-прогона `drill` (08ca440d, fa2baded, 00f71751 — все VERIFIED/REMOVED) показывали блок HEALTHY «Здорово» после каждой успешной проверки. Наступление отдалённой отметки T+168 ч в UAT не выжидалось — арифметика каденции детерминированно покрыта unit/integration-тестами.

### 4. Ветка «миграции не на head»
expected: `BackupVerificationReceipt.overall = 'UNVERIFIED'`, `failureReason = 'MIGRATIONS_NOT_AT_HEAD'`, drill никогда не даёт `VERIFIED` при pending-миграциях.
result: pass
evidence: |
  Live 2026-10-29: `BACKUP_PRISMA_DIR` указывал на изолированный probe-корень (копия prisma/ + junction node_modules, реальный каталог миграций не трогали); pending-миграция `99991231000000_uat_pending_probe` дропалась watcher'ом между `migrate deploy` (exit 0) и `migrate status` (exit 1). Итог: событие `backup_drill.recorded` drillId 67e01d11 — `overall: "UNVERIFIED", failureReason: "MIGRATIONS_NOT_AT_HEAD"`; UI «Последняя проверка восстановления — Не подтверждена», общее состояние «Сбой» — `VERIFIED` при pending невозможен. Отклонённые альтернативы (эмпирика Prisma 7): чексумма изменённого файла status'ом не детектится (exit 0), провалившийся ряд `_prisma_migrations` даёт P3009 уже на deploy (ветка MIGRATE_DEPLOY_FAILED). После сброса оверрайда финальный drill снова VERIFIED.

### 5. Сбой очистки контейнера (behavior_unverified)
expected: В чеке `containerCleanup = 'FAILED'` фиксируется, а не скрывается; `overall` остаётся прежним (заработанным) значением и не подкрашивается в зелёное из-за (не)успешной очистки; имя контейнера — `bet-stats-drill-pg-<pid>-<ts>`.
result: issue
reported: "агентский вывод: ветка FAILED недостижима live на Docker 29.9.2 (идемпотентный `docker rm -f`), эксперимент rename-гонкой оставил сироту при containerCleanup = 'REMOVED'"
severity: minor
diagnosis: |
  Подтверждено live: формат имени контейнера `bet-stats-drill-pg-20168-1793203629163` (pid + ts); `overall` не перекрашивается очисткой (при аномалии очистки drill остался VERIFIED — заработанное значение сохранено); поле и UI-лейблы существуют («Контейнер удалён» / «Не удалось удалить контейнер» / «Контейнер не запускался», юнит-тесты backup-status-block). Недостижимо live: сам `FAILED` — на Docker server 29.9.2 `docker rm -f` идемпотентен (exit 0 и по несуществующему, и по paused контейнеру), поэтому rename контейнера во время дрилла дал ложный `REMOVED` при живой сироте (удалена вручную); надёжно вызвать отказ rm можно только падением демона, что недопустимо для живого стека. Слепое место: утечка «контейнер исчез/переименован до rm» маскируется в честный записанный факт.

### 6. Живой UI-прогон обеих кнопок триггеров
expected: Кнопки дают role=status обратную связь, после завершения страница обновляется через `load()`; при выключенных бэкапах — одинаковый 404 без утечки информации о конфигурации; русские подписи пяти состояний на месте, «Здорово» не показывается ни в одном не-зелёном состоянии.
result: issue
reported: "все недоступно"
severity: major
diagnosis: |
  Обычный браузер не проходит HMAC-верификацию прокси `/internal-api/operations`: `apps/web/app/internal-api/operations/[[...path]]/route.ts:25-44` — fail-closed 404 для запросов без подписи, dev-обхода нет («Do not accept … a permissive development bypass», 02-19-PLAN). Операторский шлюз `infra/operator-gateway/security.mjs` подписывает только replay-пути (`isProtectedReplayPath` = `/internal*/pipeline/replay*`), пути операций — нет; в dev-топологии (`app-lifecycle.ps1`) шлюз вообще не запущен. Итог: все блоки `/internal/operations` показывают «Этот операционный блок недоступен…», обе кнопки триггеров недоступны оператору. Логика самого блока и кнопок проверена через подписанный драйвер (тест 1: данные рендерятся, триггер POST → 202), поэтому это gap ingress-обвязки, а не функции бэкапов.

## Summary

total: 6
passed: 4
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-08-6
  truth: "Оператор открывает /internal/operations в обычном браузере, жмёт обе кнопки триггеров и видит пять русских состояний блока (VALIDATION §Manual-Only)."
  status: failed
  reason: "User reported: все недоступно (все блоки /internal/operations показывают «Этот операционный блок недоступен», кнопки триггеров недоступны)"
  severity: major
  test: 6
  root_cause: "AND-gate ingress-обвязки (Bohrbug, 404 детерминирован): (1) [code] infra/operator-gateway/security.mjs:3,6-8 — isProtectedReplayPath подписывает только /internal*/pipeline/replay*; пути /internal*/operations* проходят через шлюз unsigned и добивают в fail-closed 404 прокси route.ts:44 (dev-обхода нет by design, 02-19-PLAN); (2) [topology] шлюз вообще не запущен в штатной dev-топологии — app-lifecycle.ps1 и infra/docker-compose.yml не содержат ни сервиса, ни лаунча operator-gateway (grep 0 упоминаний gateway/8080), так что у человека нет источника HMAC-подписи ни для каких защищённых путей. Обе причины одновременно необходимы. Требование 08-03-PLAN («operator through the gateway → signed web proxy → OperatorGuard») было недостижимо при реализованном replay-only шлюзе — расширение скоупа не входило ни в задачи плана, ни в дизайн-скоуп (design doc lines 9-14). Подписанный доступ существует только у программных драйверов, синтезирующих HMAC in-process (e2e setExtraHTTPHeaders, capture-faq-screenshots.mjs, UAT-драйвер) — человек в это множество не попадает; функция бэкапов/дриллов исправна (тест 1 pass)."
  artifacts:
    - "apps/web/app/internal-api/operations/[[...path]]/route.ts:25-44 — fail-closed HMAC для /internal-api/operations*, dev-обхода нет"
    - "infra/operator-gateway/security.mjs:3,6-8 — isProtectedReplayPath покрывает только /internal*/pipeline/replay*"
    - "infra/operator-gateway/server.mjs:114-125 — подпись применяется только при protectedPath"
    - "scripts/app-lifecycle.ps1, infra/docker-compose.yml — шлюз не запускается ни в dev, ни в compose; grep gateway/8080 = 0"
    - "docs/superpowers/specs/2026-08-31-docker-basic-auth-operator-gateway-design.md:9-14 — шлюз по дизайну подписывает только replay"
    - "08-03-PLAN.md:32 — UAT-критерий предполагал «through the gateway», но расширение gateway-скоупа не было задачей плана"
    - "tests/e2e/operator-overview.spec.ts — UI проверяется только с внедрённой подписью (setExtraHTTPHeaders)"
  missing:
    - "Расширить классификацию защищённых путей шлюза на /internal*/operations* (тем же OPERATOR_PROXY_SIGNING_SECRET) + unit-тесты на новый скоуп"
    - "Штатный human ingress в документированной топологии: поднять operator-gateway в dev-лаунчере/app-lifecycle (браузер через :8080 с Basic auth) либо иной документированный путь"
    - "e2e-тест «оператор через шлюз видит блоки операций и жмёт обе кнопки триггеров»"
  debug_session: .planning/debug/operations-ingress-hmac-gap.md
  updated: 2026-10-29
- gap_id: G-08-5
  truth: "Сбой очистки контейнера фиксируется честно: containerCleanup = 'FAILED' в неизменяемом чеке, overall остаётся заработанным (тест 5, D-11/T-08-10)."
  status: failed
  reason: "Agent finding: на Docker 29.9.2 `docker rm -f` идемпотентен (exit 0 на несуществующем контейнере) — rename-гонка во время живого дрилла дала containerCleanup = 'REMOVED' при живой сироте-контейнере; ветка FAILED на живом хосте достижима только падением демона"
  severity: minor
  test: 5
  root_cause: "Вердикт очистки выводится только по exit-коду `docker rm --force` — backup-drill.ts:438-439 (containerCleanup = removal.spawnError || removal.code !== 0 ? \"FAILED\" : \"REMOVED\") без проверки, что контейнер реально исчез (docker inspect в файле отсутствует, grep = 0). На Docker server 29.9.2 rm -f идемпотентен (живо: по несуществующему имени → exit 0), поэтому при потере идентичности до cleanup (rename-гонка) rm по старому имени возвращает 0 и чек пишет ложный REMOVED при живой сироте bet-stats-drill-pg-20168-1793203629163. AND-gate: (а) вердикт по exit-коду без верификации объекта + (б) идемпотентность rm -f под rename-потерей имени — каждое в одиночку ложного REMOVED не даёт. Ветка FAILED живьём достижима только spawn-ошибкой (ENOENT на docker CLI / EXEC_TIMEOUT) или падением демона; в tests/unit/backup-drill.test.ts:78 стаб exec всегда возвращает OK на rm, ветка FAILED не покрыта. Правду-части тест 5 код выполняет: overall не перекрашивается очисткой (record(outcome) пишет независимо), формат имени bet-stats-drill-pg-<pid>-<ts> корректен — дефект только в маскировке утечки."
  artifacts:
    - "workers/data-sync/src/jobs/backup-drill.ts:438-439 — вердикт лишь по exit-коду rm; идемпотентный rm -f даёт ложный REMOVED (UAT-артефакт ранее неточно указывал backup.ts — containerCleanup отсутствует в backup.ts)"
    - "лог 2026-10-28: backup_drill.verified fa2baded containerCleanup REMOVED при переименованном контейнере bet-stats-drill-pg-20168-1793203629163 (сирота удалена вручную)"
    - "эксперименты: rm -f по несуществующему и по paused контейнеру → exit 0 (Docker server 29.9.2); rename → rm старого имени exit 0 при живом новом"
    - "tests/unit/backup-drill.test.ts:78 — стаб rm всегда exit 0, grep тестов на cleanup-FAILED = 0"
  missing:
    - "Верификация объекта вместо exit-кода: пре-rm docker inspect <name> должен находить контейнер (потеря/переименование до cleanup ⇒ FAILED — ловит rename-гонку), затем rm, затем пост-rm inspect должен падать «not found», иначе FAILED (ловит «rm сказал 0, но контейнер остался»)"
    - "Интеграционный тест ветки FAILED (stub exec: rm exit 0 + inspect «контейнер существует» → FAILED; overall не перекрашивается); желательно сохранять containerName в receipt checks для аудита"
  debug_session: .planning/debug/container-cleanup-false-reMOVED.md
  updated: 2026-10-29
