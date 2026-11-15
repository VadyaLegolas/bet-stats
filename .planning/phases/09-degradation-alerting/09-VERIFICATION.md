---
phase: 09-degradation-alerting
verified: 2026-11-15T00:30:32Z
status: gaps_found
score: 8/9 must-haves verified
covered_files: [".planning/phases/09-degradation-alerting/09-01-PLAN.md", ".planning/phases/09-degradation-alerting/09-01-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-02-PLAN.md", ".planning/phases/09-degradation-alerting/09-02-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-03-PLAN.md", ".planning/phases/09-degradation-alerting/09-03-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-04-PLAN.md", ".planning/phases/09-degradation-alerting/09-04-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-05-PLAN.md", ".planning/phases/09-degradation-alerting/09-05-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-06-PLAN.md", ".planning/phases/09-degradation-alerting/09-06-SUMMARY.md", ".planning/phases/09-degradation-alerting/09-07-PLAN.md", ".planning/phases/09-degradation-alerting/09-07-SUMMARY.md", "apps/web/app/globals.css", "apps/web/app/internal/operations/alerts-block.tsx", "tests/e2e/operator-overview.spec.ts", "tests/integration/alerts-fingerprint.test.ts", "tests/unit/alerts-composition.test.ts", "tests/unit/alerts-signals.test.ts", "workers/data-sync/src/jobs/alerts.ts", "workers/data-sync/src/jobs/delivery-probe.ts"]
covered_digest: "v4:sha256:2fdf8f143dd2cb33a907009aa4046f97d5b700a982714550044e596d45045e33"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 8/9
  gaps_closed:
    - "G-09-1 (блокер UAT, NUL-фингерпринт): закрыт с независимым верификаторским доказательством — (а) собственный прогон round 2: интеграционный roundtrip на owned PostgreSQL 18.6, 3/3; (б) собственная проверка round 3: живые строки OpsAlert в Docker-PostgreSQL, созданные реальным evaluator-тиком 2026-11-14 (DEAD_LETTER/WARNING, U+001F ровно на позиции 12 = после 11 символов сигнала; SYNC_FAILURES — позиция 14, WEBHOOK_FAILED — позиция 15), NUL-путь отсутствует, честные RESOLVED с иммутабельными OpsAlertTransition (OPEN→RESOLVED, 2026-11-14 13:51:55); (в) сессия этого раунда: 09-UAT.md тесты 1/5 (resolved_by: 09-07), интеграция alerts-fingerprint 3/3 + alerts+operator-overview 34/34, юнит 62/62"
    - "G-09-2 (minor UAT, zoom-200% reflow): закрыт с собственным поведенческим прогоном верификатора round 3 — формальный e2e 'html zoom 200% at 320px reflows without horizontal scroll (G-09-2)' ЗЕЛЁНЫЙ в обоих проектах (desktop-chromium + mobile-chromium, 2 passed) на owned release stack через playwright.phase06.config.ts; плюс формальный прогон UAT 2026-11-14 (2 passed) и живая визуальная проверка в реальном Chrome (zoomDiff=0, theme-toggle 88×88 CSS px, тёмная тема, скриншот uat6-zoom-200-320px.png)"
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "At zoom 100% nothing regresses: the existing 320px no-scroll assertion in operator-overview.spec.ts and the release-accessibility zoom/reflow tests stay green"
    status: failed
    reason: "Собственный полный прогон e2e-спеки верификатором (2 прогона, owned release stack): 4 из 6 кейсов operator-overview.spec.ts красные — постоянный guard операций-центра мёртв; утверждение no-scroll (строка 44) недостижимо. Причина A (добавлена фазой 08, усугублена фазой 09-04): страница рендерит 8 h2-секций (фаза 08 «Резервные копии и проверка восстановления», фаза 09-04 «Алерты»), а spec ждёт ровно 6 (список заморожен 2026-10-15, d44f65f — после этого spec не обновлялся). Причина B (внесена фазой 09-04): клиентский fetch страницы добавляет alertPage=N (page.tsx:60), а e2e подписывает HMAC только page/pageSize/windowHours → дайджест запроса не совпадает с подписанным → прокси возвращает 404 (доказано трассой Playwright: GET /internal-api/operations/overview?page=1&pageSize=25&windowHours=24&alertPage=1 → HTTP 404 от web :3240) → все блоки в состоянии ошибки. Продукт-уровень не пострадал (страница рендерится, zoom-инвариант 100% доказан живьём в UAT round 1), но регрессионный guard — красный, и одна из двух причин — код фазы 09"
    artifacts:
      - path: "tests/e2e/operator-overview.spec.ts"
        issue: "Строка 37: ожидание 6 h2, фактически 8; строки 12-17: подпись не покрывает alertPage — 4 render-кейса (desktop/mobile × 2 проекта) красные в прогоне верификатора"
      - path: "apps/web/app/internal/operations/page.tsx"
        issue: "Строка 60: fetch(`/internal-api/operations/overview${query}...alertPage=${alertPage}`) — контракт запроса изменён фазой 09-04 без обновления e2e-подписи"
    missing:
      - "Обновить список ожидаемых h2 в operator-overview.spec.ts до текущих 8 секций operations center"
      - "Синхронизировать подпись e2e с реальным fetch-URL (включить alertPage=1 в подписываемый search) — либо вынести подпись в общий хелпер, чтобы страница и тест не расходились"
      - "Полный зелёный прогон operator-overview.spec.ts (все 3 кейса × 2 проекта) на owned release stack после фикса — включая утверждение no-scroll на строке 44 (zoom 100%)"
