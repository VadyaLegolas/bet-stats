---
status: diagnosed
trigger: "UAT phase 08 test 5 (G-08-5): containerCleanup = 'FAILED' должен фиксироваться честно в неизменяемом чеке, overall остаётся заработанным; rename-гонка дала ложный REMOVED при живой сироте-контейнере"
created: 2026-10-29T14:18:36.000Z
updated: 2026-10-29T14:18:36.000Z
---

## Current Focus

hypothesis: CONFIRMED — вердикт `containerCleanup` выводится ТОЛЬКО по exit-коду `docker rm --force` (backup-drill.ts:438-439), а Docker server 29.9.2 делает `rm -f` идемпотентным (exit 0 и для несуществующего имени) → любая потеря идентичности контейнера до cleanup (rename-гонка) маскируется в честный `REMOVED` при живой сироте; ветка FAILED живьём достижима только spawn-ошибкой/падением демона.
test: прямая репродукция на живом хосте — (1) `docker rm --force <несуществующее имя>` → exit 0; (2) создать контейнер → rename → `docker rm --force <старое имя>` → exit 0, `docker inspect <новое имя>` → контейнер жив.
expecting: exit 0 при живом переименованном контейнере доказывает, что кодовая ветка `removal.code !== 0 ? FAILED : REMOVED` физически не может различить «удалено» и «никогда не существовало под этим именем».
next_action: вернуть структурированный диагноз (goal: find_root_cause_only) — фикс не применяется.

bug_class: Bohrbug (детерминированная логическая ошибка на стыке код+семантика платформы; rename-сценарий всегда даёт ложный REMOVED)

reasoning_checkpoint (диагностический, фикс вне scope):
  hypothesis: "containerCleanup = 'REMOVED' при живой сироте, потому что вердикт равен exit-коду идемпотентного `docker rm -f` (0 для несуществующего имени) и не проверяет факт исчезновения контейнера"
  confirming_evidence:
    - "backup-drill.ts:438-439 — единственное присвоение вердикта: `removal.spawnError || removal.code !== 0 ? 'FAILED' : 'REMOVED'`; `docker inspect` в файле отсутствует (grep: 0 совпадений)"
    - "живой эксперимент на Docker server 29.9.2: `docker rm --force uat-nonexistent-probe-xyz` → exit=0"
    - "репродукция rename-механизма: create → rename → `docker rm --force <старое имя>` → rm_old_exit=0, `docker inspect <новое имя>` → exists (state=created)"
    - "лог стека: `backup_drill.verified` drillId fa2baded-2733-4299-8bef-db23d13caec2 containerCleanup=REMOVED (2026-10-28)"
    - "tests/unit/backup-drill.test.ts:78 — стаб exec всегда возвращает OK на `rm` (нет override), ветка FAILED не покрыта тестами"
  falsification_test: "если бы `docker rm -f` на несуществующее/переименованное имя возвращал != 0, код записал бы FAILED и ложного REMOVED не было бы — прямой замер exit-кода это опровергает (exit 0)"
  fix_rationale: "пост-rm (или пре-rm) `docker inspect` переводит вердикт из «код exit равен 0» в «контейнер действительно отсутствует под записанным именем», т.е. убирает источник неоднозначности в самом месте вывода вердикта"
  blind_spots: "пост-rm inspect СТАРОГО имени не ловит сам rename (старое имя уже отсутствует → «not found» → всё равно REMOVED); нужна пре-rm проверка существования под записанным именем (или проверка по префиксу). Идемпотентный rm сам по себе не дефект — дефект в отсутствии какой-либо проверки объекта."
  candidate_causes:
    - "code: вердикт только по exit-коду rm, без проверки существования контейнера; ветка FAILED не покрыта тестом"
    - "environment: семантика Docker server 29.9.2 — `rm -f` идемпотентен (exit 0 и на несуществующем, и на paused контейнере)"
    - "data/timing: внешнее переименование Owned-контейнера дрилла в окне между docker run и cleanup (rename-гонка)"
    - "test: стаб exec в backup-drill.test.ts не позволяет задать исход rm → FAILED-ветка недостижима и в тестах"
  and_gate: "YES — сбой требует ОДНОВРЕМЕННО (b) потери идентичности контейнера до cleanup И (a) вердикта по exit-коду идемпотентного rm; каждое условие в одиночку не даёт ложного REMOVED (без rename rm честно удаляет; без exit-code-вердикта потеря имени = FAILED)"

