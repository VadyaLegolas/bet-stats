---
phase: 09-degradation-alerting
verified: 2026-11-14T14:33:24Z
status: human_needed
score: 8/9 must-haves verified
covered_files: [".planning/phases/09-degradation-alerting/09-01-PLAN.md", ".planning/phases/09-degradation-alerting/09-01-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-02-PLAN.md", ".planning/phases/09-degradation-alerting/09-02-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-03-PLAN.md", ".planning/phases/09-degradation-alerting/09-03-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-04-PLAN.md", ".planning/phases/09-degradation-alerting/09-04-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-05-PLAN.md", ".planning/phases/09-degradation-alerting/09-05-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-06-PLAN.md", ".planning/phases/09-degradation-alerting/09-06-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-07-PLAN.md", ".planning/phases/09-degradation-alerting/09-07-SUMMARY.md", "apps/web/app/globals.css", "apps/web/app/internal/operations/alerts-block.tsx", "tests/e2e/operator-overview.spec.ts", "tests/integration/alerts-fingerprint.test.ts", "tests/unit/alerts-composition.test.ts", "tests/unit/alerts-signals.test.ts", "workers/data-sync/src/jobs/alerts.ts", "workers/data-sync/src/jobs/delivery-probe.ts"]
covered_digest: "v4:sha256:e6c03e833140d94424fdfc31f021b724c2965bbe2b2656f6da1afaf80c90d47e"
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 7/7
  gaps_closed:
    - "G-09-1 (блокер UAT): fingerprint-разделитель заменён на NUL-free U+001F; roundtrip dedupUpsert по реальному PostgreSQL доказан собственным прогоном верификатора (tests/integration/alerts-fingerprint.test.ts, 3/3 на owned-контейнерах после `prisma migrate deploy`)"
    - "G-09-2 (minor UAT): zoom-200% @ 320px reflow — постоянный e2e-кейс в operator-overview.spec.ts, CSS-фикс в globals.css; код-уровень VERIFIED, поведенческий прогон e2e требует owned release stack — перенесён в human verification"
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "WR-G1: 廒 DELIVERY_HEALTH остаётся OPEN/CRITICAL навсегда, если после неудачного probe удаляется ALERT_WEBHOOK_URL и не перезапускается воркер (probe не вооружается, evaluator 廒 исключает)"
    category: other
    reason: "Задокументировано в 09-REVIEW-DISPOSITION.md (carried-forward из предыдущей верификации); closure не решён пользователем"
    evidence_status: "none provided"
  - finding: "WR-G2: успех probe на ACKNOWLEDGED-廒 переходит в OPEN без transition-строки и без затирания acknowledgedAt (безвредно, но неидеально)"
    category: other
    reason: "Carried-forward; ledger: <безвредный побочный эффект>"
    evidence_status: "none provided"
  - finding: "WR-G3: instanceof-guard в close() всегда истинен (necessity) — неиспользуемая защита"
    category: other
    reason: "Carried-forward; scope-вопрос чистоты"
    evidence_status: "none provided"
  - finding: "IN-G1: фракционные ошибки HttpException обрабатываются фильтром по ветке <null ? 500> (только contrived-случай)"
    category: other
    reason: "Carried-forward; ledger"
    evidence_status: "none provided"
  - finding: "IN-G2: лишний параметр runtime в runOneTick (неиспользуемый)"
    category: other
    reason: "Carried-forward; ledger"
    evidence_status: "none provided"
  - finding: "Документ-состояние устарело: REQUIREMENTS.md строки ALRT-03/ALRT-04 всё ещё 'Gaps Found' + чекбоксы [ ], ROADMAP.md чекбокс 09-07-PLAN.md не отмечен — при том что 09-UAT.md фиксирует оба gap'а как resolved (resolved_by: 09-07)"
    category: other
    reason: "Косметика планировочных документов, не код; обновится при финальном reconcile /gsd-verify-work"
    evidence_status: "none provided"
behavior_unverified_items:
  - truth: "При html zoom 200% на viewport 320px страница /internal/operations переполняется без горизонтального скролла (scrollWidth ? clientWidth + 1) — и при zoom 100% ничего не регрессирует"
    test: "Запустить `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts` (запускает owned release stack через live-release-stack.ts globalSetup: Docker + Node 24 обязательны), затем визуально подтвердить на 320px/zoom 200%, что release-header-tools, quota-counter, theme-toggle и секции не обрезаются"
    expected: "Кейс 'html zoom 200% at 320px reflows without horizontal scroll (G-09-2)' зелёный (overflow ? 1px); существующие desktop/mobile/zoom-100% кейсы зелёные"
    why_human: "e2e требует owned release stack (dev-серверы не запускаются верификатором); кейс и код-фикс есть в репозитории (verified presence), но поведенческий прогон в этом раунде не выполнялся — финальное подтверждение за /gsd-verify-work"
