---
phase: 09
review: 09-REVIEW.md
titles: json
findings:
  - id: WR-08
    severity: warning
    disposition: open
    title: "Интеграционный тест отпечатков — PID-суффикс без очистки БД даёт флаки на переиспользуемых PID и засоряет операторскую таблицу"
  - id: IN-06
    severity: info
    disposition: open
    title: "Phantom requirement — «синхронность» зеркала сепаратора в веб-приложении ничем не гарантирована и поведенчески не нужна; инъективность U+001F утверждена в комментарии, но не закреплена тестом"
  - id: IN-07
    severity: info
    disposition: open
    title: "Мёртвое ожидание `waitForTimeout(100)` в zoom-тесте G-09-2"
  - id: IN-08
    severity: info
    disposition: open
    title: "В фикс-коммит 0a03eeb, заявленный как закрытие G-09-1/G-09-2, контрабандно внесён несвязанный рестайл `<summary>`, не отражённый ни в покрытии 09-07-SUMMARY, ни в сообщении коммита"
  - id: IN-09
    severity: info
    disposition: open
    title: "Спред `ACK_CHIP` в inline-style утекает не-CSS ключ `dot` в проп `style`"
  - id: CR-01
    severity: critical
    disposition: fixed
  - id: CR-02
    severity: critical
    disposition: fixed
  - id: WR-01
    severity: warning
    disposition: fixed
  - id: WR-02
    severity: warning
    disposition: fixed
  - id: IN-05
    severity: info
    disposition: fixed
  - id: WR-03
    severity: warning
    disposition: open
  - id: WR-04
    severity: warning
    disposition: open
  - id: WR-05
    severity: warning
    disposition: open
  - id: WR-06
    severity: warning
    disposition: open
  - id: WR-07
    severity: warning
    disposition: open
  - id: IN-01
    severity: info
    disposition: open
  - id: IN-02
    severity: info
    disposition: open
  - id: IN-03
    severity: info
    disposition: open
  - id: IN-04
    severity: info
    disposition: open
  - id: WR-G1
    severity: warning
    disposition: open
    title: "Probe anchor is stranded OPEN/CRITICAL forever once the webhook is removed after a failed probe"
  - id: WR-G2
    severity: warning
    disposition: open
    title: "Repeated probe failure on an ACKNOWLEDGED anchor flips it to OPEN with no transition row (D-04 violation)"
  - id: WR-G3
    severity: warning
    disposition: open
    title: "Impossible-state guard — instanceof Redis/Queue checks in close() can never be false"
  - id: IN-G1
    severity: info
    disposition: open
    title: "Non-integer HttpException status is counted into the 5xx numerator on a false premise"
  - id: IN-G2
    severity: info
    disposition: open
    title: "Dead parameter in the runOneTick test helper"
open: 19
total: 24
recorded: 2026-11-14T06:13:28.639Z
---

# Phase 09: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-08 | warning | open | - |
| IN-06 | info | open | - |
| IN-07 | info | open | - |
| IN-08 | info | open | - |
| IN-09 | info | open | - |
| CR-01 | critical | fixed | Closed by 09-05 Task 1 (inspector passed into scheduleAlertingTick; commits `8948374`/`a08e05c`); confirmed by 09-REVIEW-GAPS.md (not in the current review) |
| CR-02 | critical | fixed | Closed by 09-05 Task 2 (PROBE_ANCHOR_SIGNAL excluded from resolveClearedAlerts; commit `a08e05c`); confirmed by 09-REVIEW-GAPS.md (not in the current review) |
| WR-01 | warning | fixed | Closed by 09-06 Task 1 (raw exceptions counted into 5xx numerator; commits `87fee2e`/`d86112e`); confirmed by 09-REVIEW-GAPS.md (not in the current review) |
| WR-02 | warning | fixed | Closed by 09-06 Task 2 (TTL 120→420 + cross-module mirror guard; commits `f142f61`/`a511349`); confirmed by 09-REVIEW-GAPS.md (not in the current review) |
| IN-05 | info | fixed | Closed by 09-05 Task 2 (probe success resolves OPEN and ACKNOWLEDGED anchors; commit `a08e05c`); confirmed by 09-REVIEW-GAPS.md (not in the current review) |
| WR-03 | warning | open | Де-эскалация CRITICAL→WARNING отправляется как alert_escalated (not in the current review) |
| WR-04 | warning | open | Неограниченный Retry-After может заморозить evaluator (not in the current review) |
| WR-05 | warning | open | Ключи ALERT_SIGNAL_LABELS не совпадают с фактическими сигналами (SYNC_FAILURES/DEAD_LETTER) (not in the current review) |
| WR-06 | warning | open | Гонка acknowledge: RESOLVED-алерт может вернуться в ACKNOWLEDGED (not in the current review) |
| WR-07 | warning | open | INFO в ALERT_SEVERITY_RANK — impossible-state guard (necessity) (not in the current review) |
| IN-01 | info | open | Мёртвая константа MAX_TIMER_DELAY (not in the current review) |
| IN-02 | info | open | Неиспользуемые поля inspector/state в scheduleDeliveryProbe (not in the current review) |
| IN-03 | info | open | take: 100 без пагинации молча скрывает старые активные алерты (not in the current review) |
| IN-04 | info | open | Гонка find→create в dedupUpsert роняет остаток тика (not in the current review) |
| WR-G1 | warning | open | (09-REVIEW-GAPS.md, 2026-11-13) После неудачного probe удаление ALERT_WEBHOOK_URL + перезапуск оставляет якорь навсегда OPEN/CRITICAL без пути к разрешению (probe не вооружается при main.ts:194, evaluator якорь исключён alerts.ts:409) — противоречие честному «не настроен» по D-01 (not in the current review) |
| WR-G2 | warning | open | (09-REVIEW-GAPS.md, 2026-11-13) Повторный провал probe на ACKNOWLEDGED-якоре молча переводит его в OPEN без transition-строки, acknowledgedAt остаётся выставленным — нарушение D-04; смежный скоуп (блок существовал до closure, живёт в якорном цикле, который closure взял во владение) (not in the current review) |
| WR-G3 | warning | open | (09-REVIEW-GAPS.md, 2026-11-13) Impossible-state guard: instanceof Redis/Queue в close() (main.ts:210-211) недостижимо ложны — ветка исполняется только когда deps falsy, а значения построены двумя строками выше (not in the current review) |
| IN-G1 | info | open | (09-REVIEW-GAPS.md, 2026-11-13) Нецелочисленный статус HttpException (getStatus() → null) попадает в 5xx-числитель на посылке «null ⇒ Nest отвечает 500» — верно только для сырых исключений (not in the current review) |
| IN-G2 | info | open | (09-REVIEW-GAPS.md, 2026-11-13) Мёртвый параметр runtime в хелпере runOneTick композиционного теста (not in the current review) |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