## Symptoms

expected: В чеке `containerCleanup = 'FAILED'` фиксируется, а не скрывается; `overall` остаётся прежним (заработанным) значением и не подкрашивается из-за (не)успешной очистки; имя контейнера — `bet-stats-drill-pg-<pid>-<ts>`.
actual: На Docker 29.9.2 rename-гонка во время живого дрилла дала `containerCleanup = 'REMOVED'` при живой сироте-контейнере (ложнополитительный результат, не ошибка рендера); ветка FAILED на живом хосте достижима только падением демона.
errors: None reported (ложноположительный результат, не ошибка)
reproduction: Test 5 in UAT (08-UAT.md); минимальная репродукция — см. Evidence (create → rename → rm старого имени → exit 0 при живом контейнере)
started: Discovered during UAT (2026-10-29); ложный REMOVED замечен в логе 2026-10-28 (drill fa2baded)

## Eliminated

- hypothesis: FAILED-ветка существует, но значение перезаписывается/не сохраняется в неизменяемый чек (проблема persistence)
  evidence: backup-drill.ts:352 ставит fail-closed default FAILED после docker run; finally (435-441) — единственное место перезаписи; record() (444, 257-291) пишет containerCleanup и overall независимо. Семантика записи корректна — дефект в самом входе в ветку FAILED, а не в хранении.
  timestamp: 2026-10-29T14:10Z
- hypothesis: `overall` перекрашивается очисткой (зелёный из-за cleanup)
  evidence: record(outcome) берёт overall только из результата дрилла (строки 267, 431-434, 444); UAT live наблюдал VERIFIED при аномалии очистки — заработанное значение сохранено. Правда теста 5 выполняется.
  timestamp: 2026-10-29T14:11Z
- hypothesis: неверный формат имени контейнера
  evidence: backup-drill.ts:249 — `${DRILL_CONTAINER_PREFIX}${pid}-${Date.now()}`; UAT наблюдал `bet-stats-drill-pg-20168-1793203629163`. Правда выполняется.
  timestamp: 2026-10-29T14:11Z
- hypothesis: ложный REMOVED возникает из-за ошибки в подсчёте exit-кода / spawn-обёртке (код читает не тот статус)
  evidence: spawnBackupExec (backup.ts:26-60) возвращает close-код напрямую; эксперимент подтверждает, что реальный код процесса `docker rm -f` на старое имя действительно 0 — обёртка не виновата, это настоящий exit-код демона.
  timestamp: 2026-10-29T14:14Z

## Evidence

- timestamp: 2026-10-29T14:05Z
  checked: workers/data-sync/src/jobs/backup-drill.ts (весь файл)
  found: строка 438-439 в finally: `const removal = await exec.run("docker", ["rm", "--force", containerName], …); containerCleanup = removal.spawnError || removal.code !== 0 ? "FAILED" : "REMOVED";` — единственное присвоение вердикта; grep `inspect` по файлу — 0 совпадений (никакой post-rm проверки нет); строка 352 — fail-closed default FAILED до rm; строка 444 — record() пишет receipt уже после finally.
  implication: вердикт эквивалентен exit-коду rm; любая «тихая» неудача rm (exit 0 без фактического удаления под именем) становится честным REMOVED.
- timestamp: 2026-10-29T14:07Z
  checked: живой Docker на хосте UAT
  found: `docker version` → server 29.9.2; `docker rm --force uat-nonexistent-probe-xyz` → exit=0
  implication: подтверждена идемпотентность rm -f — «имени нет» неотличимо от «удалено успешно» по exit-коду.