---

# Phase 9: Degradation Alerting - Verification Report (ре-верификация после plan 09-07)

**Phase Goal:** An operator is proactively told when the platform degrades - provider-quota exhaustion, worker failures and dead letters, sync-run failures, 5xx spikes, and backup staleness - with PostgreSQL as the source of truth and the operations center as the operator's view.
**Verified:** 2026-11-14T14:33:24Z
**Status:** human_needed
**Re-verification:** Yes — предыдущий 09-VERIFICATION.md устарел (stale) после plan 09-07 (commit 0a03eeb затронул 8 файлов из covered-набора)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: каждый настроенный сигнал деградации (квоты, отказы/дед-леттеры воркеров, отказы sync-run, всплески 5xx, устаревание бэкапов) создаёт durable-оповещение с дедупликацией, severity-уровнями и историей переходов | ✓ VERIFIED | Быстрая регрессия: состав-корень цел (main.ts передаёт `inspector` в `scheduleAlertingTick`, CR-01); `resolveClearedAlerts` по-прежнему исключает probe-якорь (alerts.ts:409, CR-02); **собственный поведенческий прогон верификатора: интеграционный гейт на owned PostgreSQL 18.6 — alert-наборы 37/37 (alerts-fingerprint 3 + alerts 9 + operator-overview 25)**; 62/62 unit alert-тестов; живой тик на dev-стеке — carried human item (см. behavior_unverified_items предыдущего раунда, proxy принят) |
| 2 | SC2: оператор видит активные и недавние оповещения в operations center с correlation-контекстом и секретами, скрытыми от вывода | ✓ VERIFIED | Быстрая регрессия: alerts-block.tsx + page.tsx целы; **SSR 39/39 passed (собственный прогон)**; canary-утверждения в operator-overview.spec.ts на месте |
| 3 | SC3: dispatch доставляет в настраиваемый webhook без утечки секретов или betting-данных; неудачная доставка не теряет оповещение | ✓ VERIFIED | Быстрая регрессия: dispatchWebhook + canary-тесты зелёные (в 62/62); источник истины в PostgreSQL независимо от доставки — подтверждено реальным DB-раундтрипом (#8) |
| 4 | SC4: probes и alerting никогда не вызывают живых внешних провайдеров; отказы не создают alert fatigue | ✓ VERIFIED | Быстрая регрессия: probe-файл <never calls live providers - payload is a typed allowlist only>; авто-разрешение только по probe-сигналу (alerts.ts:409); damping/dedup зелёные в 62/62 |
| 5 | Plan 02: все signal-адаптеры досягаемы из тика (inspector через startAlertingRuntime, CR-01) | ✓ VERIFIED | main.ts:187 `inspector,` на месте; интеграционно-композиционный тест зелёный (в 62/62) |
| 6 | Plan 02: неудачный delivery-probe не резолвится автоматически, успех резолвит OPEN/ACKNOWLEDGED (CR-02/IN-05) | ✓ VERIFIED | alerts.ts:417 `signal: { not: PROBE_ANCHOR_SIGNAL }`; delivery-probe.ts цел; оба теста зелёные (в 62/62) |
| 7 | Plan 01: OpsAlert/OpsAlertTransition/OpsAlertDelivery в PostgreSQL с guarded-миграцией, append-only гарантией | ✓ VERIFIED | schema.prisma:1127/1148/1164; миграция 20261108_phase09_ops_alerts применена **собственным прогоном** (`prisma migrate deploy` в интеграционном гейте: "All migrations have been successfully applied") на чистой БД |
| 8 | Plan 07 (G-09-1): evaluator пишет реальный alertFingerprint в PostgreSQL без ошибки 22021; разделитель U+001F — единственный закреплённый источник; probe-якорь и web dedup-ключ выведены из него | ✓ VERIFIED | Код: alerts.ts:70 `ALERT_FINGERPRINT_SEPARATOR = "\u001f"`, :75 интерполяция; delivery-probe.ts:11 `alertFingerprint(DELIVERY_PROBE_SIGNAL, DELIVERY_PROBE_SCOPE)` (второго литерала нет); alerts-block.tsx:53 зеркальный `DEDUP_KEY_SEPARATOR`; unit-хелперы на константе (жёстких старых литералов нет). **Поведение: tests/integration/alerts-fingerprint.test.ts 3/3 на реальном PostgreSQL (create / occurrence count=2 / guarded RESOLVED?OPEN re-open с transition-строкой) — собственный прогон верификатора** |
| 9 | Plan 07 (G-09-2): при zoom 200% на 320px /internal/operations вписывается без горизонтального скролла; zoom 100% без регрессий | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Присутствие+проводка: e2e-кейс в operator-overview.spec.ts:48-62 (утверждение scrollWidth-clientWidth ? 1 + H1 видим), CSS-фикс: globals.css `min-width: 0` для quota-counter в обоих media-блоках (строки 349/353) + `overflow-wrap: anywhere; min-width: 0` на section/header/h1/h2/p/dl в ?480px; zoom-100% контроль-утверждение на месте (строка 44). Поведение не прогонялось верификатором (e2e требует owned release stack) — ? human verification |

**Score:** 8/9 truths verified (1 present, behavior-unverified)

### Verified Evidence (собственные прогоны этого раунда, не SUMMARY)

- `pnpm vitest run --project unit` (полный юнит-проект, регрессионный гейт): **512/519 passed**; единственный упавший файл `tests/unit/fixtures-sync.test.ts` (7 тестов, "Authentication failed against the database server" — dev-DB-предпосылка; файл фазы ?9, не затронут коммитами фазы 09) — принято как известная средовая предпосылка, не регрессия
- Alert unit-набор (5 файлов): **62/62 passed**
- SSR alerts-block: **39/39 passed**
- Интеграционный гейт `pnpm run test:integration:docker` (owned postgres:18 + redis:8, `migrate deploy`, весь integration-проект): **514/515 passed**; единственный отказ — `privacy-retention.test.ts` ("waits for the TCP listener...", timeout 20s при вложенном docker-запуске под нагрузкой полного прогона ~12 мин; файл фазы 06, вне фазы 09, не в covered-наборе) — классифицирован как тайминговый/средовой отказ, не регрессия фазы 09
- Повторный прицельный прогон alert-интеграции на owned-контейнерах: `alerts-fingerprint.test.ts` + `alerts.test.ts` + `operator-overview.test.ts` — **37/37 passed**
- `npx tsc --noEmit`: workers/data-sync **exit 0**, apps/api **exit 0**, apps/web **exit 0**
- Prohibition-проверка plan 09-07: `git show 0a03eeb --stat` — только 8 заявленных файлов, **packages/database/** и package.json не затронуты (нет schema/migration/dependency изменений)
- Debt-маркеры (TBD/FIXME/XXX/PLACEHOLDER/HACK) во всех 8 covered-файлах: не обнаружены

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `workers/data-sync/src/jobs/alerts.ts` | ALERT_FINGERPRINT_SEPARATOR (U+001F) + интерполяция в alertFingerprint | ✓ VERIFIED | строки 70, 75; dedupUpsert:366, fired-set:547/553 идут через alertFingerprint; оставшиеся `\0` в файле (97, 164, 204) — только in-memory Map-ключи группировки, не DB-записи |
| `workers/data-sync/src/jobs/delivery-probe.ts` | DELIVERY_PROBE_FINGERPRINT выведен из alertFingerprint | ✓ VERIFIED | строка 11 — второй литерал-разделитель отсутствует |
| `apps/web/app/internal/operations/alerts-block.tsx` | DEDUP_KEY_SEPARATOR-зеркало | ✓ VERIFIED | строка 53 (константа `\u001f`), строка 111 — сборка ключа из неё |
| `apps/web/app/globals.css` | CSS-only zoom-200% фикс | ✓ VERIFIED (presence) | ?720px: `.quota-counter { min-width: 0; ... }` (349); ?480px: `min-width: 0` (353) + `overflow-wrap: anywhere; min-width: 0` на блочных контейнерах (356) |
| `tests/unit/alerts-signals.test.ts` / `alerts-composition.test.ts` | хелперы на новой константе | ✓ VERIFIED | split/replace на ALERT_FINGERPRINT_SEPARATOR; жёсткие литералы 245/252 переведены на константу |
| `tests/integration/alerts-fingerprint.test.ts` | real-PostgreSQL roundtrip-набор | ✓ VERIFIED | 3 кейса, guarded Prisma-пути, pid-scoped scope, инвариант "no NUL" — прогон 3/3 |
| `tests/e2e/operator-overview.spec.ts` | постоянный zoom-200% кейс | ✓ VERIFIED (presence) | строки 48-62; подписанные заголовки, H1-видимость, overflow ? 1px; поведенческий прогон ? human |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| alertFingerprint (alerts.ts) | dedupUpsert findUnique/update by dedupFingerprint | реальный PostgreSQL TEXT | ✓ WIRED | интеграционный раундtrip 3/3 на живой БД — точная связь, которую ломал 22021 |
| alertFingerprint | DELIVERY_PROBE_FINGERPRINT (delivery-probe.ts) | импорт ./alerts.js | ✓ WIRED | выведено, не пересобрано |
| alertFingerprint | alerts-block.tsx dedup-ключ | DEDUP_KEY_SEPARATOR-зеркало | ✓ WIRED | константа + комментарий о worker-tree границе |
| .quota-counter min-width:0 | zoom-200% reflow | ?480px media-правило | ✓ WIRED (presence) | правило на месте; поведенческий прогон e2e ? human |
| startAlertingRuntime | scheduleAlertingTick `inspector` | composition root | ✓ WIRED | main.ts:187 (регрессия прошлых раундов не нарушена) |
| resolveClearedAlerts | PROBE_ANCHOR_SIGNAL-исключение | `signal: { not }` | ✓ WIRED | alerts.ts:417 |
| Prisma migrate deploy | 20261108_phase09_ops_alerts | миграция на чистой БД | ✓ WIRED | применена верификатором в гейте |
| NestJS filter / evaluator / read model / UI | (прошлые связи) | — | ✓ WIRED | быстрая регрессия без изменений; детали в отчёте 2026-11-13 (git-история) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Полный юнит-проект (регрессия) | `pnpm vitest run --project unit` | 512/519; 7 failures только fixtures-sync.test.ts (dev-DB credentials, вне фазы 09) | ✓ PASS (с оговоркой) |
| Alert unit-набор | `pnpm vitest run --project unit tests/unit/alerts-{signals,composition,delivery-probe,dispatch,5xx-filter}.test.ts` | 62/62 passed | ✓ PASS |
| SSR AlertsBlock | `pnpm --filter @bet-stats/web exec vitest run ... alerts-block.test.ts` | 39/39 passed | ✓ PASS |
| Интеграционный гейт (полный) | `pnpm run test:integration:docker` | 514/515; 1 failure privacy-retention.test.ts (тайминг вложенного docker, фаза 06) | ✓ PASS (с оговоркой) |
| Alert-интеграция на реальном PostgreSQL | owned-контейнеры: alerts-fingerprint + alerts + operator-overview | 37/37 passed | ✓ PASS |
| Typecheck | tsc --noEmit (workers/api/web) | 3 ? exit 0 | ✓ PASS |
| e2e zoom-200% reflow | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts` | требует owned release stack | ? SKIP ? human verification |

### Probe Execution

Shell-пробы (`scripts/*/tests/probe-*.sh`) в фазе нет; PLAN/SUMMARY не объявляют probe-файлов — шаг не применим. Псевдо-probe поведенческого уровня выполнены выше (Behavioral Spot-Checks).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ALRT-01 | 01, 02, 03, 05, 06, 07 | Оператор получает оповещения о деградации: квоты, отказы/дед-леттеры воркеров, отказы sync-run, 5xx, бэкапы | ✓ SATISFIED | Все 5 сигналов покрыты; G-09-1 устранял блокер записи оповещений в реальную БД — теперь доказано live-раундтрипом |
| ALRT-02 | 01, 02, 05, 07 | Durable PostgreSQL-записи с дедупликацией, severity-уровнями, историей переходов; доставка — попытка, не источник истины | ✓ SATISFIED | guarded-миграция применена на чистой БД; дедуп/occurrence/re-open/transition доказаны интеграцией 3/3 |
| ALRT-03 | 03, 04, 07 | Оператор видит активные/недавние оповещения в operations center с correlation и скрытыми секретами | ✓ SATISFIED | SSR 39/39; G-09-2 (zoom reflow) закрыт код-уровнем, поведенческое подтверждение ? финальный human-чек /gsd-verify-work |
| ALRT-04 | 02, 03, 04 | Доставка в настраиваемый webhook без утечки секретов/betting-данных | ✓ SATISFIED | dispatchWebhook + canary зелёные; источник истины не зависит от доставки (доказано #8) |

Orphaned requirements: нет — все 4 ID фазы объявлены в планах (01: ALRT-02; 02: 01/02/04; 03: 01/03/04; 04: 03/04; 05: 01/02; 06: 01; 07: 02/03) и покрыты.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| workers/data-sync/src/jobs/alerts.ts | 97, 164, 204 | In-memory Map-ключи с `\0`-разделителем (не DB) | ?? Info | Легитимно: Redis/память хранит NUL безопасно; DB-путь изолирован alertFingerprint |
| tests/integration/privacy-retention.test.ts | 116 | Тайминг-зависимый кейс (20s timeout на вложенный docker-старт) вне фазы 09 | ?? Info | Упал 1 раз под нагрузкой полного гейта; фаза 06, не covered-файл — наблюдение, не регрессия 09 |
| (carried) delivery-probe.ts / main.ts / alerts.ts | — | WR-G1/WR-G2/WR-G3, IN-G1/IN-G2 | ?? Warning (advisory) | Задокументированы в 09-REVIEW-DISPOSITION.md; не gap этого раунда |

Blocking anti-patterns: отсутствуют. Debt-маркеры в covered-файлах: не обнаружены.

### Human Verification Required

### 1. Живой тик evaluator'а (carried из предыдущего раунда; proxy принят)
**Test:** В рабочем окружении установить ALERTS_ENABLED=true (+ опционально ALERT_WEBHOOK_URL), перезапустить воркер, дождаться тика, проверить OpsAlert/OpsAlertDelivery в PostgreSQL и TTL ключей bet-stats:http5xx:* (ожидание: 420s после WR-02).
**Expected:** Тик выполняется без ошибок; записи появляются в PostgreSQL; channelState корректен.
**Why human:** Требует dev-серверов пользователя (задокументированные ограничения); интеграционные proxy-пробы верифицируют startAlertingRuntime по интерфейсам, но не PostgreSQL/Redis/BullMQ-интеграцию живого стека.

### 2. Финальное подтверждение reflow: zoom 200% @ 320px (G-09-2) + визуальный чек operations center
**Test:** Запустить `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts` (owned release stack), затем визуально: 320px/zoom 200% — без горизонтального скролла, theme-toggle ? 44px, ack через фейковый HMAC-заголовок, ack-фидбек.
**Expected:** e2e-кейс 'html zoom 200% at 320px reflows without horizontal scroll (G-09-2)' зелёный; desktop/mobile кейсы зелёные; в браузере текст переносится, ничего не обрезано.
**Why human:** Поведенческое доказательство требует запуска release stack; визуальная корректность и фидбек не проверяются SSR-пробами.

### 3. Живые Redis-счётчики 5xx (carried)
**Test:** На живом стеке вызвать намеренно ошибочный запрос и проверить ключи bet-stats:http5xx:*/httpTotal:* в Redis.
**Expected:** Счётчики растут с TTL 420s; ответ 500 (в т.ч. raw-исключение, WR-01) инкрементирует http5xx.
**Why human:** Требует живого Redis и реальной маршрутизации.

### Gaps Summary

Ре-верификация после plan 09-07 (commit 0a03eeb): **блокер G-09-1 закрыт с поведенческим доказательством** — верификатор собственным прогоном развернул owned PostgreSQL 18.6, применил миграции и провёл полный roundtrip dedupUpsert (create ? occurrence ? guarded resolve ? re-open) с реальным U+001F-фингерпринтом: 3/3 зелёные. Разделитель — единственный закреплённый источник (ALERT_FINGERPRINT_SEPARATOR), probe-якорь выведен из него, web-зеркало согласовано, unit-хелперы переведены. **G-09-2 закрыт код-уровнем**: постоянный e2e-кейс и CSS-фикс на месте; поведенческий прогон требует owned release stack и остаётся финальным human-чеком.

Regрессии нет: юнит-проект 512/519 (единственные 7 отказов — fixtures-sync.test.ts, средовая dev-DB предпосылка, файл вне фазы), alert-наборы 62/62 unit + 37/37 интеграция + 39/39 SSR, tsc ?3 exit 0. Отказ privacy-retention.test.ts в полном интеграционном гейте — тайминговый, в файле фазы 06 вне covered-набора; рекомендован к наблюдению, не блокер фазы 09.

Prohibitions plan 09-07 соблюдены: packages/database/** и package.json не затронуты (git show 0a03eeb --stat), интеграционный тест идёт только через guarded Prisma-пути.

Статус **human_needed** (не passed) из-за одного behavior-unverified truth (zoom-200% reflow — e2e требует release stack) и carried живых человеческих проверок (живой тик, Redis-счётчики, визуальный чек). Финальное подтверждение — /gsd-verify-work.

---

_Verified: 2026-11-14T14:33:24Z_
_Verifier: the agent (gsd-verifier)_