advisory:
  - finding: "WR-G1: DELIVERY_HEALTH остаётся OPEN/CRITICAL навсегда, если после неудачного probe удаляется ALERT_WEBHOOK_URL и не перезапускается воркер (probe не вооружается, evaluator исключает)"
    category: other
    reason: "Carried-forward (задокументировано в 09-REVIEW-DISPOSITION.md); closure не решён пользователем"
    evidence_status: "none provided"
  - finding: "WR-G2: успех probe на ACKNOWLEDGED переходит в OPEN без transition-строки и без затирания acknowledgedAt (безвредно, но неидеально)"
    category: other
    reason: "Carried-forward; ledger"
    evidence_status: "none provided"
  - finding: "WR-G3: instanceof-guard в close() всегда истинен — неиспользуемая защита"
    category: other
    reason: "Carried-forward; scope-вопрос чистоты"
    evidence_status: "none provided"
  - finding: "IN-G1: фракционные ошибки HttpException обрабатываются фильтром по ветке <null ? 500> (только contrived-случай); IN-G2: лишний параметр runtime в runOneTick"
    category: other
    reason: "Carried-forward; ledger"
    evidence_status: "none provided"
  - finding: "Документ-состояние устарело: REQUIREMENTS.md ALRT-03/ALRT-04 всё ещё 'Gaps Found' + чекбоксы [ ], ROADMAP.md чекбокс 09-07 не отмечен — при том что 09-UAT.md фиксирует оба gap'а как resolved и раунд 3 подтверждает"
    category: other
    reason: "Косметика планировочных документов, не код; обновится при финальном reconcile /gsd-verify-work"
    evidence_status: "none provided"
  - finding: "Маскировка прогона: в 09-UAT.md тест 6 записан как '2 passed… спека содержит единственный тест, поэтому прогоны полные' — фактически спека содержит 3 теста с d44f65f; прогон шёл с фильтром по zoom-кейсу, и 4 красных render-кейса остались незамеченными в UAT и в раундах 1–2 (полный прогон spec не выполнялся ни разу в фазе 09 до прогона верификатора в раунде 3)"
    category: other
    reason: "Процессное наблюдение: записывать в UAT область прогона (grep/фильтр) явно; полный прогон спеки — при следующем прогоне после фикса gap'а"
    evidence_status: "deterministic (прогон верификатора round 3: 2 passed / 4 failed)"
---

# Phase 9: Degradation Alerting - Verification Report (ре-верификация round 3)