- timestamp: 2026-10-29T14:15Z
  checked: репродукция rename-механизма (create postgres:18-alpine → rename → rm старого имени)
  found: rm_old_exit=0; `docker inspect <новое имя>` → exists, state=created; после ручного cleanup_new_exit=0
  implication: точный механизм ложного REMOVED воспроизведён: при rename между docker run и cleanup кодовая ветка line 439 записала бы REMOVED, пока сирота жива. UAT-сценарий подтверждён напрямую, не по косвенным данным.
- timestamp: 2026-10-29T14:08Z
  checked: лог стека %TEMP%\bet-stats-stack.log
  found: `{"event":"backup_drill.verified","drillId":"fa2baded-2733-4299-8bef-db23d13caec2","overall":"VERIFIED","containerCleanup":"REMOVED","backupFileName":"football_prediction-20261028T144115Z.dump"}`
  implication: живой прогон с записанным REMOVED существует (2026-10-28); `docker ps -a --filter name=bet-stats-drill-pg` сейчас пуст — сирота удалена вручную, как и указано в UAT.
- timestamp: 2026-10-29T14:12Z
  checked: tests/unit/backup-drill.test.ts (drillExec стаб, все кейсы cleanup)
  found: строка 78 `if (args[0] === "rm") return OK;` без override-параметра (options: только dockerRun/restore/blockPrintenv); ожидания `containerCleanup = "REMOVED"` (стр. 185) и NOT_STARTED (142, 156); grep по тестам `FAILED.*cleanup` — 0 совпадений
  implication: ветка FAILED не покрыта ни одним тестом — вторичный вклад: регрессия verdict-логики недетектируема автоматически.
- timestamp: 2026-10-29T14:13Z
  checked: backup.ts spawnBackupExec + достижимость FAILED живьём
  found: FAILED требует spawnError (ENOENT на docker CLI / EXEC_TIMEOUT 60с) или exit≠0 (недоступен демон); при живом демоне rm -f всегда exit 0 → FAILED недостижим
  implication: подтверждает вывод UAT: надёжно вызвать отказ rm можно только падением демона/отсутствием CLI — что для живого стека недопустимо.
- timestamp: 2026-10-29T14:16Z
  checked: UAT gap G-08-5 (artifacts) vs фактическое расположение кода
  found: артефакт ссылается на `workers/data-sync/src/jobs/backup.ts:438-440`, но строки 438-440 с containerCleanup находятся в `backup-drill.ts` (в backup.ts вообще нет containerCleanup — grep 0)
  implication: неточность пути в UAT-артефакте; линии и механика верны, файл — backup-drill.ts.

## Resolution

root_cause: Вердикт очистки в `runBackupDrill` finally-блоке (workers/data-sync/src/jobs/backup-drill.ts:438-439) равен по построению exit-коду `docker rm --force <name>` и нигде не проверяет, что контейнер действительно исчез; на Docker server 29.9.2 `rm -f` идемпотентен (exit 0 для несуществующего имени — проверено живо: exit=0), поэтому при потере идентичности контейнера до cleanup (UAT rename-гонка) `docker rm -f` по старому имени возвращает 0, и чек записывает ложный `containerCleanup = 'REMOVED'` при живой сироте (`bet-stats-drill-pg-20168-1793203629163`, удалена вручную); ветка FAILED (line 439) живьём достижима только spawn-ошибкой (нет docker CLI / EXEC_TIMEOUT) или падением демона, и не покрыта тестами (стаб exec на backup-drill.test.ts:78 всегда возвращает OK на rm). AND-gate: (а) exit-code-вердикт без проверки объекта + (б) идемпотентность rm -f при rename-потере имени — оба условия необходимы; `overall`-неперекрашивание и формат имени контейнера работают правильно (не являются дефектом). Вторичная неточность: UAT-артефакт G-08-5 указывает backup.ts вместо backup-drill.ts.
fix: (NON-BINDING) — не применялся (goal: find_root_cause_only)
verification: —
files_changed: []