**Phase Goal:** An operator is proactively told when the platform degrades — provider-quota exhaustion, worker failures and dead letters, sync-run failures, 5xx spikes, and backup staleness — with PostgreSQL as the source of truth and the operations center as the operator's view.
**Verified:** 2026-11-15T00:30:32Z
**Status:** gaps_found
**Re-verification:** Yes — round 3; UAT-сессия завершена (09-UAT.md: 5 passed, 2 issues — оба resolved_by: 09-07, подтверждены #4983)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: каждый настроенный сигнал деградации (квоты, отказы/дед-леттеры воркеров, отказы sync-run, всплески 5xx, устаревание бэкапов) создаёт durable-оповещение с дедупликацией, severity-уровнями и историей переходов | ✓ VERIFIED | Быстрая регрессия round 3: состав-корень цел (main.ts:187 `inspector` → scheduleAlertingTick, CR-01); resolveClearedAlerts исключает probe-якорь (alerts.ts:419, CR-02). Поведение: живые строки OpsAlert от реального evaluator-тика в PostgreSQL проверены верификатором напрямую (см. #8); юнит 62/62 + интеграция 37/37 — сессия раунда |
| 2 | SC2: оператор видит активные и недавние оповещения в operations center с correlation-контекстом и секретами, скрытыми от вывода | ✓ VERIFIED | Быстрая регрессия: alerts-block.tsx + page.tsx целы; SSR 39/39 (round 2); живой рендер подтверждён UAT тестом 6 (8 секций, данные загружаются, 51 запрос / 0 отказов через gateway); canary-утверждения в spec на месте |
| 3 | SC3: dispatch доставляет в настраиваемый webhook без утечки секретов или betting-данных; неудачная доставка не теряет оповещение | ✓ VERIFIED | Быстрая регрессия: dispatchWebhook + canary-тесты зелёные (в 62/62); источник истины в PostgreSQL независимо от доставки — подтверждено DB-раундтрипом (#8) |
| 4 | SC4: probes и alerting никогда не вызывают живых внешних провайдеров; отказы не создают alert fatigue | ✓ VERIFIED | Быстрая регрессия: probe-payload — типизированный allowlist; авто-разрешение только по probe-сигналу (alerts.ts:419); damping/dedup зелёные |
| 5 | Plan 02: все signal-адаптеры досягаемы из тика (inspector через startAlertingRuntime, CR-01) | ✓ VERIFIED | main.ts:187 `inspector,` на месте (проверено grep round 3); композиционный тест зелёный |
| 6 | Plan 02: неудачный delivery-probe не резолвится автоматически, успех резолвит OPEN/ACKNOWLEDGED (CR-02/IN-05) | ✓ VERIFIED | alerts.ts:419 `signal: { not: PROBE_ANCHOR_SIGNAL }`; delivery-probe.ts:11 выводит якорь из alertFingerprint; тесты зелёные |
| 7 | Plan 01: OpsAlert/OpsAlertTransition/OpsAlertDelivery в PostgreSQL с guarded-миграцией, append-only гарантией | ✓ VERIFIED | Таблицы существуют в живой БД (проверено psql round 3: OpsAlert, OpsAlertTransition, OpsAlertDelivery); миграция применена прогоном round 2; живые transition-строки OPEN→RESOLVED от тика 2026-11-14 прочитаны верификатором |
| 8 | Plan 07 (G-09-1): evaluator пишет реальный alertFingerprint в PostgreSQL без ошибки 22021; разделитель U+001F — единственный закреплённый источник; probe-якорь и web dedup-ключ выведены из него | ✓ VERIFIED | Код: alerts.ts `ALERT_FINGERPRINT_SEPARATOR = "\u001f"` + интерполяция; delivery-probe.ts:11 `alertFingerprint(...)`; alerts-block.tsx:53/111 зеркало. **Независимое верификаторское доказательство round 3: SELECT по живой БД — OpsAlert-строки тика 2026-11-14 содержат U+001F ровно на ожидаемых позициях (12/14/15), length(fp) 37–47, NUL-путь отсутствует** |
| 9 | Plan 07 (G-09-2): при zoom 200% на 320px /internal/operations вписывается без горизонтального скролла; zoom 100% без регрессий | ✗ FAILED | Zoom-200% часть: **✓ поведенчески доказана собственным прогоном верификатора** — e2e кейс 'html zoom 200% at 320px reflows without horizontal scroll (G-09-2)' зелёный в обоих проектах (2 passed) на owned release stack + формальный UAT-прогон 2026-11-14 + живой Chrome (zoomDiff=0, toggle 88×88). Zoom-100% часть: **✗** — полный прогон spec (2 прогона верификатора): 4 render-кейса красные (список h2 8≠6 + подпись без alertPage → 404 → блоки в ошибке); утверждение no-scroll (строка 44) недостижимо → см. gaps |

**Score:** 8/9 truths verified (1 failed — zoom-100% guard; сам zoom-200% инвариант доказан)

### Verified Evidence (собственные прогоны round 3)

- **Полный e2e operator-overview.spec.ts на owned release stack** (`pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts`): **2 passed / 4 failed (2.6m)** — zoom-кейс G-09-2 зелёный в desktop-chromium и mobile-chromium; 4 render-кейса красные (детерминированно, в двух прогонах) → gap
- **Трасса Playwright** (trace.zip → 0-trace.network): GET `/internal-api/operations/overview?page=1&pageSize=25&windowHours=24&alertPage=1` → **HTTP 404 Not Found** от web :3240 — корневая причина B доказана напрямую
- **release-accessibility.spec.ts: 20/20 passed (1.9m)** — включая 'reflow keeps the page inside 320 CSS pixels' (строка 38) и '200 percent text zoom' (строка 51): вторая половина truth 6 зелёная
- **Живой PostgreSQL (docker exec psql, независимо от SUMMARY/UAT):** OpsAlert — 8 последних строк: DEAD_LETTER/WARNING (тик 2026-11-14 13:51:10) с fp_len 47/37 и U+001F на позиции 12 (DEAD_LETTER = 11 символов); SYNC_FAILURES fp_len 39 / позиция 14; WEBHOOK_FAILED fp_len 34 / позиция 15; ASCII-фикстуры интеграционных тестов (us_pos 0) отличимы. OpsAlertTransition: 2 строки OPEN→RESOLVED 2026-11-14 13:51:55 — честное разрешение с иммутабельной историей
- **Регрессионный гейт юнитов** (сессия раунда): 512/519 passed; единственный отказ tests/unit/fixtures-sync.test.ts (7 тестов, live-DB credentials) — документированная средовая предпосылка round 1 (user-approved), файл вне фазы 09
- **Интеграция сессии раунда:** alerts-fingerprint 3/3 + alerts + operator-overview 34/34 на owned PostgreSQL 18.6; юнит alert-набор 62/62
- **Fingerprint обновлён:** `verification.fingerprint` over covered set → `v4:sha256:2fdf8f14…` (свежий; verification.status больше не stale). WIP-коммиты b549581..db7dee4 затронули globals.css только косметикой (drop-shadow/scale у .release-brand .brand-icon — диф проверен, quota-counter/overflow-wrap правила не тронуты); fixtures/FAQ/favicon — вне covered-набора
- **git-диф fada06f..HEAD по operations-файлам и spec:** пусто — красные render-кейсы не след WIP-коммитов пользователя

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `workers/data-sync/src/jobs/alerts.ts` | ALERT_FINGERPRINT_SEPARATOR (U+001F) + интерполяция в alertFingerprint | ✓ VERIFIED | grep round 3: константа + интерполяция; оставшиеся `\0` (строки ~97/164/204) — только in-memory Map-ключи, не DB |
| `workers/data-sync/src/jobs/delivery-probe.ts` | DELIVERY_PROBE_FINGERPRINT выведен из alertFingerprint | ✓ VERIFIED | строка 11, второй литерал-разделитель отсутствует |
| `apps/web/app/internal/operations/alerts-block.tsx` | DEDUP_KEY_SEPARATOR-зеркало | ✓ VERIFIED | строки 53/111 (grep round 3) |
| `apps/web/app/globals.css` | CSS-only zoom-200% фикс | ✓ VERIFIED (presence) | min-width: 0 у .quota-counter (354/358) + overflow-wrap anywhere (361); WIP-диф — только brand-icon glow, zoom-фикс не затронут |
| `tests/unit/alerts-signals.test.ts` / `alerts-composition.test.ts` | хелперы на константе | ✓ VERIFIED | round 2; без изменений (диф пуст) |
| `tests/integration/alerts-fingerprint.test.ts` | real-PostgreSQL roundtrip-набор | ✓ VERIFIED | 3/3 (сессия раунда) |
| `tests/e2e/operator-overview.spec.ts` | постоянный zoom-200% кейс | ⚠️ PARTIAL | zoom-кейс (48–62) зелёный в прогоне верификатора; render-кейсы 30–46 красные (spec drift) → gap |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| alertFingerprint (alerts.ts) | dedupUpsert по dedupFingerprint | реальный PostgreSQL TEXT | ✓ WIRED | живые строки тика 2026-11-14 в БД (верификаторский SELECT) + интеграция 3/3 |
| alertFingerprint | DELIVERY_PROBE_FINGERPRINT | импорт ./alerts.js | ✓ WIRED | delivery-probe.ts:11 |
| alertFingerprint | alerts-block.tsx dedup-ключ | DEDUP_KEY_SEPARATOR-зеркало | ✓ WIRED | строки 53/111 |
| .quota-counter min-width:0 | zoom-200% reflow | ≤480px media-правило | ✓ WIRED | e2e zoom-кейс зелёный (прогон верификатора) |
| startAlertingRuntime | scheduleAlertingTick `inspector` | composition root | ✓ WIRED | main.ts:187 |
| resolveClearedAlerts | PROBE_ANCHOR_SIGNAL-исключение | `signal: { not }` | ✓ WIRED | alerts.ts:419 |
| Prisma migrate deploy | 20261108_phase09_ops_alerts | миграция | ✓ WIRED | применена (round 2); таблицы живут (psql round 3) |
| ops page fetch (page.tsx:60) | e2e-подпись (spec:12-17) | alertPage-параметр | ✗ NOT WIRED | **новый разрыв:** fetch добавляет alertPage, подпись не покрывает → 404 → guard мёртв (доказано трассой) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| OpsAlert rows | dedupFingerprint | alertFingerprint (real evaluator tick) | да — DEAD_LETTER/UAT-проб | ✓ FLOWING |
| OpsAlertTransition | from/to | guarded resolve | да — OPEN→RESOLVED 2026-11-14 | ✓ FLOWING |
| ops page overview fetch | overview JSON | /internal-api/operations/overview | да через gateway (UAT тест 6: 51 запрос/0 отказов); через прямой web e2e-путь — 404 (подпись без alertPage) → gap |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | -------- | ------ |
| Zoom-200% reflow (G-09-2) | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/operator-overview.spec.ts` (полный прогон) | 2 passed (zoom, оба проекта) / 4 failed (render) | ✓ PASS (zoom-часть) / ✗ FAIL (render-часть → gap) |
| Release-accessibility zoom/reflow | `pnpm exec playwright test -c playwright.phase06.config.ts tests/e2e/release-accessibility.spec.ts` | 20/20 passed (1.9m) | ✓ PASS |
| Живой evaluator-тик → PostgreSQL | psql SELECT по OpsAlert/OpsAlertTransition | строки тика 2026-11-14 с U+001F (позиции 12/14/15), NUL нет; transitions OPEN→RESOLVED | ✓ PASS |
| Юнит-регрессия | `pnpm vitest run --project unit` (сессия раунда) | 512/519; 7 failures — fixtures-sync (live-DB credentials, вне фазы) | ✓ PASS (с оговоркой) |
| Интеграция на реальном PostgreSQL | alerts-fingerprint + alerts + operator-overview | 3/3 + 34/34 | ✓ PASS |
| Повторный render-прогон (1 кейс, 2 проекта) | `--grep "renders the ordered"` | 2 failed, [api] логи без ошибок (404 от web-прокси — подпись) | ✗ FAIL → gap |

### Probe Execution

Shell-пробы (`scripts/*/tests/probe-*.sh`) в фазе не объявлены — шаг не применим. Поведенческие пробы выполнены выше (Behavioral Spot-Checks + живые psql-проверки).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ALRT-01 | 01, 02, 03, 05, 06, 07 | Оператор получает оповещения о деградации: квоты, отказы/дед-леттеры воркеров, отказы sync-run, 5xx, бэкапы | ✓ SATISFIED | Все 5 сигналов; живой тик написал DEAD_LETTER-алерт в реальную БД (верификаторский SELECT) |
| ALRT-02 | 01, 02, 05, 07 | Durable PostgreSQL-записи с дедупликацией, severity-уровнями, историей переходов; доставка — попытка, не источник истины | ✓ SATISFIED | Живые OpsAlert + OpsAlertTransition (OPEN→RESOLVED) в БД; U+001F-фингерпринты на ожидаемых позициях |
| ALRT-03 | 03, 04, 07 | Оператор видит активные/недавние оповещения в operations center с correlation и скрытыми секретами | ✓ SATISFIED | SSR 39/39; UAT тест 6: живой рендер 8 секций, данные, тёмная тема, zoom 200% без скролла; **новый gap — тест-guard render-кейсов красный (spec drift), продукт-уровень не пострадал** |
| ALRT-04 | 02, 03, 04 | Доставка в настраиваемый webhook без утечки секретов/betting-данных | ✓ SATISFIED | dispatchWebhook + canary зелёные; честный channelState при пустых deliveries (UAT тест 5) |

Orphaned requirements: нет — все 4 ID фазы объявлены в планах (01: ALRT-02; 02: 01/02/04; 03: 01/03/04; 04: 03/04; 05: 01/02; 06: 01; 07: 02/03) и покрыты.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| tests/e2e/operator-overview.spec.ts | 37 | Spec drift: ожидание 6 h2 при 8 фактических секциях (фаза 08 + фаза 09-04) | 🛑 Blocker (внутри gap'а) | 4 render-кейса красные; guard мёртв |
| apps/web/app/internal/operations/page.tsx | 60 | Контракт fetch изменён (alertPage) без обновления e2e-подписи | 🛑 Blocker (внутри gap'а) | HMAC-дайджест не совпадает → 404 → блоки в ошибке в e2e-пути |
| 09-UAT.md | тест 6 note | Маскировка прогона («спека содержит единственный тест» — фактически 3; прогон с фильтром) | ℹ️ Info | 4 красных кейса остались незамеченными в UAT/раундах 1–2 |
| workers/data-sync/src/jobs/alerts.ts | 97/164/204 | In-memory Map-ключи с `\0` (не DB) | ℹ️ Info | Легитимно; DB-путь изолирован alertFingerprint |
| (carried) delivery-probe.ts / main.ts / alerts.ts | — | WR-G1/WR-G2/WR-G3, IN-G1/IN-G2 | ⚠️ Warning (advisory) | Задокументированы в 09-REVIEW-DISPOSITION.md |

Debt-маркеры (TBD/FIXME/XXX/PLACEHOLDER/HACK) в covered-файлах: не обнаружены (round 2 + WIP-диф globals.css без маркеров).

### Human Verification Required

**Пусто** — все перенесённые human-итемы раунда 2 закрыты поведенческими доказательствами:
- Живой тик evaluator'а → 09-UAT.md тест 5 (pass, evidence: evaluateAndDispatch × 2, OpsAlert/Transition read back) + верификаторский psql-SELECT round 3
- Zoom-200% reflow + визуальный чек → 09-UAT.md тест 6 (pass: формальный e2e 2 passed + живой Chrome, zoomDiff=0, toggle 88×88, скриншот) + собственный e2e-прогон верификатора (2 passed)
- Живые Redis-счётчики 5xx → 09-UAT.md тесты 3 и 7 (pass: TTL 418s ≈ WR-02 420s, последовательные минутные бакеты, val = числу запросов)

### Gaps Summary

Ре-верификация round 3: **оба UAT-gap'а закрыты поведенчески** — G-09-1 доказан независимо от SUMMARY (живые OpsAlert-строки тика 2026-11-14 с U+001F на ожидаемых позициях, NUL-путь отсутствует, честные RESOLVED с иммутабельными transitions), G-09-2 — собственный e2e-прогон верификатора (zoom-кейс зелёный в обоих проектах на owned release stack) плюс формальный UAT-прогон и живой Chrome-чек. UAT-сессия завершена (5 passed, 2 issues → оба resolved_by: 09-07); секция human verification пуста — все прежние human-итемы имеют записанные поведенческие доказательства.

**Новый gap (обнаружен первым полным прогоном e2e-спеки в истории фазы 09):** 4 из 6 render-кейсов operator-overview.spec.ts красные — постоянный guard операций-центра мёртв. Две детерминированные причины: (A) spec-дрифт списка h2 (6 ожидаемых против 8 фактических секций; дрифт начат фазой 08 2026-10-23, усугублен фазой 09-04 «Алерты»), (B) фаза 09-04 добавила alertPage в клиентский fetch (page.tsx:60), а e2e-подпись не покрывает новый параметр → HMAC-дайджест не совпадает → web-прокси отвечает 404 (доказано трассой Playwright) → все блоки в состоянии ошибки. Сам zoom-200% инвариант и release-accessibility (20/20) зелёные; продукт-уровень операций-центра работает (живой рендер через gateway доказан UAT тестом 6), но "existing assertions stay green" (must-have плана 09-07) — false, и один из корней — код фазы 09. Деферра в фазу 10 (Performance Audit) нет — goal/criteria фазы 10 не покрывают e2e-guard. Исправление компактное: обновить список h2 в spec, включить alertPage в подписываемый search (или общий хелпер подписи), полный зелёный прогон spec.

Статус **gaps_found**: 1 gap (e2e-guard операций-центра), 8/9 must-haves verified, human verification пуст.

---

_Verified: 2026-11-15T00:30:32Z_
_Verifier: the agent (gsd-verifier)_
